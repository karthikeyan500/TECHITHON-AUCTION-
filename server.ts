import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import dotenv from 'dotenv';
import express from 'express';
import { Server as SocketIOServer } from 'socket.io';
import {
  clearSessionCookie,
  createRateLimiter,
  csrfProtectMiddleware,
  getHostFromRequest,
  getTeamFromRequest,
  hashSecret,
  HOST_COOKIE_NAME,
  parseCookies,
  requireHost,
  requireTeam,
  setSessionCookie,
  signToken,
  TEAM_COOKIE_NAME,
  verifySecret,
  verifyToken,
  type AuthenticatedRequest,
  type HostTokenPayload,
  type TeamTokenPayload,
} from './server/auth.ts';
import { db } from './server/db.ts';
import {
  advanceToNextItem,
  broadcastRoomState,
  buildRoomSummary,
  clearRoomTimer,
  endAuctionEarly,
  escapeCsvCell,
  evaluateAnswerDecision,
  generateRoomCode,
  getHostSnapshot,
  getPublicSnapshot,
  getTeamSnapshot,
  manualAdjustTeamScore,
  mapQuestionBankRow,
  pauseCurrentSession,
  processAtomicBid,
  recoverActiveTimers,
  restartClosedAuction,
  resumeCurrentSession,
  setSocketServer,
  startAnswerTimer,
  startAuctionForCurrentItem,
} from './server/engine.ts';
import type { DifficultyLevel, HostUser } from './src/shared/types.ts';

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const app = express();
app.set('trust proxy', 1);

app.use(express.json({ limit: '2mb' }));
app.use(csrfProtectMiddleware);

const authLimiter = createRateLimiter('auth', 60, 60_000);
const joinLimiter = createRateLimiter('join', 120, 60_000);
const bidLimiter = createRateLimiter('bid', 30, 10_000, (req) => {
  const team = getTeamFromRequest(req);
  return team ? team.teamId : req.ip || 'anon';
});

// Helper to verify host owns the room
function getOwnedRoom(roomId: string, hostId: string): Record<string, unknown> | null {
  const row = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId) as
    | Record<string, unknown>
    | undefined;
  if (!row || String(row.host_id) !== hostId) return null;
  return row;
}

function parseCsvLines(csvText: string): string[][] {
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
        if (row.some((c) => c.length > 0)) {
          rows.push(row);
        }
        row = [];
        cell = '';
      } else {
        cell += ch;
      }
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    if (row.some((c) => c.length > 0)) {
      rows.push(row);
    }
  }
  return rows;
}

// ==========================================
// HEALTH CHECK
// ==========================================
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, serverTime: Date.now() });
});

// ==========================================
// HOST AUTHENTICATION ROUTES
// ==========================================
app.post('/api/auth/register', authLimiter, (req, res) => {
  const { username, displayName, password } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: 'Username and password are required.' });
    return;
  }
  const cleanUser = username.trim();
  const cleanDisplay =
    typeof displayName === 'string' && displayName.trim().length > 0
      ? displayName.trim()
      : cleanUser;

  if (cleanUser.length < 3 || cleanUser.length > 40) {
    res.status(400).json({ error: 'Username must be between 3 and 40 characters.' });
    return;
  }
  if (password.length < 6 || password.length > 128) {
    res.status(400).json({ error: 'Password must be at least 6 characters.' });
    return;
  }

  const existing = db
    .prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)')
    .get(cleanUser);
  if (existing) {
    res.status(409).json({ error: 'This host username is already registered.' });
    return;
  }

  const id = crypto.randomUUID();
  const now = Date.now();
  const passwordHash = hashSecret(password);

  db.prepare(
    `INSERT INTO users (id, username, display_name, password_hash, role, created_at)
     VALUES (?, ?, ?, ?, 'HOST', ?)`,
  ).run(id, cleanUser, cleanDisplay, passwordHash, now);

  const host: HostUser = {
    id,
    username: cleanUser,
    displayName: cleanDisplay,
    role: 'HOST',
    createdAt: now,
  };

  const token = signToken({
    type: 'host',
    userId: id,
    username: cleanUser,
    displayName: cleanDisplay,
    exp: now + 1000 * 60 * 60 * 24,
  });

  setSessionCookie(req, res, HOST_COOKIE_NAME, token);
  res.status(201).json({ host, token });
});

app.post('/api/auth/login', authLimiter, (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: 'Username and password are required.' });
    return;
  }

  const row = db
    .prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?)')
    .get(username.trim()) as
    | {
        id: string;
        username: string;
        display_name: string;
        password_hash: string;
        role: 'HOST';
        created_at: number;
      }
    | undefined;

  if (!row || !verifySecret(password, row.password_hash)) {
    res.status(401).json({ error: 'Invalid username or password.' });
    return;
  }

  const host: HostUser = {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    createdAt: row.created_at,
  };

  const token = signToken({
    type: 'host',
    userId: row.id,
    username: row.username,
    displayName: row.display_name,
    exp: Date.now() + 1000 * 60 * 60 * 24,
  });

  setSessionCookie(req, res, HOST_COOKIE_NAME, token);
  res.json({ host, token });
});

app.post('/api/auth/logout', (req, res) => {
  clearSessionCookie(req, res, HOST_COOKIE_NAME);
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const host = getHostFromRequest(req);
  if (!host) {
    res.json({ host: null });
    return;
  }
  const token = signToken({
    type: 'host',
    userId: host.id,
    username: host.username,
    displayName: host.displayName,
    exp: Date.now() + 1000 * 60 * 60 * 24,
  });
  res.json({ host, token });
});

// ==========================================
// HOST ROOM MANAGEMENT ROUTES
// ==========================================
app.get('/api/host/rooms', requireHost, (req: AuthenticatedRequest, res) => {
  const rows = db
    .prepare('SELECT * FROM rooms WHERE host_id = ? ORDER BY created_at DESC')
    .all(req.hostUser!.id) as Record<string, unknown>[];
  res.json({
    rooms: rows.map((r) => buildRoomSummary(r as never)),
  });
});

app.post('/api/host/rooms', requireHost, (req: AuthenticatedRequest, res) => {
  const body = req.body ?? {};
  const roomName = typeof body.roomName === 'string' ? body.roomName.trim() : '';
  if (roomName.length < 2 || roomName.length > 80) {
    res.status(400).json({ error: 'Room name must be between 2 and 80 characters.' });
    return;
  }

  const maxTeams = Math.min(200, Math.max(2, Math.trunc(Number(body.maxTeams ?? 32))));
  const startingCoins = Math.min(100000, Math.max(0, Math.trunc(Number(body.startingCoins ?? 100))));
  const auctionDurationSec = Math.min(
    600,
    Math.max(5, Math.trunc(Number(body.auctionDurationSec ?? 30))),
  );
  const answerDurationSec = Math.min(
    300,
    Math.max(5, Math.trunc(Number(body.answerDurationSec ?? 20))),
  );
  const correctPoints = Math.min(1000, Math.max(1, Math.trunc(Number(body.correctPoints ?? 10))));
  const wrongDeduction = Math.min(1000, Math.max(0, Math.trunc(Number(body.wrongDeduction ?? 10))));
  const minStartingBid = Math.min(
    10000,
    Math.max(1, Math.trunc(Number(body.minStartingBid ?? 10))),
  );
  const minBidIncrement = Math.min(
    1000,
    Math.max(1, Math.trunc(Number(body.minBidIncrement ?? 5))),
  );
  const deductWinningBid = body.deductWinningBid === true ? 1 : 0;

  const rawPin = typeof body.roomPin === 'string' ? body.roomPin.trim() : '';
  const hasPin = rawPin.length > 0 ? 1 : 0;
  const roomPinHash = hasPin ? hashSecret(rawPin) : null;

  const id = crypto.randomUUID();
  const roomCode = generateRoomCode();
  const now = Date.now();

  db.prepare(
    `INSERT INTO rooms (
      id, room_code, room_name, room_pin_hash, has_pin, host_id, host_name,
      machine_state, is_paused, is_active, max_teams, starting_coins,
      auction_duration_sec, answer_duration_sec, correct_points, wrong_deduction,
      min_starting_bid, min_bid_increment, deduct_winning_bid, current_item_index,
      last_announcement, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ROOM_WAITING', 0, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
  ).run(
    id,
    roomCode,
    roomName,
    roomPinHash,
    hasPin,
    req.hostUser!.id,
    req.hostUser!.displayName,
    maxTeams,
    startingCoins,
    auctionDurationSec,
    answerDurationSec,
    correctPoints,
    wrongDeduction,
    minStartingBid,
    minBidIncrement,
    deductWinningBid,
    `Room "${roomName}" created. Waiting for teams with code ${roomCode}.`,
    now,
  );

  const snapshot = getHostSnapshot(id);
  res.status(201).json(snapshot);
});

app.get('/api/host/rooms/:roomId', requireHost, (req: AuthenticatedRequest, res) => {
  const roomId = String(req.params.roomId);
  if (!getOwnedRoom(roomId, req.hostUser!.id)) {
    res.status(404).json({ error: 'Room not found or unauthorized.' });
    return;
  }
  const snap = getHostSnapshot(roomId);
  res.json(snap);
});

app.patch('/api/host/rooms/:roomId/settings', requireHost, (req: AuthenticatedRequest, res) => {
  const roomId = String(req.params.roomId);
  const room = getOwnedRoom(roomId, req.hostUser!.id);
  if (!room) {
    res.status(404).json({ error: 'Room not found or unauthorized.' });
    return;
  }
  if (['AUCTION_OPEN', 'ANSWER_RUNNING'].includes(String(room.machine_state))) {
    res.status(400).json({ error: 'Pause or finish the active timer before editing settings.' });
    return;
  }

  const body = req.body ?? {};
  const roomName =
    typeof body.roomName === 'string' && body.roomName.trim().length >= 2
      ? body.roomName.trim().slice(0, 80)
      : String(room.room_name);

  const maxTeams = Math.min(
    200,
    Math.max(2, Math.trunc(Number(body.maxTeams ?? room.max_teams))),
  );
  const startingCoins = Math.min(
    100000,
    Math.max(0, Math.trunc(Number(body.startingCoins ?? room.starting_coins))),
  );
  const auctionDurationSec = Math.min(
    600,
    Math.max(5, Math.trunc(Number(body.auctionDurationSec ?? room.auction_duration_sec))),
  );
  const answerDurationSec = Math.min(
    300,
    Math.max(5, Math.trunc(Number(body.answerDurationSec ?? room.answer_duration_sec))),
  );
  const correctPoints = Math.min(
    1000,
    Math.max(1, Math.trunc(Number(body.correctPoints ?? room.correct_points))),
  );
  const wrongDeduction = Math.min(
    1000,
    Math.max(0, Math.trunc(Number(body.wrongDeduction ?? room.wrong_deduction))),
  );
  const minStartingBid = Math.min(
    10000,
    Math.max(1, Math.trunc(Number(body.minStartingBid ?? room.min_starting_bid))),
  );
  const minBidIncrement = Math.min(
    1000,
    Math.max(1, Math.trunc(Number(body.minBidIncrement ?? room.min_bid_increment))),
  );
  const deductWinningBid =
    body.deductWinningBid !== undefined
      ? body.deductWinningBid
        ? 1
        : 0
      : Number(room.deduct_winning_bid);

  let hasPin = Number(room.has_pin);
  let roomPinHash = room.room_pin_hash as string | null;
  if (body.clearPin === true) {
    hasPin = 0;
    roomPinHash = null;
  } else if (typeof body.roomPin === 'string' && body.roomPin.trim().length > 0) {
    hasPin = 1;
    roomPinHash = hashSecret(body.roomPin.trim());
  }

  db.prepare(
    `UPDATE rooms
     SET room_name = ?, room_pin_hash = ?, has_pin = ?, max_teams = ?, starting_coins = ?,
         auction_duration_sec = ?, answer_duration_sec = ?, correct_points = ?, wrong_deduction = ?,
         min_starting_bid = ?, min_bid_increment = ?, deduct_winning_bid = ?
     WHERE id = ?`,
  ).run(
    roomName,
    roomPinHash,
    hasPin,
    maxTeams,
    startingCoins,
    auctionDurationSec,
    answerDurationSec,
    correctPoints,
    wrongDeduction,
    minStartingBid,
    minBidIncrement,
    deductWinningBid,
    roomId,
  );

  broadcastRoomState(roomId);
  res.json(getHostSnapshot(roomId));
});

app.post('/api/host/rooms/:roomId/toggle-active', requireHost, (req: AuthenticatedRequest, res) => {
  const roomId = String(req.params.roomId);
  const room = getOwnedRoom(roomId, req.hostUser!.id);
  if (!room) {
    res.status(404).json({ error: 'Room not found or unauthorized.' });
    return;
  }
  const nextActive = Number(room.is_active) === 1 ? 0 : 1;
  db.prepare('UPDATE rooms SET is_active = ? WHERE id = ?').run(nextActive, roomId);
  broadcastRoomState(roomId);
  res.json(getHostSnapshot(roomId));
});

app.post('/api/host/rooms/:roomId/ready', requireHost, (req: AuthenticatedRequest, res) => {
  const roomId = String(req.params.roomId);
  const room = getOwnedRoom(roomId, req.hostUser!.id);
  if (!room) {
    res.status(404).json({ error: 'Room not found or unauthorized.' });
    return;
  }
  const itemsCount = (
    db.prepare('SELECT COUNT(*) as cnt FROM auction_items WHERE room_id = ?').get(roomId) as {
      cnt: number;
    }
  ).cnt;
  if (itemsCount === 0) {
    res.status(400).json({ error: 'Add at least one custom auction item before marking ready.' });
    return;
  }
  if (room.machine_state === 'ROOM_WAITING') {
    db.prepare(
      `UPDATE rooms SET machine_state = 'ROOM_READY', is_active = 1, last_announcement = 'Room is ready to start the auction!' WHERE id = ?`,
    ).run(roomId);
    broadcastRoomState(roomId);
  }
  res.json(getHostSnapshot(roomId));
});

app.post('/api/host/rooms/:roomId/complete', requireHost, (req: AuthenticatedRequest, res) => {
  const roomId = String(req.params.roomId);
  const room = getOwnedRoom(roomId, req.hostUser!.id);
  if (!room) {
    res.status(404).json({ error: 'Room not found or unauthorized.' });
    return;
  }
  clearRoomTimer(roomId);
  db.prepare(
    `UPDATE rooms SET machine_state = 'ROOM_COMPLETED', is_paused = 0, last_announcement = 'Event completed! Final standings are announced.' WHERE id = ?`,
  ).run(roomId);
  broadcastRoomState(roomId);
  res.json(getHostSnapshot(roomId));
});

app.delete('/api/host/rooms/:roomId', requireHost, (req: AuthenticatedRequest, res) => {
  const roomId = String(req.params.roomId);
  const room = getOwnedRoom(roomId, req.hostUser!.id);
  if (!room) {
    res.status(404).json({ error: 'Room not found or unauthorized.' });
    return;
  }
  clearRoomTimer(roomId);
  db.prepare('DELETE FROM rooms WHERE id = ?').run(roomId);
  res.json({ ok: true });
});

// ==========================================
// CUSTOM AUCTION ITEMS & QUESTION BANK (NO CORRECT ANSWER FIELD)
// ==========================================
app.post('/api/host/rooms/:roomId/items', requireHost, (req: AuthenticatedRequest, res) => {
  const roomId = String(req.params.roomId);
  const room = getOwnedRoom(roomId, req.hostUser!.id);
  if (!room) {
    res.status(404).json({ error: 'Room not found or unauthorized.' });
    return;
  }

  const body = req.body ?? {};
  const itemName = typeof body.itemName === 'string' ? body.itemName.trim() : '';
  const questionTitle = typeof body.questionTitle === 'string' ? body.questionTitle.trim() : '';
  const questionDescription =
    typeof body.questionDescription === 'string' ? body.questionDescription.trim() : '';
  const category =
    typeof body.category === 'string' && body.category.trim() ? body.category.trim() : 'General Tech';
  const imageOrEmoji =
    typeof body.imageOrEmoji === 'string' && body.imageOrEmoji.trim()
      ? body.imageOrEmoji.trim().slice(0, 200)
      : '💻';
  const difficulty = (['Easy', 'Medium', 'Hard', 'Expert'].includes(String(body.difficulty))
    ? String(body.difficulty)
    : '') as DifficultyLevel | '';
  const startingBid = Math.max(
    1,
    Math.trunc(Number(body.startingBid ?? room.min_starting_bid ?? 10)),
  );
  const auctionDurationOverride =
    body.auctionDurationOverride !== null &&
    body.auctionDurationOverride !== undefined &&
    body.auctionDurationOverride !== ''
      ? Math.min(600, Math.max(5, Math.trunc(Number(body.auctionDurationOverride))))
      : null;
  const answerDurationOverride =
    body.answerDurationOverride !== null &&
    body.answerDurationOverride !== undefined &&
    body.answerDurationOverride !== ''
      ? Math.min(300, Math.max(5, Math.trunc(Number(body.answerDurationOverride))))
      : null;

  if (!itemName || !questionTitle) {
    res.status(400).json({ error: 'Item name and question title are required.' });
    return;
  }

  const maxSortRow = db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) as max_sort FROM auction_items WHERE room_id = ?')
    .get(roomId) as { max_sort: number };

  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO auction_items (
      id, room_id, sort_order, item_name, question_title, question_description,
      category, image_or_emoji, difficulty, starting_bid,
      auction_duration_override, answer_duration_override, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)`,
  ).run(
    id,
    roomId,
    Number(maxSortRow.max_sort) + 1,
    itemName,
    questionTitle,
    questionDescription,
    category,
    imageOrEmoji,
    difficulty,
    startingBid,
    auctionDurationOverride,
    answerDurationOverride,
    Date.now(),
  );

  if (body.saveToBank === true) {
    db.prepare(
      `INSERT INTO question_bank (
        id, host_id, item_name, question_title, question_description,
        category, image_or_emoji, difficulty, starting_bid,
        auction_duration_override, answer_duration_override, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      crypto.randomUUID(),
      req.hostUser!.id,
      itemName,
      questionTitle,
      questionDescription,
      category,
      imageOrEmoji,
      difficulty,
      startingBid,
      auctionDurationOverride,
      answerDurationOverride,
      Date.now(),
    );
  }

  broadcastRoomState(roomId);
  res.status(201).json(getHostSnapshot(roomId));
});

app.patch(
  '/api/host/rooms/:roomId/items/:itemId',
  requireHost,
  (req: AuthenticatedRequest, res) => {
    const roomId = String(req.params.roomId);
    const itemId = String(req.params.itemId);
    if (!getOwnedRoom(roomId, req.hostUser!.id)) {
      res.status(404).json({ error: 'Room not found or unauthorized.' });
      return;
    }
    const existing = db
      .prepare('SELECT * FROM auction_items WHERE id = ? AND room_id = ?')
      .get(itemId, roomId) as Record<string, unknown> | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Item not found.' });
      return;
    }

    const body = req.body ?? {};
    const itemName =
      typeof body.itemName === 'string' && body.itemName.trim()
        ? body.itemName.trim()
        : String(existing.item_name);
    const questionTitle =
      typeof body.questionTitle === 'string' && body.questionTitle.trim()
        ? body.questionTitle.trim()
        : String(existing.question_title);
    const questionDescription =
      typeof body.questionDescription === 'string'
        ? body.questionDescription.trim()
        : String(existing.question_description);
    const category =
      typeof body.category === 'string' && body.category.trim()
        ? body.category.trim()
        : String(existing.category);
    const imageOrEmoji =
      typeof body.imageOrEmoji === 'string' && body.imageOrEmoji.trim()
        ? body.imageOrEmoji.trim().slice(0, 200)
        : String(existing.image_or_emoji);
    const difficulty =
      body.difficulty !== undefined
        ? ['Easy', 'Medium', 'Hard', 'Expert'].includes(String(body.difficulty))
          ? String(body.difficulty)
          : ''
        : String(existing.difficulty);
    const startingBid =
      body.startingBid !== undefined
        ? Math.max(1, Math.trunc(Number(body.startingBid)))
        : Number(existing.starting_bid);

    const auctionDurationOverride =
      body.auctionDurationOverride === null || body.auctionDurationOverride === ''
        ? null
        : body.auctionDurationOverride !== undefined
          ? Math.min(600, Math.max(5, Math.trunc(Number(body.auctionDurationOverride))))
          : (existing.auction_duration_override as number | null);

    const answerDurationOverride =
      body.answerDurationOverride === null || body.answerDurationOverride === ''
        ? null
        : body.answerDurationOverride !== undefined
          ? Math.min(300, Math.max(5, Math.trunc(Number(body.answerDurationOverride))))
          : (existing.answer_duration_override as number | null);

    db.prepare(
      `UPDATE auction_items
       SET item_name = ?, question_title = ?, question_description = ?, category = ?,
           image_or_emoji = ?, difficulty = ?, starting_bid = ?,
           auction_duration_override = ?, answer_duration_override = ?
       WHERE id = ? AND room_id = ?`,
    ).run(
      itemName,
      questionTitle,
      questionDescription,
      category,
      imageOrEmoji,
      difficulty,
      startingBid,
      auctionDurationOverride,
      answerDurationOverride,
      itemId,
      roomId,
    );

    broadcastRoomState(roomId);
    res.json(getHostSnapshot(roomId));
  },
);

app.delete(
  '/api/host/rooms/:roomId/items/:itemId',
  requireHost,
  (req: AuthenticatedRequest, res) => {
    const roomId = String(req.params.roomId);
    const itemId = String(req.params.itemId);
    if (!getOwnedRoom(roomId, req.hostUser!.id)) {
      res.status(404).json({ error: 'Room not found or unauthorized.' });
      return;
    }
    db.prepare('DELETE FROM auction_items WHERE id = ? AND room_id = ?').run(itemId, roomId);
    broadcastRoomState(roomId);
    res.json(getHostSnapshot(roomId));
  },
);

app.post(
  '/api/host/rooms/:roomId/items/:itemId/duplicate',
  requireHost,
  (req: AuthenticatedRequest, res) => {
    const roomId = String(req.params.roomId);
    const itemId = String(req.params.itemId);
    if (!getOwnedRoom(roomId, req.hostUser!.id)) {
      res.status(404).json({ error: 'Room not found or unauthorized.' });
      return;
    }
    const existing = db
      .prepare('SELECT * FROM auction_items WHERE id = ? AND room_id = ?')
      .get(itemId, roomId) as Record<string, unknown> | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Item not found.' });
      return;
    }
    const maxSortRow = db
      .prepare('SELECT COALESCE(MAX(sort_order), -1) as max_sort FROM auction_items WHERE room_id = ?')
      .get(roomId) as { max_sort: number };

    db.prepare(
      `INSERT INTO auction_items (
        id, room_id, sort_order, item_name, question_title, question_description,
        category, image_or_emoji, difficulty, starting_bid,
        auction_duration_override, answer_duration_override, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)`,
    ).run(
      crypto.randomUUID(),
      roomId,
      Number(maxSortRow.max_sort) + 1,
      `${existing.item_name} (Copy)`,
      existing.question_title,
      existing.question_description,
      existing.category,
      existing.image_or_emoji,
      existing.difficulty,
      existing.starting_bid,
      existing.auction_duration_override,
      existing.answer_duration_override,
      Date.now(),
    );

    broadcastRoomState(roomId);
    res.json(getHostSnapshot(roomId));
  },
);

app.post(
  '/api/host/rooms/:roomId/items/reorder',
  requireHost,
  (req: AuthenticatedRequest, res) => {
    const roomId = String(req.params.roomId);
    if (!getOwnedRoom(roomId, req.hostUser!.id)) {
      res.status(404).json({ error: 'Room not found or unauthorized.' });
      return;
    }
    const itemIds = req.body?.itemIds;
    if (!Array.isArray(itemIds)) {
      res.status(400).json({ error: 'itemIds array is required.' });
      return;
    }

    db.transaction(() => {
      itemIds.forEach((id, idx) => {
        if (typeof id === 'string') {
          db.prepare('UPDATE auction_items SET sort_order = ? WHERE id = ? AND room_id = ?').run(
            idx,
            id,
            roomId,
          );
        }
      });
    })();

    broadcastRoomState(roomId);
    res.json(getHostSnapshot(roomId));
  },
);

app.post(
  '/api/host/rooms/:roomId/items/randomize',
  requireHost,
  (req: AuthenticatedRequest, res) => {
    const roomId = String(req.params.roomId);
    if (!getOwnedRoom(roomId, req.hostUser!.id)) {
      res.status(404).json({ error: 'Room not found or unauthorized.' });
      return;
    }

    const rows = db
      .prepare('SELECT id, status FROM auction_items WHERE room_id = ? ORDER BY sort_order ASC')
      .all(roomId) as { id: string; status: string }[];

    const nonPending = rows.filter((r) => r.status !== 'PENDING');
    const pending = rows.filter((r) => r.status === 'PENDING');
    for (let i = pending.length - 1; i > 0; i--) {
      const j = crypto.randomInt(0, i + 1);
      [pending[i], pending[j]] = [pending[j], pending[i]];
    }

    const merged = [...nonPending, ...pending];
    db.transaction(() => {
      merged.forEach((r, idx) => {
        db.prepare('UPDATE auction_items SET sort_order = ? WHERE id = ? AND room_id = ?').run(
          idx,
          r.id,
          roomId,
        );
      });
    })();

    broadcastRoomState(roomId);
    res.json(getHostSnapshot(roomId));
  },
);

app.post(
  '/api/host/rooms/:roomId/items/import-csv',
  requireHost,
  (req: AuthenticatedRequest, res) => {
    const roomId = String(req.params.roomId);
    const room = getOwnedRoom(roomId, req.hostUser!.id);
    if (!room) {
      res.status(404).json({ error: 'Room not found or unauthorized.' });
      return;
    }
    const csvText = typeof req.body?.csv === 'string' ? req.body.csv : '';
    if (!csvText.trim()) {
      res.status(400).json({ error: 'CSV content is empty.' });
      return;
    }

    const rows = parseCsvLines(csvText);
    if (rows.length < 2) {
      res.status(400).json({
        error:
          'CSV must contain a header row and at least one item row (itemName,questionTitle,questionDescription,category,imageOrEmoji,difficulty,startingBid).',
      });
      return;
    }

    const header = rows[0].map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
    const findCol = (candidates: string[]): number =>
      header.findIndex((h) => candidates.includes(h));

    const idxName = findCol(['itemname', 'item', 'name']);
    const idxTitle = findCol(['questiontitle', 'title', 'question']);
    const idxDesc = findCol(['questiondescription', 'description', 'details', 'prompt']);
    const idxCat = findCol(['category', 'topic']);
    const idxEmoji = findCol(['imageoremoji', 'emoji', 'icon', 'image']);
    const idxDiff = findCol(['difficulty', 'level']);
    const idxBid = findCol(['startingbid', 'minbid', 'bid']);

    if (idxName === -1 || idxTitle === -1) {
      res.status(400).json({
        error: 'CSV header must include itemName and questionTitle columns.',
      });
      return;
    }

    const maxSortRow = db
      .prepare('SELECT COALESCE(MAX(sort_order), -1) as max_sort FROM auction_items WHERE room_id = ?')
      .get(roomId) as { max_sort: number };
    let nextOrder = Number(maxSortRow.max_sort) + 1;
    let imported = 0;

    db.transaction(() => {
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const itemName = (r[idxName] || '').trim();
        const questionTitle = (r[idxTitle] || '').trim();
        if (!itemName || !questionTitle) continue;
        const questionDescription = idxDesc >= 0 ? (r[idxDesc] || '').trim() : '';
        const category = idxCat >= 0 && r[idxCat] ? r[idxCat].trim() : 'General Tech';
        const imageOrEmoji = idxEmoji >= 0 && r[idxEmoji] ? r[idxEmoji].trim() : '💻';
        const rawDiff = idxDiff >= 0 ? (r[idxDiff] || '').trim() : '';
        const difficulty = ['Easy', 'Medium', 'Hard', 'Expert'].includes(rawDiff) ? rawDiff : '';
        const parsedBid = idxBid >= 0 ? Math.trunc(Number(r[idxBid])) : Number(room.min_starting_bid);
        const startingBid = Number.isFinite(parsedBid) && parsedBid > 0 ? parsedBid : 10;

        db.prepare(
          `INSERT INTO auction_items (
            id, room_id, sort_order, item_name, question_title, question_description,
            category, image_or_emoji, difficulty, starting_bid,
            auction_duration_override, answer_duration_override, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'PENDING', ?)`,
        ).run(
          crypto.randomUUID(),
          roomId,
          nextOrder++,
          itemName,
          questionTitle,
          questionDescription,
          category,
          imageOrEmoji,
          difficulty,
          startingBid,
          Date.now(),
        );
        imported++;
      }
    })();

    broadcastRoomState(roomId);
    res.json({ imported, snapshot: getHostSnapshot(roomId) });
  },
);

app.get(
  '/api/host/rooms/:roomId/items/export-csv',
  requireHost,
  (req: AuthenticatedRequest, res) => {
    const roomId = String(req.params.roomId);
    if (!getOwnedRoom(roomId, req.hostUser!.id)) {
      res.status(404).json({ error: 'Room not found or unauthorized.' });
      return;
    }
    const items = db
      .prepare('SELECT * FROM auction_items WHERE room_id = ? ORDER BY sort_order ASC')
      .all(roomId) as Record<string, unknown>[];

    const lines = [
      'itemName,questionTitle,questionDescription,category,imageOrEmoji,difficulty,startingBid,auctionDurationOverride,answerDurationOverride',
    ];
    for (const item of items) {
      lines.push(
        [
          escapeCsvCell(item.item_name),
          escapeCsvCell(item.question_title),
          escapeCsvCell(item.question_description),
          escapeCsvCell(item.category),
          escapeCsvCell(item.image_or_emoji),
          escapeCsvCell(item.difficulty),
          escapeCsvCell(item.starting_bid),
          escapeCsvCell(item.auction_duration_override),
          escapeCsvCell(item.answer_duration_override),
        ].join(','),
      );
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="auction_items_${roomId}.csv"`);
    res.send(lines.join('\n'));
  },
);

// Question Bank Routes
app.get('/api/host/question-bank', requireHost, (req: AuthenticatedRequest, res) => {
  const rows = db
    .prepare('SELECT * FROM question_bank WHERE host_id = ? ORDER BY created_at DESC')
    .all(req.hostUser!.id) as Record<string, unknown>[];
  res.json({ items: rows.map(mapQuestionBankRow) });
});

app.post('/api/host/question-bank', requireHost, (req: AuthenticatedRequest, res) => {
  const body = req.body ?? {};
  const itemName = typeof body.itemName === 'string' ? body.itemName.trim() : '';
  const questionTitle = typeof body.questionTitle === 'string' ? body.questionTitle.trim() : '';
  if (!itemName || !questionTitle) {
    res.status(400).json({ error: 'Item name and question title are required.' });
    return;
  }

  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO question_bank (
      id, host_id, item_name, question_title, question_description, category,
      image_or_emoji, difficulty, starting_bid, auction_duration_override,
      answer_duration_override, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    req.hostUser!.id,
    itemName,
    questionTitle,
    typeof body.questionDescription === 'string' ? body.questionDescription.trim() : '',
    typeof body.category === 'string' && body.category.trim() ? body.category.trim() : 'General Tech',
    typeof body.imageOrEmoji === 'string' && body.imageOrEmoji.trim()
      ? body.imageOrEmoji.trim()
      : '💻',
    ['Easy', 'Medium', 'Hard', 'Expert'].includes(String(body.difficulty))
      ? String(body.difficulty)
      : '',
    Math.max(1, Math.trunc(Number(body.startingBid ?? 10))),
    body.auctionDurationOverride ? Math.trunc(Number(body.auctionDurationOverride)) : null,
    body.answerDurationOverride ? Math.trunc(Number(body.answerDurationOverride)) : null,
    Date.now(),
  );

  const rows = db
    .prepare('SELECT * FROM question_bank WHERE host_id = ? ORDER BY created_at DESC')
    .all(req.hostUser!.id) as Record<string, unknown>[];
  res.status(201).json({ items: rows.map(mapQuestionBankRow) });
});

app.post(
  '/api/host/rooms/:roomId/items/from-bank',
  requireHost,
  (req: AuthenticatedRequest, res) => {
    const roomId = String(req.params.roomId);
    if (!getOwnedRoom(roomId, req.hostUser!.id)) {
      res.status(404).json({ error: 'Room not found or unauthorized.' });
      return;
    }
    const bankIds = Array.isArray(req.body?.bankIds) ? req.body.bankIds : [];
    if (bankIds.length === 0) {
      res.status(400).json({ error: 'Select at least one item from the question bank.' });
      return;
    }

    const maxSortRow = db
      .prepare('SELECT COALESCE(MAX(sort_order), -1) as max_sort FROM auction_items WHERE room_id = ?')
      .get(roomId) as { max_sort: number };
    let nextOrder = Number(maxSortRow.max_sort) + 1;

    db.transaction(() => {
      for (const bid of bankIds) {
        if (typeof bid !== 'string') continue;
        const row = db
          .prepare('SELECT * FROM question_bank WHERE id = ? AND host_id = ?')
          .get(bid, req.hostUser!.id) as Record<string, unknown> | undefined;
        if (!row) continue;

        db.prepare(
          `INSERT INTO auction_items (
            id, room_id, sort_order, item_name, question_title, question_description,
            category, image_or_emoji, difficulty, starting_bid,
            auction_duration_override, answer_duration_override, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)`,
        ).run(
          crypto.randomUUID(),
          roomId,
          nextOrder++,
          row.item_name,
          row.question_title,
          row.question_description,
          row.category,
          row.image_or_emoji,
          row.difficulty,
          row.starting_bid,
          row.auction_duration_override,
          row.answer_duration_override,
          Date.now(),
        );
      }
    })();

    broadcastRoomState(roomId);
    res.json(getHostSnapshot(roomId));
  },
);

app.delete(
  '/api/host/question-bank/:bankId',
  requireHost,
  (req: AuthenticatedRequest, res) => {
    const bankId = String(req.params.bankId);
    db.prepare('DELETE FROM question_bank WHERE id = ? AND host_id = ?').run(
      bankId,
      req.hostUser!.id,
    );
    res.json({ ok: true });
  },
);

// ==========================================
// HOST LIVE AUCTION & EVALUATION CONTROLS
// ==========================================
app.post(
  '/api/host/rooms/:roomId/auction/start',
  requireHost,
  (req: AuthenticatedRequest, res) => {
    const roomId = String(req.params.roomId);
    const out = startAuctionForCurrentItem(roomId, req.hostUser!.id);
    if (!out.ok) {
      res.status(400).json({ error: out.error });
      return;
    }
    res.json(getHostSnapshot(roomId));
  },
);

app.post(
  '/api/host/rooms/:roomId/auction/pause',
  requireHost,
  (req: AuthenticatedRequest, res) => {
    const roomId = String(req.params.roomId);
    const out = pauseCurrentSession(roomId, req.hostUser!.id);
    if (!out.ok) {
      res.status(400).json({ error: out.error });
      return;
    }
    res.json(getHostSnapshot(roomId));
  },
);

app.post(
  '/api/host/rooms/:roomId/auction/resume',
  requireHost,
  (req: AuthenticatedRequest, res) => {
    const roomId = String(req.params.roomId);
    const out = resumeCurrentSession(roomId, req.hostUser!.id);
    if (!out.ok) {
      res.status(400).json({ error: out.error });
      return;
    }
    res.json(getHostSnapshot(roomId));
  },
);

app.post(
  '/api/host/rooms/:roomId/auction/end',
  requireHost,
  (req: AuthenticatedRequest, res) => {
    const roomId = String(req.params.roomId);
    const out = endAuctionEarly(roomId, req.hostUser!.id);
    if (!out.ok) {
      res.status(400).json({ error: out.error });
      return;
    }
    res.json(getHostSnapshot(roomId));
  },
);

app.post(
  '/api/host/rooms/:roomId/auction/restart',
  requireHost,
  (req: AuthenticatedRequest, res) => {
    const roomId = String(req.params.roomId);
    const out = restartClosedAuction(roomId, req.hostUser!.id);
    if (!out.ok) {
      res.status(400).json({ error: out.error });
      return;
    }
    res.json(getHostSnapshot(roomId));
  },
);

app.post(
  '/api/host/rooms/:roomId/answer/start',
  requireHost,
  (req: AuthenticatedRequest, res) => {
    const roomId = String(req.params.roomId);
    const out = startAnswerTimer(roomId, req.hostUser!.id);
    if (!out.ok) {
      res.status(400).json({ error: out.error });
      return;
    }
    res.json(getHostSnapshot(roomId));
  },
);

app.post(
  '/api/host/rooms/:roomId/answer/evaluate',
  requireHost,
  (req: AuthenticatedRequest, res) => {
    const roomId = String(req.params.roomId);
    const decision = req.body?.decision;
    if (!['CORRECT', 'WRONG', 'SKIPPED'].includes(decision)) {
      res.status(400).json({ error: 'Decision must be CORRECT, WRONG, or SKIPPED.' });
      return;
    }
    const out = evaluateAnswerDecision(roomId, req.hostUser!.id, decision);
    if (!out.ok) {
      res.status(400).json({ error: out.error });
      return;
    }
    res.json({ ...getHostSnapshot(roomId), alreadyEvaluated: Boolean(out.alreadyEvaluated) });
  },
);

app.post(
  '/api/host/rooms/:roomId/auction/next',
  requireHost,
  (req: AuthenticatedRequest, res) => {
    const roomId = String(req.params.roomId);
    const out = advanceToNextItem(roomId, req.hostUser!.id);
    if (!out.ok) {
      res.status(400).json({ error: out.error });
      return;
    }
    res.json(getHostSnapshot(roomId));
  },
);

app.post(
  '/api/host/rooms/:roomId/teams/:teamId/adjust-score',
  requireHost,
  (req: AuthenticatedRequest, res) => {
    const roomId = String(req.params.roomId);
    const teamId = String(req.params.teamId);
    const amount = Math.trunc(Number(req.body?.amount));
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : '';
    const out = manualAdjustTeamScore(roomId, req.hostUser!.id, teamId, amount, reason);
    if (!out.ok) {
      res.status(400).json({ error: out.error });
      return;
    }
    res.json(getHostSnapshot(roomId));
  },
);

app.delete(
  '/api/host/rooms/:roomId/teams/:teamId',
  requireHost,
  (req: AuthenticatedRequest, res) => {
    const roomId = String(req.params.roomId);
    const teamId = String(req.params.teamId);
    if (!getOwnedRoom(roomId, req.hostUser!.id)) {
      res.status(404).json({ error: 'Room not found or unauthorized.' });
      return;
    }
    db.prepare(
      `UPDATE teams SET participation_status = 'REMOVED', connection_status = 'OFFLINE' WHERE id = ? AND room_id = ?`,
    ).run(teamId, roomId);
    broadcastRoomState(roomId);
    if (ioInstanceRef) {
      ioInstanceRef.to(`team:${teamId}`).emit('team:removed', {
        message: 'Your team has been removed from the room by the host.',
      });
    }
    res.json(getHostSnapshot(roomId));
  },
);

// CSV Exports for Results & History
app.get(
  '/api/host/rooms/:roomId/export/results-csv',
  requireHost,
  (req: AuthenticatedRequest, res) => {
    const roomId = String(req.params.roomId);
    if (!getOwnedRoom(roomId, req.hostUser!.id)) {
      res.status(404).json({ error: 'Room not found or unauthorized.' });
      return;
    }
    const snap = getHostSnapshot(roomId)!;
    const lines = [
      'Rank,TeamName,PointsCoins,CorrectAnswers,WrongAnswers,AnswerSessions,TotalResponseTimeMs,TotalResponseTimeSec',
    ];
    for (const row of snap.leaderboard) {
      lines.push(
        [
          escapeCsvCell(row.rank),
          escapeCsvCell(row.teamName),
          escapeCsvCell(row.balance),
          escapeCsvCell(row.correctCount),
          escapeCsvCell(row.wrongCount),
          escapeCsvCell(row.answerSessionsCount),
          escapeCsvCell(row.totalResponseTimeMs),
          escapeCsvCell((row.totalResponseTimeMs / 1000).toFixed(3)),
        ].join(','),
      );
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="tech_auction_results_${snap.room.roomCode}.csv"`,
    );
    res.send(lines.join('\n'));
  },
);

app.get(
  '/api/host/rooms/:roomId/export/history-csv',
  requireHost,
  (req: AuthenticatedRequest, res) => {
    const roomId = String(req.params.roomId);
    if (!getOwnedRoom(roomId, req.hostUser!.id)) {
      res.status(404).json({ error: 'Room not found or unauthorized.' });
      return;
    }
    const snap = getHostSnapshot(roomId)!;
    const lines = [
      'Timestamp,RoomCode,ItemName,QuestionTitle,WinningTeam,FinalBid,HostDecision,ResponseTimeMs,PointsChange,FinalBalance',
    ];
    for (const h of snap.history) {
      lines.push(
        [
          escapeCsvCell(new Date(h.timestamp).toISOString()),
          escapeCsvCell(snap.room.roomCode),
          escapeCsvCell(h.itemName),
          escapeCsvCell(h.questionTitle),
          escapeCsvCell(h.winningTeamName || 'No Bids'),
          escapeCsvCell(h.finalBid),
          escapeCsvCell(h.hostDecision),
          escapeCsvCell(h.responseTimeMs ?? ''),
          escapeCsvCell(h.pointsChange),
          escapeCsvCell(h.finalBalance ?? ''),
        ].join(','),
      );
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="tech_auction_history_${snap.room.roomCode}.csv"`,
    );
    res.send(lines.join('\n'));
  },
);

// ==========================================
// TEAM JOIN, RECONNECTION & BIDDING ROUTES
// ==========================================
app.post('/api/rooms/join', joinLimiter, (req, res) => {
  const body = req.body ?? {};
  const rawCode = typeof body.roomCode === 'string' ? body.roomCode.trim().toUpperCase() : '';
  const rawTeamName = typeof body.teamName === 'string' ? body.teamName.trim() : '';
  const rawRoomPin = typeof body.roomPin === 'string' ? body.roomPin.trim() : '';
  const rawTeamPin = typeof body.teamPin === 'string' ? body.teamPin.trim() : '';

  if (!rawCode || rawCode.length < 4) {
    res.status(400).json({ error: 'Please enter a valid room code.' });
    return;
  }
  if (rawTeamName.length < 2 || rawTeamName.length > 40) {
    res.status(400).json({ error: 'Team name must be between 2 and 40 characters.' });
    return;
  }

  const room = db.prepare('SELECT * FROM rooms WHERE room_code = ?').get(rawCode) as
    | Record<string, unknown>
    | undefined;
  if (!room) {
    res.status(404).json({ error: 'Room not found. Check the room code and try again.' });
    return;
  }
  if (room.machine_state === 'ROOM_COMPLETED') {
    res.status(403).json({ error: 'This auction room has already completed.' });
    return;
  }
  if (Number(room.is_active) !== 1) {
    res.status(403).json({ error: 'This room is currently inactive.' });
    return;
  }

  if (Number(room.has_pin) === 1 && room.room_pin_hash) {
    if (!rawRoomPin || !verifySecret(rawRoomPin, String(room.room_pin_hash))) {
      res.status(401).json({ error: 'Incorrect room PIN.' });
      return;
    }
  }

  const roomId = String(room.id);
  const existingTeam = db
    .prepare(
      `SELECT * FROM teams WHERE room_id = ? AND LOWER(team_name) = LOWER(?) AND participation_status = 'ACTIVE'`,
    )
    .get(roomId, rawTeamName) as Record<string, unknown> | undefined;

  // Check if client already holds a valid session cookie for this exact team
  const currentCookieTeam = getTeamFromRequest(req);
  if (existingTeam) {
    const cookieMatches =
      currentCookieTeam &&
      currentCookieTeam.roomId === roomId &&
      currentCookieTeam.teamId === String(existingTeam.id);

    const pinMatches =
      Boolean(rawTeamPin) &&
      Boolean(existingTeam.team_pin_hash) &&
      verifySecret(rawTeamPin, String(existingTeam.team_pin_hash));

    if (!cookieMatches && !pinMatches) {
      res.status(409).json({
        error: existingTeam.team_pin_hash
          ? 'Duplicate team name. This name is taken — enter your Team Passcode to reconnect.'
          : 'Duplicate team name. Please choose a different team name.',
      });
      return;
    }

    const teamId = String(existingTeam.id);
    db.prepare(`UPDATE teams SET connection_status = 'ONLINE', last_seen_at = ? WHERE id = ?`).run(
      Date.now(),
      teamId,
    );

    const token = signToken({
      type: 'team',
      teamId,
      roomId,
      roomCode: String(room.room_code),
      teamName: String(existingTeam.team_name),
      exp: Date.now() + 1000 * 60 * 60 * 24,
    });
    setSessionCookie(req, res, TEAM_COOKIE_NAME, token);
    broadcastRoomState(roomId);
    res.json({ snapshot: getTeamSnapshot(roomId, teamId), token, reconnected: true });
    return;
  }

  // Enforce room capacity atomically
  const joinOutcome = db.transaction((): { ok: boolean; error?: string; teamId?: string } => {
    const countRow = db
      .prepare(
        `SELECT COUNT(*) as cnt FROM teams WHERE room_id = ? AND participation_status = 'ACTIVE'`,
      )
      .get(roomId) as { cnt: number };

    if (Number(countRow.cnt) >= Number(room.max_teams)) {
      return { ok: false, error: 'Room full. Maximum team capacity has been reached.' };
    }

    const teamId = crypto.randomUUID();
    const now = Date.now();
    const teamPinHash = rawTeamPin ? hashSecret(rawTeamPin) : null;

    db.prepare(
      `INSERT INTO teams (
        id, room_id, team_name, team_pin_hash, balance, correct_count, wrong_count,
        answer_sessions_count, total_response_time_ms, connection_status,
        participation_status, joined_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, 'ONLINE', 'ACTIVE', ?, ?)`,
    ).run(teamId, roomId, rawTeamName, teamPinHash, Number(room.starting_coins), now, now);

    return { ok: true, teamId };
  })();

  if (!joinOutcome.ok || !joinOutcome.teamId) {
    res.status(403).json({ error: joinOutcome.error || 'Unable to join room.' });
    return;
  }

  const token = signToken({
    type: 'team',
    teamId: joinOutcome.teamId,
    roomId,
    roomCode: String(room.room_code),
    teamName: rawTeamName,
    exp: Date.now() + 1000 * 60 * 60 * 24,
  });

  setSessionCookie(req, res, TEAM_COOKIE_NAME, token);
  broadcastRoomState(roomId);
  res.status(201).json({
    snapshot: getTeamSnapshot(roomId, joinOutcome.teamId),
    token,
    reconnected: false,
  });
});

app.post('/api/rooms/leave', (req, res) => {
  clearSessionCookie(req, res, TEAM_COOKIE_NAME);
  res.json({ ok: true });
});

app.get('/api/team/me', requireTeam, (req: AuthenticatedRequest, res) => {
  const session = req.teamSession!;
  const snap = getTeamSnapshot(session.roomId, session.teamId);
  if (!snap) {
    clearSessionCookie(req, res, TEAM_COOKIE_NAME);
    res.status(404).json({ error: 'Team session no longer active.' });
    return;
  }
  const token = signToken({
    type: 'team',
    teamId: session.teamId,
    roomId: session.roomId,
    roomCode: session.roomCode,
    teamName: snap.selfTeam.teamName,
    exp: Date.now() + 1000 * 60 * 60 * 24,
  });
  res.json({ snapshot: snap, token });
});

app.post('/api/team/bid', requireTeam, bidLimiter, (req: AuthenticatedRequest, res) => {
  const session = req.teamSession!;
  const { amount, clientRequestId } = req.body ?? {};
  const result = processAtomicBid(session.roomId, session.teamId, amount, clientRequestId);
  if (!result.ok) {
    res.status(400).json(result);
    return;
  }
  res.json(result);
});

// ==========================================
// PUBLIC / AUDIENCE DISPLAY ROUTES
// ==========================================
app.get('/api/public/rooms/:roomCode', (req, res) => {
  const roomCode = String(req.params.roomCode || '').trim().toUpperCase();
  const row = db.prepare('SELECT id FROM rooms WHERE room_code = ?').get(roomCode) as
    | { id: string }
    | undefined;
  if (!row) {
    res.status(404).json({ error: 'Room not found. Verify the room code.' });
    return;
  }
  const snap = getPublicSnapshot(row.id);
  if (!snap) {
    res.status(404).json({ error: 'Room not found.' });
    return;
  }
  res.json(snap);
});

// ==========================================
// HTTP + SOCKET.IO SERVER SETUP
// ==========================================
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  pingInterval: 15000,
  pingTimeout: 10000,
  transports: ['websocket', 'polling'],
});
const ioInstanceRef = io;
setSocketServer(io);

// Track active WebSocket connections per team so multi-device teams stay ONLINE cleanly
const teamSocketCounts = new Map<string, number>();

io.on('connection', (socket) => {
  const cookies = parseCookies(socket.handshake.headers.cookie);
  const auth = (socket.handshake.auth || {}) as {
    token?: string;
    role?: string;
    roomCode?: string;
    roomId?: string;
  };

  let boundTeam: TeamTokenPayload | null = null;

  socket.on(
    'subscribe:host',
    (
      payload: { roomId?: string; token?: string },
      ack?: (res: { ok: boolean; error?: string }) => void,
    ) => {
      const token = payload?.token || auth.token || cookies[HOST_COOKIE_NAME];
      const hostPayload = verifyToken<HostTokenPayload>(token, 'host');
      if (!hostPayload || !payload?.roomId) {
        ack?.({ ok: false, error: 'Unauthorized host socket.' });
        return;
      }
      const room = getOwnedRoom(payload.roomId, hostPayload.userId);
      if (!room) {
        ack?.({ ok: false, error: 'Room not found or unauthorized.' });
        return;
      }
      socket.join(`host:${payload.roomId}`);
      socket.join(`public:${payload.roomId}`);
      const snap = getHostSnapshot(payload.roomId);
      if (snap) socket.emit('host:state', snap);
      ack?.({ ok: true });
    },
  );

  socket.on(
    'subscribe:team',
    (
      payload: { token?: string },
      ack?: (res: { ok: boolean; error?: string }) => void,
    ) => {
      const token = payload?.token || auth.token || cookies[TEAM_COOKIE_NAME];
      const teamPayload = verifyToken<TeamTokenPayload>(token, 'team');
      if (!teamPayload) {
        ack?.({ ok: false, error: 'Invalid team session.' });
        return;
      }
      const row = db
        .prepare(
          `SELECT id FROM teams WHERE id = ? AND room_id = ? AND participation_status = 'ACTIVE'`,
        )
        .get(teamPayload.teamId, teamPayload.roomId);
      if (!row) {
        ack?.({ ok: false, error: 'Team is no longer active in this room.' });
        return;
      }

      if (boundTeam && boundTeam.teamId !== teamPayload.teamId) {
        const prevCount = Math.max(0, (teamSocketCounts.get(boundTeam.teamId) || 1) - 1);
        teamSocketCounts.set(boundTeam.teamId, prevCount);
      }

      boundTeam = teamPayload;
      const nextCount = (teamSocketCounts.get(teamPayload.teamId) || 0) + 1;
      teamSocketCounts.set(teamPayload.teamId, nextCount);

      db.prepare(`UPDATE teams SET connection_status = 'ONLINE', last_seen_at = ? WHERE id = ?`).run(
        Date.now(),
        teamPayload.teamId,
      );

      socket.join(`team:${teamPayload.teamId}`);
      socket.join(`public:${teamPayload.roomId}`);

      const snap = getTeamSnapshot(teamPayload.roomId, teamPayload.teamId);
      if (snap) socket.emit('team:state', snap);
      broadcastRoomState(teamPayload.roomId);
      ack?.({ ok: true });
    },
  );

  socket.on(
    'team:place_bid',
    (
      payload: { amount?: number; clientRequestId?: string; token?: string },
      ack?: (res: unknown) => void,
    ) => {
      const token = payload?.token || auth.token || cookies[TEAM_COOKIE_NAME];
      const teamPayload = boundTeam || verifyToken<TeamTokenPayload>(token, 'team');
      if (!teamPayload) {
        ack?.({ ok: false, code: 'TEAM_NOT_FOUND', message: 'Valid team session required.' });
        return;
      }
      const result = processAtomicBid(
        teamPayload.roomId,
        teamPayload.teamId,
        payload?.amount,
        payload?.clientRequestId,
      );
      ack?.(result);
    },
  );

  socket.on(
    'subscribe:public',
    (
      payload: { roomCode?: string },
      ack?: (res: { ok: boolean; error?: string }) => void,
    ) => {
      const code = typeof payload?.roomCode === 'string' ? payload.roomCode.trim().toUpperCase() : '';
      if (!code) {
        ack?.({ ok: false, error: 'Room code is required.' });
        return;
      }
      const row = db.prepare('SELECT id FROM rooms WHERE room_code = ?').get(code) as
        | { id: string }
        | undefined;
      if (!row) {
        ack?.({ ok: false, error: 'Room not found.' });
        return;
      }
      socket.join(`public:${row.id}`);
      const snap = getPublicSnapshot(row.id);
      if (snap) socket.emit('room:state', snap);
      ack?.({ ok: true });
    },
  );

  socket.on('disconnect', () => {
    if (boundTeam) {
      const nextCount = Math.max(0, (teamSocketCounts.get(boundTeam.teamId) || 1) - 1);
      if (nextCount === 0) {
        teamSocketCounts.delete(boundTeam.teamId);
        db.prepare(
          `UPDATE teams SET connection_status = 'OFFLINE', last_seen_at = ? WHERE id = ?`,
        ).run(Date.now(), boundTeam.teamId);
        broadcastRoomState(boundTeam.roomId);
      } else {
        teamSocketCounts.set(boundTeam.teamId, nextCount);
      }
    }
  });
});

async function startServer(): Promise<void> {
  recoverActiveTimers();

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`TECH AUCTION 2026 server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
