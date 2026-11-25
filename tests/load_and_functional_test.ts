import assert from 'node:assert/strict';
import { io, type Socket } from 'socket.io-client';

const BASE_URL = process.env.TEST_URL || 'http://127.0.0.1:3000';

async function api(
  path: string,
  opts: { method?: string; token?: string; body?: unknown } = {},
): Promise<{ status: number; data: Record<string, unknown>; text: string }> {
  const headers: Record<string, string> = {
    'X-Requested-With': 'XMLHttpRequest',
  };
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (opts.token) {
    headers['Authorization'] = `Bearer ${opts.token}`;
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    method: opts.method || 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    data = {};
  }
  return { status: res.status, data, text };
}

function connectSocket(event: string, payload: Record<string, unknown>): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const sock = io(BASE_URL, {
      transports: ['websocket'],
      reconnection: false,
    });
    const timer = setTimeout(() => {
      sock.disconnect();
      reject(new Error(`Socket connect/subscribe timeout for ${event}`));
    }, 8000);

    sock.on('connect', () => {
      sock.emit(event, payload, (ack: { ok: boolean; error?: string }) => {
        clearTimeout(timer);
        if (ack?.ok) {
          resolve(sock);
        } else {
          sock.disconnect();
          reject(new Error(ack?.error || `Subscribe failed for ${event}`));
        }
      });
    });
    sock.on('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function runTests() {
  const runId = Date.now();
  console.log(`Running TECH AUCTION 2026 Functional + 60-Device Load Tests against ${BASE_URL}`);

  // 1. Health check
  const health = await api('/api/health');
  assert.equal(health.status, 200, 'Health endpoint should return 200');

  // 2. Host Registration & Login
  const host1Creds = {
    username: `host_a_${runId}`,
    displayName: 'Organizer Alpha',
    password: 'StrongPassword123!',
  };
  const reg1 = await api('/api/auth/register', { method: 'POST', body: host1Creds });
  assert.equal(reg1.status, 201, 'Host registration should succeed');
  const host1Token = String(reg1.data.token);

  const login1 = await api('/api/auth/login', {
    method: 'POST',
    body: { username: host1Creds.username, password: host1Creds.password },
  });
  assert.equal(login1.status, 200, 'Host login should succeed');

  const host2Reg = await api('/api/auth/register', {
    method: 'POST',
    body: {
      username: `host_b_${runId}`,
      displayName: 'Organizer Beta',
      password: 'StrongPassword123!',
    },
  });
  assert.equal(host2Reg.status, 201);
  const host2Token = String(host2Reg.data.token);

  // 3. Create Room + Room Isolation + Settings Edit
  const createRoomRes = await api('/api/host/rooms', {
    method: 'POST',
    token: host1Token,
    body: {
      roomName: `Load Test Arena ${runId}`,
      maxTeams: 65,
      startingCoins: 100,
      auctionDurationSec: 15,
      answerDurationSec: 10,
      correctPoints: 10,
      wrongDeduction: 10,
      minStartingBid: 10,
      minBidIncrement: 5,
      deductWinningBid: false,
    },
  });
  assert.equal(createRoomRes.status, 201);
  const room = createRoomRes.data.room as { id: string; roomCode: string };
  assert.equal(room.roomCode.length, 6);

  // Unauthorized host cannot access Host 1's room
  const unauthRoomAccess = await api(`/api/host/rooms/${room.id}`, { token: host2Token });
  assert.equal(unauthRoomAccess.status, 404, 'Host 2 must not access Host 1 room');

  // Room 2 for isolation check
  const room2Res = await api('/api/host/rooms', {
    method: 'POST',
    token: host2Token,
    body: { roomName: `Isolated Room ${runId}`, maxTeams: 20 },
  });
  assert.equal(room2Res.status, 201);

  // 4. Custom Items (No Correct Answer Field)
  const item1Res = await api(`/api/host/rooms/${room.id}/items`, {
    method: 'POST',
    token: host1Token,
    body: {
      itemName: 'RISC-V Vector Engine',
      questionTitle: 'Explain vector chaining in SIMD architectures.',
      questionDescription: 'Verbal explanation only.',
      category: 'Hardware',
      imageOrEmoji: '⚙️',
      difficulty: 'Medium',
      startingBid: 10,
    },
  });
  assert.equal(item1Res.status, 201);
  const items = item1Res.data.items as Array<{ id: string }>;
  assert.equal(items.length, 1);
  assert.equal('correctAnswer' in items[0], false, 'Must not contain correctAnswer field');

  // Add second and third items for tie-breaker & ranking tests
  await api(`/api/host/rooms/${room.id}/items`, {
    method: 'POST',
    token: host1Token,
    body: {
      itemName: 'Raft Consensus Module',
      questionTitle: 'Describe leader election term increments in Raft.',
      category: 'Distributed Systems',
      startingBid: 10,
    },
  });
  await api(`/api/host/rooms/${room.id}/items`, {
    method: 'POST',
    token: host1Token,
    body: {
      itemName: 'Zero-Knowledge SNARK',
      questionTitle: 'Contrast soundness and zero-knowledge properties.',
      category: 'Cryptography',
      startingBid: 10,
    },
  });

  // 5. Team Joining Validation
  const badJoin = await api('/api/rooms/join', {
    method: 'POST',
    body: { roomCode: 'ZZZZZZ', teamName: 'Ghost Team' },
  });
  assert.equal(badJoin.status, 404, 'Invalid room code must be rejected');

  // 6. Connect 60 simultaneous teams + 1 Host + 1 Audience Display = 62 concurrent Socket.IO clients
  console.log('Connecting 62 simultaneous WebSocket clients (60 teams + 1 host + 1 audience)...');
  const teamSessions: Array<{ teamId: string; teamName: string; token: string; socket: Socket }> = [];
  const connectLatencies: number[] = [];

  const joinPromises = Array.from({ length: 60 }, async (_, idx) => {
    const t0 = performance.now();
    const teamName = `Team_${String(idx + 1).padStart(2, '0')}`;
    const joinRes = await api('/api/rooms/join', {
      method: 'POST',
      body: { roomCode: room.roomCode, teamName, teamPin: 'pass123' },
    });
    assert.equal(joinRes.status, 201, `Join failed for ${teamName}: ${joinRes.text}`);
    const snap = joinRes.data.snapshot as { selfTeam: { id: string } };
    const token = String(joinRes.data.token);
    const sock = await connectSocket('subscribe:team', { token });
    connectLatencies.push(performance.now() - t0);
    teamSessions.push({ teamId: snap.selfTeam.id, teamName, token, socket: sock });
  });

  const hostSockPromise = connectSocket('subscribe:host', { roomId: room.id, token: host1Token });
  const audSockPromise = connectSocket('subscribe:public', { roomCode: room.roomCode });

  const [, hostSock, audSock] = await Promise.all([
    Promise.all(joinPromises),
    hostSockPromise,
    audSockPromise,
  ]);
  console.log(`Connected ${teamSessions.length + 2} WebSocket clients successfully.`);

  // Duplicate team name without matching passcode rejected
  const dupJoin = await api('/api/rooms/join', {
    method: 'POST',
    body: { roomCode: room.roomCode, teamName: 'Team_01' },
  });
  assert.equal(dupJoin.status, 409, 'Duplicate team name must be rejected');

  // Team reconnection with passcode succeeds without creating duplicate
  const rejoin = await api('/api/rooms/join', {
    method: 'POST',
    body: { roomCode: room.roomCode, teamName: 'Team_01', teamPin: 'pass123' },
  });
  assert.equal(rejoin.status, 200, 'Reconnecting with team passcode must succeed');
  assert.equal(rejoin.data.reconnected, true);

  // Public snapshot must NOT leak question description
  const pubRes = await api(`/api/public/rooms/${room.roomCode}`);
  assert.equal(pubRes.status, 200);
  const pubItem = pubRes.data.currentItem as Record<string, unknown>;
  assert.equal('questionTitle' in pubItem, false, 'Public API must not leak unrevealed question');
  assert.equal('questionDescription' in pubItem, false, 'Public API must not leak question notes');

  // 7. Start Auction #1 & Fire 60 Simultaneous Bids of Equal Amount (20) + Escalating Bids
  const startRes = await api(`/api/host/rooms/${room.id}/auction/start`, {
    method: 'POST',
    token: host1Token,
  });
  assert.equal(startRes.status, 200);

  // Unauthorized team cannot start or evaluate auction
  const unauthStart = await api(`/api/host/rooms/${room.id}/auction/start`, {
    method: 'POST',
    token: teamSessions[0].token,
  });
  assert.equal(unauthStart.status, 401, 'Team token must be rejected from host endpoints');

  console.log('Firing 60 simultaneous bids of 20 coins to test atomic concurrency...');
  const bidLatencies: number[] = [];
  const equalBidResults = await Promise.all(
    teamSessions.map(
      (t) =>
        new Promise<{ ok: boolean; code: string; teamId: string }>((resolve) => {
          const t0 = performance.now();
          t.socket.emit(
            'team:place_bid',
            { amount: 20, clientRequestId: `burst-${t.teamId}` },
            (ack: { ok: boolean; code: string }) => {
              bidLatencies.push(performance.now() - t0);
              resolve({ ok: ack.ok, code: ack.code, teamId: t.teamId });
            },
          );
        }),
    ),
  );

  const acceptedCount = equalBidResults.filter((r) => r.ok).length;
  assert.equal(acceptedCount, 1, 'Exactly ONE of 60 simultaneous equal bids must win!');
  const firstWinner = equalBidResults.find((r) => r.ok)!;
  console.log(`Atomic concurrency passed: 1 accepted, 59 rejected. Winner: ${firstWinner.teamId}`);

  // Self-outbid rejection
  const selfBid = await api('/api/team/bid', {
    method: 'POST',
    token: teamSessions.find((t) => t.teamId === firstWinner.teamId)!.token,
    body: { amount: 30, clientRequestId: `self-${Date.now()}` },
  });
  assert.equal(selfBid.status, 400);
  assert.equal(selfBid.data.code, 'SELF_OUTBID');

  // Duplicate request ID idempotency
  const challenger = teamSessions.find((t) => t.teamId !== firstWinner.teamId)!;
  const dupReqId = `dup-check-${Date.now()}`;
  const validBid1 = await api('/api/team/bid', {
    method: 'POST',
    token: challenger.token,
    body: { amount: 25, clientRequestId: dupReqId },
  });
  assert.equal(validBid1.status, 200);
  const validBidDup = await api('/api/team/bid', {
    method: 'POST',
    token: challenger.token,
    body: { amount: 25, clientRequestId: dupReqId },
  });
  assert.equal(validBidDup.data.code, 'DUPLICATE_REQUEST');

  // End Auction #1 -> Challenger wins -> Start Answer Timer -> Wait 150ms -> Mark CORRECT (+10)
  await api(`/api/host/rooms/${room.id}/auction/end`, { method: 'POST', token: host1Token });
  await api(`/api/host/rooms/${room.id}/answer/start`, { method: 'POST', token: host1Token });
  await new Promise((r) => setTimeout(r, 150));

  const eval1 = await api(`/api/host/rooms/${room.id}/answer/evaluate`, {
    method: 'POST',
    token: host1Token,
    body: { decision: 'CORRECT' },
  });
  assert.equal(eval1.status, 200);

  // Double-click idempotency check
  const eval1Dup = await api(`/api/host/rooms/${room.id}/answer/evaluate`, {
    method: 'POST',
    token: host1Token,
    body: { decision: 'CORRECT' },
  });
  assert.equal(eval1Dup.status, 200);
  assert.equal(eval1Dup.data.alreadyEvaluated, true);

  const afterEvalSnap = eval1Dup.data as {
    teams: Array<{ id: string; balance: number; totalResponseTimeMs: number }>;
  };
  const chTeam = afterEvalSnap.teams.find((t) => t.id === challenger.teamId)!;
  assert.equal(chTeam.balance, 110, 'Balance must be 110 after +10 (not 120 from double-click)');
  assert.ok(chTeam.totalResponseTimeMs >= 100, 'Response time must be automatically measured');

  // 8. Tie-breaker test: Advance to item 2, Team_05 wins and answers slower -> still ranks below faster equal-points team
  await api(`/api/host/rooms/${room.id}/auction/next`, { method: 'POST', token: host1Token });
  await api(`/api/host/rooms/${room.id}/auction/start`, { method: 'POST', token: host1Token });
  const team5 = teamSessions.find((t) => t.teamName === 'Team_05')!;
  if (team5.teamId !== challenger.teamId) {
    await api('/api/team/bid', {
      method: 'POST',
      token: team5.token,
      body: { amount: 50, clientRequestId: `t5-${Date.now()}` },
    });
    await api(`/api/host/rooms/${room.id}/auction/end`, { method: 'POST', token: host1Token });
    await api(`/api/host/rooms/${room.id}/answer/start`, { method: 'POST', token: host1Token });
    await new Promise((r) => setTimeout(r, 400));
    const eval2 = await api(`/api/host/rooms/${room.id}/answer/evaluate`, {
      method: 'POST',
      token: host1Token,
      body: { decision: 'CORRECT' },
    });
    const lb = eval2.data.leaderboard as Array<{
      rank: number;
      teamId: string;
      balance: number;
      totalResponseTimeMs: number;
    }>;
    assert.equal(lb[0].teamId, challenger.teamId, 'Faster team with 110 pts must rank #1');
    assert.equal(lb[1].teamId, team5.teamId, 'Slower team with 110 pts must rank #2');
    assert.equal(lb[0].rank, 1);
    assert.equal(lb[1].rank, 2);
  }

  // 9. Negative balance clamping check via manual adjustment
  const adjRes = await api(
    `/api/host/rooms/${room.id}/teams/${teamSessions[10].teamId}/adjust-score`,
    {
      method: 'POST',
      token: host1Token,
      body: { amount: -500, reason: 'Clamp test' },
    },
  );
  assert.equal(adjRes.status, 200);
  const clampedTeam = (adjRes.data.teams as Array<{ id: string; balance: number }>).find(
    (t) => t.id === teamSessions[10].teamId,
  )!;
  assert.equal(clampedTeam.balance, 0, 'Team balance must clamp at 0 and never go negative');

  // 10. CSV Export check
  const csvRes = await api(`/api/host/rooms/${room.id}/export/results-csv`, { token: host1Token });
  assert.equal(csvRes.status, 200);
  assert.ok(csvRes.text.includes('Rank,TeamName,PointsCoins'));

  // Cleanup sockets
  for (const t of teamSessions) t.socket.disconnect();
  hostSock.disconnect();
  audSock.disconnect();

  const avgConnectMs =
    connectLatencies.reduce((a, b) => a + b, 0) / Math.max(1, connectLatencies.length);
  const avgBidMs = bidLatencies.reduce((a, b) => a + b, 0) / Math.max(1, bidLatencies.length);

  console.log('--- LOAD & FUNCTIONAL TEST REPORT ---');
  console.log(`Simulated clients: 62 (60 Teams + 1 Host + 1 Audience)`);
  console.log(`Successful connections: 62 / 62`);
  console.log(`Average join+socket latency: ${avgConnectMs.toFixed(1)} ms`);
  console.log(`Average atomic bid round-trip latency (60-way burst): ${avgBidMs.toFixed(1)} ms`);
  console.log(`All functional, concurrency, security, and scoring assertions PASSED.`);
}

runTests().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
