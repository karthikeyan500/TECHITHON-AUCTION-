import {
  AlertCircle,
  CheckCircle2,
  Coins,
  Gavel,
  LogOut,
  Minus,
  Plus,
  RefreshCw,
  Trophy,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog.tsx';
import { LeaderboardTable } from '../components/LeaderboardTable.tsx';
import { PodiumDisplay } from '../components/PodiumDisplay.tsx';
import { apiRequest, getTeamToken, setTeamToken } from '../lib/api.ts';
import { getSocket } from '../lib/socket.ts';
import { useServerCountdown } from '../lib/useServerCountdown.ts';
import type { TeamRoomSnapshot } from '../shared/types.ts';

interface TeamDashboardProps {
  initialSnapshot: TeamRoomSnapshot | null;
  onGoJoin: () => void;
  onLeftRoom: () => void;
}

export function TeamDashboard({
  initialSnapshot,
  onGoJoin,
  onLeftRoom,
}: TeamDashboardProps) {
  const [snapshot, setSnapshot] = useState<TeamRoomSnapshot | null>(initialSnapshot);
  const [socketStatus, setSocketStatus] = useState<'connected' | 'reconnecting' | 'disconnected'>(
    'connected',
  );
  const [bidAmount, setBidAmount] = useState<string>('');
  const [submittingBid, setSubmittingBid] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'info' | 'warning' | 'error';
    text: string;
  } | null>(null);
  const [activeTab, setActiveTab] = useState<'bids' | 'leaderboard'>('bids');
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);

  const prevHighestTeamRef = useRef<string | null>(null);
  const prevBalanceRef = useRef<number | null>(null);

  useEffect(() => {
    if (initialSnapshot) {
      setSnapshot(initialSnapshot);
    }
  }, [initialSnapshot]);

  // Recover team session on mount / refresh if initialSnapshot is null
  useEffect(() => {
    if (snapshot) return;
    apiRequest<{ snapshot: TeamRoomSnapshot; token: string }>('/api/team/me', {
      authMode: 'team',
    })
      .then((res) => {
        setTeamToken(res.token);
        setSnapshot(res.snapshot);
      })
      .catch(() => {
        // Not joined yet
      });
  }, [snapshot]);

  // Socket.IO room subscription & reconnection recovery
  useEffect(() => {
    if (!snapshot) return;
    const socket = getSocket();

    const subscribe = () => {
      socket.emit('subscribe:team', { token: getTeamToken() || undefined }, (res: { ok: boolean }) => {
        if (res?.ok) {
          setSocketStatus('connected');
        }
      });
    };

    const onConnect = () => {
      setSocketStatus('connected');
      subscribe();
      apiRequest<{ snapshot: TeamRoomSnapshot; token: string }>('/api/team/me', {
        authMode: 'team',
      })
        .then((res) => {
          setTeamToken(res.token);
          setSnapshot(res.snapshot);
        })
        .catch(() => {});
    };

    const onDisconnect = () => {
      setSocketStatus('reconnecting');
    };

    const onConnectError = () => {
      setSocketStatus('disconnected');
    };

    const onTeamState = (next: TeamRoomSnapshot) => {
      setSnapshot(next);
    };

    const onTeamRemoved = (payload: { message?: string }) => {
      setFeedback({
        type: 'error',
        text: payload?.message || 'Your team was removed from this room.',
      });
      setTeamToken(null);
      setTimeout(() => {
        onLeftRoom();
      }, 1500);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.on('team:state', onTeamState);
    socket.on('team:removed', onTeamRemoved);

    if (socket.connected) {
      subscribe();
    } else {
      setSocketStatus('reconnecting');
      socket.connect();
    }

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.off('team:state', onTeamState);
      socket.off('team:removed', onTeamRemoved);
    };
  }, [snapshot?.selfTeam.id, onLeftRoom]);

  // Track outbid and points updates for clear participant feedback
  useEffect(() => {
    if (!snapshot) return;
    const myId = snapshot.selfTeam.id;
    const currHighTeam = snapshot.currentAuction?.highestBidderTeamId || null;

    if (
      prevHighestTeamRef.current === myId &&
      currHighTeam &&
      currHighTeam !== myId &&
      snapshot.room.machineState === 'AUCTION_OPEN'
    ) {
      setFeedback({
        type: 'warning',
        text: `Another team (${snapshot.currentAuction?.highestBidderTeamName}) has placed a higher bid.`,
      });
    }
    prevHighestTeamRef.current = currHighTeam;

    if (
      prevBalanceRef.current !== null &&
      prevBalanceRef.current !== snapshot.selfTeam.balance
    ) {
      const diff = snapshot.selfTeam.balance - prevBalanceRef.current;
      setFeedback({
        type: diff >= 0 ? 'success' : 'warning',
        text: `Your points have been updated (${diff >= 0 ? '+' : ''}${diff} pts).`,
      });
    }
    prevBalanceRef.current = snapshot.selfTeam.balance;
  }, [snapshot]);

  const auctionRemainingMs = useServerCountdown(
    snapshot?.room.machineState === 'AUCTION_OPEN'
      ? snapshot.currentAuction?.deadlineTimestamp
      : null,
    snapshot?.serverTime,
    Boolean(snapshot?.room.isPaused),
    snapshot?.room.pausedRemainingMs,
  );

  const answerRemainingMs = useServerCountdown(
    snapshot?.room.machineState === 'ANSWER_RUNNING'
      ? snapshot.currentAnswerSession?.answerDeadlineTimestamp
      : null,
    snapshot?.serverTime,
    Boolean(snapshot?.room.isPaused),
    snapshot?.room.pausedRemainingMs,
  );

  const minRequiredBid = useMemo(() => {
    if (!snapshot) return 10;
    const inc = Math.max(1, snapshot.room.settings.minBidIncrement);
    const start = Math.max(
      1,
      snapshot.currentItem?.startingBid || snapshot.room.settings.minStartingBid,
    );
    if (snapshot.currentAuction?.highestBidderTeamId) {
      return snapshot.currentAuction.highestBid + inc;
    }
    return start;
  }, [snapshot]);

  // Keep bid input synced to minimum valid bid when auction opens or highest bid rises
  useEffect(() => {
    if (snapshot?.room.machineState === 'AUCTION_OPEN') {
      setBidAmount((prev) => {
        const num = Number(prev);
        if (!prev || !Number.isFinite(num) || num < minRequiredBid) {
          return String(minRequiredBid);
        }
        return prev;
      });
    }
  }, [minRequiredBid, snapshot?.room.machineState, snapshot?.currentAuction?.id]);

  if (!snapshot) {
    return (
      <main className="mx-auto max-w-lg px-4 py-14 text-center">
        <div className="rounded-2xl border border-[#223552] bg-[#111E31] p-8 space-y-4">
          <Gavel className="mx-auto h-10 w-10 text-[#51D6E8]" />
          <h1 className="font-display text-2xl font-bold text-[#EEF5FF]">Team Dashboard</h1>
          <p className="text-sm text-[#9BB0CA]">
            You have not joined an active auction room yet. Enter a room code to start bidding.
          </p>
          <button
            type="button"
            onClick={onGoJoin}
            className="min-h-[48px] w-full rounded-xl bg-[#51D6E8] px-6 py-3 text-sm font-bold text-[#08111F] hover:bg-[#6de0ef] transition-colors"
          >
            Join a Room
          </button>
        </div>
      </main>
    );
  }

  const { room, selfTeam, currentItem, currentAuction, currentAnswerSession } = snapshot;
  const isAuctionOpen = room.machineState === 'AUCTION_OPEN' && !room.isPaused && room.isActive;
  const isHighestBidder = currentAuction?.highestBidderTeamId === selfTeam.id;
  const isWinner =
    currentAnswerSession?.winningTeamId === selfTeam.id &&
    ['WINNER_SELECTED', 'ANSWER_PENDING', 'ANSWER_RUNNING'].includes(room.machineState);
  const inc = Math.max(1, room.settings.minBidIncrement);

  const placeBid = async (targetAmount?: number) => {
    const numeric = Math.trunc(Number(targetAmount ?? bidAmount));
    if (!Number.isFinite(numeric) || numeric <= 0) {
      setFeedback({ type: 'error', text: 'Invalid bid. Enter a positive whole number.' });
      return;
    }
    if (!isAuctionOpen) {
      setFeedback({ type: 'error', text: 'Auction is not open for bidding right now.' });
      return;
    }
    if (isHighestBidder) {
      setFeedback({ type: 'warning', text: 'You cannot outbid your own current bid.' });
      return;
    }

    setSubmittingBid(true);
    const clientRequestId = `${selfTeam.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    try {
      const socket = getSocket();
      if (socket.connected) {
        const res = await new Promise<{ ok: boolean; message: string }>((resolve) => {
          socket.emit(
            'team:place_bid',
            { amount: numeric, clientRequestId, token: getTeamToken() || undefined },
            (ack: { ok: boolean; message: string }) => resolve(ack),
          );
        });
        setFeedback({
          type: res.ok ? 'success' : 'error',
          text: res.message,
        });
      } else {
        const res = await apiRequest<{ ok: boolean; message: string }>('/api/team/bid', {
          method: 'POST',
          authMode: 'team',
          body: JSON.stringify({ amount: numeric, clientRequestId }),
        });
        setFeedback({
          type: res.ok ? 'success' : 'error',
          text: res.message,
        });
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to place bid.',
      });
    } finally {
      setSubmittingBid(false);
    }
  };

  const handleLeave = async () => {
    try {
      await apiRequest('/api/rooms/leave', { method: 'POST', authMode: 'team' });
    } catch {
      // ignore
    }
    setTeamToken(null);
    setLeaveConfirmOpen(false);
    onLeftRoom();
  };

  const auctionSeconds = (auctionRemainingMs / 1000).toFixed(1);
  const answerSeconds = (answerRemainingMs / 1000).toFixed(1);

  return (
    <main className="mx-auto max-w-5xl px-3 sm:px-6 py-4 sm:py-8 pb-36 lg:pb-10 space-y-5">
      {/* Connection Recovery Banner */}
      {socketStatus !== 'connected' && (
        <div
          role="alert"
          className="rounded-xl border border-[#F5B731]/50 bg-[#F5B731]/10 px-4 py-3 flex items-center justify-between gap-3 text-sm text-[#F5B731]"
        >
          <div className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4 animate-spin shrink-0" />
            <span>
              {socketStatus === 'reconnecting'
                ? 'Connection lost. Attempting to reconnect and restore your room state...'
                : 'Disconnected from server. Retrying automatically...'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => getSocket().connect()}
            className="rounded-lg bg-[#F5B731] px-3 py-1 text-xs font-bold text-[#08111F] whitespace-nowrap shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {/* Top Identity & Balance Strip */}
      <section className="rounded-2xl border border-[#223552] bg-[#111E31] p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-[#9BB0CA]">
              <span className="font-mono font-semibold text-[#51D6E8]">{room.roomCode}</span>
              <span aria-hidden="true">·</span>
              <span className="truncate">{room.roomName}</span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1">
                {socketStatus === 'connected' ? (
                  <>
                    <Wifi className="h-3.5 w-3.5 text-[#B9F36B]" />
                    <span className="text-[#B9F36B]">Connected</span>
                  </>
                ) : (
                  <>
                    <WifiOff className="h-3.5 w-3.5 text-[#F5B731]" />
                    <span className="text-[#F5B731]">Reconnecting</span>
                  </>
                )}
              </span>
            </div>
            <h1 className="mt-1 font-display text-xl sm:text-2xl font-extrabold text-[#EEF5FF] truncate">
              {selfTeam.teamName}
            </h1>
            <p className="mt-0.5 text-xs font-medium text-[#9BB0CA]">
              Status: <span className="text-[#EEF5FF]">{room.humanStatus}</span>
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="rounded-xl border border-[#223552] bg-[#08111F] px-4 py-2.5 text-right">
              <p className="text-[11px] font-medium text-[#9BB0CA] flex items-center justify-end gap-1">
                <Coins className="h-3.5 w-3.5 text-[#B9F36B]" />
                Points / Coins
              </p>
              <p className="font-mono tabular-nums text-2xl font-extrabold text-[#B9F36B]">
                {selfTeam.balance}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setLeaveConfirmOpen(true)}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl border border-[#223552] bg-[#172740] text-[#9BB0CA] hover:text-[#F05252] transition-colors"
              aria-label="Leave room"
              title="Leave room"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </section>

      {room.machineState === 'ROOM_COMPLETED' ? (
        <section className="space-y-6">
          <div className="rounded-2xl border border-[#F5B731]/40 bg-[#172740] p-6 text-center space-y-2">
            <Trophy className="mx-auto h-10 w-10 text-[#F5B731]" />
            <h2 className="font-display text-2xl font-extrabold text-[#EEF5FF]">
              Event Completed — Final Results
            </h2>
            <p className="text-sm text-[#9BB0CA]">
              Final official standings ranked by points and total response time.
            </p>
          </div>
          <PodiumDisplay entries={snapshot.leaderboard} />
          <LeaderboardTable entries={snapshot.leaderboard} highlightTeamId={selfTeam.id} />
        </section>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Left / Main Auction Area */}
          <div className="lg:col-span-7 space-y-5">
            {/* Feedback Banner */}
            {feedback && (
              <div
                role="status"
                className={`rounded-xl border px-4 py-3 flex items-center gap-2.5 text-sm font-medium ${
                  feedback.type === 'success'
                    ? 'border-[#B9F36B]/40 bg-[#B9F36B]/10 text-[#B9F36B]'
                    : feedback.type === 'warning'
                      ? 'border-[#F5B731]/40 bg-[#F5B731]/10 text-[#F5B731]'
                      : feedback.type === 'error'
                        ? 'border-[#F05252]/40 bg-[#F05252]/10 text-[#F05252]'
                        : 'border-[#51D6E8]/40 bg-[#51D6E8]/10 text-[#51D6E8]'
                }`}
              >
                {feedback.type === 'success' ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                ) : (
                  <AlertCircle className="h-4 w-4 shrink-0" />
                )}
                <span>{feedback.text}</span>
              </div>
            )}

            {/* Winner / Answer Stage Notification */}
            {isWinner && (
              <div className="rounded-2xl border border-[#B9F36B]/60 bg-[#B9F36B]/10 p-5 space-y-2">
                <p className="font-display text-lg font-extrabold text-[#B9F36B]">
                  Your team has won the auction!
                </p>
                <p className="text-sm text-[#EEF5FF]">
                  Listen closely to the host&apos;s question and answer verbally.
                  {room.machineState === 'ANSWER_RUNNING'
                    ? ' Answer timer is running now.'
                    : ' Waiting for the host to start the answer timer or evaluate your answer.'}
                </p>
                {room.machineState === 'ANSWER_RUNNING' && (
                  <p className="font-mono tabular-nums text-3xl font-extrabold text-[#F5B731]">
                    {answerSeconds}s
                  </p>
                )}
              </div>
            )}

            {/* Current Auction Item & Timer Card (Never reveals question before host asks!) */}
            <div className="rounded-2xl border border-[#223552] bg-[#111E31] p-5 sm:p-6 space-y-5">
              {currentItem ? (
                <>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#172740] border border-[#223552] text-3xl">
                        {currentItem.imageOrEmoji.startsWith('http') ||
                        currentItem.imageOrEmoji.startsWith('/') ? (
                          <img
                            src={currentItem.imageOrEmoji}
                            alt={currentItem.itemName}
                            referrerPolicy="no-referrer"
                            className="h-full w-full rounded-2xl object-cover"
                          />
                        ) : (
                          <span>{currentItem.imageOrEmoji || '💻'}</span>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs text-[#9BB0CA]">
                          {currentItem.category}
                          {currentItem.difficulty ? ` · ${currentItem.difficulty}` : ''}
                          {' · '}Starting {currentItem.startingBid}
                        </p>
                        <h2 className="mt-0.5 font-display text-xl sm:text-2xl font-extrabold text-[#EEF5FF] truncate">
                          {currentItem.itemName}
                        </h2>
                      </div>
                    </div>

                    {/* Authoritative Countdown */}
                    <div className="shrink-0 text-right">
                      <p className="text-[11px] font-medium text-[#9BB0CA]">
                        {room.machineState === 'ANSWER_RUNNING'
                          ? 'Answer Timer'
                          : 'Auction Timer'}
                      </p>
                      <p
                        className={`font-mono tabular-nums text-3xl sm:text-4xl font-extrabold ${
                          room.isPaused
                            ? 'text-[#F5B731]'
                            : room.machineState === 'AUCTION_OPEN' && auctionRemainingMs <= 5000
                              ? 'text-[#F05252]'
                              : room.machineState === 'AUCTION_OPEN'
                                ? 'text-[#51D6E8]'
                                : room.machineState === 'ANSWER_RUNNING'
                                  ? 'text-[#F5B731]'
                                  : 'text-[#9BB0CA]'
                        }`}
                      >
                        {room.machineState === 'AUCTION_OPEN'
                          ? `${auctionSeconds}s`
                          : room.machineState === 'ANSWER_RUNNING'
                            ? `${answerSeconds}s`
                            : room.isPaused
                              ? 'PAUSED'
                              : '—'}
                      </p>
                    </div>
                  </div>

                  {/* Highest Bid Readout */}
                  <div className="grid grid-cols-2 gap-3 rounded-xl border border-[#223552] bg-[#08111F] p-4">
                    <div>
                      <p className="text-xs text-[#9BB0CA]">Current Highest Bid</p>
                      <p className="mt-1 font-mono tabular-nums text-2xl sm:text-3xl font-extrabold text-[#51D6E8]">
                        {currentAuction?.highestBidderTeamId
                          ? currentAuction.highestBid
                          : currentItem.startingBid}
                        <span className="ml-1.5 text-xs font-normal text-[#9BB0CA]">
                          {currentAuction?.highestBidderTeamId ? 'coins' : 'min'}
                        </span>
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-[#9BB0CA]">Leading Team</p>
                      <p
                        className={`mt-1 font-display text-base sm:text-lg font-bold truncate ${
                          isHighestBidder ? 'text-[#B9F36B]' : 'text-[#EEF5FF]'
                        }`}
                      >
                        {currentAuction?.highestBidderTeamName
                          ? isHighestBidder
                            ? `${currentAuction.highestBidderTeamName} (You)`
                            : currentAuction.highestBidderTeamName
                          : 'No bids yet'}
                      </p>
                    </div>
                  </div>
                </>
              ) : (
                <div className="py-8 text-center space-y-2">
                  <p className="font-display text-lg font-bold text-[#EEF5FF]">
                    Waiting for Host to Start
                  </p>
                  <p className="text-sm text-[#9BB0CA]">
                    {snapshot.lastAnnouncement ||
                      'Stay on this screen. The auction item will appear live as soon as the host opens bidding.'}
                  </p>
                </div>
              )}

              {snapshot.lastAnnouncement && (
                <p className="text-xs text-[#9BB0CA] border-t border-[#223552] pt-3">
                  {snapshot.lastAnnouncement}
                </p>
              )}
            </div>

            {/* Desktop Inline Bidding Panel + Mobile Fixed Bottom Bidding Bar */}
            <div className="hidden lg:block rounded-2xl border border-[#223552] bg-[#111E31] p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-base font-bold text-[#EEF5FF]">Place Your Bid</h3>
                <span className="text-xs font-mono tabular-nums text-[#9BB0CA]">
                  Minimum next bid: {minRequiredBid} coins (increment +{inc})
                </span>
              </div>

              {isHighestBidder && isAuctionOpen && (
                <p className="text-sm font-semibold text-[#B9F36B]">
                  You are currently the highest bidder. Wait for another team or timer completion.
                </p>
              )}

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={!isAuctionOpen}
                  onClick={() =>
                    setBidAmount(String(Math.max(minRequiredBid, Number(bidAmount || minRequiredBid) - inc)))
                  }
                  className="min-h-[48px] min-w-[48px] flex items-center justify-center rounded-xl border border-[#223552] bg-[#172740] text-[#EEF5FF] hover:bg-[#1e3252] disabled:opacity-40"
                  aria-label="Decrease bid"
                >
                  <Minus className="h-5 w-5" />
                </button>
                <input
                  type="number"
                  min={minRequiredBid}
                  step={1}
                  disabled={!isAuctionOpen}
                  value={bidAmount}
                  onChange={(e) => setBidAmount(e.target.value)}
                  className="min-h-[48px] flex-1 rounded-xl border border-[#223552] bg-[#08111F] px-4 text-center font-mono tabular-nums text-xl font-bold text-[#EEF5FF] focus:border-[#51D6E8] focus:outline-none disabled:opacity-40"
                  aria-label="Bid amount"
                />
                <button
                  type="button"
                  disabled={!isAuctionOpen}
                  onClick={() =>
                    setBidAmount(String(Math.max(minRequiredBid, Number(bidAmount || minRequiredBid) + inc)))
                  }
                  className="min-h-[48px] min-w-[48px] flex items-center justify-center rounded-xl border border-[#223552] bg-[#172740] text-[#EEF5FF] hover:bg-[#1e3252] disabled:opacity-40"
                  aria-label="Increase bid"
                >
                  <Plus className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  disabled={!isAuctionOpen || isHighestBidder || submittingBid}
                  onClick={() => placeBid()}
                  className="min-h-[48px] rounded-xl bg-[#51D6E8] px-7 text-base font-bold text-[#08111F] hover:bg-[#6de0ef] transition-colors disabled:opacity-40 whitespace-nowrap shrink-0"
                >
                  {submittingBid
                    ? 'Sending...'
                    : isHighestBidder && isAuctionOpen
                      ? 'Highest Bidder'
                      : isAuctionOpen
                        ? 'Place Bid'
                        : 'Bidding Closed'}
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                {[minRequiredBid, minRequiredBid + inc, minRequiredBid + inc * 2].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    disabled={!isAuctionOpen || isHighestBidder || submittingBid}
                    onClick={() => {
                      setBidAmount(String(preset));
                      placeBid(preset);
                    }}
                    className="min-h-[40px] rounded-lg border border-[#223552] bg-[#172740] px-3.5 text-xs font-mono font-semibold text-[#EEF5FF] hover:border-[#51D6E8] disabled:opacity-40 transition-colors"
                  >
                    Quick Bid {preset}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Right Column: Live Bids & Leaderboard */}
          <div className="lg:col-span-5 space-y-4">
            <div className="grid grid-cols-2 gap-1 rounded-xl border border-[#223552] bg-[#111E31] p-1">
              <button
                type="button"
                onClick={() => setActiveTab('bids')}
                className={`min-h-[40px] rounded-lg text-sm font-semibold transition-colors ${
                  activeTab === 'bids'
                    ? 'bg-[#172740] text-[#51D6E8]'
                    : 'text-[#9BB0CA] hover:text-[#EEF5FF]'
                }`}
              >
                Recent Bids
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('leaderboard')}
                className={`min-h-[40px] rounded-lg text-sm font-semibold transition-colors ${
                  activeTab === 'leaderboard'
                    ? 'bg-[#172740] text-[#51D6E8]'
                    : 'text-[#9BB0CA] hover:text-[#EEF5FF]'
                }`}
              >
                Leaderboard
              </button>
            </div>

            {activeTab === 'bids' ? (
              <div className="rounded-2xl border border-[#223552] bg-[#111E31] p-4 space-y-2 max-h-[420px] overflow-y-auto">
                {snapshot.recentBids.length === 0 ? (
                  <p className="py-8 text-center text-sm text-[#9BB0CA]">
                    No bids placed in the current auction yet.
                  </p>
                ) : (
                  snapshot.recentBids.map((b, idx) => (
                    <div
                      key={b.id}
                      className={`flex items-center justify-between rounded-xl px-3.5 py-2.5 text-sm ${
                        idx === 0
                          ? 'bg-[#51D6E8]/10 border border-[#51D6E8]/40'
                          : 'bg-[#08111F]/70'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-[#EEF5FF] truncate">
                          {b.teamName}
                          {b.teamId === selfTeam.id ? ' (You)' : ''}
                        </p>
                        <p className="text-[11px] font-mono text-[#9BB0CA]">
                          #{b.sequenceNumber} ·{' '}
                          {new Date(b.serverTimestamp).toLocaleTimeString()}
                        </p>
                      </div>
                      <span className="font-mono tabular-nums text-base font-bold text-[#51D6E8]">
                        {b.bidAmount}
                      </span>
                    </div>
                  ))
                )}
              </div>
            ) : (
              <LeaderboardTable
                entries={snapshot.leaderboard}
                highlightTeamId={selfTeam.id}
                compact
              />
            )}
          </div>
        </div>
      )}

      {/* Mobile Sticky Bottom Thumb-Zone Bidding Controls */}
      {room.machineState !== 'ROOM_COMPLETED' && (
        <div className="lg:hidden fixed bottom-0 left-0 right-0 z-30 border-t border-[#223552] bg-[#08111F]/95 backdrop-blur-md px-3 py-3">
          <div className="mx-auto max-w-lg space-y-2">
            <div className="flex items-center justify-between text-xs text-[#9BB0CA]">
              <span className="font-mono tabular-nums">Min: {minRequiredBid} (+{inc})</span>
              {isHighestBidder && isAuctionOpen && (
                <span className="font-semibold text-[#B9F36B]">You lead!</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={!isAuctionOpen}
                onClick={() =>
                  setBidAmount(String(Math.max(minRequiredBid, Number(bidAmount || minRequiredBid) - inc)))
                }
                className="min-h-[48px] min-w-[48px] flex items-center justify-center rounded-xl border border-[#223552] bg-[#172740] text-[#EEF5FF] disabled:opacity-40"
                aria-label="Decrease bid"
              >
                <Minus className="h-5 w-5" />
              </button>
              <input
                type="number"
                min={minRequiredBid}
                step={1}
                disabled={!isAuctionOpen}
                value={bidAmount}
                onChange={(e) => setBidAmount(e.target.value)}
                className="min-h-[48px] w-24 rounded-xl border border-[#223552] bg-[#111E31] px-2 text-center font-mono tabular-nums text-lg font-bold text-[#EEF5FF] focus:border-[#51D6E8] focus:outline-none disabled:opacity-40"
                aria-label="Bid amount"
              />
              <button
                type="button"
                disabled={!isAuctionOpen}
                onClick={() =>
                  setBidAmount(String(Math.max(minRequiredBid, Number(bidAmount || minRequiredBid) + inc)))
                }
                className="min-h-[48px] min-w-[48px] flex items-center justify-center rounded-xl border border-[#223552] bg-[#172740] text-[#EEF5FF] disabled:opacity-40"
                aria-label="Increase bid"
              >
                <Plus className="h-5 w-5" />
              </button>
              <button
                type="button"
                disabled={!isAuctionOpen || isHighestBidder || submittingBid}
                onClick={() => placeBid()}
                className="min-h-[48px] flex-1 rounded-xl bg-[#51D6E8] px-4 text-sm font-bold text-[#08111F] active:scale-[0.98] transition-all disabled:opacity-40"
              >
                {submittingBid
                  ? 'Sending...'
                  : isHighestBidder && isAuctionOpen
                    ? 'Highest'
                    : isAuctionOpen
                      ? 'Place Bid'
                      : 'Closed'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={leaveConfirmOpen}
        title="Leave Auction Room?"
        description="You can rejoin using the same room code and your team name (if you set a passcode or reopen from this device)."
        confirmLabel="Leave Room"
        variant="danger"
        onConfirm={handleLeave}
        onCancel={() => setLeaveConfirmOpen(false)}
      />
    </main>
  );
}
