# TECH AUCTION 2026 — Think. Bid. Conquer.

A real-time multiplayer technology auction competition platform built for live college technical events. Designed to support **16+ teams and 60+ simultaneously connected devices** across three synchronized interfaces: **Host Control Center**, **Mobile-First Team Dashboard**, and **Audience / Projector Display**.

---

## Key Features

- **Authoritative Real-Time Bidding Engine**: Socket.IO rooms + SQLite (`better-sqlite3`) WAL-mode serialized atomic transactions ensure only one valid bid wins any simultaneous tie, with monotonically increasing server sequence numbers and duplicate-request protection.
- **Synchronized Server Countdowns**: All devices compute countdowns from authoritative server deadlines and clock offsets—resilient to skewed phone clocks, browser refreshes, and temporary network dropouts.
- **Host-Controlled Verbal Answer Evaluation**: Custom auction items contain **no correct-answer field**. The host reads the technical question aloud, runs the configurable answer timer, and manually judges **Correct (+10)** or **Wrong (-10)** with idempotent double-click protection.
- **Unified Points & Virtual Coins**: One authoritative `balance` field per team (default `100`, clamped at `0`). Winning bids do not deduct balance unless explicitly enabled by the host.
- **Automated Response Time & Tie-Breaking**: Server timestamps measure response time in milliseconds from answer timer start to host decision. Standings rank by **Points DESC**, then **Total Response Time ASC**, sharing identical ranks on exact ties.
- **Complete Audit & CSV Exports**: Immutable bid history, score transactions, manual adjustment audit logs, reusable Question Bank, CSV item import/export, and final results/history CSV exports.

---

## Technology Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS v4, Lucide React
- **Backend**: Node.js, Express.js, Socket.IO
- **Database**: SQLite (`better-sqlite3` with WAL mode & foreign-key room isolation)
- **Authentication**: `scrypt` salted password/PIN hashing + HMAC-SHA256 signed `HttpOnly` session cookies and Bearer token support

---

## Environment Variables

Copy `.env.example` to `.env` if customizing deployment settings:

```env
PORT=3000
SESSION_SECRET=replace-with-a-random-64-char-secret
DB_PATH=./data/tech_auction.db
```

- `SESSION_SECRET`: Recommended for production so host/team sessions survive server restarts. In local development, an ephemeral in-memory secret is generated automatically if omitted.
- `DB_PATH`: Path to the SQLite database file (defaults to `./data/tech_auction.db`).

---

## Local Development & Running

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the full-stack server (Express + Socket.IO + Vite middleware on port 3000):
   ```bash
   npm run dev
   ```
3. Open `http://localhost:3000` in your browser.

---

## Production Build & Deployment

```bash
npm run build
NODE_ENV=production npm start
```

The production server serves the compiled `dist/` frontend, REST APIs, and Socket.IO WebSocket connections on `PORT` (default `3000`).

---

## Running Automated Functional & 60-Device Load Tests

With the server running on port 3000:

```bash
npx tsx tests/load_and_functional_test.ts
```

This exercises host authentication, room isolation, custom items without answer keys, 62 simultaneous WebSocket connections (60 teams + 1 host + 1 audience display), 60-way concurrent equal-bid atomic resolution, self-outbid/duplicate-request protection, idempotent scoring, response-time tie-breaking, balance clamping, and CSV export.
