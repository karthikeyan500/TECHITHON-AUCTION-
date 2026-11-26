# TECH AUCTION 2026 — Security Specification (Phase 0 TDD)

## 1. Core Security & Integrity Invariants

1. **Host Ownership & Verified Google Auth**: Only a Google-authenticated user with `request.auth.token.email_verified == true` matching `room.hostId` can modify room configuration, manage auction items, read `host_prompts`, read `private/pin`, evaluate answers, adjust team balances, or delete the room.
2. **PII Isolation**: User email addresses and host profiles reside strictly in `/users/{userId}`, readable and writable only by `request.auth.uid == userId`.
3. **Host-Only Prompt Isolation**: Question titles and prompt descriptions reside in `/rooms/{roomId}/host_prompts/{itemId}`, strictly unreadable by teams and public viewers.
4. **Public Code Lookup Without Enumeration**: `/room_codes/{roomCode}` allows exact `get` lookups for valid alphanumeric codes (`^[A-Z0-9]{4,12}$`), while `allow list: if false;` prevents room scraping.
5. **PIN & Passcode Verification Without Secret Exposure**: Room PIN hashes (`/rooms/{roomId}/private/pin`) and team passcode/reconnect token hashes (`/rooms/{roomId}/team_auth/{teamId}`) are never readable by public clients; security rules validate hashes server-side via `get()`.
6. **Independent Coin & Point Economy Integrity**:
   - Newly joined teams MUST initialize strictly to `coinBalance == room.settings.startingCoins` and `points == room.settings.startingPoints`.
   - Teams can NEVER update their own `coinBalance`, `points`, `correctCount`, `wrongCount`, or `participationStatus`.
   - Bids MUST satisfy `bidAmount <= team.coinBalance`, `bidAmount >= minimumRequiredBid`, `auctionStatus == 'OPEN'`, `request.time <= auction.deadlineAt`, and `highestBidderTeamId != teamId`.
   - `transactions` and `bids` are append-only/immutable for non-hosts (and transactions are never deleted/edited except full room cleanup by the host).
7. **Terminal State Locking**: Once `room.machineState == 'ROOM_COMPLETED'`, no new teams can join and no bids or auctions can run.

## 2. "Dirty Dozen" Attack Payloads (Must Return PERMISSION_DENIED)

1. **Forged Starting Coins/Points on Join**: Unauthenticated client creates `/rooms/{roomId}/teams/{teamId}` with `coinBalance: 999999` or `points: 500` when `room.settings.startingCoins == 100`.
2. **Host Identity Spoofing**: User B (`uid_b`) creates `/rooms/{roomId}` with `hostId: 'uid_a'`.
3. **Unverified Email Host Write**: Authenticated token with `email_verified: false` tries to create `/rooms/{roomId}`.
4. **Self-Balance Escalation by Team**: Public client updates `/rooms/{roomId}/teams/{teamId}` with `{ coinBalance: 9000, points: 9000 }`.
5. **Over-Balance Bid**: Team with `coinBalance: 40` tries to place `bidAmount: 50` and update `auctions/{auctionId}`.
6. **Self-Outbidding / Low-Ball Bid**: Current `highestBidderTeamId` submits another bid, or submits `bidAmount < highestBid + minBidIncrement`.
7. **Expired Auction Bid**: Client submits a bid after `request.time > auction.deadlineAt` or when `room.isPaused == true`.
8. **Shadow Ghost Field Injection**: Client includes `{ isAdmin: true, role: 'HOST' }` inside `/users/{uid}` or `/rooms/{roomId}/teams/{teamId}`.
9. **Unauthorized Prompt Snooping**: Public client reads `/rooms/{roomId}/host_prompts/{itemId}` or `/rooms/{roomId}/private/pin`.
10. **Room Directory Scraping**: Unauthenticated client runs `list` on `/rooms` or `/room_codes`.
11. **Joined Without Valid PIN / Duplicate Name Bypass**: Client creates `/rooms/{roomId}/teams/{teamId}` on a PIN-locked room without `joinedPinHash` matching `private/pin`, or omits atomic `team_names/{nameSlug}` lock.
12. **Terminal Room Mutation**: Client attempts to join or place a bid after `room.machineState == 'ROOM_COMPLETED'`.
