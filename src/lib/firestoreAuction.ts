import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  computeRankedLeaderboard,
  computeTeamEconomyStats,
  DEFAULT_ROOM_SETTINGS,
  getHumanRoomStatus,
  isRenderableImageSrc,
  type AnswerDecision,
  type AnswerSession,
  type AuctionHistoryEntry,
  type AuctionItem,
  type AuctionState,
  type BidRecord,
  type CurrencyType,
  type DifficultyLevel,
  type EconomyTransaction,
  type HostRoomSnapshot,
  type HostUser,
  type MachineState,
  type PublicAuctionItem,
  type PublicRoomSnapshot,
  type QuestionBankItem,
  type RoomSettings,
  type RoomSummary,
  type Team,
  type TeamRoomSnapshot,
} from '../shared/types.ts';
import {
  auth,
  createRandomHex,
  db,
  handleFirestoreError,
  OperationType,
  sha256Hex,
} from './firebase.ts';

export type RoomActionErrorCode =
  | 'NOT_FOUND'
  | 'ROOM_INACTIVE'
  | 'ROOM_COMPLETED'
  | 'ROOM_FULL'
  | 'PIN_REQUIRED'
  | 'PIN_INVALID'
  | 'DUPLICATE_TEAM'
  | 'PERMISSION_DENIED'
  | 'AUTH_REQUIRED'
  | 'VALIDATION'
  | 'UNAVAILABLE';

export class RoomActionError extends Error {
  code: RoomActionErrorCode;

  constructor(code: RoomActionErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface StoredTeamSession {
  roomId: string;
  roomCode: string;
  teamId: string;
  teamName: string;
  authSecret: string;
  isTeamPin: boolean;
}

const TEAM_SESSION_KEY = 'ta2026_team_session_v2';

export function getStoredTeamSession(): StoredTeamSession | null {
  try {
    const raw = localStorage.getItem(TEAM_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredTeamSession>;
    if (
      typeof parsed.roomId === 'string' &&
      typeof parsed.roomCode === 'string' &&
      typeof parsed.teamId === 'string' &&
      typeof parsed.teamName === 'string' &&
      typeof parsed.authSecret === 'string'
    ) {
      return {
        roomId: parsed.roomId,
        roomCode: parsed.roomCode,
        teamId: parsed.teamId,
        teamName: parsed.teamName,
        authSecret: parsed.authSecret,
        isTeamPin: Boolean(parsed.isTeamPin),
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function setStoredTeamSession(session: StoredTeamSession | null): void {
  try {
    if (!session) {
      localStorage.removeItem(TEAM_SESSION_KEY);
    } else {
      localStorage.setItem(TEAM_SESSION_KEY, JSON.stringify(session));
    }
  } catch {
    // ignore storage errors
  }
}

function tsToMs(value: unknown, fallback = Date.now()): number {
  if (value && typeof value === 'object' && 'toMillis' in value && typeof (value as { toMillis: () => number }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return fallback;
}

function newId(prefix = ''): string {
  const raw = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return prefix ? `${prefix}_${raw}` : raw;
}

function normalizeTeamSlug(teamName: string): string {
  const slug = teamName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || `team-${Math.random().toString(36).slice(2, 8)}`;
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function randomRoomCode(): string {
  const buf = new Uint8Array(6);
  crypto.getRandomValues(buf);
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += CODE_CHARS[buf[i] % CODE_CHARS.length];
  }
  return out;
}

function classifyError(err: unknown, fallbackMessage: string): RoomActionError {
  if (err instanceof RoomActionError) return err;
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (lower.includes('permission-denied') || lower.includes('missing or insufficient permissions')) {
    return new RoomActionError(
      'PERMISSION_DENIED',
      'Database permission denied. Please verify your sign-in status or room permissions.',
    );
  }
  if (
    lower.includes('unavailable') ||
    lower.includes('network') ||
    lower.includes('offline') ||
    lower.includes('failed to fetch')
  ) {
    return new RoomActionError(
      'UNAVAILABLE',
      'Connection failure while reaching the cloud database. Please check your internet connection.',
    );
  }
  return new RoomActionError('VALIDATION', msg || fallbackMessage);
}

function normalizeSettings(raw: Partial<RoomSettings> | undefined): RoomSettings {
  return {
    maxTeams: Math.min(200, Math.max(2, Math.trunc(Number(raw?.maxTeams ?? DEFAULT_ROOM_SETTINGS.maxTeams)))),
    startingCoins: Math.min(
      1_000_000,
      Math.max(0, Math.trunc(Number(raw?.startingCoins ?? DEFAULT_ROOM_SETTINGS.startingCoins))),
    ),
    startingPoints: Math.min(
      1_000_000,
      Math.max(-100_000, Math.trunc(Number(raw?.startingPoints ?? DEFAULT_ROOM_SETTINGS.startingPoints))),
    ),
    auctionDurationSec: Math.min(
      600,
      Math.max(5, Math.trunc(Number(raw?.auctionDurationSec ?? DEFAULT_ROOM_SETTINGS.auctionDurationSec))),
    ),
    answerDurationSec: Math.min(
      300,
      Math.max(5, Math.trunc(Number(raw?.answerDurationSec ?? DEFAULT_ROOM_SETTINGS.answerDurationSec))),
    ),
    correctCoinReward: Math.min(
      100_000,
      Math.max(0, Math.trunc(Number(raw?.correctCoinReward ?? DEFAULT_ROOM_SETTINGS.correctCoinReward))),
    ),
    correctPointReward: Math.min(
      100_000,
      Math.max(0, Math.trunc(Number(raw?.correctPointReward ?? DEFAULT_ROOM_SETTINGS.correctPointReward))),
    ),
    wrongCoinPenalty: Math.min(
      100_000,
      Math.max(0, Math.trunc(Number(raw?.wrongCoinPenalty ?? DEFAULT_ROOM_SETTINGS.wrongCoinPenalty))),
    ),
    wrongPointPenalty: Math.min(
      100_000,
      Math.max(0, Math.trunc(Number(raw?.wrongPointPenalty ?? DEFAULT_ROOM_SETTINGS.wrongPointPenalty))),
    ),
    participationCoinReward: Math.min(
      10_000,
      Math.max(0, Math.trunc(Number(raw?.participationCoinReward ?? DEFAULT_ROOM_SETTINGS.participationCoinReward))),
    ),
    participationPointReward: Math.min(
      10_000,
      Math.max(0, Math.trunc(Number(raw?.participationPointReward ?? DEFAULT_ROOM_SETTINGS.participationPointReward))),
    ),
    minStartingBid: Math.min(
      100_000,
      Math.max(1, Math.trunc(Number(raw?.minStartingBid ?? DEFAULT_ROOM_SETTINGS.minStartingBid))),
    ),
    minBidIncrement: Math.min(
      10_000,
      Math.max(1, Math.trunc(Number(raw?.minBidIncrement ?? DEFAULT_ROOM_SETTINGS.minBidIncrement))),
    ),
    deductWinningBid: raw?.deductWinningBid ?? DEFAULT_ROOM_SETTINGS.deductWinningBid,
    allowNegativePoints: raw?.allowNegativePoints ?? DEFAULT_ROOM_SETTINGS.allowNegativePoints,
  };
}

function sanitizeImageOrEmoji(raw: string | null | undefined): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '💻';
  if (trimmed.startsWith('data:')) {
    if (isRenderableImageSrc(trimmed) && trimmed.length <= 250_000) {
      return trimmed;
    }
    throw new RoomActionError(
      'VALIDATION',
      'Uploaded image must be a JPG, PNG, WebP, or GIF under 200 KB.',
    );
  }
  if (trimmed.startsWith('https://') || trimmed.startsWith('http://') || trimmed.startsWith('/')) {
    return trimmed.slice(0, 2000);
  }
  return trimmed.slice(0, 32) || '💻';
}

function mapRoomDoc(data: Record<string, unknown>, activeTeamCount?: number, items?: AuctionItem[]): RoomSummary {
  const machineState = (data.machineState as MachineState) || 'ROOM_WAITING';
  const isPaused = Boolean(data.isPaused);
  const itemCount = items ? items.length : Number(data.itemCount ?? 0);
  const unusedItemCount = items
    ? items.filter((i) => i.status === 'PENDING').length
    : Number(data.unusedItemCount ?? 0);
  return {
    id: String(data.id),
    roomCode: String(data.roomCode),
    roomName: String(data.roomName),
    hasPin: Boolean(data.hasPin),
    hostId: String(data.hostId),
    hostName: String(data.hostName || 'Event Host'),
    machineState,
    humanStatus: getHumanRoomStatus(machineState, isPaused),
    isPaused,
    pausedFromState: (data.pausedFromState as MachineState | null) ?? null,
    pausedRemainingMs:
      typeof data.pausedRemainingMs === 'number' ? data.pausedRemainingMs : null,
    isActive: Boolean(data.isActive),
    settings: normalizeSettings(data.settings as Partial<RoomSettings> | undefined),
    currentItemIndex: Number(data.currentItemIndex ?? 0),
    currentAuctionId: (data.currentAuctionId as string | null) ?? null,
    currentAnswerSessionId: (data.currentAnswerSessionId as string | null) ?? null,
    teamCount: activeTeamCount !== undefined ? activeTeamCount : Number(data.teamCount ?? 0),
    itemCount,
    unusedItemCount,
    createdAt: tsToMs(data.createdAt),
  };
}

function mapTeamDoc(data: Record<string, unknown>): Team {
  return {
    id: String(data.id),
    roomId: String(data.roomId),
    teamName: String(data.teamName),
    nameSlug: String(data.nameSlug || ''),
    coinBalance: Math.trunc(Number(data.coinBalance ?? 0)),
    points: Math.trunc(Number(data.points ?? 0)),
    correctCount: Math.trunc(Number(data.correctCount ?? 0)),
    wrongCount: Math.trunc(Number(data.wrongCount ?? 0)),
    answerSessionsCount: Math.trunc(Number(data.answerSessionsCount ?? 0)),
    totalResponseTimeMs: Math.trunc(Number(data.totalResponseTimeMs ?? 0)),
    connectionStatus: data.connectionStatus === 'OFFLINE' ? 'OFFLINE' : 'ONLINE',
    participationStatus: data.participationStatus === 'REMOVED' ? 'REMOVED' : 'ACTIVE',
    joinedAt: tsToMs(data.joinedAt),
    lastSeenAt: tsToMs(data.lastSeenAt),
  };
}

function normalizeDifficulty(raw: unknown): DifficultyLevel | '' {
  if (raw === 'Easy' || raw === 'Medium' || raw === 'Hard' || raw === 'Expert') {
    return raw;
  }
  return '';
}

function mapPublicItemDoc(data: Record<string, unknown>): PublicAuctionItem {
  return {
    id: String(data.id),
    sortOrder: Math.trunc(Number(data.sortOrder ?? 0)),
    itemName: String(data.itemName),
    category: String(data.category || 'General Tech'),
    imageOrEmoji: String(data.imageOrEmoji || '💻'),
    difficulty: normalizeDifficulty(data.difficulty),
    startingBid: Math.trunc(Number(data.startingBid ?? 10)),
    auctionDurationOverride:
      typeof data.auctionDurationOverride === 'number' ? data.auctionDurationOverride : null,
    answerDurationOverride:
      typeof data.answerDurationOverride === 'number' ? data.answerDurationOverride : null,
    status: (data.status as 'PENDING' | 'COMPLETED' | 'SKIPPED') || 'PENDING',
  };
}

function mapAuctionDoc(data: Record<string, unknown>): AuctionState {
  return {
    id: String(data.id),
    roomId: String(data.roomId),
    itemId: String(data.itemId),
    startingBid: Math.trunc(Number(data.startingBid ?? 10)),
    auctionStatus: (data.auctionStatus as AuctionState['auctionStatus']) || 'OPEN',
    startTimestamp: Number(data.startTimestamp ?? 0),
    deadlineTimestamp: Number(data.deadlineTimestamp ?? 0),
    closedTimestamp:
      typeof data.closedTimestamp === 'number' ? data.closedTimestamp : null,
    highestBid: Math.trunc(Number(data.highestBid ?? 0)),
    highestBidderTeamId: (data.highestBidderTeamId as string | null) ?? null,
    highestBidderTeamName: (data.highestBidderTeamName as string | null) ?? null,
    sequenceCounter: Math.trunc(Number(data.sequenceCounter ?? 0)),
    bidDeducted: Boolean(data.bidDeducted),
    deductedAmount: Math.trunc(Number(data.deductedAmount ?? 0)),
    bidRefunded: Boolean(data.bidRefunded),
  };
}

function mapBidDoc(data: Record<string, unknown>): BidRecord {
  return {
    id: String(data.id),
    auctionId: String(data.auctionId),
    roomId: String(data.roomId),
    teamId: String(data.teamId),
    teamName: String(data.teamName),
    bidAmount: Math.trunc(Number(data.bidAmount ?? 0)),
    serverTimestamp: tsToMs(data.serverTimestamp),
    sequenceNumber: Math.trunc(Number(data.sequenceNumber ?? 0)),
    status: data.status === 'REJECTED' ? 'REJECTED' : 'ACCEPTED',
    rejectionReason: (data.rejectionReason as string | null) ?? null,
  };
}

function mapAnswerSessionDoc(data: Record<string, unknown>): AnswerSession {
  return {
    id: String(data.id),
    auctionId: String(data.auctionId),
    roomId: String(data.roomId),
    itemId: String(data.itemId),
    winningTeamId: String(data.winningTeamId),
    winningTeamName: String(data.winningTeamName),
    answerStartTimestamp:
      typeof data.answerStartTimestamp === 'number' ? data.answerStartTimestamp : null,
    answerDeadlineTimestamp:
      typeof data.answerDeadlineTimestamp === 'number' ? data.answerDeadlineTimestamp : null,
    answerDecisionTimestamp:
      typeof data.answerDecisionTimestamp === 'number' ? data.answerDecisionTimestamp : null,
    responseTimeMs: typeof data.responseTimeMs === 'number' ? data.responseTimeMs : null,
    hostDecision: (data.hostDecision as AnswerDecision) || 'PENDING',
  };
}

function mapTransactionDoc(data: Record<string, unknown>): EconomyTransaction {
  return {
    id: String(data.id),
    roomId: String(data.roomId),
    teamId: String(data.teamId),
    teamName: String(data.teamName),
    currencyType: data.currencyType === 'POINTS' ? 'POINTS' : 'COINS',
    transactionType: data.transactionType as EconomyTransaction['transactionType'],
    previousBalance: Math.trunc(Number(data.previousBalance ?? 0)),
    configuredChange: Math.trunc(Number(data.configuredChange ?? 0)),
    actualChange: Math.trunc(Number(data.actualChange ?? 0)),
    newBalance: Math.trunc(Number(data.newBalance ?? 0)),
    reason: String(data.reason || ''),
    itemId: (data.itemId as string | null) ?? null,
    itemName: (data.itemName as string | null) ?? null,
    auctionId: (data.auctionId as string | null) ?? null,
    hostId: String(data.hostId || ''),
    timestamp: tsToMs(data.timestamp),
  };
}

function mapHistoryDoc(data: Record<string, unknown>): AuctionHistoryEntry {
  return {
    id: String(data.id),
    roomId: String(data.roomId),
    roomName: String(data.roomName || ''),
    itemId: String(data.itemId),
    itemName: String(data.itemName),
    questionTitle: String(data.questionTitle || ''),
    auctionId: String(data.auctionId),
    winningTeamId: (data.winningTeamId as string | null) ?? null,
    winningTeamName: (data.winningTeamName as string | null) ?? null,
    finalBid: Math.trunc(Number(data.finalBid ?? 0)),
    winningBidDeducted: Math.trunc(Number(data.winningBidDeducted ?? 0)),
    auctionStartTimestamp: Number(data.auctionStartTimestamp ?? 0),
    auctionEndTimestamp:
      typeof data.auctionEndTimestamp === 'number' ? data.auctionEndTimestamp : null,
    answerStartTimestamp:
      typeof data.answerStartTimestamp === 'number' ? data.answerStartTimestamp : null,
    hostDecision: (data.hostDecision as AuctionHistoryEntry['hostDecision']) || 'SKIPPED',
    responseTimeMs: typeof data.responseTimeMs === 'number' ? data.responseTimeMs : null,
    coinsChange: Math.trunc(Number(data.coinsChange ?? 0)),
    pointsChange: Math.trunc(Number(data.pointsChange ?? 0)),
    finalCoinBalance:
      typeof data.finalCoinBalance === 'number' ? data.finalCoinBalance : null,
    finalPoints: typeof data.finalPoints === 'number' ? data.finalPoints : null,
    timestamp: tsToMs(data.timestamp),
  };
}

function requireHostAuth(): HostUser {
  const user = auth.currentUser;
  if (!user) {
    throw new RoomActionError('AUTH_REQUIRED', 'Please sign in with Google to manage rooms.');
  }
  return {
    id: user.uid,
    username: user.email || user.uid,
    displayName: user.displayName || user.email?.split('@')[0] || 'Event Host',
    email: user.email || undefined,
    role: 'HOST',
    createdAt: Date.now(),
  };
}

export async function ensureHostProfileDoc(host: HostUser): Promise<void> {
  const ref = doc(db, 'users', host.id);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        id: host.id,
        displayName: host.displayName.slice(0, 80),
        ...(host.email ? { email: host.email.slice(0, 160) } : {}),
        role: 'HOST',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        displayName: host.displayName.slice(0, 80),
        ...(host.email ? { email: host.email.slice(0, 160) } : {}),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `users/${host.id}`);
  }
}

export async function listHostRooms(hostId: string): Promise<RoomSummary[]> {
  try {
    const q = query(collection(db, 'rooms'), where('hostId', '==', hostId));
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => mapRoomDoc(d.data()))
      .sort((a, b) => b.createdAt - a.createdAt);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'rooms');
  }
}

export async function listQuestionBank(hostId: string): Promise<QuestionBankItem[]> {
  try {
    const q = query(
      collection(db, 'users', hostId, 'question_bank'),
      where('hostId', '==', hostId),
    );
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => {
        const data = d.data();
        return {
          id: String(data.id),
          hostId: String(data.hostId),
          itemName: String(data.itemName),
          questionTitle: String(data.questionTitle),
          questionDescription: String(data.questionDescription || ''),
          category: String(data.category || 'General Tech'),
          imageOrEmoji: String(data.imageOrEmoji || '💻'),
          difficulty: normalizeDifficulty(data.difficulty),
          startingBid: Math.trunc(Number(data.startingBid ?? 10)),
          auctionDurationOverride:
            typeof data.auctionDurationOverride === 'number'
              ? data.auctionDurationOverride
              : null,
          answerDurationOverride:
            typeof data.answerDurationOverride === 'number'
              ? data.answerDurationOverride
              : null,
          createdAt: tsToMs(data.createdAt),
        };
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, `users/${hostId}/question_bank`);
  }
}

export async function deleteQuestionBankItem(hostId: string, bankId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'users', hostId, 'question_bank', bankId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `users/${hostId}/question_bank/${bankId}`);
  }
}

export interface CreateRoomItemInput {
  itemName: string;
  imageOrEmoji: string;
  startingBid?: number;
}

export interface CreateRoomInput {
  roomName: string;
  roomPin?: string;
  settings: RoomSettings;
  initialItems?: CreateRoomItemInput[];
}

export async function createRoom(input: CreateRoomInput): Promise<HostRoomSnapshot> {
  const host = requireHostAuth();
  const cleanName = input.roomName.trim();
  if (cleanName.length < 2 || cleanName.length > 80) {
    throw new RoomActionError('VALIDATION', 'Room name must be between 2 and 80 characters.');
  }

  const settings = normalizeSettings(input.settings);
  const cleanPin = (input.roomPin || '').trim();
  const hasPin = cleanPin.length > 0;
  const roomId = newId('room');

  const preparedItems: AuctionItem[] = [];
  for (let i = 0; i < (input.initialItems || []).length; i++) {
    const rawItem = input.initialItems![i];
    const itemName = (rawItem.itemName || '').trim().slice(0, 120);
    if (!itemName) continue;
    const itemId = newId('item');
    const imageOrEmoji = sanitizeImageOrEmoji(rawItem.imageOrEmoji);
    const startingBid = Math.max(
      1,
      Math.trunc(Number(rawItem.startingBid ?? settings.minStartingBid)),
    );
    preparedItems.push({
      id: itemId,
      roomId,
      sortOrder: preparedItems.length,
      itemName,
      questionTitle: itemName,
      questionDescription: '',
      category: 'Tech Auction',
      imageOrEmoji,
      difficulty: '',
      startingBid,
      auctionDurationOverride: null,
      answerDurationOverride: null,
      status: 'PENDING',
      createdAt: Date.now(),
    });
  }

  // Generate collision-free room code
  let roomCode = randomRoomCode();
  for (let attempt = 0; attempt < 6; attempt++) {
    const existingCode = await getDoc(doc(db, 'room_codes', roomCode));
    if (!existingCode.exists()) break;
    roomCode = randomRoomCode();
  }

  const announcement = `Room "${cleanName}" created. Share code ${roomCode} with teams to begin.`;
  const batch = writeBatch(db);

  batch.set(doc(db, 'rooms', roomId), {
    id: roomId,
    roomCode,
    roomName: cleanName,
    hasPin,
    hostId: host.id,
    hostName: host.displayName.slice(0, 80),
    machineState: 'ROOM_WAITING',
    isPaused: false,
    pausedFromState: null,
    pausedRemainingMs: null,
    isActive: true,
    settings,
    currentItemIndex: 0,
    currentAuctionId: null,
    currentAnswerSessionId: null,
    teamCount: 0,
    itemCount: preparedItems.length,
    unusedItemCount: preparedItems.length,
    lastAnnouncement: announcement,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, 'room_codes', roomCode), {
    roomCode,
    roomId,
    roomName: cleanName,
    hostId: host.id,
    hasPin,
    isActive: true,
    machineState: 'ROOM_WAITING',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  if (hasPin) {
    const pinHash = await sha256Hex(`${roomId}:${cleanPin}`);
    batch.set(doc(db, 'rooms', roomId, 'private', 'pin'), {
      roomId,
      hostId: host.id,
      pinHash,
      updatedAt: serverTimestamp(),
    });
  }

  for (const item of preparedItems) {
    batch.set(doc(db, 'rooms', roomId, 'items', item.id), {
      id: item.id,
      roomId,
      sortOrder: item.sortOrder,
      itemName: item.itemName,
      category: item.category,
      imageOrEmoji: item.imageOrEmoji,
      difficulty: item.difficulty,
      startingBid: item.startingBid,
      auctionDurationOverride: null,
      answerDurationOverride: null,
      status: 'PENDING',
      createdAt: serverTimestamp(),
    });
    batch.set(doc(db, 'rooms', roomId, 'host_prompts', item.id), {
      id: item.id,
      roomId,
      hostId: host.id,
      questionTitle: item.itemName,
      questionDescription: '',
      updatedAt: serverTimestamp(),
    });
  }

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `rooms/${roomId}`);
  }

  const roomSummary: RoomSummary = {
    id: roomId,
    roomCode,
    roomName: cleanName,
    hasPin,
    hostId: host.id,
    hostName: host.displayName.slice(0, 80),
    machineState: 'ROOM_WAITING',
    humanStatus: 'Waiting for Teams',
    isPaused: false,
    pausedFromState: null,
    pausedRemainingMs: null,
    isActive: true,
    settings,
    currentItemIndex: 0,
    currentAuctionId: null,
    currentAnswerSessionId: null,
    teamCount: 0,
    itemCount: preparedItems.length,
    unusedItemCount: preparedItems.length,
    createdAt: Date.now(),
  };

  const firstItem = preparedItems[0] ?? null;

  return {
    serverTime: Date.now(),
    room: roomSummary,
    currentItem: firstItem
      ? {
          id: firstItem.id,
          sortOrder: firstItem.sortOrder,
          itemName: firstItem.itemName,
          category: firstItem.category,
          imageOrEmoji: firstItem.imageOrEmoji,
          difficulty: firstItem.difficulty,
          startingBid: firstItem.startingBid,
          auctionDurationOverride: null,
          answerDurationOverride: null,
          status: 'PENDING',
        }
      : null,
    currentAuction: null,
    currentAnswerSession: null,
    recentBids: [],
    leaderboard: [],
    lastAnnouncement: announcement,
    items: preparedItems,
    currentHostItem: firstItem,
    teams: [],
    allAuctionBids: [],
    transactions: [],
    history: [],
  };
}

export async function lookupRoomByCode(
  rawCode: string,
): Promise<{
  roomId: string;
  roomCode: string;
  roomName: string;
  hasPin: boolean;
  isActive: boolean;
  machineState: MachineState;
  settings: RoomSettings;
  teamCount: number;
}> {
  const code = rawCode.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,12}$/.test(code)) {
    throw new RoomActionError(
      'VALIDATION',
      'Room code must be 4 to 12 uppercase letters or numbers.',
    );
  }

  let codeSnap;
  try {
    codeSnap = await getDoc(doc(db, 'room_codes', code));
  } catch (err) {
    throw classifyError(err, 'Unable to reach room directory.');
  }

  if (!codeSnap.exists()) {
    throw new RoomActionError(
      'NOT_FOUND',
      'Room not found. Check the room code and try again.',
    );
  }

  const codeData = codeSnap.data();
  const roomId = String(codeData.roomId);

  let roomSnap;
  try {
    roomSnap = await getDoc(doc(db, 'rooms', roomId));
  } catch (err) {
    throw classifyError(err, 'Unable to read room details.');
  }

  if (!roomSnap.exists()) {
    throw new RoomActionError(
      'NOT_FOUND',
      'Room not found. Check the room code and try again.',
    );
  }

  const roomData = roomSnap.data();
  const teamsSnap = await getDocs(
    query(collection(db, 'rooms', roomId, 'teams'), where('roomId', '==', roomId)),
  );
  const activeCount = teamsSnap.docs.filter(
    (d) => d.data().participationStatus === 'ACTIVE',
  ).length;

  const summary = mapRoomDoc(roomData, activeCount);
  return {
    roomId: summary.id,
    roomCode: summary.roomCode,
    roomName: summary.roomName,
    hasPin: summary.hasPin,
    isActive: summary.isActive,
    machineState: summary.machineState,
    settings: summary.settings,
    teamCount: activeCount,
  };
}

export async function joinRoomPublic(input: {
  roomCode: string;
  teamName: string;
  roomPin?: string;
  teamPin?: string;
}): Promise<{ snapshot: TeamRoomSnapshot; reconnected: boolean }> {
  const code = input.roomCode.trim().toUpperCase();
  const cleanTeamName = input.teamName.trim();
  const cleanRoomPin = (input.roomPin || '').trim();
  const cleanTeamPin = (input.teamPin || '').trim();

  if (!/^[A-Z0-9]{4,12}$/.test(code)) {
    throw new RoomActionError('VALIDATION', 'Enter a valid room code (4-12 characters).');
  }
  if (cleanTeamName.length < 2 || cleanTeamName.length > 40) {
    throw new RoomActionError('VALIDATION', 'Team name must be between 2 and 40 characters.');
  }

  const roomMeta = await lookupRoomByCode(code);
  const { roomId } = roomMeta;

  if (!roomMeta.isActive) {
    throw new RoomActionError(
      'ROOM_INACTIVE',
      'This room is currently inactive or paused for new entries. Ask your host to activate it.',
    );
  }
  if (roomMeta.machineState === 'ROOM_COMPLETED') {
    throw new RoomActionError(
      'ROOM_COMPLETED',
      'This auction event has already completed and is closed to new teams.',
    );
  }

  const nameSlug = normalizeTeamSlug(cleanTeamName);
  const lockRef = doc(db, 'rooms', roomId, 'team_names', nameSlug);
  let lockSnap;
  try {
    lockSnap = await getDoc(lockRef);
  } catch (err) {
    throw classifyError(err, 'Unable to verify team name.');
  }

  // Case A: Reconnect existing team with same name if Team Passcode provided or local session matches
  if (lockSnap.exists()) {
    const lockData = lockSnap.data();
    const existingTeamId = String(lockData.teamId);
    if (lockData.participationStatus === 'REMOVED') {
      throw new RoomActionError(
        'PERMISSION_DENIED',
        'This team was removed from the room by the host.',
      );
    }

    const stored = getStoredTeamSession();
    const canTryStored =
      stored && stored.roomId === roomId && stored.teamId === existingTeamId;

    if (!cleanTeamPin && !canTryStored) {
      throw new RoomActionError(
        'DUPLICATE_TEAM',
        lockData.hasTeamPin
          ? 'A team with this name already joined. Enter your Team Passcode below to reconnect on this device.'
          : 'A team with this name already exists in this room. Choose another team name.',
      );
    }

    const authSecret = cleanTeamPin || stored!.authSecret;
    const isTeamPin = cleanTeamPin.length > 0 || Boolean(stored?.isTeamPin);
    const authVerifier = isTeamPin
      ? await sha256Hex(`teampin:${roomId}:${authSecret}`)
      : await sha256Hex(authSecret);

    const batch = writeBatch(db);
    batch.update(doc(db, 'rooms', roomId, 'team_auth', existingTeamId), {
      authVerifier,
      lastPingAt: serverTimestamp(),
    });
    batch.update(doc(db, 'rooms', roomId, 'teams', existingTeamId), {
      connectionStatus: 'ONLINE',
      lastSeenAt: serverTimestamp(),
    });

    try {
      await batch.commit();
    } catch (err) {
      const classified = classifyError(err, 'Unable to reconnect team.');
      if (classified.code === 'PERMISSION_DENIED') {
        throw new RoomActionError(
          'PIN_INVALID',
          'Incorrect Team Passcode for this team name.',
        );
      }
      throw classified;
    }

    setStoredTeamSession({
      roomId,
      roomCode: roomMeta.roomCode,
      teamId: existingTeamId,
      teamName: String(lockData.teamName),
      authSecret,
      isTeamPin,
    });

    const snap = await fetchTeamSnapshotOnce(roomId, existingTeamId);
    return { snapshot: snap, reconnected: true };
  }

  // Case B: New team joining
  if (roomMeta.hasPin && !cleanRoomPin) {
    throw new RoomActionError(
      'PIN_REQUIRED',
      'This room requires a Room PIN. Enter the PIN provided by your host.',
    );
  }

  if (roomMeta.teamCount >= roomMeta.settings.maxTeams) {
    throw new RoomActionError(
      'ROOM_FULL',
      `This room has reached its maximum capacity of ${roomMeta.settings.maxTeams} teams.`,
    );
  }

  const teamId = newId('team');
  const reconnectToken = createRandomHex(24);
  const reconnectTokenHash = await sha256Hex(reconnectToken);
  const joinedPinHash = roomMeta.hasPin
    ? await sha256Hex(`${roomId}:${cleanRoomPin}`)
    : '';
  const teamPinHash = cleanTeamPin
    ? await sha256Hex(`teampin:${roomId}:${cleanTeamPin}`)
    : '';

  const batch = writeBatch(db);
  batch.set(doc(db, 'rooms', roomId, 'teams', teamId), {
    id: teamId,
    roomId,
    teamName: cleanTeamName,
    nameSlug,
    coinBalance: roomMeta.settings.startingCoins,
    points: roomMeta.settings.startingPoints,
    correctCount: 0,
    wrongCount: 0,
    answerSessionsCount: 0,
    totalResponseTimeMs: 0,
    connectionStatus: 'ONLINE',
    participationStatus: 'ACTIVE',
    joinedAt: serverTimestamp(),
    lastSeenAt: serverTimestamp(),
  });

  batch.set(lockRef, {
    nameSlug,
    roomId,
    teamId,
    teamName: cleanTeamName,
    participationStatus: 'ACTIVE',
    hasTeamPin: cleanTeamPin.length > 0,
    createdAt: serverTimestamp(),
  });

  batch.set(doc(db, 'rooms', roomId, 'team_auth', teamId), {
    teamId,
    roomId,
    joinedPinHash,
    teamPinHash,
    reconnectTokenHash,
    authVerifier: reconnectTokenHash,
    lastPingAt: serverTimestamp(),
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    const classified = classifyError(err, 'Unable to join room.');
    if (classified.code === 'PERMISSION_DENIED') {
      if (roomMeta.hasPin) {
        throw new RoomActionError(
          'PIN_INVALID',
          'Incorrect Room PIN or join rejected by room security rules.',
        );
      }
      throw classified;
    }
    throw classified;
  }

  setStoredTeamSession({
    roomId,
    roomCode: roomMeta.roomCode,
    teamId,
    teamName: cleanTeamName,
    authSecret: reconnectToken,
    isTeamPin: false,
  });

  const snap = await fetchTeamSnapshotOnce(roomId, teamId);
  return { snapshot: snap, reconnected: false };
}

export async function reconnectStoredTeamSession(): Promise<TeamRoomSnapshot | null> {
  const session = getStoredTeamSession();
  if (!session) return null;

  try {
    const teamSnap = await getDoc(doc(db, 'rooms', session.roomId, 'teams', session.teamId));
    if (!teamSnap.exists() || teamSnap.data().participationStatus !== 'ACTIVE') {
      setStoredTeamSession(null);
      return null;
    }
    const authVerifier = session.isTeamPin
      ? await sha256Hex(`teampin:${session.roomId}:${session.authSecret}`)
      : await sha256Hex(session.authSecret);

    const batch = writeBatch(db);
    batch.update(doc(db, 'rooms', session.roomId, 'team_auth', session.teamId), {
      authVerifier,
      lastPingAt: serverTimestamp(),
    });
    batch.update(doc(db, 'rooms', session.roomId, 'teams', session.teamId), {
      connectionStatus: 'ONLINE',
      lastSeenAt: serverTimestamp(),
    });
    await batch.commit();

    return await fetchTeamSnapshotOnce(session.roomId, session.teamId);
  } catch {
    return null;
  }
}

export async function markTeamOffline(): Promise<void> {
  const session = getStoredTeamSession();
  if (!session) return;
  try {
    const authVerifier = session.isTeamPin
      ? await sha256Hex(`teampin:${session.roomId}:${session.authSecret}`)
      : await sha256Hex(session.authSecret);
    const batch = writeBatch(db);
    batch.update(doc(db, 'rooms', session.roomId, 'team_auth', session.teamId), {
      authVerifier,
      lastPingAt: serverTimestamp(),
    });
    batch.update(doc(db, 'rooms', session.roomId, 'teams', session.teamId), {
      connectionStatus: 'OFFLINE',
      lastSeenAt: serverTimestamp(),
    });
    await batch.commit();
  } catch {
    // ignore on leave
  } finally {
    setStoredTeamSession(null);
  }
}

async function fetchTeamSnapshotOnce(
  roomId: string,
  teamId: string,
): Promise<TeamRoomSnapshot> {
  const [roomSnap, teamsSnap, itemsSnap, auctionsSnap, bidsSnap, ansSnap, txSnap] =
    await Promise.all([
      getDoc(doc(db, 'rooms', roomId)),
      getDocs(query(collection(db, 'rooms', roomId, 'teams'), where('roomId', '==', roomId))),
      getDocs(query(collection(db, 'rooms', roomId, 'items'), where('roomId', '==', roomId))),
      getDocs(query(collection(db, 'rooms', roomId, 'auctions'), where('roomId', '==', roomId))),
      getDocs(query(collection(db, 'rooms', roomId, 'bids'), where('roomId', '==', roomId))),
      getDocs(query(collection(db, 'rooms', roomId, 'answer_sessions'), where('roomId', '==', roomId))),
      getDocs(query(collection(db, 'rooms', roomId, 'transactions'), where('roomId', '==', roomId))),
    ]);

  if (!roomSnap.exists()) {
    throw new RoomActionError('NOT_FOUND', 'Room no longer exists.');
  }

  return buildTeamSnapshotFromDocs(
    roomSnap.data(),
    teamsSnap.docs.map((d) => mapTeamDoc(d.data())),
    itemsSnap.docs.map((d) => mapPublicItemDoc(d.data())),
    auctionsSnap.docs.map((d) => mapAuctionDoc(d.data())),
    bidsSnap.docs.map((d) => mapBidDoc(d.data())),
    ansSnap.docs.map((d) => mapAnswerSessionDoc(d.data())),
    txSnap.docs.map((d) => mapTransactionDoc(d.data())),
    teamId,
  );
}

function buildPublicSnapshotFromDocs(
  roomData: Record<string, unknown>,
  teams: Team[],
  publicItems: PublicAuctionItem[],
  auctions: AuctionState[],
  bids: BidRecord[],
  answerSessions: AnswerSession[],
): PublicRoomSnapshot {
  const sortedItems = [...publicItems].sort((a, b) => a.sortOrder - b.sortOrder);
  const activeTeams = teams.filter((t) => t.participationStatus === 'ACTIVE');
  const room = mapRoomDoc(roomData, activeTeams.length);
  room.itemCount = sortedItems.length;
  room.unusedItemCount = sortedItems.filter((i) => i.status === 'PENDING').length;

  const currentItem =
    sortedItems[room.currentItemIndex] ??
    sortedItems.find((i) => i.status === 'PENDING') ??
    null;

  const currentAuction = room.currentAuctionId
    ? auctions.find((a) => a.id === room.currentAuctionId) ?? null
    : currentItem
      ? auctions
          .filter((a) => a.itemId === currentItem.id)
          .sort((a, b) => b.startTimestamp - a.startTimestamp)[0] ?? null
      : null;

  const currentAnswerSession = room.currentAnswerSessionId
    ? answerSessions.find((s) => s.id === room.currentAnswerSessionId) ?? null
    : currentAuction
      ? answerSessions.find((s) => s.auctionId === currentAuction.id) ?? null
      : null;

  const recentBids = currentAuction
    ? bids
        .filter((b) => b.auctionId === currentAuction.id && b.status === 'ACCEPTED')
        .sort((a, b) => b.sequenceNumber - a.sequenceNumber)
        .slice(0, 20)
    : [];

  return {
    serverTime: Date.now(),
    room,
    currentItem,
    currentAuction,
    currentAnswerSession,
    recentBids,
    leaderboard: computeRankedLeaderboard(activeTeams),
    lastAnnouncement: (roomData.lastAnnouncement as string | null) ?? null,
  };
}

function buildTeamSnapshotFromDocs(
  roomData: Record<string, unknown>,
  teams: Team[],
  publicItems: PublicAuctionItem[],
  auctions: AuctionState[],
  bids: BidRecord[],
  answerSessions: AnswerSession[],
  transactions: EconomyTransaction[],
  teamId: string,
): TeamRoomSnapshot {
  const pub = buildPublicSnapshotFromDocs(
    roomData,
    teams,
    publicItems,
    auctions,
    bids,
    answerSessions,
  );
  const selfTeam = teams.find((t) => t.id === teamId);
  if (!selfTeam || selfTeam.participationStatus !== 'ACTIVE') {
    throw new RoomActionError('PERMISSION_DENIED', 'Team is no longer active in this room.');
  }
  const teamTransactions = transactions.filter((tx) => tx.teamId === teamId);
  const recentTransactions = [...teamTransactions]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 100);
  const teamStats = computeTeamEconomyStats(teamTransactions, teamId);

  return {
    ...pub,
    selfTeam,
    recentTransactions,
    teamStats,
  };
}

export async function fetchPublicRoomByCode(roomCode: string): Promise<PublicRoomSnapshot> {
  const meta = await lookupRoomByCode(roomCode);
  const { roomId } = meta;
  const [roomSnap, teamsSnap, itemsSnap, auctionsSnap, bidsSnap, ansSnap] = await Promise.all([
    getDoc(doc(db, 'rooms', roomId)),
    getDocs(query(collection(db, 'rooms', roomId, 'teams'), where('roomId', '==', roomId))),
    getDocs(query(collection(db, 'rooms', roomId, 'items'), where('roomId', '==', roomId))),
    getDocs(query(collection(db, 'rooms', roomId, 'auctions'), where('roomId', '==', roomId))),
    getDocs(query(collection(db, 'rooms', roomId, 'bids'), where('roomId', '==', roomId))),
    getDocs(query(collection(db, 'rooms', roomId, 'answer_sessions'), where('roomId', '==', roomId))),
  ]);

  if (!roomSnap.exists()) {
    throw new RoomActionError('NOT_FOUND', 'Room not found. Check the room code and try again.');
  }

  return buildPublicSnapshotFromDocs(
    roomSnap.data(),
    teamsSnap.docs.map((d) => mapTeamDoc(d.data())),
    itemsSnap.docs.map((d) => mapPublicItemDoc(d.data())),
    auctionsSnap.docs.map((d) => mapAuctionDoc(d.data())),
    bidsSnap.docs.map((d) => mapBidDoc(d.data())),
    ansSnap.docs.map((d) => mapAnswerSessionDoc(d.data())),
  );
}

// ==========================================
// REAL-TIME SUBSCRIPTIONS (onSnapshot)
// ==========================================
export function subscribeHostRoom(
  roomId: string,
  hostId: string,
  onSnapshotData: (snap: HostRoomSnapshot | null) => void,
  onError: (err: RoomActionError) => void,
): () => void {
  let roomData: Record<string, unknown> | null = null;
  let teams: Team[] = [];
  let publicItems: PublicAuctionItem[] = [];
  let prompts = new Map<string, { questionTitle: string; questionDescription: string }>();
  let auctions: AuctionState[] = [];
  let bids: BidRecord[] = [];
  let answerSessions: AnswerSession[] = [];
  let transactions: EconomyTransaction[] = [];
  let history: AuctionHistoryEntry[] = [];
  let roomReady = false;

  const emit = () => {
    if (!roomReady || !roomData) {
      if (roomReady && !roomData) onSnapshotData(null);
      return;
    }

    const mergedItems: AuctionItem[] = [...publicItems]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((item) => {
        const prompt = prompts.get(item.id);
        return {
          ...item,
          roomId,
          questionTitle: prompt?.questionTitle || item.itemName,
          questionDescription: prompt?.questionDescription || '',
          createdAt: 0,
        };
      });

    const pub = buildPublicSnapshotFromDocs(
      roomData,
      teams,
      publicItems,
      auctions,
      bids,
      answerSessions,
    );

    const currentHostItem = pub.currentItem
      ? mergedItems.find((i) => i.id === pub.currentItem!.id) ?? null
      : null;

    const allAuctionBids = pub.currentAuction
      ? bids
          .filter((b) => b.auctionId === pub.currentAuction!.id)
          .sort((a, b) => b.sequenceNumber - a.sequenceNumber)
      : [];

    onSnapshotData({
      ...pub,
      items: mergedItems,
      currentHostItem,
      teams: teams.filter((t) => t.participationStatus === 'ACTIVE'),
      allAuctionBids,
      transactions: [...transactions].sort((a, b) => b.timestamp - a.timestamp),
      history: [...history].sort((a, b) => b.timestamp - a.timestamp),
    });
  };

  const handleErr = (path: string) => (err: unknown) => {
    try {
      handleFirestoreError(err, OperationType.LIST, path);
    } catch {
      onError(classifyError(err, `Failed to sync ${path}`));
    }
  };

  const unsubs = [
    onSnapshot(
      doc(db, 'rooms', roomId),
      (snap) => {
        roomReady = true;
        roomData = snap.exists() ? snap.data() : null;
        emit();
      },
      handleErr(`rooms/${roomId}`),
    ),
    onSnapshot(
      query(collection(db, 'rooms', roomId, 'teams'), where('roomId', '==', roomId)),
      (snap) => {
        teams = snap.docs.map((d) => mapTeamDoc(d.data()));
        emit();
      },
      handleErr(`rooms/${roomId}/teams`),
    ),
    onSnapshot(
      query(collection(db, 'rooms', roomId, 'items'), where('roomId', '==', roomId)),
      (snap) => {
        publicItems = snap.docs.map((d) => mapPublicItemDoc(d.data()));
        emit();
      },
      handleErr(`rooms/${roomId}/items`),
    ),
    onSnapshot(
      query(collection(db, 'rooms', roomId, 'host_prompts'), where('hostId', '==', hostId)),
      (snap) => {
        const nextMap = new Map<string, { questionTitle: string; questionDescription: string }>();
        snap.docs.forEach((d) => {
          const data = d.data();
          nextMap.set(String(data.id), {
            questionTitle: String(data.questionTitle || ''),
            questionDescription: String(data.questionDescription || ''),
          });
        });
        prompts = nextMap;
        emit();
      },
      handleErr(`rooms/${roomId}/host_prompts`),
    ),
    onSnapshot(
      query(collection(db, 'rooms', roomId, 'auctions'), where('roomId', '==', roomId)),
      (snap) => {
        auctions = snap.docs.map((d) => mapAuctionDoc(d.data()));
        emit();
      },
      handleErr(`rooms/${roomId}/auctions`),
    ),
    onSnapshot(
      query(collection(db, 'rooms', roomId, 'bids'), where('roomId', '==', roomId)),
      (snap) => {
        bids = snap.docs.map((d) => mapBidDoc(d.data()));
        emit();
      },
      handleErr(`rooms/${roomId}/bids`),
    ),
    onSnapshot(
      query(collection(db, 'rooms', roomId, 'answer_sessions'), where('roomId', '==', roomId)),
      (snap) => {
        answerSessions = snap.docs.map((d) => mapAnswerSessionDoc(d.data()));
        emit();
      },
      handleErr(`rooms/${roomId}/answer_sessions`),
    ),
    onSnapshot(
      query(collection(db, 'rooms', roomId, 'transactions'), where('roomId', '==', roomId)),
      (snap) => {
        transactions = snap.docs.map((d) => mapTransactionDoc(d.data()));
        emit();
      },
      handleErr(`rooms/${roomId}/transactions`),
    ),
    onSnapshot(
      query(collection(db, 'rooms', roomId, 'history'), where('roomId', '==', roomId)),
      (snap) => {
        history = snap.docs.map((d) => mapHistoryDoc(d.data()));
        emit();
      },
      handleErr(`rooms/${roomId}/history`),
    ),
  ];

  return () => {
    unsubs.forEach((u) => u());
  };
}

export function subscribeTeamRoom(
  roomId: string,
  teamId: string,
  onSnapshotData: (snap: TeamRoomSnapshot) => void,
  onRemoved: (message: string) => void,
  onError: (err: RoomActionError) => void,
): () => void {
  let roomData: Record<string, unknown> | null = null;
  let teams: Team[] = [];
  let publicItems: PublicAuctionItem[] = [];
  let auctions: AuctionState[] = [];
  let bids: BidRecord[] = [];
  let answerSessions: AnswerSession[] = [];
  let transactions: EconomyTransaction[] = [];
  let roomLoaded = false;
  let teamsLoaded = false;

  const emit = () => {
    if (!roomLoaded || !teamsLoaded) return;
    if (!roomData) {
      onRemoved('This auction room has been closed or deleted by the host.');
      return;
    }
    const selfTeam = teams.find((t) => t.id === teamId);
    if (!selfTeam || selfTeam.participationStatus !== 'ACTIVE') {
      onRemoved('Your team has been removed from this room by the host.');
      return;
    }
    onSnapshotData(
      buildTeamSnapshotFromDocs(
        roomData,
        teams,
        publicItems,
        auctions,
        bids,
        answerSessions,
        transactions,
        teamId,
      ),
    );
  };

  const handleErr = (path: string) => (err: unknown) => {
    onError(classifyError(err, `Failed to sync ${path}`));
  };

  const unsubs = [
    onSnapshot(
      doc(db, 'rooms', roomId),
      (snap) => {
        roomLoaded = true;
        roomData = snap.exists() ? snap.data() : null;
        emit();
      },
      handleErr(`rooms/${roomId}`),
    ),
    onSnapshot(
      query(collection(db, 'rooms', roomId, 'teams'), where('roomId', '==', roomId)),
      (snap) => {
        teamsLoaded = true;
        teams = snap.docs.map((d) => mapTeamDoc(d.data()));
        emit();
      },
      handleErr(`rooms/${roomId}/teams`),
    ),
    onSnapshot(
      query(collection(db, 'rooms', roomId, 'items'), where('roomId', '==', roomId)),
      (snap) => {
        publicItems = snap.docs.map((d) => mapPublicItemDoc(d.data()));
        emit();
      },
      handleErr(`rooms/${roomId}/items`),
    ),
    onSnapshot(
      query(collection(db, 'rooms', roomId, 'auctions'), where('roomId', '==', roomId)),
      (snap) => {
        auctions = snap.docs.map((d) => mapAuctionDoc(d.data()));
        emit();
      },
      handleErr(`rooms/${roomId}/auctions`),
    ),
    onSnapshot(
      query(collection(db, 'rooms', roomId, 'bids'), where('roomId', '==', roomId)),
      (snap) => {
        bids = snap.docs.map((d) => mapBidDoc(d.data()));
        emit();
      },
      handleErr(`rooms/${roomId}/bids`),
    ),
    onSnapshot(
      query(collection(db, 'rooms', roomId, 'answer_sessions'), where('roomId', '==', roomId)),
      (snap) => {
        answerSessions = snap.docs.map((d) => mapAnswerSessionDoc(d.data()));
        emit();
      },
      handleErr(`rooms/${roomId}/answer_sessions`),
    ),
    onSnapshot(
      query(collection(db, 'rooms', roomId, 'transactions'), where('roomId', '==', roomId)),
      (snap) => {
        transactions = snap.docs.map((d) => mapTransactionDoc(d.data()));
        emit();
      },
      handleErr(`rooms/${roomId}/transactions`),
    ),
  ];

  return () => {
    unsubs.forEach((u) => u());
  };
}

export function subscribePublicRoom(
  roomId: string,
  onSnapshotData: (snap: PublicRoomSnapshot | null) => void,
  onError: (err: RoomActionError) => void,
): () => void {
  let roomData: Record<string, unknown> | null = null;
  let teams: Team[] = [];
  let publicItems: PublicAuctionItem[] = [];
  let auctions: AuctionState[] = [];
  let bids: BidRecord[] = [];
  let answerSessions: AnswerSession[] = [];
  let roomLoaded = false;

  const emit = () => {
    if (!roomLoaded) return;
    if (!roomData) {
      onSnapshotData(null);
      return;
    }
    onSnapshotData(
      buildPublicSnapshotFromDocs(
        roomData,
        teams,
        publicItems,
        auctions,
        bids,
        answerSessions,
      ),
    );
  };

  const handleErr = (path: string) => (err: unknown) => {
    onError(classifyError(err, `Failed to sync ${path}`));
  };

  const unsubs = [
    onSnapshot(
      doc(db, 'rooms', roomId),
      (snap) => {
        roomLoaded = true;
        roomData = snap.exists() ? snap.data() : null;
        emit();
      },
      handleErr(`rooms/${roomId}`),
    ),
    onSnapshot(
      query(collection(db, 'rooms', roomId, 'teams'), where('roomId', '==', roomId)),
      (snap) => {
        teams = snap.docs.map((d) => mapTeamDoc(d.data()));
        emit();
      },
      handleErr(`rooms/${roomId}/teams`),
    ),
    onSnapshot(
      query(collection(db, 'rooms', roomId, 'items'), where('roomId', '==', roomId)),
      (snap) => {
        publicItems = snap.docs.map((d) => mapPublicItemDoc(d.data()));
        emit();
      },
      handleErr(`rooms/${roomId}/items`),
    ),
    onSnapshot(
      query(collection(db, 'rooms', roomId, 'auctions'), where('roomId', '==', roomId)),
      (snap) => {
        auctions = snap.docs.map((d) => mapAuctionDoc(d.data()));
        emit();
      },
      handleErr(`rooms/${roomId}/auctions`),
    ),
    onSnapshot(
      query(collection(db, 'rooms', roomId, 'bids'), where('roomId', '==', roomId)),
      (snap) => {
        bids = snap.docs.map((d) => mapBidDoc(d.data()));
        emit();
      },
      handleErr(`rooms/${roomId}/bids`),
    ),
    onSnapshot(
      query(collection(db, 'rooms', roomId, 'answer_sessions'), where('roomId', '==', roomId)),
      (snap) => {
        answerSessions = snap.docs.map((d) => mapAnswerSessionDoc(d.data()));
        emit();
      },
      handleErr(`rooms/${roomId}/answer_sessions`),
    ),
  ];

  return () => {
    unsubs.forEach((u) => u());
  };
}

// ==========================================
// ATOMIC TEAM BIDDING TRANSACTION (USES COINS ONLY)
// ==========================================
export async function placeBidTransaction(input: {
  roomId: string;
  teamId: string;
  amount: number;
}): Promise<{ ok: boolean; message: string }> {
  const numeric = Math.trunc(Number(input.amount));
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return { ok: false, message: 'Invalid bid. Enter a positive whole number.' };
  }

  const session = getStoredTeamSession();
  if (!session || session.roomId !== input.roomId || session.teamId !== input.teamId) {
    return { ok: false, message: 'Valid team session required to place a bid.' };
  }

  const authVerifier = session.isTeamPin
    ? await sha256Hex(`teampin:${session.roomId}:${session.authSecret}`)
    : await sha256Hex(session.authSecret);

  const bidId = newId('bid');

  try {
    await runTransaction(db, async (tx) => {
      const roomRef = doc(db, 'rooms', input.roomId);
      const teamRef = doc(db, 'rooms', input.roomId, 'teams', input.teamId);
      const authRef = doc(db, 'rooms', input.roomId, 'team_auth', input.teamId);

      const [roomSnap, teamSnap] = await Promise.all([tx.get(roomRef), tx.get(teamRef)]);
      if (!roomSnap.exists()) {
        throw new RoomActionError('NOT_FOUND', 'Room does not exist.');
      }
      const room = mapRoomDoc(roomSnap.data());
      if (!room.isActive || room.isPaused || room.machineState !== 'AUCTION_OPEN' || !room.currentAuctionId) {
        throw new RoomActionError('VALIDATION', 'Auction is not open for bidding right now.');
      }
      if (!teamSnap.exists()) {
        throw new RoomActionError('PERMISSION_DENIED', 'Team not found.');
      }
      const team = mapTeamDoc(teamSnap.data());
      if (team.participationStatus !== 'ACTIVE') {
        throw new RoomActionError('PERMISSION_DENIED', 'Team is not active in this room.');
      }

      const auctionRef = doc(db, 'rooms', input.roomId, 'auctions', room.currentAuctionId);
      const auctionSnap = await tx.get(auctionRef);
      if (!auctionSnap.exists()) {
        throw new RoomActionError('NOT_FOUND', 'Active auction round not found.');
      }
      const auction = mapAuctionDoc(auctionSnap.data());
      if (auction.auctionStatus !== 'OPEN') {
        throw new RoomActionError('VALIDATION', 'This auction round has already closed.');
      }
      if (Date.now() > auction.deadlineTimestamp) {
        throw new RoomActionError('VALIDATION', 'Auction timer has expired.');
      }
      if (auction.highestBidderTeamId === team.id) {
        throw new RoomActionError('VALIDATION', 'You are already the highest bidder.');
      }

      const minRequired = auction.highestBidderTeamId
        ? auction.highestBid + room.settings.minBidIncrement
        : Math.max(auction.startingBid, room.settings.minStartingBid);

      if (numeric < minRequired) {
        throw new RoomActionError(
          'VALIDATION',
          `Bid must be at least ${minRequired} coins.`,
        );
      }

      if (numeric > team.coinBalance) {
        throw new RoomActionError(
          'VALIDATION',
          `Insufficient coin balance. Your team has ${team.coinBalance} coins available.`,
        );
      }

      const nextSeq = auction.sequenceCounter + 1;

      tx.update(authRef, {
        authVerifier,
        lastPingAt: serverTimestamp(),
      });

      tx.update(auctionRef, {
        highestBid: numeric,
        highestBidderTeamId: team.id,
        highestBidderTeamName: team.teamName,
        sequenceCounter: nextSeq,
        updatedAt: serverTimestamp(),
      });

      tx.set(doc(db, 'rooms', input.roomId, 'bids', bidId), {
        id: bidId,
        auctionId: auction.id,
        roomId: input.roomId,
        teamId: team.id,
        teamName: team.teamName,
        bidAmount: numeric,
        sequenceNumber: nextSeq,
        status: 'ACCEPTED',
        serverTimestamp: serverTimestamp(),
      });
    });

    return { ok: true, message: `Bid of ${numeric} coins accepted! You currently lead.` };
  } catch (err) {
    if (err instanceof RoomActionError) {
      return { ok: false, message: err.message };
    }
    const classified = classifyError(err, 'Unable to place bid.');
    return { ok: false, message: classified.message };
  }
}

// ==========================================
// HOST ITEM MANAGEMENT (NO CORRECT ANSWER FIELD)
// ==========================================
export async function addCustomItem(
  roomId: string,
  payload: {
    itemName: string;
    questionTitle?: string;
    questionDescription?: string;
    category?: string;
    imageOrEmoji: string;
    difficulty?: DifficultyLevel | '';
    startingBid: number;
    auctionDurationOverride?: number | null;
    answerDurationOverride?: number | null;
    saveToBank?: boolean;
  },
): Promise<void> {
  const host = requireHostAuth();
  const itemName = payload.itemName.trim().slice(0, 120);
  if (!itemName) {
    throw new RoomActionError('VALIDATION', 'Item name is required.');
  }
  const questionTitle = (payload.questionTitle || itemName).trim().slice(0, 300) || itemName;
  const questionDescription = (payload.questionDescription || '').trim().slice(0, 2000);
  const safeImageOrEmoji = sanitizeImageOrEmoji(payload.imageOrEmoji);

  const itemsSnap = await getDocs(
    query(collection(db, 'rooms', roomId, 'items'), where('roomId', '==', roomId)),
  );
  const existingItems = itemsSnap.docs.map((d) => mapPublicItemDoc(d.data()));
  const nextOrder =
    existingItems.reduce((acc, item) => Math.max(acc, item.sortOrder), -1) + 1;

  const itemId = newId('item');
  const batch = writeBatch(db);

  batch.set(doc(db, 'rooms', roomId, 'items', itemId), {
    id: itemId,
    roomId,
    sortOrder: nextOrder,
    itemName,
    category: (payload.category || 'Tech Auction').trim().slice(0, 80),
    imageOrEmoji: safeImageOrEmoji,
    difficulty: payload.difficulty || '',
    startingBid: Math.max(1, Math.trunc(Number(payload.startingBid || 10))),
    auctionDurationOverride: payload.auctionDurationOverride
      ? Math.min(600, Math.max(5, Math.trunc(payload.auctionDurationOverride)))
      : null,
    answerDurationOverride: payload.answerDurationOverride
      ? Math.min(300, Math.max(5, Math.trunc(payload.answerDurationOverride)))
      : null,
    status: 'PENDING',
    createdAt: serverTimestamp(),
  });

  batch.set(doc(db, 'rooms', roomId, 'host_prompts', itemId), {
    id: itemId,
    roomId,
    hostId: host.id,
    questionTitle,
    questionDescription,
    updatedAt: serverTimestamp(),
  });

  const newTotal = existingItems.length + 1;
  const newUnused = existingItems.filter((i) => i.status === 'PENDING').length + 1;
  batch.update(doc(db, 'rooms', roomId), {
    itemCount: newTotal,
    unusedItemCount: newUnused,
    updatedAt: serverTimestamp(),
  });

  if (payload.saveToBank) {
    const bankId = newId('bank');
    batch.set(doc(db, 'users', host.id, 'question_bank', bankId), {
      id: bankId,
      hostId: host.id,
      itemName,
      questionTitle,
      questionDescription,
      category: (payload.category || 'Tech Auction').trim().slice(0, 80),
      imageOrEmoji: safeImageOrEmoji,
      difficulty: payload.difficulty || '',
      startingBid: Math.max(1, Math.trunc(Number(payload.startingBid || 10))),
      auctionDurationOverride: payload.auctionDurationOverride ?? null,
      answerDurationOverride: payload.answerDurationOverride ?? null,
      createdAt: serverTimestamp(),
    });
  }

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `rooms/${roomId}/items/${itemId}`);
  }
}

export async function updateCustomItem(
  roomId: string,
  itemId: string,
  payload: {
    itemName: string;
    questionTitle?: string;
    questionDescription?: string;
    category?: string;
    imageOrEmoji: string;
    difficulty?: DifficultyLevel | '';
    startingBid: number;
    auctionDurationOverride?: number | null;
    answerDurationOverride?: number | null;
  },
): Promise<void> {
  const host = requireHostAuth();
  const itemName = payload.itemName.trim().slice(0, 120);
  if (!itemName) {
    throw new RoomActionError('VALIDATION', 'Item name is required.');
  }
  const questionTitle = (payload.questionTitle || itemName).trim().slice(0, 300) || itemName;
  const safeImageOrEmoji = sanitizeImageOrEmoji(payload.imageOrEmoji);

  const batch = writeBatch(db);
  batch.update(doc(db, 'rooms', roomId, 'items', itemId), {
    itemName,
    category: (payload.category || 'Tech Auction').trim().slice(0, 80),
    imageOrEmoji: safeImageOrEmoji,
    difficulty: payload.difficulty || '',
    startingBid: Math.max(1, Math.trunc(Number(payload.startingBid || 10))),
    auctionDurationOverride: payload.auctionDurationOverride
      ? Math.min(600, Math.max(5, Math.trunc(payload.auctionDurationOverride)))
      : null,
    answerDurationOverride: payload.answerDurationOverride
      ? Math.min(300, Math.max(5, Math.trunc(payload.answerDurationOverride)))
      : null,
  });

  batch.set(doc(db, 'rooms', roomId, 'host_prompts', itemId), {
    id: itemId,
    roomId,
    hostId: host.id,
    questionTitle,
    questionDescription: (payload.questionDescription || '').trim().slice(0, 2000),
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `rooms/${roomId}/items/${itemId}`);
  }
}

export async function deleteCustomItem(roomId: string, itemId: string): Promise<void> {
  requireHostAuth();
  const itemsSnap = await getDocs(
    query(collection(db, 'rooms', roomId, 'items'), where('roomId', '==', roomId)),
  );
  const remaining = itemsSnap.docs
    .map((d) => mapPublicItemDoc(d.data()))
    .filter((i) => i.id !== itemId);

  const batch = writeBatch(db);
  batch.delete(doc(db, 'rooms', roomId, 'items', itemId));
  batch.delete(doc(db, 'rooms', roomId, 'host_prompts', itemId));
  batch.update(doc(db, 'rooms', roomId), {
    itemCount: remaining.length,
    unusedItemCount: remaining.filter((i) => i.status === 'PENDING').length,
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `rooms/${roomId}/items/${itemId}`);
  }
}

export async function duplicateCustomItem(roomId: string, item: AuctionItem): Promise<void> {
  await addCustomItem(roomId, {
    itemName: `${item.itemName} (Copy)`.slice(0, 120),
    questionTitle: item.questionTitle,
    questionDescription: item.questionDescription,
    category: item.category,
    imageOrEmoji: item.imageOrEmoji,
    difficulty: item.difficulty,
    startingBid: item.startingBid,
    auctionDurationOverride: item.auctionDurationOverride,
    answerDurationOverride: item.answerDurationOverride,
    saveToBank: false,
  });
}

export async function reorderCustomItems(roomId: string, itemIds: string[]): Promise<void> {
  requireHostAuth();
  const batch = writeBatch(db);
  itemIds.forEach((id, idx) => {
    batch.update(doc(db, 'rooms', roomId, 'items', id), { sortOrder: idx });
  });
  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `rooms/${roomId}/items`);
  }
}

export async function randomizePendingItems(roomId: string, items: AuctionItem[]): Promise<void> {
  const nonPending = items.filter((i) => i.status !== 'PENDING');
  const pending = [...items.filter((i) => i.status === 'PENDING')];
  for (let i = pending.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pending[i], pending[j]] = [pending[j], pending[i]];
  }
  await reorderCustomItems(
    roomId,
    [...nonPending, ...pending].map((i) => i.id),
  );
}

export function parseCsvLines(csvText: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const ch = csvText[i];
    const next = csvText[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(cell.trim());
        cell = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && next === '\n') i++;
        row.push(cell.trim());
        if (row.some((c) => c.length > 0)) rows.push(row);
        row = [];
        cell = '';
      } else {
        cell += ch;
      }
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    if (row.some((c) => c.length > 0)) rows.push(row);
  }
  return rows;
}

export async function importItemsFromCsv(
  roomId: string,
  csvText: string,
  defaultStartingBid: number,
): Promise<number> {
  const host = requireHostAuth();
  const rows = parseCsvLines(csvText);
  if (rows.length < 2) {
    throw new RoomActionError(
      'VALIDATION',
      'CSV must include a header row and at least one item row.',
    );
  }

  const header = rows[0].map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const findCol = (candidates: string[]) => header.findIndex((h) => candidates.includes(h));

  const idxName = findCol(['itemname', 'item', 'name']);
  const idxTitle = findCol(['questiontitle', 'title', 'question']);
  const idxDesc = findCol(['questiondescription', 'description', 'details', 'prompt']);
  const idxCat = findCol(['category', 'topic']);
  const idxEmoji = findCol(['imageoremoji', 'emoji', 'icon', 'image']);
  const idxDiff = findCol(['difficulty', 'level']);
  const idxBid = findCol(['startingbid', 'minbid', 'bid']);

  if (idxName === -1) {
    throw new RoomActionError(
      'VALIDATION',
      'CSV header must include an itemName column.',
    );
  }

  const itemsSnap = await getDocs(
    query(collection(db, 'rooms', roomId, 'items'), where('roomId', '==', roomId)),
  );
  const existingItems = itemsSnap.docs.map((d) => mapPublicItemDoc(d.data()));
  let nextOrder =
    existingItems.reduce((acc, item) => Math.max(acc, item.sortOrder), -1) + 1;

  const batch = writeBatch(db);
  let imported = 0;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const itemName = (r[idxName] || '').trim().slice(0, 120);
    if (!itemName) continue;
    const questionTitle =
      idxTitle >= 0 && r[idxTitle] ? r[idxTitle].trim().slice(0, 300) : itemName;

    const itemId = newId('item');
    const rawDiff = idxDiff >= 0 ? (r[idxDiff] || '').trim() : '';
    const difficulty = (['Easy', 'Medium', 'Hard', 'Expert'].includes(rawDiff)
      ? rawDiff
      : '') as DifficultyLevel | '';
    const parsedBid =
      idxBid >= 0 ? Math.trunc(Number(r[idxBid])) : defaultStartingBid;
    const startingBid = Number.isFinite(parsedBid) && parsedBid > 0 ? parsedBid : 10;
    const safeImage = sanitizeImageOrEmoji(idxEmoji >= 0 ? r[idxEmoji] : '💻');

    batch.set(doc(db, 'rooms', roomId, 'items', itemId), {
      id: itemId,
      roomId,
      sortOrder: nextOrder++,
      itemName,
      category: (idxCat >= 0 && r[idxCat] ? r[idxCat].trim() : 'Tech Auction').slice(0, 80),
      imageOrEmoji: safeImage,
      difficulty,
      startingBid,
      auctionDurationOverride: null,
      answerDurationOverride: null,
      status: 'PENDING',
      createdAt: serverTimestamp(),
    });

    batch.set(doc(db, 'rooms', roomId, 'host_prompts', itemId), {
      id: itemId,
      roomId,
      hostId: host.id,
      questionTitle,
      questionDescription: (idxDesc >= 0 ? r[idxDesc] || '' : '').trim().slice(0, 2000),
      updatedAt: serverTimestamp(),
    });
    imported++;
  }

  if (imported === 0) {
    throw new RoomActionError('VALIDATION', 'No valid rows found in CSV.');
  }

  batch.update(doc(db, 'rooms', roomId), {
    itemCount: existingItems.length + imported,
    unusedItemCount: existingItems.filter((i) => i.status === 'PENDING').length + imported,
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `rooms/${roomId}/items`);
  }
  return imported;
}

export async function addItemsFromQuestionBank(
  roomId: string,
  bankItems: QuestionBankItem[],
): Promise<void> {
  const host = requireHostAuth();
  if (bankItems.length === 0) return;

  const itemsSnap = await getDocs(
    query(collection(db, 'rooms', roomId, 'items'), where('roomId', '==', roomId)),
  );
  const existingItems = itemsSnap.docs.map((d) => mapPublicItemDoc(d.data()));
  let nextOrder =
    existingItems.reduce((acc, item) => Math.max(acc, item.sortOrder), -1) + 1;

  const batch = writeBatch(db);
  for (const b of bankItems) {
    const itemId = newId('item');
    batch.set(doc(db, 'rooms', roomId, 'items', itemId), {
      id: itemId,
      roomId,
      sortOrder: nextOrder++,
      itemName: b.itemName.slice(0, 120),
      category: b.category.slice(0, 80),
      imageOrEmoji: sanitizeImageOrEmoji(b.imageOrEmoji),
      difficulty: b.difficulty,
      startingBid: Math.max(1, Math.trunc(b.startingBid)),
      auctionDurationOverride: b.auctionDurationOverride,
      answerDurationOverride: b.answerDurationOverride,
      status: 'PENDING',
      createdAt: serverTimestamp(),
    });
    batch.set(doc(db, 'rooms', roomId, 'host_prompts', itemId), {
      id: itemId,
      roomId,
      hostId: host.id,
      questionTitle: b.questionTitle.slice(0, 300),
      questionDescription: b.questionDescription.slice(0, 2000),
      updatedAt: serverTimestamp(),
    });
  }

  batch.update(doc(db, 'rooms', roomId), {
    itemCount: existingItems.length + bankItems.length,
    unusedItemCount:
      existingItems.filter((i) => i.status === 'PENDING').length + bankItems.length,
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `rooms/${roomId}/items`);
  }
}

// ==========================================
// HOST LIVE AUCTION, ECONOMY & ROOM LIFECYCLE
// ==========================================
export async function updateRoomSettings(
  roomId: string,
  roomCode: string,
  payload: {
    roomName: string;
    settings: RoomSettings;
    newPin?: string;
    clearPin?: boolean;
  },
): Promise<void> {
  const host = requireHostAuth();
  const cleanName = payload.roomName.trim().slice(0, 80);
  if (cleanName.length < 2) {
    throw new RoomActionError('VALIDATION', 'Room name must be at least 2 characters.');
  }
  const settings = normalizeSettings(payload.settings);

  const roomSnap = await getDoc(doc(db, 'rooms', roomId));
  if (!roomSnap.exists()) throw new RoomActionError('NOT_FOUND', 'Room not found.');
  const room = mapRoomDoc(roomSnap.data());

  let hasPin = room.hasPin;
  const batch = writeBatch(db);

  if (payload.clearPin) {
    hasPin = false;
    batch.delete(doc(db, 'rooms', roomId, 'private', 'pin'));
  } else if (payload.newPin && payload.newPin.trim().length > 0) {
    hasPin = true;
    const pinHash = await sha256Hex(`${roomId}:${payload.newPin.trim()}`);
    batch.set(doc(db, 'rooms', roomId, 'private', 'pin'), {
      roomId,
      hostId: host.id,
      pinHash,
      updatedAt: serverTimestamp(),
    });
  }

  batch.update(doc(db, 'rooms', roomId), {
    roomName: cleanName,
    hasPin,
    settings,
    updatedAt: serverTimestamp(),
  });

  batch.update(doc(db, 'room_codes', roomCode), {
    roomName: cleanName,
    hasPin,
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `rooms/${roomId}`);
  }
}

export async function toggleRoomActive(
  roomId: string,
  roomCode: string,
  currentActive: boolean,
): Promise<void> {
  requireHostAuth();
  const nextActive = !currentActive;
  const batch = writeBatch(db);
  batch.update(doc(db, 'rooms', roomId), {
    isActive: nextActive,
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'room_codes', roomCode), {
    isActive: nextActive,
    updatedAt: serverTimestamp(),
  });
  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `rooms/${roomId}`);
  }
}

export async function markRoomReady(roomId: string, roomCode: string): Promise<void> {
  requireHostAuth();
  const batch = writeBatch(db);
  batch.update(doc(db, 'rooms', roomId), {
    machineState: 'ROOM_READY',
    isActive: true,
    lastAnnouncement: 'Room is ready to start the auction!',
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'room_codes', roomCode), {
    machineState: 'ROOM_READY',
    isActive: true,
    updatedAt: serverTimestamp(),
  });
  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `rooms/${roomId}`);
  }
}

export async function completeRoom(roomId: string, roomCode: string): Promise<void> {
  requireHostAuth();
  const batch = writeBatch(db);
  batch.update(doc(db, 'rooms', roomId), {
    machineState: 'ROOM_COMPLETED',
    isPaused: false,
    pausedFromState: null,
    pausedRemainingMs: null,
    lastAnnouncement: 'Event completed! Final standings are announced.',
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'room_codes', roomCode), {
    machineState: 'ROOM_COMPLETED',
    updatedAt: serverTimestamp(),
  });
  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `rooms/${roomId}`);
  }
}

export async function deleteRoom(roomId: string, roomCode: string): Promise<void> {
  const host = requireHostAuth();
  const subcollections = [
    'items',
    'teams',
    'auctions',
    'bids',
    'answer_sessions',
    'transactions',
    'history',
  ];

  try {
    const batch = writeBatch(db);
    const teamsSnap = await getDocs(
      query(collection(db, 'rooms', roomId, 'teams'), where('roomId', '==', roomId)),
    );
    teamsSnap.docs.forEach((d) => {
      const data = d.data();
      batch.delete(doc(db, 'rooms', roomId, 'team_auth', d.id));
      if (typeof data.nameSlug === 'string' && data.nameSlug) {
        batch.delete(doc(db, 'rooms', roomId, 'team_names', data.nameSlug));
      }
    });

    const promptsSnap = await getDocs(
      query(collection(db, 'rooms', roomId, 'host_prompts'), where('hostId', '==', host.id)),
    );
    promptsSnap.docs.forEach((d) => batch.delete(d.ref));

    for (const sub of subcollections) {
      const snap = await getDocs(
        query(collection(db, 'rooms', roomId, sub), where('roomId', '==', roomId)),
      );
      snap.docs.forEach((d) => batch.delete(d.ref));
    }

    batch.delete(doc(db, 'rooms', roomId, 'private', 'pin'));
    batch.delete(doc(db, 'room_codes', roomCode));
    batch.delete(doc(db, 'rooms', roomId));
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `rooms/${roomId}`);
  }
}

export async function removeTeamFromRoom(roomId: string, team: Team): Promise<void> {
  requireHostAuth();
  const batch = writeBatch(db);
  batch.update(doc(db, 'rooms', roomId, 'teams', team.id), {
    participationStatus: 'REMOVED',
    connectionStatus: 'OFFLINE',
    lastSeenAt: serverTimestamp(),
  });
  if (team.nameSlug) {
    batch.update(doc(db, 'rooms', roomId, 'team_names', team.nameSlug), {
      participationStatus: 'REMOVED',
    });
  }
  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `rooms/${roomId}/teams/${team.id}`);
  }
}

export async function startAuction(roomId: string, item: AuctionItem): Promise<void> {
  requireHostAuth();
  const auctionId = newId('auc');
  try {
    await runTransaction(db, async (tx) => {
      const roomRef = doc(db, 'rooms', roomId);
      const roomSnap = await tx.get(roomRef);
      if (!roomSnap.exists()) throw new RoomActionError('NOT_FOUND', 'Room not found.');
      const room = mapRoomDoc(roomSnap.data());

      if (!['ROOM_WAITING', 'ROOM_READY', 'NEXT_ITEM_PENDING'].includes(room.machineState)) {
        throw new RoomActionError(
          'VALIDATION',
          `Cannot start auction from state ${room.machineState}.`,
        );
      }

      const durationSec = item.auctionDurationOverride ?? room.settings.auctionDurationSec;
      const now = Date.now();
      const deadlineMs = now + durationSec * 1000;
      const startingBid = Math.max(item.startingBid, room.settings.minStartingBid);

      tx.set(doc(db, 'rooms', roomId, 'auctions', auctionId), {
        id: auctionId,
        roomId,
        itemId: item.id,
        startingBid,
        auctionStatus: 'OPEN',
        startTimestamp: now,
        deadlineTimestamp: deadlineMs,
        deadlineAt: Timestamp.fromMillis(deadlineMs),
        closedTimestamp: null,
        highestBid: startingBid,
        highestBidderTeamId: null,
        highestBidderTeamName: null,
        sequenceCounter: 0,
        bidDeducted: false,
        deductedAmount: 0,
        bidRefunded: false,
        updatedAt: serverTimestamp(),
      });

      tx.update(roomRef, {
        machineState: 'AUCTION_OPEN',
        isPaused: false,
        pausedFromState: null,
        pausedRemainingMs: null,
        isActive: true,
        currentAuctionId: auctionId,
        currentAnswerSessionId: null,
        lastAnnouncement: `Auction LIVE for "${item.itemName}"! Starting bid: ${startingBid} coins.`,
        updatedAt: serverTimestamp(),
      });

      tx.update(doc(db, 'room_codes', room.roomCode), {
        machineState: 'AUCTION_OPEN',
        isActive: true,
        updatedAt: serverTimestamp(),
      });
    });
  } catch (err) {
    if (err instanceof RoomActionError) throw err;
    handleFirestoreError(err, OperationType.WRITE, `rooms/${roomId}/auctions/${auctionId}`);
  }
}

export async function closeAuctionTransaction(roomId: string, auctionId: string): Promise<void> {
  const host = requireHostAuth();
  const sessionId = newId('ans');
  const txId = newId('tx');

  try {
    await runTransaction(db, async (tx) => {
      const roomRef = doc(db, 'rooms', roomId);
      const auctionRef = doc(db, 'rooms', roomId, 'auctions', auctionId);

      const [roomSnap, auctionSnap] = await Promise.all([tx.get(roomRef), tx.get(auctionRef)]);
      if (!roomSnap.exists() || !auctionSnap.exists()) return;

      const room = mapRoomDoc(roomSnap.data());
      const auction = mapAuctionDoc(auctionSnap.data());
      if (auction.auctionStatus !== 'OPEN' || room.machineState !== 'AUCTION_OPEN') {
        return; // Idempotent guard
      }

      const itemSnap = await tx.get(doc(db, 'rooms', roomId, 'items', auction.itemId));
      const itemName = itemSnap.exists() ? String(itemSnap.data().itemName) : 'Auction Item';
      const now = Date.now();

      if (auction.highestBidderTeamId && auction.highestBidderTeamName) {
        const winningTeamId = auction.highestBidderTeamId;
        const winningTeamName = auction.highestBidderTeamName;
        const winningBid = auction.highestBid;

        const teamRef = doc(db, 'rooms', roomId, 'teams', winningTeamId);
        const teamSnap = await tx.get(teamRef);
        const team = teamSnap.exists() ? mapTeamDoc(teamSnap.data()) : null;

        let bidDeducted = false;
        let deductedAmount = 0;

        if (room.settings.deductWinningBid && !auction.bidDeducted && team) {
          const prevCoins = team.coinBalance;
          const nextCoins = Math.max(0, prevCoins - winningBid);
          const actualDeduction = nextCoins - prevCoins; // negative or 0
          bidDeducted = true;
          deductedAmount = Math.abs(actualDeduction);

          tx.update(teamRef, {
            coinBalance: nextCoins,
            lastSeenAt: serverTimestamp(),
          });

          tx.set(doc(db, 'rooms', roomId, 'transactions', txId), {
            id: txId,
            roomId,
            teamId: winningTeamId,
            teamName: winningTeamName,
            currencyType: 'COINS',
            transactionType: 'BID_DEDUCTION',
            previousBalance: prevCoins,
            configuredChange: -winningBid,
            actualChange: actualDeduction,
            newBalance: nextCoins,
            reason: `Winning bid deducted for "${itemName}" (${winningBid} coins)`,
            itemId: auction.itemId,
            itemName,
            auctionId: auction.id,
            hostId: host.id,
            timestamp: serverTimestamp(),
          });
        }

        tx.update(auctionRef, {
          auctionStatus: 'WINNER_SELECTED',
          closedTimestamp: now,
          bidDeducted,
          deductedAmount,
          updatedAt: serverTimestamp(),
        });

        tx.set(doc(db, 'rooms', roomId, 'answer_sessions', sessionId), {
          id: sessionId,
          auctionId: auction.id,
          roomId,
          itemId: auction.itemId,
          winningTeamId,
          winningTeamName,
          answerStartTimestamp: null,
          answerDeadlineTimestamp: null,
          answerDecisionTimestamp: null,
          responseTimeMs: null,
          hostDecision: 'PENDING',
        });

        tx.update(roomRef, {
          machineState: 'WINNER_SELECTED',
          isPaused: false,
          pausedFromState: null,
          pausedRemainingMs: null,
          currentAnswerSessionId: sessionId,
          lastAnnouncement: bidDeducted
            ? `${winningTeamName} won "${itemName}" for ${winningBid} coins (${winningBid} coins deducted).`
            : `${winningTeamName} won "${itemName}" with a bid of ${winningBid} coins!`,
          updatedAt: serverTimestamp(),
        });

        tx.update(doc(db, 'room_codes', room.roomCode), {
          machineState: 'WINNER_SELECTED',
          updatedAt: serverTimestamp(),
        });
      } else {
        tx.update(auctionRef, {
          auctionStatus: 'CLOSED',
          closedTimestamp: now,
          updatedAt: serverTimestamp(),
        });

        tx.update(roomRef, {
          machineState: 'AUCTION_CLOSED',
          isPaused: false,
          pausedFromState: null,
          pausedRemainingMs: null,
          lastAnnouncement: `No bids placed for "${itemName}". Host can restart or skip.`,
          updatedAt: serverTimestamp(),
        });

        tx.update(doc(db, 'room_codes', room.roomCode), {
          machineState: 'AUCTION_CLOSED',
          updatedAt: serverTimestamp(),
        });
      }
    });
  } catch (err) {
    if (err instanceof RoomActionError) throw err;
    handleFirestoreError(err, OperationType.UPDATE, `rooms/${roomId}/auctions/${auctionId}`);
  }
}

export async function restartClosedAuction(roomId: string, item: AuctionItem): Promise<void> {
  requireHostAuth();
  await runTransaction(db, async (tx) => {
    const roomRef = doc(db, 'rooms', roomId);
    const roomSnap = await tx.get(roomRef);
    if (!roomSnap.exists()) throw new RoomActionError('NOT_FOUND', 'Room not found.');
    const room = mapRoomDoc(roomSnap.data());
    if (room.machineState !== 'AUCTION_CLOSED') {
      throw new RoomActionError('VALIDATION', 'Auction can only be restarted from AUCTION_CLOSED.');
    }
    tx.update(roomRef, {
      machineState: 'ROOM_READY',
      currentAuctionId: null,
      currentAnswerSessionId: null,
      updatedAt: serverTimestamp(),
    });
  });
  await startAuction(roomId, item);
}

export async function pauseCurrentSession(roomId: string): Promise<void> {
  requireHostAuth();
  try {
    await runTransaction(db, async (tx) => {
      const roomRef = doc(db, 'rooms', roomId);
      const roomSnap = await tx.get(roomRef);
      if (!roomSnap.exists()) throw new RoomActionError('NOT_FOUND', 'Room not found.');
      const room = mapRoomDoc(roomSnap.data());
      if (room.isPaused) return;
      if (!['AUCTION_OPEN', 'ANSWER_RUNNING'].includes(room.machineState)) {
        throw new RoomActionError('VALIDATION', 'Only an active auction or answer timer can be paused.');
      }

      let remainingMs = 0;
      const now = Date.now();
      if (room.machineState === 'AUCTION_OPEN' && room.currentAuctionId) {
        const aucSnap = await tx.get(doc(db, 'rooms', roomId, 'auctions', room.currentAuctionId));
        if (aucSnap.exists()) {
          remainingMs = Math.max(0, Number(aucSnap.data().deadlineTimestamp) - now);
        }
      } else if (room.machineState === 'ANSWER_RUNNING' && room.currentAnswerSessionId) {
        const ansSnap = await tx.get(
          doc(db, 'rooms', roomId, 'answer_sessions', room.currentAnswerSessionId),
        );
        if (ansSnap.exists()) {
          remainingMs = Math.max(0, Number(ansSnap.data().answerDeadlineTimestamp ?? now) - now);
        }
      }

      tx.update(roomRef, {
        isPaused: true,
        pausedFromState: room.machineState,
        pausedRemainingMs: Math.trunc(remainingMs),
        lastAnnouncement: 'Session paused by host.',
        updatedAt: serverTimestamp(),
      });
    });
  } catch (err) {
    if (err instanceof RoomActionError) throw err;
    handleFirestoreError(err, OperationType.UPDATE, `rooms/${roomId}`);
  }
}

export async function resumeCurrentSession(roomId: string): Promise<void> {
  requireHostAuth();
  try {
    await runTransaction(db, async (tx) => {
      const roomRef = doc(db, 'rooms', roomId);
      const roomSnap = await tx.get(roomRef);
      if (!roomSnap.exists()) throw new RoomActionError('NOT_FOUND', 'Room not found.');
      const room = mapRoomDoc(roomSnap.data());
      if (!room.isPaused) return;

      const remainingMs = Math.max(2000, room.pausedRemainingMs ?? 5000);
      const nextDeadline = Date.now() + remainingMs;

      if (room.pausedFromState === 'AUCTION_OPEN' && room.currentAuctionId) {
        tx.update(doc(db, 'rooms', roomId, 'auctions', room.currentAuctionId), {
          deadlineTimestamp: nextDeadline,
          deadlineAt: Timestamp.fromMillis(nextDeadline),
          updatedAt: serverTimestamp(),
        });
      } else if (room.pausedFromState === 'ANSWER_RUNNING' && room.currentAnswerSessionId) {
        tx.update(doc(db, 'rooms', roomId, 'answer_sessions', room.currentAnswerSessionId), {
          answerDeadlineTimestamp: nextDeadline,
        });
      }

      tx.update(roomRef, {
        isPaused: false,
        pausedFromState: null,
        pausedRemainingMs: null,
        lastAnnouncement: 'Session resumed by host!',
        updatedAt: serverTimestamp(),
      });
    });
  } catch (err) {
    if (err instanceof RoomActionError) throw err;
    handleFirestoreError(err, OperationType.UPDATE, `rooms/${roomId}`);
  }
}

export async function startAnswerTimer(
  roomId: string,
  sessionId: string,
  answerDurationOverride: number | null,
): Promise<void> {
  requireHostAuth();
  try {
    await runTransaction(db, async (tx) => {
      const roomRef = doc(db, 'rooms', roomId);
      const sessionRef = doc(db, 'rooms', roomId, 'answer_sessions', sessionId);
      const [roomSnap, sessionSnap] = await Promise.all([tx.get(roomRef), tx.get(sessionRef)]);
      if (!roomSnap.exists() || !sessionSnap.exists()) {
        throw new RoomActionError('NOT_FOUND', 'Answer session not found.');
      }
      const room = mapRoomDoc(roomSnap.data());
      const session = mapAnswerSessionDoc(sessionSnap.data());
      if (!['WINNER_SELECTED', 'ANSWER_PENDING'].includes(room.machineState)) {
        throw new RoomActionError('VALIDATION', 'Answer timer can only start after winner selection.');
      }

      const sec = answerDurationOverride ?? room.settings.answerDurationSec;
      const now = Date.now();
      const deadline = now + sec * 1000;

      tx.update(sessionRef, {
        answerStartTimestamp: now,
        answerDeadlineTimestamp: deadline,
      });

      tx.update(roomRef, {
        machineState: 'ANSWER_RUNNING',
        isPaused: false,
        pausedFromState: null,
        pausedRemainingMs: null,
        lastAnnouncement: `${session.winningTeamName} is answering live (${sec}s timer).`,
        updatedAt: serverTimestamp(),
      });

      tx.update(doc(db, 'room_codes', room.roomCode), {
        machineState: 'ANSWER_RUNNING',
        updatedAt: serverTimestamp(),
      });
    });
  } catch (err) {
    if (err instanceof RoomActionError) throw err;
    handleFirestoreError(err, OperationType.UPDATE, `rooms/${roomId}/answer_sessions/${sessionId}`);
  }
}

export async function refundCancelledAuctionTransaction(
  roomId: string,
  auctionId: string,
): Promise<void> {
  const host = requireHostAuth();
  const refundTxId = newId('tx');
  const historyId = newId('hist');

  try {
    await runTransaction(db, async (tx) => {
      const roomRef = doc(db, 'rooms', roomId);
      const auctionRef = doc(db, 'rooms', roomId, 'auctions', auctionId);

      const [roomSnap, auctionSnap] = await Promise.all([tx.get(roomRef), tx.get(auctionRef)]);
      if (!roomSnap.exists() || !auctionSnap.exists()) {
        throw new RoomActionError('NOT_FOUND', 'Auction not found.');
      }
      const room = mapRoomDoc(roomSnap.data());
      const auction = mapAuctionDoc(auctionSnap.data());

      const itemRef = doc(db, 'rooms', roomId, 'items', auction.itemId);
      const promptRef = doc(db, 'rooms', roomId, 'host_prompts', auction.itemId);
      const ansRef = room.currentAnswerSessionId
        ? doc(db, 'rooms', roomId, 'answer_sessions', room.currentAnswerSessionId)
        : null;
      const itemsSnap = await getDocs(
        query(collection(db, 'rooms', roomId, 'items'), where('roomId', '==', roomId)),
      );

      const [itemSnap, promptSnap, ansSnap, teamSnap] = await Promise.all([
        tx.get(itemRef),
        tx.get(promptRef),
        ansRef ? tx.get(ansRef) : Promise.resolve(null),
        auction.bidDeducted &&
        !auction.bidRefunded &&
        auction.deductedAmount > 0 &&
        auction.highestBidderTeamId
          ? tx.get(doc(db, 'rooms', roomId, 'teams', auction.highestBidderTeamId))
          : Promise.resolve(null),
      ]);
      const itemName = itemSnap.exists() ? String(itemSnap.data().itemName) : 'Auction Item';
      const questionTitle = promptSnap.exists() ? String(promptSnap.data().questionTitle) : itemName;

      let coinsRefunded = 0;
      let finalCoinBalance: number | null = null;
      let finalPoints: number | null = null;

      if (
        auction.bidDeducted &&
        !auction.bidRefunded &&
        auction.deductedAmount > 0 &&
        auction.highestBidderTeamId &&
        teamSnap &&
        teamSnap.exists()
      ) {
        const teamRef = doc(db, 'rooms', roomId, 'teams', auction.highestBidderTeamId);
        const team = mapTeamDoc(teamSnap.data());
        const prevCoins = team.coinBalance;
        const nextCoins = prevCoins + auction.deductedAmount;
        coinsRefunded = auction.deductedAmount;
        finalCoinBalance = nextCoins;
        finalPoints = team.points;

        tx.update(teamRef, {
          coinBalance: nextCoins,
          lastSeenAt: serverTimestamp(),
        });

        tx.set(doc(db, 'rooms', roomId, 'transactions', refundTxId), {
          id: refundTxId,
          roomId,
          teamId: team.id,
          teamName: team.teamName,
          currencyType: 'COINS',
          transactionType: 'REFUND',
          previousBalance: prevCoins,
          configuredChange: coinsRefunded,
          actualChange: coinsRefunded,
          newBalance: nextCoins,
          reason: `Refund for cancelled auction "${itemName}"`,
          itemId: auction.itemId,
          itemName,
          auctionId: auction.id,
          hostId: host.id,
          timestamp: serverTimestamp(),
        });
      }

      if (ansRef && ansSnap && ansSnap.exists() && ansSnap.data().hostDecision === 'PENDING') {
        tx.update(ansRef, {
          answerDecisionTimestamp: Date.now(),
          hostDecision: 'SKIPPED',
        });
      }

      tx.update(auctionRef, {
        auctionStatus: 'SKIPPED',
        bidRefunded: coinsRefunded > 0 || auction.bidRefunded,
        updatedAt: serverTimestamp(),
      });

      if (itemSnap.exists()) {
        tx.update(itemRef, { status: 'SKIPPED' });
      }

      const remainingUnused = itemsSnap.docs.filter(
        (d) => d.id !== auction.itemId && d.data().status === 'PENDING',
      ).length;

      tx.set(doc(db, 'rooms', roomId, 'history', historyId), {
        id: historyId,
        roomId,
        roomName: room.roomName,
        itemId: auction.itemId,
        itemName,
        questionTitle,
        auctionId: auction.id,
        winningTeamId: auction.highestBidderTeamId,
        winningTeamName: auction.highestBidderTeamName,
        finalBid: auction.highestBid,
        winningBidDeducted: auction.deductedAmount,
        auctionStartTimestamp: auction.startTimestamp,
        auctionEndTimestamp: auction.closedTimestamp,
        answerStartTimestamp: null,
        hostDecision: 'SKIPPED',
        responseTimeMs: null,
        coinsChange: coinsRefunded,
        pointsChange: 0,
        finalCoinBalance,
        finalPoints,
        timestamp: serverTimestamp(),
      });

      tx.update(roomRef, {
        machineState: 'ANSWER_EVALUATED',
        isPaused: false,
        pausedFromState: null,
        pausedRemainingMs: null,
        unusedItemCount: remainingUnused,
        lastAnnouncement: coinsRefunded > 0
          ? `Auction cancelled & ${coinsRefunded} coins refunded to ${auction.highestBidderTeamName}.`
          : `Item "${itemName}" cancelled / skipped.`,
        updatedAt: serverTimestamp(),
      });

      tx.update(doc(db, 'room_codes', room.roomCode), {
        machineState: 'ANSWER_EVALUATED',
        updatedAt: serverTimestamp(),
      });
    });
  } catch (err) {
    if (err instanceof RoomActionError) throw err;
    handleFirestoreError(err, OperationType.WRITE, `rooms/${roomId}/auctions/${auctionId}`);
  }
}

export async function evaluateAnswerTransaction(
  roomId: string,
  decision: 'CORRECT' | 'WRONG' | 'SKIPPED',
): Promise<{ alreadyEvaluated: boolean }> {
  const host = requireHostAuth();
  const historyId = newId('hist');

  try {
    let alreadyEvaluated = false;

    await runTransaction(db, async (tx) => {
      const roomRef = doc(db, 'rooms', roomId);
      const roomSnap = await tx.get(roomRef);
      if (!roomSnap.exists()) throw new RoomActionError('NOT_FOUND', 'Room not found.');
      const room = mapRoomDoc(roomSnap.data());

      if (room.machineState === 'ANSWER_EVALUATED') {
        alreadyEvaluated = true;
        return;
      }

      const itemsSnap = await getDocs(
        query(collection(db, 'rooms', roomId, 'items'), where('roomId', '==', roomId)),
      );
      const teamsSnap = await getDocs(
        query(collection(db, 'rooms', roomId, 'teams'), where('roomId', '==', roomId)),
      );

      // Case 1: Skip from AUCTION_CLOSED (no bids)
      if (room.machineState === 'AUCTION_CLOSED' && decision === 'SKIPPED' && room.currentAuctionId) {
        const aucRef = doc(db, 'rooms', roomId, 'auctions', room.currentAuctionId);
        const aucSnap = await tx.get(aucRef);
        if (!aucSnap.exists()) return;
        const auction = mapAuctionDoc(aucSnap.data());

        const itemRef = doc(db, 'rooms', roomId, 'items', auction.itemId);
        const promptRef = doc(db, 'rooms', roomId, 'host_prompts', auction.itemId);
        const [itemSnap, promptSnap] = await Promise.all([tx.get(itemRef), tx.get(promptRef)]);
        const itemName = itemSnap.exists() ? String(itemSnap.data().itemName) : 'Auction Item';
        const questionTitle = promptSnap.exists() ? String(promptSnap.data().questionTitle) : itemName;

        tx.update(aucRef, { auctionStatus: 'SKIPPED', updatedAt: serverTimestamp() });
        if (itemSnap.exists()) tx.update(itemRef, { status: 'SKIPPED' });

        const unusedCount = itemsSnap.docs.filter(
          (d) => d.id !== auction.itemId && d.data().status === 'PENDING',
        ).length;

        tx.set(doc(db, 'rooms', roomId, 'history', historyId), {
          id: historyId,
          roomId,
          roomName: room.roomName,
          itemId: auction.itemId,
          itemName,
          questionTitle,
          auctionId: auction.id,
          winningTeamId: null,
          winningTeamName: null,
          finalBid: 0,
          winningBidDeducted: 0,
          auctionStartTimestamp: auction.startTimestamp,
          auctionEndTimestamp: auction.closedTimestamp,
          answerStartTimestamp: null,
          hostDecision: 'NO_BIDS',
          responseTimeMs: null,
          coinsChange: 0,
          pointsChange: 0,
          finalCoinBalance: null,
          finalPoints: null,
          timestamp: serverTimestamp(),
        });

        tx.update(roomRef, {
          machineState: 'ANSWER_EVALUATED',
          isPaused: false,
          pausedFromState: null,
          pausedRemainingMs: null,
          unusedItemCount: unusedCount,
          lastAnnouncement: `Item "${itemName}" skipped (no bids).`,
          updatedAt: serverTimestamp(),
        });

        tx.update(doc(db, 'room_codes', room.roomCode), {
          machineState: 'ANSWER_EVALUATED',
          updatedAt: serverTimestamp(),
        });
        return;
      }

      if (!room.currentAnswerSessionId || !room.currentAuctionId) {
        throw new RoomActionError('VALIDATION', 'No active answer session to evaluate.');
      }

      const sessionRef = doc(db, 'rooms', roomId, 'answer_sessions', room.currentAnswerSessionId);
      const aucRef = doc(db, 'rooms', roomId, 'auctions', room.currentAuctionId);
      const [sessionSnap, aucSnap] = await Promise.all([tx.get(sessionRef), tx.get(aucRef)]);
      if (!sessionSnap.exists() || !aucSnap.exists()) {
        throw new RoomActionError('NOT_FOUND', 'Answer session or auction missing.');
      }

      const session = mapAnswerSessionDoc(sessionSnap.data());
      if (session.hostDecision !== 'PENDING') {
        alreadyEvaluated = true;
        return;
      }

      const auction = mapAuctionDoc(aucSnap.data());
      const teamRef = doc(db, 'rooms', roomId, 'teams', session.winningTeamId);
      const itemRef = doc(db, 'rooms', roomId, 'items', session.itemId);
      const promptRef = doc(db, 'rooms', roomId, 'host_prompts', session.itemId);

      const [teamSnap, itemSnap, promptSnap] = await Promise.all([
        tx.get(teamRef),
        tx.get(itemRef),
        tx.get(promptRef),
      ]);
      if (!teamSnap.exists()) throw new RoomActionError('NOT_FOUND', 'Winning team not found.');

      const team = mapTeamDoc(teamSnap.data());
      const itemName = itemSnap.exists() ? String(itemSnap.data().itemName) : 'Auction Item';
      const questionTitle = promptSnap.exists() ? String(promptSnap.data().questionTitle) : itemName;

      const now = Date.now();
      const responseTimeMs = session.answerStartTimestamp
        ? Math.max(0, now - session.answerStartTimestamp)
        : 0;

      const prevCoins = team.coinBalance;
      const prevPoints = team.points;
      let nextCoins = prevCoins;
      let nextPoints = prevPoints;
      let configuredCoinsChange = 0;
      let actualCoinsChange = 0;
      let configuredPointsChange = 0;
      let actualPointsChange = 0;

      if (decision === 'CORRECT') {
        configuredCoinsChange = room.settings.correctCoinReward;
        configuredPointsChange = room.settings.correctPointReward;
        nextCoins = prevCoins + configuredCoinsChange;
        nextPoints = prevPoints + configuredPointsChange;
        actualCoinsChange = nextCoins - prevCoins;
        actualPointsChange = nextPoints - prevPoints;
      } else if (decision === 'WRONG') {
        configuredCoinsChange = -room.settings.wrongCoinPenalty;
        configuredPointsChange = -room.settings.wrongPointPenalty;
        nextCoins = Math.max(0, prevCoins + configuredCoinsChange);
        nextPoints = room.settings.allowNegativePoints
          ? prevPoints + configuredPointsChange
          : Math.max(0, prevPoints + configuredPointsChange);
        actualCoinsChange = nextCoins - prevCoins;
        actualPointsChange = nextPoints - prevPoints;
      }

      // Record Coin transaction if non-zero configured or actual
      if (decision === 'CORRECT' || decision === 'WRONG') {
        if (configuredCoinsChange !== 0) {
          const coinTxId = newId('tx');
          tx.set(doc(db, 'rooms', roomId, 'transactions', coinTxId), {
            id: coinTxId,
            roomId,
            teamId: team.id,
            teamName: team.teamName,
            currencyType: 'COINS',
            transactionType: decision === 'CORRECT' ? 'CORRECT_REWARD' : 'WRONG_PENALTY',
            previousBalance: prevCoins,
            configuredChange: configuredCoinsChange,
            actualChange: actualCoinsChange,
            newBalance: nextCoins,
            reason: `${decision} answer on "${itemName}"`,
            itemId: session.itemId,
            itemName,
            auctionId: auction.id,
            hostId: host.id,
            timestamp: serverTimestamp(),
          });
        }

        if (configuredPointsChange !== 0) {
          const ptsTxId = newId('tx');
          tx.set(doc(db, 'rooms', roomId, 'transactions', ptsTxId), {
            id: ptsTxId,
            roomId,
            teamId: team.id,
            teamName: team.teamName,
            currencyType: 'POINTS',
            transactionType: decision === 'CORRECT' ? 'CORRECT_REWARD' : 'WRONG_PENALTY',
            previousBalance: prevPoints,
            configuredChange: configuredPointsChange,
            actualChange: actualPointsChange,
            newBalance: nextPoints,
            reason: `${decision} answer on "${itemName}"`,
            itemId: session.itemId,
            itemName,
            auctionId: auction.id,
            hostId: host.id,
            timestamp: serverTimestamp(),
          });
        }
      }

      tx.update(teamRef, {
        coinBalance: nextCoins,
        points: nextPoints,
        correctCount: team.correctCount + (decision === 'CORRECT' ? 1 : 0),
        wrongCount: team.wrongCount + (decision === 'WRONG' ? 1 : 0),
        answerSessionsCount: team.answerSessionsCount + (decision === 'SKIPPED' ? 0 : 1),
        totalResponseTimeMs:
          team.totalResponseTimeMs + (decision === 'SKIPPED' ? 0 : responseTimeMs),
        lastSeenAt: serverTimestamp(),
      });

      // Optional participation rewards for active non-winning teams when item is answered
      if (
        decision !== 'SKIPPED' &&
        (room.settings.participationCoinReward > 0 || room.settings.participationPointReward > 0)
      ) {
        const otherTeams = teamsSnap.docs
          .map((d) => mapTeamDoc(d.data()))
          .filter((t) => t.participationStatus === 'ACTIVE' && t.id !== team.id);

        for (const other of otherTeams) {
          const partCoin = room.settings.participationCoinReward;
          const partPts = room.settings.participationPointReward;
          const nextOtherCoins = other.coinBalance + partCoin;
          const nextOtherPts = other.points + partPts;

          tx.update(doc(db, 'rooms', roomId, 'teams', other.id), {
            coinBalance: nextOtherCoins,
            points: nextOtherPts,
          });

          if (partCoin > 0) {
            const pCoinTx = newId('tx');
            tx.set(doc(db, 'rooms', roomId, 'transactions', pCoinTx), {
              id: pCoinTx,
              roomId,
              teamId: other.id,
              teamName: other.teamName,
              currencyType: 'COINS',
              transactionType: 'PARTICIPATION_REWARD',
              previousBalance: other.coinBalance,
              configuredChange: partCoin,
              actualChange: partCoin,
              newBalance: nextOtherCoins,
              reason: `Participation reward for "${itemName}"`,
              itemId: session.itemId,
              itemName,
              auctionId: auction.id,
              hostId: host.id,
              timestamp: serverTimestamp(),
            });
          }

          if (partPts > 0) {
            const pPtsTx = newId('tx');
            tx.set(doc(db, 'rooms', roomId, 'transactions', pPtsTx), {
              id: pPtsTx,
              roomId,
              teamId: other.id,
              teamName: other.teamName,
              currencyType: 'POINTS',
              transactionType: 'PARTICIPATION_REWARD',
              previousBalance: other.points,
              configuredChange: partPts,
              actualChange: partPts,
              newBalance: nextOtherPts,
              reason: `Participation reward for "${itemName}"`,
              itemId: session.itemId,
              itemName,
              auctionId: auction.id,
              hostId: host.id,
              timestamp: serverTimestamp(),
            });
          }
        }
      }

      tx.update(sessionRef, {
        answerDecisionTimestamp: now,
        responseTimeMs: decision === 'SKIPPED' ? null : responseTimeMs,
        hostDecision: decision,
      });

      tx.update(aucRef, {
        auctionStatus: decision === 'SKIPPED' ? 'SKIPPED' : 'COMPLETED',
        updatedAt: serverTimestamp(),
      });

      if (itemSnap.exists()) {
        tx.update(itemRef, {
          status: decision === 'SKIPPED' ? 'SKIPPED' : 'COMPLETED',
        });
      }

      const remainingUnused = itemsSnap.docs.filter(
        (d) => d.id !== session.itemId && d.data().status === 'PENDING',
      ).length;

      tx.set(doc(db, 'rooms', roomId, 'history', historyId), {
        id: historyId,
        roomId,
        roomName: room.roomName,
        itemId: session.itemId,
        itemName,
        questionTitle,
        auctionId: auction.id,
        winningTeamId: team.id,
        winningTeamName: team.teamName,
        finalBid: auction.highestBid,
        winningBidDeducted: auction.deductedAmount,
        auctionStartTimestamp: auction.startTimestamp,
        auctionEndTimestamp: auction.closedTimestamp,
        answerStartTimestamp: session.answerStartTimestamp,
        hostDecision: decision,
        responseTimeMs: decision === 'SKIPPED' ? null : responseTimeMs,
        coinsChange: actualCoinsChange,
        pointsChange: actualPointsChange,
        finalCoinBalance: nextCoins,
        finalPoints: nextPoints,
        timestamp: serverTimestamp(),
      });

      const announcement =
        decision === 'CORRECT'
          ? `${team.teamName} answered CORRECT! (+${actualCoinsChange} coins, +${actualPointsChange} pts)`
          : decision === 'WRONG'
            ? `${team.teamName} answered WRONG! (${actualCoinsChange} coins, ${actualPointsChange} pts)`
            : `Question skipped for ${team.teamName} (0 coins, 0 pts).`;

      tx.update(roomRef, {
        machineState: 'ANSWER_EVALUATED',
        isPaused: false,
        pausedFromState: null,
        pausedRemainingMs: null,
        unusedItemCount: remainingUnused,
        lastAnnouncement: announcement,
        updatedAt: serverTimestamp(),
      });

      tx.update(doc(db, 'room_codes', room.roomCode), {
        machineState: 'ANSWER_EVALUATED',
        updatedAt: serverTimestamp(),
      });
    });

    return { alreadyEvaluated };
  } catch (err) {
    if (err instanceof RoomActionError) throw err;
    handleFirestoreError(err, OperationType.WRITE, `rooms/${roomId}/answer_sessions`);
  }
}

export async function advanceToNextItem(roomId: string): Promise<void> {
  requireHostAuth();
  try {
    await runTransaction(db, async (tx) => {
      const roomRef = doc(db, 'rooms', roomId);
      const roomSnap = await tx.get(roomRef);
      if (!roomSnap.exists()) throw new RoomActionError('NOT_FOUND', 'Room not found.');
      const room = mapRoomDoc(roomSnap.data());

      const itemsSnap = await getDocs(
        query(collection(db, 'rooms', roomId, 'items'), where('roomId', '==', roomId)),
      );
      const sorted = itemsSnap.docs
        .map((d) => mapPublicItemDoc(d.data()))
        .sort((a, b) => a.sortOrder - b.sortOrder);

      const nextIdx = sorted.findIndex((i) => i.status === 'PENDING');
      if (nextIdx === -1) {
        tx.update(roomRef, {
          machineState: 'ROOM_COMPLETED',
          isPaused: false,
          pausedFromState: null,
          pausedRemainingMs: null,
          currentAuctionId: null,
          currentAnswerSessionId: null,
          unusedItemCount: 0,
          lastAnnouncement: 'All auction items completed! Final standings are live.',
          updatedAt: serverTimestamp(),
        });
        tx.update(doc(db, 'room_codes', room.roomCode), {
          machineState: 'ROOM_COMPLETED',
          updatedAt: serverTimestamp(),
        });
      } else {
        const nextItem = sorted[nextIdx];
        tx.update(roomRef, {
          machineState: 'NEXT_ITEM_PENDING',
          currentItemIndex: nextIdx,
          currentAuctionId: null,
          currentAnswerSessionId: null,
          unusedItemCount: sorted.filter((i) => i.status === 'PENDING').length,
          lastAnnouncement: `Next item ready: "${nextItem.itemName}". Host may start bidding.`,
          updatedAt: serverTimestamp(),
        });
        tx.update(doc(db, 'room_codes', room.roomCode), {
          machineState: 'NEXT_ITEM_PENDING',
          updatedAt: serverTimestamp(),
        });
      }
    });
  } catch (err) {
    if (err instanceof RoomActionError) throw err;
    handleFirestoreError(err, OperationType.UPDATE, `rooms/${roomId}`);
  }
}

export async function adjustTeamBalancesTransaction(input: {
  roomId: string;
  teamId: string;
  coinDelta: number;
  pointsDelta: number;
  reason: string;
}): Promise<void> {
  const host = requireHostAuth();
  const coinDelta = Math.trunc(Number(input.coinDelta || 0));
  const pointsDelta = Math.trunc(Number(input.pointsDelta || 0));
  const cleanReason = input.reason.trim().slice(0, 300);

  if (coinDelta === 0 && pointsDelta === 0) {
    throw new RoomActionError('VALIDATION', 'Enter a non-zero Coin or Point adjustment.');
  }
  if (!cleanReason) {
    throw new RoomActionError('VALIDATION', 'An audit reason is required for manual adjustments.');
  }

  try {
    await runTransaction(db, async (tx) => {
      const roomRef = doc(db, 'rooms', input.roomId);
      const teamRef = doc(db, 'rooms', input.roomId, 'teams', input.teamId);
      const [roomSnap, teamSnap] = await Promise.all([tx.get(roomRef), tx.get(teamRef)]);
      if (!roomSnap.exists() || !teamSnap.exists()) {
        throw new RoomActionError('NOT_FOUND', 'Room or team not found.');
      }
      const room = mapRoomDoc(roomSnap.data());
      const team = mapTeamDoc(teamSnap.data());

      const prevCoins = team.coinBalance;
      const prevPoints = team.points;
      const nextCoins = Math.max(0, prevCoins + coinDelta);
      const nextPoints = room.settings.allowNegativePoints
        ? prevPoints + pointsDelta
        : Math.max(0, prevPoints + pointsDelta);

      const actualCoinChange = nextCoins - prevCoins;
      const actualPointsChange = nextPoints - prevPoints;

      tx.update(teamRef, {
        coinBalance: nextCoins,
        points: nextPoints,
        lastSeenAt: serverTimestamp(),
      });

      if (coinDelta !== 0) {
        const cTxId = newId('tx');
        tx.set(doc(db, 'rooms', input.roomId, 'transactions', cTxId), {
          id: cTxId,
          roomId: input.roomId,
          teamId: team.id,
          teamName: team.teamName,
          currencyType: 'COINS' as CurrencyType,
          transactionType: 'MANUAL_ADJUSTMENT',
          previousBalance: prevCoins,
          configuredChange: coinDelta,
          actualChange: actualCoinChange,
          newBalance: nextCoins,
          reason: cleanReason,
          itemId: null,
          itemName: null,
          auctionId: null,
          hostId: host.id,
          timestamp: serverTimestamp(),
        });
      }

      if (pointsDelta !== 0) {
        const pTxId = newId('tx');
        tx.set(doc(db, 'rooms', input.roomId, 'transactions', pTxId), {
          id: pTxId,
          roomId: input.roomId,
          teamId: team.id,
          teamName: team.teamName,
          currencyType: 'POINTS' as CurrencyType,
          transactionType: 'MANUAL_ADJUSTMENT',
          previousBalance: prevPoints,
          configuredChange: pointsDelta,
          actualChange: actualPointsChange,
          newBalance: nextPoints,
          reason: cleanReason,
          itemId: null,
          itemName: null,
          auctionId: null,
          hostId: host.id,
          timestamp: serverTimestamp(),
        });
      }

      const parts: string[] = [];
      if (coinDelta !== 0) {
        parts.push(`${actualCoinChange >= 0 ? '+' : ''}${actualCoinChange} coins`);
      }
      if (pointsDelta !== 0) {
        parts.push(`${actualPointsChange >= 0 ? '+' : ''}${actualPointsChange} pts`);
      }

      tx.update(roomRef, {
        lastAnnouncement: `Host adjusted ${team.teamName}: ${parts.join(', ')} (${cleanReason}).`,
        updatedAt: serverTimestamp(),
      });
    });
  } catch (err) {
    if (err instanceof RoomActionError) throw err;
    handleFirestoreError(err, OperationType.WRITE, `rooms/${input.roomId}/teams/${input.teamId}`);
  }
}

// ==========================================
// CLIENT-SIDE CSV EXPORTS (NO COOKIE NEEDED)
// ==========================================
function escapeCsvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function triggerCsvDownload(filename: string, lines: string[]): void {
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportResultsCsv(snapshot: HostRoomSnapshot): void {
  const lines = [
    'Rank,TeamName,Points,CoinBalance,CorrectAnswers,WrongAnswers,AnswerSessions,TotalResponseTimeMs,TotalResponseTimeSec',
  ];
  for (const row of snapshot.leaderboard) {
    lines.push(
      [
        escapeCsvCell(row.rank),
        escapeCsvCell(row.teamName),
        escapeCsvCell(row.points),
        escapeCsvCell(row.coinBalance),
        escapeCsvCell(row.correctCount),
        escapeCsvCell(row.wrongCount),
        escapeCsvCell(row.answerSessionsCount),
        escapeCsvCell(row.totalResponseTimeMs),
        escapeCsvCell((row.totalResponseTimeMs / 1000).toFixed(3)),
      ].join(','),
    );
  }
  triggerCsvDownload(`tech_auction_results_${snapshot.room.roomCode}.csv`, lines);
}

export function exportHistoryCsv(snapshot: HostRoomSnapshot): void {
  const lines = [
    'Timestamp,RoomCode,ItemName,QuestionTitle,WinningTeam,FinalBid,BidDeducted,HostDecision,ResponseTimeMs,CoinsChange,PointsChange,FinalCoins,FinalPoints',
  ];
  for (const h of snapshot.history) {
    lines.push(
      [
        escapeCsvCell(new Date(h.timestamp).toISOString()),
        escapeCsvCell(snapshot.room.roomCode),
        escapeCsvCell(h.itemName),
        escapeCsvCell(h.questionTitle),
        escapeCsvCell(h.winningTeamName || 'No Bids'),
        escapeCsvCell(h.finalBid),
        escapeCsvCell(h.winningBidDeducted),
        escapeCsvCell(h.hostDecision),
        escapeCsvCell(h.responseTimeMs ?? ''),
        escapeCsvCell(h.coinsChange),
        escapeCsvCell(h.pointsChange),
        escapeCsvCell(h.finalCoinBalance ?? ''),
        escapeCsvCell(h.finalPoints ?? ''),
      ].join(','),
    );
  }
  triggerCsvDownload(`tech_auction_history_${snapshot.room.roomCode}.csv`, lines);
}

export function exportItemsCsv(snapshot: HostRoomSnapshot): void {
  const lines = [
    'itemName,category,imageOrEmoji,startingBid,auctionDurationOverride,answerDurationOverride',
  ];
  for (const item of snapshot.items) {
    lines.push(
      [
        escapeCsvCell(item.itemName),
        escapeCsvCell(item.category),
        escapeCsvCell(item.imageOrEmoji),
        escapeCsvCell(item.startingBid),
        escapeCsvCell(item.auctionDurationOverride ?? ''),
        escapeCsvCell(item.answerDurationOverride ?? ''),
      ].join(','),
    );
  }
  triggerCsvDownload(`auction_items_${snapshot.room.roomCode}.csv`, lines);
}
