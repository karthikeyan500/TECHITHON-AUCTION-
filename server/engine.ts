import crypto from 'node:crypto';
import type { Server as SocketIOServer } from 'socket.io';
import { db } from './db.ts';
import {
  computeRankedLeaderboard,
  getHumanRoomStatus,
  type AnswerDecision,
  type AnswerSession,
  type AuctionHistoryEntry,
  type AuctionItem,
  type AuctionState,
  type BidRecord,
  type DifficultyLevel,
  type HostRoomSnapshot,
  type MachineState,
  type PublicAuctionItem,
  type PublicRoomSnapshot,
  type QuestionBankItem,
  type RoomSettings,
  type RoomSummary,
  type ScoreTransaction,
  type Team,
  type TeamRoomSnapshot,
} from '../src/shared/types.ts';

let ioInstance: SocketIOServer | null = null;
const activeTimers = new Map<string, NodeJS.Timeout>();

export function setSocketServer(io: SocketIOServer): void {
  ioInstance = io;
}

export function clearRoomTimer(roomId: string): void {
  const existing = activeTimers.get(roomId);
  if (existing) {
    clearTimeout(existing);
    activeTimers.delete(roomId);
  }
}

export function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 25; attempt++) {
    let code = '';
    const bytes = crypto.randomBytes(6);
    for (let i = 0; i < 6; i++) {
      code += chars[bytes[i] % chars.length];
    }
    const existing = db
      .prepare('SELECT id FROM rooms WHERE room_code = ?')
      .get(code);
    if (!existing) return code;
  }
  return `TA${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

interface RoomRow {
  id: string;
  room_code: string;
  room_name: string;
  room_pin_hash: string | null;
  has_pin: number;
  host_id: string;
  host_name: string;
  machine_state: MachineState;
  is_paused: number;
  paused_from_state: MachineState | null;
  paused_remaining_ms: number | null;
  is_active: number;
  max_teams: number;
  starting_coins: number;
  auction_duration_sec: number;
  answer_duration_sec: number;
  correct_points: number;
  wrong_deduction: number;
  min_starting_bid: number;
  min_bid_increment: number;
  deduct_winning_bid: number;
  current_item_index: number;
  current_auction_id: string | null;
  last_announcement: string | null;
  created_at: number;
}

function mapTeamRow(r: Record<string, unknown>): Team {
  return {
    id: String(r.id),
    roomId: String(r.room_id),
    teamName: String(r.team_name),
    balance: Number(r.balance),
    correctCount: Number(r.correct_count),
    wrongCount: Number(r.wrong_count),
    answerSessionsCount: Number(r.answer_sessions_count),
    totalResponseTimeMs: Number(r.total_response_time_ms),
    connectionStatus: (r.connection_status as 'ONLINE' | 'OFFLINE') || 'OFFLINE',
    participationStatus: (r.participation_status as 'ACTIVE' | 'REMOVED') || 'ACTIVE',
    joinedAt: Number(r.joined_at),
    lastSeenAt: Number(r.last_seen_at),
  };
}

function mapItemRow(r: Record<string, unknown>): AuctionItem {
  return {
    id: String(r.id),
    roomId: String(r.room_id),
    sortOrder: Number(r.sort_order),
    itemName: String(r.item_name),
    questionTitle: String(r.question_title),
    questionDescription: String(r.question_description),
    category: String(r.category),
    imageOrEmoji: String(r.image_or_emoji || '💻'),
    difficulty: (r.difficulty as DifficultyLevel | '') || '',
    startingBid: Number(r.starting_bid),
    auctionDurationOverride:
      r.auction_duration_override !== null && r.auction_duration_override !== undefined
        ? Number(r.auction_duration_override)
        : null,
    answerDurationOverride:
      r.answer_duration_override !== null && r.answer_duration_override !== undefined
        ? Number(r.answer_duration_override)
        : null,
    status: (r.status as 'PENDING' | 'COMPLETED' | 'SKIPPED') || 'PENDING',
    createdAt: Number(r.created_at),
  };
}

function toPublicItem(item: AuctionItem | null): PublicAuctionItem | null {
  if (!item) return null;
  return {
    id: item.id,
    sortOrder: item.sortOrder,
    itemName: item.itemName,
    category: item.category,
    imageOrEmoji: item.imageOrEmoji,
    difficulty: item.difficulty,
    startingBid: item.startingBid,
    status: item.status,
  };
}

function mapAuctionRow(r: Record<string, unknown> | undefined): AuctionState | null {
  if (!r) return null;
  return {
    id: String(r.id),
    roomId: String(r.room_id),
    itemId: String(r.item_id),
    auctionStatus: r.auction_status as AuctionState['auctionStatus'],
    startTimestamp: Number(r.start_timestamp),
    deadlineTimestamp: Number(r.deadline_timestamp),
    closedTimestamp:
      r.closed_timestamp !== null && r.closed_timestamp !== undefined
        ? Number(r.closed_timestamp)
        : null,
    highestBid: Number(r.highest_bid),
    highestBidderTeamId: r.highest_bidder_team_id ? String(r.highest_bidder_team_id) : null,
    highestBidderTeamName: r.highest_bidder_team_name ? String(r.highest_bidder_team_name) : null,
    sequenceCounter: Number(r.sequence_counter),
  };
}

function mapBidRow(r: Record<string, unknown>): BidRecord {
  return {
    id: String(r.id),
    auctionId: String(r.auction_id),
    roomId: String(r.room_id),
    teamId: String(r.team_id),
    teamName: String(r.team_name),
    bidAmount: Number(r.bid_amount),
    serverTimestamp: Number(r.server_timestamp),
    sequenceNumber: Number(r.sequence_number),
    status: r.status as 'ACCEPTED' | 'REJECTED',
    rejectionReason: r.rejection_reason ? String(r.rejection_reason) : null,
  };
}

function mapAnswerSessionRow(r: Record<string, unknown> | undefined): AnswerSession | null {
  if (!r) return null;
  return {
    id: String(r.id),
    auctionId: String(r.auction_id),
    roomId: String(r.room_id),
    itemId: String(r.item_id),
    winningTeamId: String(r.winning_team_id),
    winningTeamName: String(r.winning_team_name),
    answerStartTimestamp:
      r.answer_start_timestamp !== null && r.answer_start_timestamp !== undefined
        ? Number(r.answer_start_timestamp)
        : null,
    answerDeadlineTimestamp:
      r.answer_deadline_timestamp !== null && r.answer_deadline_timestamp !== undefined
        ? Number(r.answer_deadline_timestamp)
        : null,
    answerDecisionTimestamp:
      r.answer_decision_timestamp !== null && r.answer_decision_timestamp !== undefined
        ? Number(r.answer_decision_timestamp)
        : null,
    responseTimeMs:
      r.response_time_ms !== null && r.response_time_ms !== undefined
        ? Number(r.response_time_ms)
        : null,
    hostDecision: r.host_decision as AnswerDecision,
  };
}

export function buildRoomSummary(row: RoomRow): RoomSummary {
  const counts = db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM teams WHERE room_id = ? AND participation_status = 'ACTIVE') AS team_count,
        (SELECT COUNT(*) FROM auction_items WHERE room_id = ?) AS item_count,
        (SELECT COUNT(*) FROM auction_items WHERE room_id = ? AND status = 'PENDING') AS unused_count`,
    )
    .get(row.id, row.id, row.id) as {
    team_count: number;
    item_count: number;
    unused_count: number;
  };

  const settings: RoomSettings = {
    maxTeams: row.max_teams,
    startingCoins: row.starting_coins,
    auctionDurationSec: row.auction_duration_sec,
    answerDurationSec: row.answer_duration_sec,
    correctPoints: row.correct_points,
    wrongDeduction: row.wrong_deduction,
    minStartingBid: row.min_starting_bid,
    minBidIncrement: row.min_bid_increment,
    deductWinningBid: row.deduct_winning_bid === 1,
  };

  return {
    id: row.id,
    roomCode: row.room_code,
    roomName: row.room_name,
    hasPin: row.has_pin === 1,
    hostId: row.host_id,
    hostName: row.host_name,
    machineState: row.machine_state,
    humanStatus: getHumanRoomStatus(row.machine_state, row.is_paused === 1),
    isPaused: row.is_paused === 1,
    pausedFromState: row.paused_from_state,
    pausedRemainingMs: row.paused_remaining_ms,
    isActive: row.is_active === 1,
    settings,
    currentItemIndex: row.current_item_index,
    currentAuctionId: row.current_auction_id,
    teamCount: Number(counts?.team_count || 0),
    itemCount: Number(counts?.item_count || 0),
    unusedItemCount: Number(counts?.unused_count || 0),
    createdAt: row.created_at,
  };
}

export function getPublicSnapshot(roomId: string): PublicRoomSnapshot | null {
  const row = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId) as RoomRow | undefined;
  if (!row) return null;

  const summary = buildRoomSummary(row);
  const itemRows = db
    .prepare('SELECT * FROM auction_items WHERE room_id = ? ORDER BY sort_order ASC, created_at ASC')
    .all(roomId) as Record<string, unknown>[];
  const items = itemRows.map(mapItemRow);

  const currentHostItem =
    items[row.current_item_index] || items.find((i) => i.status === 'PENDING') || null;

  const auctionRow = row.current_auction_id
    ? (db.prepare('SELECT * FROM auctions WHERE id = ?').get(row.current_auction_id) as
        | Record<string, unknown>
        | undefined)
    : undefined;
  const currentAuction = mapAuctionRow(auctionRow);

  const answerRow = row.current_auction_id
    ? (db
        .prepare('SELECT * FROM answer_sessions WHERE auction_id = ?')
        .get(row.current_auction_id) as Record<string, unknown> | undefined)
    : undefined;
  const currentAnswerSession = mapAnswerSessionRow(answerRow);

  const recentBidRows = row.current_auction_id
    ? (db
        .prepare(
          `SELECT * FROM bids WHERE auction_id = ? AND status = 'ACCEPTED'
           ORDER BY sequence_number DESC LIMIT 15`,
        )
        .all(row.current_auction_id) as Record<string, unknown>[])
    : [];

  const teamRows = db
    .prepare(`SELECT * FROM teams WHERE room_id = ? AND participation_status = 'ACTIVE'`)
    .all(roomId) as Record<string, unknown>[];
  const teams = teamRows.map(mapTeamRow);

  return {
    serverTime: Date.now(),
    room: summary,
    currentItem: toPublicItem(currentHostItem),
    currentAuction,
    currentAnswerSession,
    recentBids: recentBidRows.map(mapBidRow),
    leaderboard: computeRankedLeaderboard(teams),
    lastAnnouncement: row.last_announcement,
  };
}

export function getHostSnapshot(roomId: string): HostRoomSnapshot | null {
  const pub = getPublicSnapshot(roomId);
  if (!pub) return null;

  const itemRows = db
    .prepare('SELECT * FROM auction_items WHERE room_id = ? ORDER BY sort_order ASC, created_at ASC')
    .all(roomId) as Record<string, unknown>[];
  const items = itemRows.map(mapItemRow);
  const currentHostItem =
    items[pub.room.currentItemIndex] || items.find((i) => i.status === 'PENDING') || null;

  const teamRows = db
    .prepare(
      `SELECT * FROM teams WHERE room_id = ? AND participation_status = 'ACTIVE' ORDER BY joined_at ASC`,
    )
    .all(roomId) as Record<string, unknown>[];
  const teams = teamRows.map(mapTeamRow);

  const allBidRows = pub.room.currentAuctionId
    ? (db
        .prepare('SELECT * FROM bids WHERE auction_id = ? ORDER BY sequence_number DESC LIMIT 100')
        .all(pub.room.currentAuctionId) as Record<string, unknown>[])
    : [];

  const txRows = db
    .prepare('SELECT * FROM score_transactions WHERE room_id = ? ORDER BY timestamp DESC LIMIT 200')
    .all(roomId) as Record<string, unknown>[];

  const historyRows = db
    .prepare('SELECT * FROM auction_history WHERE room_id = ? ORDER BY timestamp DESC LIMIT 200')
    .all(roomId) as Record<string, unknown>[];

  return {
    ...pub,
    items,
    currentHostItem,
    teams,
    allAuctionBids: allBidRows.map(mapBidRow),
    scoreTransactions: txRows.map((t) => ({
      id: String(t.id),
      roomId: String(t.room_id),
      teamId: String(t.team_id),
      teamName: String(t.team_name),
      itemId: t.item_id ? String(t.item_id) : null,
      auctionId: t.auction_id ? String(t.auction_id) : null,
      previousBalance: Number(t.previous_balance),
      configuredChange: Number(t.configured_change),
      actualChange: Number(t.actual_change),
      newBalance: Number(t.new_balance),
      reason: String(t.reason),
      decisionType: t.decision_type as ScoreTransaction['decisionType'],
      hostId: String(t.host_id),
      timestamp: Number(t.timestamp),
    })),
    history: historyRows.map((h) => ({
      id: String(h.id),
      roomId: String(h.room_id),
      roomName: String(h.room_name),
      itemId: String(h.item_id),
      itemName: String(h.item_name),
      questionTitle: String(h.question_title),
      auctionId: String(h.auction_id),
      winningTeamId: h.winning_team_id ? String(h.winning_team_id) : null,
      winningTeamName: h.winning_team_name ? String(h.winning_team_name) : null,
      finalBid: Number(h.final_bid),
      auctionStartTimestamp: Number(h.auction_start_timestamp),
      auctionEndTimestamp:
        h.auction_end_timestamp !== null && h.auction_end_timestamp !== undefined
          ? Number(h.auction_end_timestamp)
          : null,
      answerStartTimestamp:
        h.answer_start_timestamp !== null && h.answer_start_timestamp !== undefined
          ? Number(h.answer_start_timestamp)
          : null,
      hostDecision: h.host_decision as AuctionHistoryEntry['hostDecision'],
      responseTimeMs:
        h.response_time_ms !== null && h.response_time_ms !== undefined
          ? Number(h.response_time_ms)
          : null,
      pointsChange: Number(h.points_change),
      finalBalance:
        h.final_balance !== null && h.final_balance !== undefined
          ? Number(h.final_balance)
          : null,
      timestamp: Number(h.timestamp),
    })),
  };
}

export function getTeamSnapshot(roomId: string, teamId: string): TeamRoomSnapshot | null {
  const pub = getPublicSnapshot(roomId);
  if (!pub) return null;
  const row = db
    .prepare(
      `SELECT * FROM teams WHERE id = ? AND room_id = ? AND participation_status = 'ACTIVE'`,
    )
    .get(teamId, roomId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    ...pub,
    selfTeam: mapTeamRow(row),
  };
}

export function broadcastRoomState(roomId: string): void {
  if (!ioInstance) return;
  const pub = getPublicSnapshot(roomId);
  if (!pub) return;

  ioInstance.to(`public:${roomId}`).emit('room:state', pub);

  const hostSnap = getHostSnapshot(roomId);
  if (hostSnap) {
    ioInstance.to(`host:${roomId}`).emit('host:state', hostSnap);
  }

  // Emit team-specific selfTeam updates cleanly to active team channels
  if (hostSnap) {
    for (const team of hostSnap.teams) {
      ioInstance.to(`team:${team.id}`).emit('team:state', {
        ...pub,
        selfTeam: team,
      } satisfies TeamRoomSnapshot);
    }
  }
}

export function scheduleAuctionDeadline(roomId: string, deadlineTimestamp: number): void {
  clearRoomTimer(roomId);
  const delay = Math.max(0, deadlineTimestamp - Date.now());
  const timer = setTimeout(() => {
    activeTimers.delete(roomId);
    closeAuctionOnTimeout(roomId);
  }, delay);
  activeTimers.set(roomId, timer);
}

export function scheduleAnswerDeadline(roomId: string, deadlineTimestamp: number): void {
  clearRoomTimer(roomId);
  const delay = Math.max(0, deadlineTimestamp - Date.now());
  const timer = setTimeout(() => {
    activeTimers.delete(roomId);
    onAnswerTimerExpired(roomId);
  }, delay);
  activeTimers.set(roomId, timer);
}

export const closeAuctionOnTimeout = (roomId: string): boolean => {
  const result = db.transaction(() => {
    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId) as RoomRow | undefined;
    if (!room || room.machine_state !== 'AUCTION_OPEN' || room.is_paused === 1) {
      return false;
    }
    if (!room.current_auction_id) return false;
    const auction = db
      .prepare('SELECT * FROM auctions WHERE id = ?')
      .get(room.current_auction_id) as Record<string, unknown> | undefined;
    if (!auction || auction.auction_status !== 'OPEN') return false;

    const now = Date.now();
    const hasWinner = Boolean(auction.highest_bidder_team_id);

    if (hasWinner) {
      db.prepare(
        `UPDATE auctions SET auction_status = 'WINNER_SELECTED', closed_timestamp = ? WHERE id = ?`,
      ).run(now, auction.id);

      const answerSessionId = crypto.randomUUID();
      db.prepare(
        `INSERT INTO answer_sessions (
          id, auction_id, room_id, item_id, winning_team_id, winning_team_name, host_decision
        ) VALUES (?, ?, ?, ?, ?, ?, 'PENDING')`,
      ).run(
        answerSessionId,
        auction.id,
        roomId,
        auction.item_id,
        auction.highest_bidder_team_id,
        auction.highest_bidder_team_name,
      );

      const announcement = `${auction.highest_bidder_team_name} won the auction with a bid of ${auction.highest_bid} coins.`;
      db.prepare(
        `UPDATE rooms SET machine_state = 'ANSWER_PENDING', last_announcement = ? WHERE id = ?`,
      ).run(announcement, roomId);
    } else {
      db.prepare(
        `UPDATE auctions SET auction_status = 'NO_BIDS', closed_timestamp = ? WHERE id = ?`,
      ).run(now, auction.id);

      const announcement = 'Auction time is over. No valid bids were placed for this item.';
      db.prepare(
        `UPDATE rooms SET machine_state = 'AUCTION_CLOSED', last_announcement = ? WHERE id = ?`,
      ).run(announcement, roomId);
    }

    return true;
  })();

  if (result) {
    clearRoomTimer(roomId);
    broadcastRoomState(roomId);
  }
  return result;
};

function onAnswerTimerExpired(roomId: string): void {
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId) as RoomRow | undefined;
  if (!room || room.machine_state !== 'ANSWER_RUNNING' || room.is_paused === 1) return;

  // Never automatically mark an answer correct on timeout. Notify the host.
  const announcement =
    'Answer time is over. Host must manually mark the answer Wrong, Skip, or record an outcome.';
  db.prepare(`UPDATE rooms SET last_announcement = ? WHERE id = ?`).run(announcement, roomId);
  broadcastRoomState(roomId);
  if (ioInstance) {
    ioInstance.to(`host:${roomId}`).emit('host:answer_timer_expired', {
      roomId,
      serverTime: Date.now(),
    });
  }
}

export function recoverActiveTimers(): void {
  const rows = db
    .prepare(
      `SELECT * FROM rooms WHERE is_active = 1 AND is_paused = 0 AND machine_state IN ('AUCTION_OPEN', 'ANSWER_RUNNING')`,
    )
    .all() as RoomRow[];

  for (const room of rows) {
    if (!room.current_auction_id) continue;
    if (room.machine_state === 'AUCTION_OPEN') {
      const auction = db
        .prepare('SELECT deadline_timestamp FROM auctions WHERE id = ?')
        .get(room.current_auction_id) as { deadline_timestamp: number } | undefined;
      if (auction) {
        if (Date.now() >= auction.deadline_timestamp) {
          closeAuctionOnTimeout(room.id);
        } else {
          scheduleAuctionDeadline(room.id, auction.deadline_timestamp);
        }
      }
    } else if (room.machine_state === 'ANSWER_RUNNING') {
      const session = db
        .prepare('SELECT answer_deadline_timestamp FROM answer_sessions WHERE auction_id = ?')
        .get(room.current_auction_id) as { answer_deadline_timestamp: number | null } | undefined;
      if (session?.answer_deadline_timestamp) {
        if (Date.now() >= session.answer_deadline_timestamp) {
          onAnswerTimerExpired(room.id);
        } else {
          scheduleAnswerDeadline(room.id, session.answer_deadline_timestamp);
        }
      }
    }
  }
}

export interface PlaceBidResult {
  ok: boolean;
  code:
    | 'ACCEPTED'
    | 'DUPLICATE_REQUEST'
    | 'ROOM_NOT_FOUND'
    | 'AUCTION_CLOSED'
    | 'PAUSED'
    | 'TEAM_NOT_FOUND'
    | 'SELF_OUTBID'
    | 'INVALID_AMOUNT'
    | 'TOO_LOW';
  message: string;
  bid?: BidRecord;
  highestBid?: number;
  highestBidderTeamId?: string | null;
}

export function processAtomicBid(
  roomId: string,
  teamId: string,
  rawAmount: unknown,
  clientRequestId?: string,
): PlaceBidResult {
  const result = db.transaction((): PlaceBidResult => {
    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId) as RoomRow | undefined;
    if (!room) {
      return { ok: false, code: 'ROOM_NOT_FOUND', message: 'Room not found.' };
    }
    if (room.is_active !== 1 || room.machine_state === 'ROOM_COMPLETED') {
      return { ok: false, code: 'AUCTION_CLOSED', message: 'This auction room is closed.' };
    }
    if (room.is_paused === 1) {
      return { ok: false, code: 'PAUSED', message: 'Auction is currently paused by the host.' };
    }
    if (room.machine_state !== 'AUCTION_OPEN' || !room.current_auction_id) {
      return { ok: false, code: 'AUCTION_CLOSED', message: 'Auction has ended or has not started yet.' };
    }

    const team = db
      .prepare(
        `SELECT * FROM teams WHERE id = ? AND room_id = ? AND participation_status = 'ACTIVE'`,
      )
      .get(teamId, roomId) as Record<string, unknown> | undefined;
    if (!team) {
      return { ok: false, code: 'TEAM_NOT_FOUND', message: 'Your team is not active in this room.' };
    }

    const auction = db
      .prepare('SELECT * FROM auctions WHERE id = ?')
      .get(room.current_auction_id) as Record<string, unknown> | undefined;
    if (!auction || auction.auction_status !== 'OPEN') {
      return { ok: false, code: 'AUCTION_CLOSED', message: 'Auction has ended.' };
    }

    const now = Date.now();
    if (now >= Number(auction.deadline_timestamp)) {
      return { ok: false, code: 'AUCTION_CLOSED', message: 'Auction time is over.' };
    }

    const cleanRequestId =
      typeof clientRequestId === 'string' && clientRequestId.trim().length > 0
        ? clientRequestId.trim().slice(0, 80)
        : null;

    if (cleanRequestId) {
      const existing = db
        .prepare('SELECT * FROM bids WHERE auction_id = ? AND client_request_id = ?')
        .get(auction.id, cleanRequestId) as Record<string, unknown> | undefined;
      if (existing) {
        return {
          ok: existing.status === 'ACCEPTED',
          code: 'DUPLICATE_REQUEST',
          message:
            existing.status === 'ACCEPTED'
              ? 'Your bid has been accepted.'
              : String(existing.rejection_reason || 'Duplicate bid request.'),
          bid: mapBidRow(existing),
          highestBid: Number(auction.highest_bid),
          highestBidderTeamId: auction.highest_bidder_team_id
            ? String(auction.highest_bidder_team_id)
            : null,
        };
      }
    }

    const parsedAmount = typeof rawAmount === 'number' ? rawAmount : Number(rawAmount);
    if (!Number.isFinite(parsedAmount) || !Number.isInteger(parsedAmount) || parsedAmount <= 0) {
      return {
        ok: false,
        code: 'INVALID_AMOUNT',
        message: 'Invalid bid. Enter a positive whole number.',
      };
    }

    if (auction.highest_bidder_team_id && String(auction.highest_bidder_team_id) === teamId) {
      return {
        ok: false,
        code: 'SELF_OUTBID',
        message: 'You cannot outbid your own current bid.',
      };
    }

    const item = db
      .prepare('SELECT starting_bid FROM auction_items WHERE id = ?')
      .get(auction.item_id) as { starting_bid: number } | undefined;

    const itemStartBid = item ? Number(item.starting_bid) : room.min_starting_bid;
    const minStarting = Math.max(1, itemStartBid > 0 ? itemStartBid : room.min_starting_bid);

    const hasHighest = Boolean(auction.highest_bidder_team_id);
    const minRequired = hasHighest
      ? Number(auction.highest_bid) + Math.max(1, room.min_bid_increment)
      : minStarting;

    const nextSeq = Number(auction.sequence_counter) + 1;
    const bidId = crypto.randomUUID();
    const teamName = String(team.team_name);

    if (parsedAmount < minRequired) {
      const reason = hasHighest
        ? `Your bid is too low. Minimum bid is ${minRequired} coins.`
        : `Bid must be at least the starting bid of ${minRequired} coins.`;

      db.prepare('UPDATE auctions SET sequence_counter = ? WHERE id = ?').run(nextSeq, auction.id);
      db.prepare(
        `INSERT INTO bids (
          id, auction_id, room_id, team_id, team_name, bid_amount, server_timestamp, sequence_number, status, rejection_reason, client_request_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'REJECTED', ?, ?)`,
      ).run(
        bidId,
        auction.id,
        roomId,
        teamId,
        teamName,
        parsedAmount,
        now,
        nextSeq,
        reason,
        cleanRequestId,
      );

      return {
        ok: false,
        code: 'TOO_LOW',
        message: reason,
        highestBid: Number(auction.highest_bid),
        highestBidderTeamId: auction.highest_bidder_team_id
          ? String(auction.highest_bidder_team_id)
          : null,
      };
    }

    db.prepare(
      `UPDATE auctions
       SET highest_bid = ?, highest_bidder_team_id = ?, highest_bidder_team_name = ?, sequence_counter = ?
       WHERE id = ?`,
    ).run(parsedAmount, teamId, teamName, nextSeq, auction.id);

    db.prepare(
      `INSERT INTO bids (
        id, auction_id, room_id, team_id, team_name, bid_amount, server_timestamp, sequence_number, status, rejection_reason, client_request_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACCEPTED', NULL, ?)`,
    ).run(
      bidId,
      auction.id,
      roomId,
      teamId,
      teamName,
      parsedAmount,
      now,
      nextSeq,
      cleanRequestId,
    );

    const acceptedBid: BidRecord = {
      id: bidId,
      auctionId: String(auction.id),
      roomId,
      teamId,
      teamName,
      bidAmount: parsedAmount,
      serverTimestamp: now,
      sequenceNumber: nextSeq,
      status: 'ACCEPTED',
      rejectionReason: null,
    };

    return {
      ok: true,
      code: 'ACCEPTED',
      message: 'Your bid has been accepted.',
      bid: acceptedBid,
      highestBid: parsedAmount,
      highestBidderTeamId: teamId,
    };
  })();

  // If deadline had passed when bid arrived, close the auction immediately outside txn
  if (!result.ok && result.message === 'Auction time is over.') {
    closeAuctionOnTimeout(roomId);
  }

  if (result.ok) {
    broadcastRoomState(roomId);
    if (ioInstance && result.bid) {
      ioInstance.to(`public:${roomId}`).emit('auction:bid_accepted', result.bid);
    }
  }
  return result;
}

export function startAuctionForCurrentItem(
  roomId: string,
  hostId: string,
): { ok: boolean; error?: string } {
  const res = db.transaction((): { ok: boolean; error?: string; deadline?: number } => {
    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId) as RoomRow | undefined;
    if (!room) return { ok: false, error: 'Room not found.' };
    if (room.host_id !== hostId) return { ok: false, error: 'Unauthorized host access.' };
    if (room.machine_state === 'ROOM_COMPLETED') {
      return { ok: false, error: 'Room is already completed.' };
    }
    if (
      ['AUCTION_OPEN', 'ANSWER_PENDING', 'ANSWER_RUNNING'].includes(room.machine_state)
    ) {
      return {
        ok: false,
        error: 'Cannot start a new auction while an auction or answer session is still pending.',
      };
    }

    const items = db
      .prepare('SELECT * FROM auction_items WHERE room_id = ? ORDER BY sort_order ASC, created_at ASC')
      .all(roomId) as Record<string, unknown>[];
    if (items.length === 0) {
      return {
        ok: false,
        error: 'Add at least one custom auction item before starting the auction.',
      };
    }

    let targetIndex = room.current_item_index;
    let targetItem = items[targetIndex] ? mapItemRow(items[targetIndex]) : null;
    if (!targetItem || targetItem.status !== 'PENDING') {
      const nextIdx = items.findIndex((r) => r.status === 'PENDING');
      if (nextIdx === -1) {
        return {
          ok: false,
          error: 'All auction items have been completed. Finish the event or add another item.',
        };
      }
      targetIndex = nextIdx;
      targetItem = mapItemRow(items[nextIdx]);
    }

    const now = Date.now();
    const durationSec =
      targetItem.auctionDurationOverride && targetItem.auctionDurationOverride >= 5
        ? targetItem.auctionDurationOverride
        : room.auction_duration_sec;
    const deadline = now + durationSec * 1000;
    const auctionId = crypto.randomUUID();

    db.prepare(
      `INSERT INTO auctions (
        id, room_id, item_id, auction_status, start_timestamp, deadline_timestamp, highest_bid, sequence_counter
      ) VALUES (?, ?, ?, 'OPEN', ?, ?, 0, 0)`,
    ).run(auctionId, roomId, targetItem.id, now, deadline);

    const announcement = `Auction live for ${targetItem.itemName}! Starting bid: ${targetItem.startingBid} coins.`;
    db.prepare(
      `UPDATE rooms
       SET machine_state = 'AUCTION_OPEN', is_paused = 0, paused_from_state = NULL, paused_remaining_ms = NULL,
           is_active = 1, current_item_index = ?, current_auction_id = ?, last_announcement = ?
       WHERE id = ?`,
    ).run(targetIndex, auctionId, announcement, roomId);

    return { ok: true, deadline };
  })();

  if (res.ok && res.deadline) {
    scheduleAuctionDeadline(roomId, res.deadline);
    broadcastRoomState(roomId);
  }
  return { ok: res.ok, error: res.error };
}

export function pauseCurrentSession(roomId: string, hostId: string): { ok: boolean; error?: string } {
  const res = db.transaction(() => {
    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId) as RoomRow | undefined;
    if (!room) return { ok: false, error: 'Room not found.' };
    if (room.host_id !== hostId) return { ok: false, error: 'Unauthorized host access.' };
    if (room.is_paused === 1) return { ok: false, error: 'Already paused.' };
    if (!['AUCTION_OPEN', 'ANSWER_RUNNING'].includes(room.machine_state)) {
      return { ok: false, error: 'Only an active auction or answer timer can be paused.' };
    }

    const now = Date.now();
    let remainingMs = 0;

    if (room.machine_state === 'AUCTION_OPEN' && room.current_auction_id) {
      const auction = db
        .prepare('SELECT deadline_timestamp FROM auctions WHERE id = ?')
        .get(room.current_auction_id) as { deadline_timestamp: number } | undefined;
      remainingMs = auction ? Math.max(1000, auction.deadline_timestamp - now) : 1000;
    } else if (room.machine_state === 'ANSWER_RUNNING' && room.current_auction_id) {
      const session = db
        .prepare('SELECT answer_deadline_timestamp FROM answer_sessions WHERE auction_id = ?')
        .get(room.current_auction_id) as { answer_deadline_timestamp: number | null } | undefined;
      remainingMs = session?.answer_deadline_timestamp
        ? Math.max(1000, session.answer_deadline_timestamp - now)
        : 1000;
    }

    db.prepare(
      `UPDATE rooms
       SET is_paused = 1, paused_from_state = ?, paused_remaining_ms = ?, last_announcement = 'Session paused by host.'
       WHERE id = ?`,
    ).run(room.machine_state, remainingMs, roomId);

    return { ok: true };
  })();

  if (res.ok) {
    clearRoomTimer(roomId);
    broadcastRoomState(roomId);
  }
  return res;
}

export function resumeCurrentSession(roomId: string, hostId: string): { ok: boolean; error?: string } {
  const res = db.transaction((): {
    ok: boolean;
    error?: string;
    mode?: MachineState;
    deadline?: number;
  } => {
    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId) as RoomRow | undefined;
    if (!room) return { ok: false, error: 'Room not found.' };
    if (room.host_id !== hostId) return { ok: false, error: 'Unauthorized host access.' };
    if (room.is_paused !== 1 || !room.paused_from_state) {
      return { ok: false, error: 'Room is not paused.' };
    }

    const now = Date.now();
    const remainingMs = Math.max(1000, room.paused_remaining_ms || 5000);
    const newDeadline = now + remainingMs;

    if (room.paused_from_state === 'AUCTION_OPEN' && room.current_auction_id) {
      db.prepare('UPDATE auctions SET deadline_timestamp = ? WHERE id = ?').run(
        newDeadline,
        room.current_auction_id,
      );
    } else if (room.paused_from_state === 'ANSWER_RUNNING' && room.current_auction_id) {
      const session = db
        .prepare('SELECT answer_start_timestamp, answer_deadline_timestamp FROM answer_sessions WHERE auction_id = ?')
        .get(room.current_auction_id) as
        | { answer_start_timestamp: number | null; answer_deadline_timestamp: number | null }
        | undefined;
      if (session?.answer_start_timestamp && session?.answer_deadline_timestamp) {
        const totalDuration = session.answer_deadline_timestamp - session.answer_start_timestamp;
        const elapsedBeforePause = Math.max(0, totalDuration - remainingMs);
        const adjustedStart = now - elapsedBeforePause;
        db.prepare(
          `UPDATE answer_sessions
           SET answer_start_timestamp = ?, answer_deadline_timestamp = ?
           WHERE auction_id = ?`,
        ).run(adjustedStart, newDeadline, room.current_auction_id);
      } else {
        db.prepare(
          `UPDATE answer_sessions SET answer_deadline_timestamp = ? WHERE auction_id = ?`,
        ).run(newDeadline, room.current_auction_id);
      }
    }

    db.prepare(
      `UPDATE rooms
       SET is_paused = 0, machine_state = ?, paused_from_state = NULL, paused_remaining_ms = NULL,
           last_announcement = 'Session resumed by host.'
       WHERE id = ?`,
    ).run(room.paused_from_state, roomId);

    return { ok: true, mode: room.paused_from_state, deadline: newDeadline };
  })();

  if (res.ok && res.deadline) {
    if (res.mode === 'AUCTION_OPEN') {
      scheduleAuctionDeadline(roomId, res.deadline);
    } else if (res.mode === 'ANSWER_RUNNING') {
      scheduleAnswerDeadline(roomId, res.deadline);
    }
    broadcastRoomState(roomId);
  }
  return { ok: res.ok, error: res.error };
}

export function endAuctionEarly(roomId: string, hostId: string): { ok: boolean; error?: string } {
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId) as RoomRow | undefined;
  if (!room) return { ok: false, error: 'Room not found.' };
  if (room.host_id !== hostId) return { ok: false, error: 'Unauthorized host access.' };
  if (room.machine_state !== 'AUCTION_OPEN') {
    return { ok: false, error: 'No auction is currently open.' };
  }
  if (room.is_paused === 1) {
    db.prepare('UPDATE rooms SET is_paused = 0, paused_from_state = NULL, paused_remaining_ms = NULL WHERE id = ?').run(
      roomId,
    );
  }
  closeAuctionOnTimeout(roomId);
  return { ok: true };
}

export function startAnswerTimer(roomId: string, hostId: string): { ok: boolean; error?: string } {
  const res = db.transaction((): { ok: boolean; error?: string; deadline?: number } => {
    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId) as RoomRow | undefined;
    if (!room) return { ok: false, error: 'Room not found.' };
    if (room.host_id !== hostId) return { ok: false, error: 'Unauthorized host access.' };
    if (!['WINNER_SELECTED', 'ANSWER_PENDING'].includes(room.machine_state)) {
      return { ok: false, error: 'Winner must be selected before starting the answer timer.' };
    }
    if (!room.current_auction_id) return { ok: false, error: 'No active auction.' };

    const session = db
      .prepare('SELECT * FROM answer_sessions WHERE auction_id = ?')
      .get(room.current_auction_id) as Record<string, unknown> | undefined;
    if (!session || session.host_decision !== 'PENDING') {
      return { ok: false, error: 'Answer session is not pending.' };
    }

    const item = db
      .prepare('SELECT answer_duration_override FROM auction_items WHERE id = ?')
      .get(session.item_id) as { answer_duration_override: number | null } | undefined;

    const durationSec =
      item?.answer_duration_override && item.answer_duration_override >= 5
        ? item.answer_duration_override
        : room.answer_duration_sec;

    const now = Date.now();
    const deadline = now + durationSec * 1000;

    db.prepare(
      `UPDATE answer_sessions
       SET answer_start_timestamp = ?, answer_deadline_timestamp = ?
       WHERE id = ?`,
    ).run(now, deadline, session.id);

    const announcement = `Answer timer started (${durationSec}s) for ${session.winning_team_name}.`;
    db.prepare(
      `UPDATE rooms SET machine_state = 'ANSWER_RUNNING', is_paused = 0, last_announcement = ? WHERE id = ?`,
    ).run(announcement, roomId);

    return { ok: true, deadline };
  })();

  if (res.ok && res.deadline) {
    scheduleAnswerDeadline(roomId, res.deadline);
    broadcastRoomState(roomId);
  }
  return { ok: res.ok, error: res.error };
}

export function evaluateAnswerDecision(
  roomId: string,
  hostId: string,
  decision: 'CORRECT' | 'WRONG' | 'SKIPPED',
): { ok: boolean; error?: string; alreadyEvaluated?: boolean } {
  const res = db.transaction((): { ok: boolean; error?: string; alreadyEvaluated?: boolean } => {
    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId) as RoomRow | undefined;
    if (!room) return { ok: false, error: 'Room not found.' };
    if (room.host_id !== hostId) return { ok: false, error: 'Unauthorized host access.' };

    // Handle skipping a NO_BIDS closed auction directly
    if (room.machine_state === 'AUCTION_CLOSED' && decision === 'SKIPPED' && room.current_auction_id) {
      const auction = db
        .prepare('SELECT * FROM auctions WHERE id = ?')
        .get(room.current_auction_id) as Record<string, unknown> | undefined;
      if (!auction) return { ok: false, error: 'Auction not found.' };
      const item = db
        .prepare('SELECT * FROM auction_items WHERE id = ?')
        .get(auction.item_id) as Record<string, unknown>;

      db.prepare(`UPDATE auction_items SET status = 'SKIPPED' WHERE id = ?`).run(auction.item_id);
      db.prepare(`UPDATE auctions SET auction_status = 'SKIPPED' WHERE id = ?`).run(auction.id);

      const now = Date.now();
      db.prepare(
        `INSERT INTO auction_history (
          id, room_id, room_name, item_id, item_name, question_title, auction_id,
          winning_team_id, winning_team_name, final_bid, auction_start_timestamp,
          auction_end_timestamp, answer_start_timestamp, host_decision, response_time_ms,
          points_change, final_balance, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, ?, ?, NULL, 'NO_BIDS', NULL, 0, NULL, ?)`,
      ).run(
        crypto.randomUUID(),
        roomId,
        room.room_name,
        auction.item_id,
        item.item_name,
        item.question_title,
        auction.id,
        auction.start_timestamp,
        auction.closed_timestamp,
        now,
      );

      db.prepare(
        `UPDATE rooms SET machine_state = 'ANSWER_EVALUATED', is_paused = 0, last_announcement = 'Item skipped (no bids).' WHERE id = ?`,
      ).run(roomId);
      return { ok: true };
    }

    if (!['WINNER_SELECTED', 'ANSWER_PENDING', 'ANSWER_RUNNING'].includes(room.machine_state)) {
      if (room.machine_state === 'ANSWER_EVALUATED' || room.machine_state === 'NEXT_ITEM_PENDING') {
        // Idempotent guard against double-clicking!
        return { ok: true, alreadyEvaluated: true };
      }
      return { ok: false, error: 'No answer session is ready for evaluation.' };
    }

    if (!room.current_auction_id) return { ok: false, error: 'No active auction.' };

    const session = db
      .prepare('SELECT * FROM answer_sessions WHERE auction_id = ?')
      .get(room.current_auction_id) as Record<string, unknown> | undefined;
    if (!session) return { ok: false, error: 'Answer session not found.' };

    // Idempotent double-click protection
    if (session.host_decision !== 'PENDING') {
      return { ok: true, alreadyEvaluated: true };
    }

    const auction = db
      .prepare('SELECT * FROM auctions WHERE id = ?')
      .get(room.current_auction_id) as Record<string, unknown>;
    const item = db
      .prepare('SELECT * FROM auction_items WHERE id = ?')
      .get(session.item_id) as Record<string, unknown>;
    const team = db
      .prepare('SELECT * FROM teams WHERE id = ?')
      .get(session.winning_team_id) as Record<string, unknown>;

    if (!team) return { ok: false, error: 'Winning team not found.' };

    const now = Date.now();
    const answerStart =
      session.answer_start_timestamp !== null && session.answer_start_timestamp !== undefined
        ? Number(session.answer_start_timestamp)
        : null;

    // Only recorded answer sessions (CORRECT or WRONG) contribute response time.
    const responseTimeMs =
      decision === 'SKIPPED'
        ? null
        : answerStart !== null
          ? Math.max(0, now - answerStart)
          : 0;

    let workingBalance = Number(team.balance);

    // Optional winning bid deduction (OFF by default)
    if (room.deduct_winning_bid === 1 && decision !== 'SKIPPED' && Number(auction.highest_bid) > 0) {
      const prevBal = workingBalance;
      const bidDeduction = -Number(auction.highest_bid);
      const afterBid = Math.max(0, prevBal + bidDeduction);
      const actualBidDeducted = afterBid - prevBal;
      workingBalance = afterBid;

      db.prepare(
        `INSERT INTO score_transactions (
          id, room_id, team_id, team_name, item_id, auction_id, previous_balance,
          configured_change, actual_change, new_balance, reason, decision_type, host_id, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'WINNING_BID_DEDUCTION', ?, ?)`,
      ).run(
        crypto.randomUUID(),
        roomId,
        team.id,
        team.team_name,
        item.id,
        auction.id,
        prevBal,
        bidDeduction,
        actualBidDeducted,
        afterBid,
        `Winning bid deduction for ${item.item_name}`,
        hostId,
        now,
      );
    }

    let configuredChange = 0;
    if (decision === 'CORRECT') configuredChange = room.correct_points;
    if (decision === 'WRONG') configuredChange = -Math.abs(room.wrong_deduction);

    const prevBalanceBeforeEval = workingBalance;
    const finalBalance =
      decision === 'SKIPPED'
        ? workingBalance
        : Math.max(0, prevBalanceBeforeEval + configuredChange);
    const actualChange = finalBalance - prevBalanceBeforeEval;

    if (decision !== 'SKIPPED') {
      db.prepare(
        `INSERT INTO score_transactions (
          id, room_id, team_id, team_name, item_id, auction_id, previous_balance,
          configured_change, actual_change, new_balance, reason, decision_type, host_id, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        crypto.randomUUID(),
        roomId,
        team.id,
        team.team_name,
        item.id,
        auction.id,
        prevBalanceBeforeEval,
        configuredChange,
        actualChange,
        finalBalance,
        decision === 'CORRECT'
          ? `Correct answer for ${item.item_name}`
          : `Wrong answer for ${item.item_name}`,
        decision,
        hostId,
        now,
      );
    }

    const correctInc = decision === 'CORRECT' ? 1 : 0;
    const wrongInc = decision === 'WRONG' ? 1 : 0;
    const sessionInc = decision === 'SKIPPED' ? 0 : 1;
    const timeInc = responseTimeMs ?? 0;

    db.prepare(
      `UPDATE teams
       SET balance = ?,
           correct_count = correct_count + ?,
           wrong_count = wrong_count + ?,
           answer_sessions_count = answer_sessions_count + ?,
           total_response_time_ms = total_response_time_ms + ?
       WHERE id = ?`,
    ).run(finalBalance, correctInc, wrongInc, sessionInc, timeInc, team.id);

    db.prepare(
      `UPDATE answer_sessions
       SET answer_decision_timestamp = ?, response_time_ms = ?, host_decision = ?
       WHERE id = ?`,
    ).run(now, responseTimeMs, decision, session.id);

    db.prepare(`UPDATE auctions SET auction_status = 'COMPLETED' WHERE id = ?`).run(auction.id);
    db.prepare(`UPDATE auction_items SET status = ? WHERE id = ?`).run(
      decision === 'SKIPPED' ? 'SKIPPED' : 'COMPLETED',
      item.id,
    );

    db.prepare(
      `INSERT INTO auction_history (
        id, room_id, room_name, item_id, item_name, question_title, auction_id,
        winning_team_id, winning_team_name, final_bid, auction_start_timestamp,
        auction_end_timestamp, answer_start_timestamp, host_decision, response_time_ms,
        points_change, final_balance, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      crypto.randomUUID(),
      roomId,
      room.room_name,
      item.id,
      item.item_name,
      item.question_title,
      auction.id,
      team.id,
      team.team_name,
      auction.highest_bid,
      auction.start_timestamp,
      auction.closed_timestamp,
      answerStart,
      decision,
      responseTimeMs,
      actualChange,
      finalBalance,
      now,
    );

    const announcement =
      decision === 'CORRECT'
        ? `${team.team_name} answered CORRECT! (+${actualChange} pts)`
        : decision === 'WRONG'
          ? `${team.team_name} answered WRONG! (${actualChange} pts)`
          : `${team.team_name}'s answer was skipped by the host.`;

    db.prepare(
      `UPDATE rooms SET machine_state = 'ANSWER_EVALUATED', is_paused = 0, paused_from_state = NULL, paused_remaining_ms = NULL, last_announcement = ? WHERE id = ?`,
    ).run(announcement, roomId);

    return { ok: true };
  })();

  if (res.ok && !res.alreadyEvaluated) {
    clearRoomTimer(roomId);
    broadcastRoomState(roomId);
  }
  return res;
}

export function restartClosedAuction(roomId: string, hostId: string): { ok: boolean; error?: string } {
  const res = db.transaction(() => {
    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId) as RoomRow | undefined;
    if (!room) return { ok: false, error: 'Room not found.' };
    if (room.host_id !== hostId) return { ok: false, error: 'Unauthorized host access.' };
    if (room.machine_state !== 'AUCTION_CLOSED') {
      return { ok: false, error: 'Only a closed no-bid auction can be restarted directly.' };
    }
    db.prepare(
      `UPDATE rooms SET machine_state = 'ROOM_READY', current_auction_id = NULL, last_announcement = 'Auction reset. Ready to start.' WHERE id = ?`,
    ).run(roomId);
    return { ok: true };
  })();

  if (res.ok) {
    broadcastRoomState(roomId);
  }
  return res;
}

export function advanceToNextItem(roomId: string, hostId: string): { ok: boolean; error?: string; completed?: boolean } {
  const res = db.transaction((): { ok: boolean; error?: string; completed?: boolean } => {
    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId) as RoomRow | undefined;
    if (!room) return { ok: false, error: 'Room not found.' };
    if (room.host_id !== hostId) return { ok: false, error: 'Unauthorized host access.' };
    if (['AUCTION_OPEN', 'ANSWER_RUNNING', 'ANSWER_PENDING', 'WINNER_SELECTED'].includes(room.machine_state)) {
      return { ok: false, error: 'Finish or skip the current auction/answer session first.' };
    }

    const items = db
      .prepare('SELECT * FROM auction_items WHERE room_id = ? ORDER BY sort_order ASC, created_at ASC')
      .all(roomId) as Record<string, unknown>[];
    const nextIdx = items.findIndex((i) => i.status === 'PENDING');

    if (nextIdx === -1) {
      db.prepare(
        `UPDATE rooms SET machine_state = 'ROOM_COMPLETED', current_auction_id = NULL, last_announcement = 'All auction items completed! Final results are live.' WHERE id = ?`,
      ).run(roomId);
      return { ok: true, completed: true };
    }

    db.prepare(
      `UPDATE rooms SET machine_state = 'ROOM_READY', current_item_index = ?, current_auction_id = NULL, last_announcement = 'Ready for next auction item.' WHERE id = ?`,
    ).run(nextIdx, roomId);
    return { ok: true, completed: false };
  })();

  if (res.ok) {
    clearRoomTimer(roomId);
    broadcastRoomState(roomId);
  }
  return res;
}

export function manualAdjustTeamScore(
  roomId: string,
  hostId: string,
  teamId: string,
  amount: number,
  reason: string,
): { ok: boolean; error?: string } {
  const res = db.transaction(() => {
    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId) as RoomRow | undefined;
    if (!room) return { ok: false, error: 'Room not found.' };
    if (room.host_id !== hostId) return { ok: false, error: 'Unauthorized host access.' };
    if (!Number.isInteger(amount) || amount === 0) {
      return { ok: false, error: 'Adjustment amount must be a non-zero integer.' };
    }
    const cleanReason = reason.trim();
    if (!cleanReason) return { ok: false, error: 'Reason is required for audit history.' };

    const team = db
      .prepare(`SELECT * FROM teams WHERE id = ? AND room_id = ? AND participation_status = 'ACTIVE'`)
      .get(teamId, roomId) as Record<string, unknown> | undefined;
    if (!team) return { ok: false, error: 'Team not found in this room.' };

    const prevBalance = Number(team.balance);
    const newBalance = Math.max(0, prevBalance + amount);
    const actualChange = newBalance - prevBalance;
    const now = Date.now();

    db.prepare('UPDATE teams SET balance = ? WHERE id = ?').run(newBalance, teamId);
    db.prepare(
      `INSERT INTO score_transactions (
        id, room_id, team_id, team_name, item_id, auction_id, previous_balance,
        configured_change, actual_change, new_balance, reason, decision_type, host_id, timestamp
      ) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, 'MANUAL_ADJUSTMENT', ?, ?)`,
    ).run(
      crypto.randomUUID(),
      roomId,
      teamId,
      team.team_name,
      prevBalance,
      amount,
      actualChange,
      newBalance,
      cleanReason,
      hostId,
      now,
    );

    const sign = actualChange >= 0 ? `+${actualChange}` : `${actualChange}`;
    db.prepare('UPDATE rooms SET last_announcement = ? WHERE id = ?').run(
      `Host adjusted ${team.team_name} points (${sign}): ${cleanReason}`,
      roomId,
    );
    return { ok: true };
  })();

  if (res.ok) {
    broadcastRoomState(roomId);
  }
  return res;
}

export function mapQuestionBankRow(r: Record<string, unknown>): QuestionBankItem {
  return {
    id: String(r.id),
    hostId: String(r.host_id),
    itemName: String(r.item_name),
    questionTitle: String(r.question_title),
    questionDescription: String(r.question_description),
    category: String(r.category),
    imageOrEmoji: String(r.image_or_emoji || '💻'),
    difficulty: (r.difficulty as DifficultyLevel | '') || '',
    startingBid: Number(r.starting_bid),
    auctionDurationOverride:
      r.auction_duration_override !== null && r.auction_duration_override !== undefined
        ? Number(r.auction_duration_override)
        : null,
    answerDurationOverride:
      r.answer_duration_override !== null && r.answer_duration_override !== undefined
        ? Number(r.answer_duration_override)
        : null,
    createdAt: Number(r.created_at),
  };
}

export function escapeCsvCell(value: unknown): string {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
