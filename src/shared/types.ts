export type MachineState =
  | 'ROOM_WAITING'
  | 'ROOM_READY'
  | 'AUCTION_OPEN'
  | 'AUCTION_CLOSED'
  | 'WINNER_SELECTED'
  | 'ANSWER_PENDING'
  | 'ANSWER_RUNNING'
  | 'ANSWER_EVALUATED'
  | 'NEXT_ITEM_PENDING'
  | 'ROOM_COMPLETED';

export type HumanRoomStatus =
  | 'Waiting for Teams'
  | 'Ready to Start'
  | 'Auction Live'
  | 'Answer in Progress'
  | 'Paused'
  | 'Completed';

export type UserRole = 'HOST' | 'TEAM' | 'AUDIENCE';

export type AnswerDecision = 'PENDING' | 'CORRECT' | 'WRONG' | 'SKIPPED';

export type DifficultyLevel = 'Easy' | 'Medium' | 'Hard' | 'Expert';

export interface HostUser {
  id: string;
  username: string;
  displayName: string;
  role: 'HOST';
  createdAt: number;
}

export interface RoomSettings {
  maxTeams: number;
  startingCoins: number;
  auctionDurationSec: number;
  answerDurationSec: number;
  correctPoints: number;
  wrongDeduction: number;
  minStartingBid: number;
  minBidIncrement: number;
  deductWinningBid: boolean;
}

export interface RoomSummary {
  id: string;
  roomCode: string;
  roomName: string;
  hasPin: boolean;
  hostId: string;
  hostName: string;
  machineState: MachineState;
  humanStatus: HumanRoomStatus;
  isPaused: boolean;
  pausedFromState: MachineState | null;
  pausedRemainingMs: number | null;
  isActive: boolean;
  settings: RoomSettings;
  currentItemIndex: number;
  currentAuctionId: string | null;
  teamCount: number;
  itemCount: number;
  unusedItemCount: number;
  createdAt: number;
}

/**
 * NOTE: By strict event specification, AuctionItem NEVER contains a correctAnswer field.
 * The host listens verbally and decides Correct or Wrong manually.
 */
export interface AuctionItem {
  id: string;
  roomId: string;
  sortOrder: number;
  itemName: string;
  questionTitle: string;
  questionDescription: string;
  category: string;
  imageOrEmoji: string;
  difficulty: DifficultyLevel | '';
  startingBid: number;
  auctionDurationOverride: number | null;
  answerDurationOverride: number | null;
  status: 'PENDING' | 'COMPLETED' | 'SKIPPED';
  createdAt: number;
}

export interface PublicAuctionItem {
  id: string;
  sortOrder: number;
  itemName: string;
  category: string;
  imageOrEmoji: string;
  difficulty: DifficultyLevel | '';
  startingBid: number;
  status: 'PENDING' | 'COMPLETED' | 'SKIPPED';
}

export interface QuestionBankItem {
  id: string;
  hostId: string;
  itemName: string;
  questionTitle: string;
  questionDescription: string;
  category: string;
  imageOrEmoji: string;
  difficulty: DifficultyLevel | '';
  startingBid: number;
  auctionDurationOverride: number | null;
  answerDurationOverride: number | null;
  createdAt: number;
}

export interface Team {
  id: string;
  roomId: string;
  teamName: string;
  balance: number;
  correctCount: number;
  wrongCount: number;
  answerSessionsCount: number;
  totalResponseTimeMs: number;
  connectionStatus: 'ONLINE' | 'OFFLINE';
  participationStatus: 'ACTIVE' | 'REMOVED';
  joinedAt: number;
  lastSeenAt: number;
}

export interface LeaderboardEntry {
  rank: number;
  teamId: string;
  teamName: string;
  balance: number;
  correctCount: number;
  wrongCount: number;
  answerSessionsCount: number;
  totalResponseTimeMs: number;
  connectionStatus: 'ONLINE' | 'OFFLINE';
}

export interface AuctionState {
  id: string;
  roomId: string;
  itemId: string;
  auctionStatus: 'OPEN' | 'CLOSED' | 'WINNER_SELECTED' | 'NO_BIDS' | 'COMPLETED' | 'SKIPPED';
  startTimestamp: number;
  deadlineTimestamp: number;
  closedTimestamp: number | null;
  highestBid: number;
  highestBidderTeamId: string | null;
  highestBidderTeamName: string | null;
  sequenceCounter: number;
}

export interface BidRecord {
  id: string;
  auctionId: string;
  roomId: string;
  teamId: string;
  teamName: string;
  bidAmount: number;
  serverTimestamp: number;
  sequenceNumber: number;
  status: 'ACCEPTED' | 'REJECTED';
  rejectionReason: string | null;
}

export interface AnswerSession {
  id: string;
  auctionId: string;
  roomId: string;
  itemId: string;
  winningTeamId: string;
  winningTeamName: string;
  answerStartTimestamp: number | null;
  answerDeadlineTimestamp: number | null;
  answerDecisionTimestamp: number | null;
  responseTimeMs: number | null;
  hostDecision: AnswerDecision;
}

export interface ScoreTransaction {
  id: string;
  roomId: string;
  teamId: string;
  teamName: string;
  itemId: string | null;
  auctionId: string | null;
  previousBalance: number;
  configuredChange: number;
  actualChange: number;
  newBalance: number;
  reason: string;
  decisionType: 'CORRECT' | 'WRONG' | 'WINNING_BID_DEDUCTION' | 'MANUAL_ADJUSTMENT';
  hostId: string;
  timestamp: number;
}

export interface AuctionHistoryEntry {
  id: string;
  roomId: string;
  roomName: string;
  itemId: string;
  itemName: string;
  questionTitle: string;
  auctionId: string;
  winningTeamId: string | null;
  winningTeamName: string | null;
  finalBid: number;
  auctionStartTimestamp: number;
  auctionEndTimestamp: number | null;
  answerStartTimestamp: number | null;
  hostDecision: AnswerDecision | 'NO_BIDS';
  responseTimeMs: number | null;
  pointsChange: number;
  finalBalance: number | null;
  timestamp: number;
}

export interface PublicRoomSnapshot {
  serverTime: number;
  room: RoomSummary;
  currentItem: PublicAuctionItem | null;
  currentAuction: AuctionState | null;
  currentAnswerSession: AnswerSession | null;
  recentBids: BidRecord[];
  leaderboard: LeaderboardEntry[];
  lastAnnouncement: string | null;
}

export interface HostRoomSnapshot extends PublicRoomSnapshot {
  items: AuctionItem[];
  currentHostItem: AuctionItem | null;
  teams: Team[];
  allAuctionBids: BidRecord[];
  scoreTransactions: ScoreTransaction[];
  history: AuctionHistoryEntry[];
}

export interface TeamRoomSnapshot extends PublicRoomSnapshot {
  selfTeam: Team;
}

export function getHumanRoomStatus(
  machineState: MachineState,
  isPaused: boolean,
): HumanRoomStatus {
  if (isPaused) return 'Paused';
  switch (machineState) {
    case 'ROOM_WAITING':
      return 'Waiting for Teams';
    case 'ROOM_READY':
    case 'ANSWER_EVALUATED':
    case 'NEXT_ITEM_PENDING':
      return 'Ready to Start';
    case 'AUCTION_OPEN':
      return 'Auction Live';
    case 'AUCTION_CLOSED':
    case 'WINNER_SELECTED':
    case 'ANSWER_PENDING':
    case 'ANSWER_RUNNING':
      return 'Answer in Progress';
    case 'ROOM_COMPLETED':
      return 'Completed';
    default:
      return 'Waiting for Teams';
  }
}

/**
 * Authoritative deterministic leaderboard ranking algorithm:
 * 1. Higher balance (points/coins) ranks first.
 * 2. Lower total recorded responseTimeMs ranks first.
 * 3. Identical balance AND responseTimeMs share the same rank.
 */
export function computeRankedLeaderboard(teams: Team[]): LeaderboardEntry[] {
  const active = teams.filter((t) => t.participationStatus === 'ACTIVE');
  const sorted = [...active].sort((a, b) => {
    if (b.balance !== a.balance) return b.balance - a.balance;
    if (a.totalResponseTimeMs !== b.totalResponseTimeMs) {
      return a.totalResponseTimeMs - b.totalResponseTimeMs;
    }
    return a.teamName.localeCompare(b.teamName);
  });

  const ranked: LeaderboardEntry[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i];
    let rank = i + 1;
    if (i > 0) {
      const prev = sorted[i - 1];
      if (
        prev.balance === t.balance &&
        prev.totalResponseTimeMs === t.totalResponseTimeMs
      ) {
        rank = ranked[i - 1].rank;
      }
    }
    ranked.push({
      rank,
      teamId: t.id,
      teamName: t.teamName,
      balance: t.balance,
      correctCount: t.correctCount,
      wrongCount: t.wrongCount,
      answerSessionsCount: t.answerSessionsCount,
      totalResponseTimeMs: t.totalResponseTimeMs,
      connectionStatus: t.connectionStatus,
    });
  }
  return ranked;
}

export function formatResponseTime(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  if (ms === 0) return '0.000s';
  const seconds = ms / 1000;
  return `${seconds.toFixed(3)}s`;
}
