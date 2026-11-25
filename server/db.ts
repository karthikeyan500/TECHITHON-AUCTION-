import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const configuredPath = process.env.DB_PATH?.trim();
const dbPath = configuredPath
  ? path.resolve(process.cwd(), configuredPath)
  : path.resolve(process.cwd(), 'data', 'tech_auction.db');

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);

// High-concurrency WAL settings for 60+ simultaneous connected clients
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'HOST',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    room_code TEXT NOT NULL UNIQUE COLLATE NOCASE,
    room_name TEXT NOT NULL,
    room_pin_hash TEXT,
    has_pin INTEGER NOT NULL DEFAULT 0,
    host_id TEXT NOT NULL,
    host_name TEXT NOT NULL,
    machine_state TEXT NOT NULL DEFAULT 'ROOM_WAITING',
    is_paused INTEGER NOT NULL DEFAULT 0,
    paused_from_state TEXT,
    paused_remaining_ms INTEGER,
    is_active INTEGER NOT NULL DEFAULT 1,
    max_teams INTEGER NOT NULL DEFAULT 32,
    starting_coins INTEGER NOT NULL DEFAULT 100,
    auction_duration_sec INTEGER NOT NULL DEFAULT 30,
    answer_duration_sec INTEGER NOT NULL DEFAULT 20,
    correct_points INTEGER NOT NULL DEFAULT 10,
    wrong_deduction INTEGER NOT NULL DEFAULT 10,
    min_starting_bid INTEGER NOT NULL DEFAULT 10,
    min_bid_increment INTEGER NOT NULL DEFAULT 5,
    deduct_winning_bid INTEGER NOT NULL DEFAULT 0,
    current_item_index INTEGER NOT NULL DEFAULT 0,
    current_auction_id TEXT,
    last_announcement TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (host_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    team_name TEXT NOT NULL,
    team_pin_hash TEXT,
    balance INTEGER NOT NULL DEFAULT 100,
    correct_count INTEGER NOT NULL DEFAULT 0,
    wrong_count INTEGER NOT NULL DEFAULT 0,
    answer_sessions_count INTEGER NOT NULL DEFAULT 0,
    total_response_time_ms INTEGER NOT NULL DEFAULT 0,
    connection_status TEXT NOT NULL DEFAULT 'ONLINE',
    participation_status TEXT NOT NULL DEFAULT 'ACTIVE',
    joined_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_room_name_active
    ON teams(room_id, LOWER(team_name))
    WHERE participation_status = 'ACTIVE';

  CREATE INDEX IF NOT EXISTS idx_teams_room_id ON teams(room_id);

  -- NOTE: Intentionally NO correct_answer column. Answers are physically judged by the host.
  CREATE TABLE IF NOT EXISTS auction_items (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    item_name TEXT NOT NULL,
    question_title TEXT NOT NULL,
    question_description TEXT NOT NULL,
    category TEXT NOT NULL,
    image_or_emoji TEXT NOT NULL DEFAULT '💻',
    difficulty TEXT NOT NULL DEFAULT '',
    starting_bid INTEGER NOT NULL DEFAULT 10,
    auction_duration_override INTEGER,
    answer_duration_override INTEGER,
    status TEXT NOT NULL DEFAULT 'PENDING',
    created_at INTEGER NOT NULL,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_items_room_order ON auction_items(room_id, sort_order);

  CREATE TABLE IF NOT EXISTS question_bank (
    id TEXT PRIMARY KEY,
    host_id TEXT NOT NULL,
    item_name TEXT NOT NULL,
    question_title TEXT NOT NULL,
    question_description TEXT NOT NULL,
    category TEXT NOT NULL,
    image_or_emoji TEXT NOT NULL DEFAULT '💻',
    difficulty TEXT NOT NULL DEFAULT '',
    starting_bid INTEGER NOT NULL DEFAULT 10,
    auction_duration_override INTEGER,
    answer_duration_override INTEGER,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (host_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_bank_host ON question_bank(host_id);

  CREATE TABLE IF NOT EXISTS auctions (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    auction_status TEXT NOT NULL,
    start_timestamp INTEGER NOT NULL,
    deadline_timestamp INTEGER NOT NULL,
    closed_timestamp INTEGER,
    highest_bid INTEGER NOT NULL DEFAULT 0,
    highest_bidder_team_id TEXT,
    highest_bidder_team_name TEXT,
    sequence_counter INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    FOREIGN KEY (item_id) REFERENCES auction_items(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_auctions_room ON auctions(room_id);

  CREATE TABLE IF NOT EXISTS bids (
    id TEXT PRIMARY KEY,
    auction_id TEXT NOT NULL,
    room_id TEXT NOT NULL,
    team_id TEXT NOT NULL,
    team_name TEXT NOT NULL,
    bid_amount INTEGER NOT NULL,
    server_timestamp INTEGER NOT NULL,
    sequence_number INTEGER NOT NULL,
    status TEXT NOT NULL,
    rejection_reason TEXT,
    client_request_id TEXT,
    FOREIGN KEY (auction_id) REFERENCES auctions(id) ON DELETE CASCADE,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_bids_dedup
    ON bids(auction_id, client_request_id)
    WHERE client_request_id IS NOT NULL;

  CREATE INDEX IF NOT EXISTS idx_bids_auction_seq ON bids(auction_id, sequence_number DESC);
  CREATE INDEX IF NOT EXISTS idx_bids_room ON bids(room_id);

  CREATE TABLE IF NOT EXISTS answer_sessions (
    id TEXT PRIMARY KEY,
    auction_id TEXT NOT NULL UNIQUE,
    room_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    winning_team_id TEXT NOT NULL,
    winning_team_name TEXT NOT NULL,
    answer_start_timestamp INTEGER,
    answer_deadline_timestamp INTEGER,
    answer_decision_timestamp INTEGER,
    response_time_ms INTEGER,
    host_decision TEXT NOT NULL DEFAULT 'PENDING',
    FOREIGN KEY (auction_id) REFERENCES auctions(id) ON DELETE CASCADE,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_answer_sessions_room ON answer_sessions(room_id);

  CREATE TABLE IF NOT EXISTS score_transactions (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    team_id TEXT NOT NULL,
    team_name TEXT NOT NULL,
    item_id TEXT,
    auction_id TEXT,
    previous_balance INTEGER NOT NULL,
    configured_change INTEGER NOT NULL,
    actual_change INTEGER NOT NULL,
    new_balance INTEGER NOT NULL,
    reason TEXT NOT NULL,
    decision_type TEXT NOT NULL,
    host_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_score_tx_room ON score_transactions(room_id, timestamp DESC);

  CREATE TABLE IF NOT EXISTS auction_history (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    room_name TEXT NOT NULL,
    item_id TEXT NOT NULL,
    item_name TEXT NOT NULL,
    question_title TEXT NOT NULL,
    auction_id TEXT NOT NULL,
    winning_team_id TEXT,
    winning_team_name TEXT,
    final_bid INTEGER NOT NULL DEFAULT 0,
    auction_start_timestamp INTEGER NOT NULL,
    auction_end_timestamp INTEGER,
    answer_start_timestamp INTEGER,
    host_decision TEXT NOT NULL,
    response_time_ms INTEGER,
    points_change INTEGER NOT NULL DEFAULT 0,
    final_balance INTEGER,
    timestamp INTEGER NOT NULL,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_history_room ON auction_history(room_id, timestamp DESC);
`);
