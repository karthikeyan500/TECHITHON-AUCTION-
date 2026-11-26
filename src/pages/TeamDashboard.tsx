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
import {
  markTeamOffline,
  placeBidTransaction,
  reconnectStoredTeamSession,
  subscribeTeamRoom,
} from '../lib/firestoreAuction.ts';
import { useServerCountdown } from '../lib/useServerCountdown.ts';
import { isRenderableImageSrc, type TeamRoomSnapshot } from '../shared/types.ts';

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
  const [syncStatus, setSyncStatus] = useState<'connected' | 'reconnecting'>('connected');
  const [bidAmount, setBidAmount] = useState<string>('');
  const [submittingBid, setSubmittingBid] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'info' | 'warning' | 'error';
    text: string;
  } | null>(null);
  const [activeTab, setActiveTab] = useState<'bids' | 'leaderboard' | 'transactions'>('bids');
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);

  const prevHighestTeamRef = useRef<string | null>(null);
  const prevCoinsRef = useRef<number | null>(null);
  const prevPointsRef = useRef<number | null>(null);

  useEffect(() => {
    if (initialSnapshot) {
      setSnapshot(initialSnapshot);
    }
  }, [initialSnapshot]);

  // Recover stored session if user navigated directly to /team
  useEffect(() => {
    if (snapshot) return;
    reconnectStoredTeamSession()
      .then((snap) => {
        if (snap) setSnapshot(snap);
      })
      .catch(() => {
        // Not joined yet
      });
  }, [snapshot]);

  // Real-time Firestore room subscription
  useEffect(() => {
    if (!snapshot?.room.id || !snapshot?.selfTeam.id) return;
    setSyncStatus('connected');

    const unsub = subscribeTeamRoom(
      snapshot.room.id,
      snapshot.selfTeam.id,
      (next) => {
        setSyncStatus('connected');
        setSnapshot(next);
      },
      (removedMsg) => {
        setFeedback({ type: 'error', text: removedMsg });
        setTimeout(() => {
          onLeftRoom();
        }, 1600);
      },
      () => {
        setSyncStatus('reconnecting');
      },
    );

    return () => unsub();
  }, [snapshot?.room.id, snapshot?.selfTeam.id, onLeftRoom]);

  // Track outbid, coin balance, and point balance notifications separately
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

    const coinsChanged =
      prevCoinsRef.current !== null && prevCoinsRef.current !== snapshot.selfTeam.coinBalance;
    const pointsChanged =
      prevPointsRef.current !== null && prevPointsRef.current !== snapshot.selfTeam.points;

    if (coinsChanged || pointsChanged) {
      const parts: string[] = [];
      let positive = true;
      if (coinsChanged && prevCoinsRef.current !== null) {
        const diffC = snapshot.selfTeam.coinBalance - prevCoinsRef.current;
        parts.push(`${diffC >= 0 ? '+' : ''}${diffC} Coins`);
        if (diffC < 0) positive = false;
      }
      if (pointsChanged && prevPointsRef.current !== null) {
        const diffP = snapshot.selfTeam.points - prevPointsRef.current;
        parts.push(`${diffP >= 0 ? '+' : ''}${diffP} Points`);
        if (diffP < 0) positive = false;
      }
      setFeedback({
        type: positive ? 'success' : 'warning',
        text: `Balance updated: ${parts.join(', ')}.`,
      });
    }

    prevCoinsRef.current = snapshot.selfTeam.coinBalance;
    prevPointsRef.current = snapshot.selfTeam.points;
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

  const {
    room,
    selfTeam,
    currentItem,
    currentAuction,
    currentAnswerSession,
    leaderboard,
    teamStats,
  } = snapshot;
  const isAuctionOpen =
    room.machineState === 'AUCTION_OPEN' &&
    !room.isPaused &&
    room.isActive &&
    auctionRemainingMs > 0;
  const isHighestBidder = currentAuction?.highestBidderTeamId === selfTeam.id;
  const isWinner =
    currentAnswerSession?.winningTeamId === selfTeam.id &&
    ['WINNER_SELECTED', 'ANSWER_PENDING', 'ANSWER_RUNNING'].includes(room.machineState);
  const inc = Math.max(1, room.settings.minBidIncrement);
  const insufficientForMinBid = selfTeam.coinBalance < minRequiredBid;
  const myRank = leaderboard.find((e) => e.teamId === selfTeam.id)?.rank ?? null;
  const displayItemNumber = Math.min(room.currentItemIndex + 1, Math.max(1, room.itemCount));
  const hasItemPhoto = isRenderableImageSrc(currentItem?.imageOrEmoji);

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
    if (numeric > selfTeam.coinBalance) {
      setFeedback({
        type: 'error',
        text: `Insufficient Virtual Coins (${selfTeam.coinBalance} coins available).`,
      });
      return;
    }

    setSubmittingBid(true);
    try {
      const res = await placeBidTransaction({
        roomId: room.id,
        teamId: selfTeam.id,
        amount: numeric,
      });
      setFeedback({
        type: res.ok ? 'success' : 'error',
        text: res.message,
      });
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
    await markTeamOffline();
    setLeaveConfirmOpen(false);
    onLeftRoom();
  };

  const auctionSeconds = (auctionRemainingMs / 1000).toFixed(1);
  const answerSeconds = (answerRemainingMs / 1000).toFixed(1);

  return (
    <main className="mx-auto max-w-5xl px-3 sm:px-6 py-4 sm:py-8 pb-36 lg:pb-10 space-y-5">
      {/* Connection Recovery Banner */}
      {syncStatus !== 'connected' && (
        <div
          role="alert"
          className="rounded-xl border border-[#F5B731]/50 bg-[#F5B731]/10 px-4 py-3 flex items-center justify-between gap-3 text-sm text-[#F5B731]"
        >
          <div className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4 animate-spin shrink-0" />
            <span>
              Sync interrupted. Attempting to reconnect and restore your live room state...
            </span>
          </div>
          <button
            type="button"
            onClick={() => void reconnectStoredTeamSession().then((s) => s && setSnapshot(s))}
            className="rounded-lg bg-[#F5B731] px-3 py-1 text-xs font-bold text-[#08111F] whitespace-nowrap shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {/* Top Team Identity Strip */}
      <section className="rounded-2xl border border-[#223552] bg-[#111E31] p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-[#9BB0CA]">
              <span className="font-mono font-semibold text-[#51D6E8]">{room.roomCode}</span>
              <span aria-hidden="true">·</span>
              <span className="truncate">{room.roomName}</span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1">
                {syncStatus === 'connected' ? (
                  <>
                    <Wifi className="h-3.5 w-3.5 text-[#B9F36B]" />
                    <span className="text-[#B9F36B]">Live</span>
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
              {myRank !== null ? ` · Leaderboard Rank #${myRank}` : ''}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setLeaveConfirmOpen(true)}
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#223552] bg-[#172740] px-3.5 text-xs font-semibold text-[#9BB0CA] hover:text-[#F05252] transition-colors"
            aria-label="Leave room"
            title="Leave room"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Leave</span>
          </button>
        </div>
      </section>

      {/* Feature 7: Dedicated VIRTUAL COINS & COMPETITION POINTS Sections */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* VIRTUAL COINS */}
        <div className="rounded-2xl border border-[#51D6E8]/40 bg-[#111E31] p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between gap-2 border-b border-[#223552] pb-2.5">
            <div>
              <h2 className="font-display text-sm font-extrabold tracking-wide text-[#51D6E8] flex items-center gap-1.5">
                <Coins className="h-4 w-4" />
                VIRTUAL COINS
              </h2>
              <p className="text-[11px] text-[#9BB0CA]">Used exclusively for auction bidding</p>
            </div>
            <span className="font-mono tabular-nums text-2xl font-extrabold text-[#51D6E8]">
              {selfTeam.coinBalance}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
            <div className="rounded-xl border border-[#223552] bg-[#08111F] p-2.5">
              <p className="text-[11px] text-[#9BB0CA]">Available</p>
              <p className="mt-0.5 font-mono tabular-nums text-base font-bold text-[#51D6E8]">
                {selfTeam.coinBalance}
              </p>
            </div>
            <div className="rounded-xl border border-[#223552] bg-[#08111F] p-2.5">
              <p className="text-[11px] text-[#9BB0CA]">Spent on Bids</p>
              <p className="mt-0.5 font-mono tabular-nums text-base font-bold text-[#EEF5FF]">
                {teamStats.coinsSpentOnBids}
              </p>
            </div>
            <div className="rounded-xl border border-[#223552] bg-[#08111F] p-2.5">
              <p className="text-[11px] text-[#9BB0CA]">Earned (Correct)</p>
              <p className="mt-0.5 font-mono tabular-nums text-base font-bold text-[#B9F36B]">
                +{teamStats.coinsEarnedCorrect}
              </p>
            </div>
            <div className="rounded-xl border border-[#223552] bg-[#08111F] p-2.5">
              <p className="text-[11px] text-[#9BB0CA]">Lost (Wrong)</p>
              <p className="mt-0.5 font-mono tabular-nums text-base font-bold text-[#F05252]">
                -{teamStats.coinsLostWrong}
              </p>
            </div>
          </div>
        </div>

        {/* COMPETITION POINTS */}
        <div className="rounded-2xl border border-[#B9F36B]/40 bg-[#111E31] p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between gap-2 border-b border-[#223552] pb-2.5">
            <div>
              <h2 className="font-display text-sm font-extrabold tracking-wide text-[#B9F36B] flex items-center gap-1.5">
                <Trophy className="h-4 w-4" />
                COMPETITION POINTS
              </h2>
              <p className="text-[11px] text-[#9BB0CA]">Determines leaderboard rankings</p>
            </div>
            <span className="font-mono tabular-nums text-2xl font-extrabold text-[#B9F36B]">
              {selfTeam.points}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
            <div className="rounded-xl border border-[#223552] bg-[#08111F] p-2.5">
              <p className="text-[11px] text-[#9BB0CA]">Current Points</p>
              <p className="mt-0.5 font-mono tabular-nums text-base font-bold text-[#B9F36B]">
                {selfTeam.points}
              </p>
            </div>
            <div className="rounded-xl border border-[#223552] bg-[#08111F] p-2.5">
              <p className="text-[11px] text-[#9BB0CA]">Earned (Correct)</p>
              <p className="mt-0.5 font-mono tabular-nums text-base font-bold text-[#B9F36B]">
                +{teamStats.pointsEarnedCorrect}
              </p>
            </div>
            <div className="rounded-xl border border-[#223552] bg-[#08111F] p-2.5">
              <p className="text-[11px] text-[#9BB0CA]">Lost (Wrong)</p>
              <p className="mt-0.5 font-mono tabular-nums text-base font-bold text-[#F05252]">
                -{teamStats.pointsLostWrong}
              </p>
            </div>
            <div className="rounded-xl border border-[#223552] bg-[#08111F] p-2.5">
              <p className="text-[11px] text-[#9BB0CA]">Leaderboard Pos.</p>
              <p className="mt-0.5 font-mono tabular-nums text-base font-bold text-[#F5B731]">
                {myRank !== null ? `#${myRank}` : '—'}
              </p>
            </div>
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
              Final official standings ranked by Competition Points and total response time.
            </p>
          </div>
          <PodiumDisplay entries={snapshot.leaderboard} />
          <LeaderboardTable entries={snapshot.leaderboard} highlightTeamId={selfTeam.id} />
        </section>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Left / Main Auction Area */}
          <div className="lg:col-span-7 space-y-5">
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

            {isWinner && (
              <div className="rounded-2xl border border-[#B9F36B]/60 bg-[#B9F36B]/10 p-5 space-y-2">
                <p className="font-display text-lg font-extrabold text-[#B9F36B]">
                  Your team has won the auction!
                </p>
                <p className="text-sm text-[#EEF5FF]">
                  Listen closely to the host and give your answer verbally.
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

            {/* Current Auction Item & Timer Card */}
            <div className="rounded-2xl border border-[#223552] bg-[#111E31] p-5 sm:p-6 space-y-5">
              {currentItem ? (
                <>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-[#51D6E8]">
                        Item #{displayItemNumber} of {room.itemCount} · {currentItem.category}
                        {' · '}Start {currentItem.startingBid} coins
                      </p>
                      <h2 className="mt-0.5 font-display text-xl sm:text-2xl font-extrabold text-[#EEF5FF]">
                        {currentItem.itemName}
                      </h2>
                    </div>

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

                  {/* Crisp Uploaded Item Photograph Preview */}
                  <div className="aspect-video max-h-[220px] w-full rounded-xl border border-[#223552] bg-[#08111F] overflow-hidden flex items-center justify-center">
                    {hasItemPhoto ? (
                      <img
                        src={currentItem.imageOrEmoji}
                        alt={currentItem.itemName}
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <div className="text-center space-y-1 p-4">
                        <span className="block text-5xl">
                          {currentItem.imageOrEmoji || '💻'}
                        </span>
                        <span className="block text-xs text-[#9BB0CA]">
                          Item #{displayItemNumber} · {currentItem.itemName}
                        </span>
                      </div>
                    )}
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

            {/* Desktop Inline Bidding Panel */}
            <div className="hidden lg:block rounded-2xl border border-[#223552] bg-[#111E31] p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-base font-bold text-[#EEF5FF]">
                  Place Bid (Using Bidding Coins)
                </h3>
                <span className="text-xs font-mono tabular-nums text-[#9BB0CA]">
                  Min: {minRequiredBid} coins (+{inc}) · Available: {selfTeam.coinBalance}
                </span>
              </div>

              {isHighestBidder && isAuctionOpen && (
                <p className="text-sm font-semibold text-[#B9F36B]">
                  You are currently the highest bidder. Wait for another team or timer completion.
                </p>
              )}

              {isAuctionOpen && insufficientForMinBid && !isHighestBidder && (
                <p className="text-sm font-semibold text-[#F05252]">
                  Insufficient Bidding Coins ({selfTeam.coinBalance} coins) to meet the minimum bid
                  of {minRequiredBid} coins.
                </p>
              )}

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={!isAuctionOpen}
                  onClick={() =>
                    setBidAmount(
                      String(Math.max(minRequiredBid, Number(bidAmount || minRequiredBid) - inc)),
                    )
                  }
                  className="min-h-[48px] min-w-[48px] flex items-center justify-center rounded-xl border border-[#223552] bg-[#172740] text-[#EEF5FF] hover:bg-[#1e3252] disabled:opacity-40"
                  aria-label="Decrease bid"
                >
                  <Minus className="h-5 w-5" />
                </button>
                <input
                  type="number"
                  min={minRequiredBid}
                  max={Math.max(minRequiredBid, selfTeam.coinBalance)}
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
                    setBidAmount(
                      String(Math.max(minRequiredBid, Number(bidAmount || minRequiredBid) + inc)),
                    )
                  }
                  className="min-h-[48px] min-w-[48px] flex items-center justify-center rounded-xl border border-[#223552] bg-[#172740] text-[#EEF5FF] hover:bg-[#1e3252] disabled:opacity-40"
                  aria-label="Increase bid"
                >
                  <Plus className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  disabled={
                    !isAuctionOpen ||
                    isHighestBidder ||
                    submittingBid ||
                    Number(bidAmount) > selfTeam.coinBalance
                  }
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
                    disabled={
                      !isAuctionOpen ||
                      isHighestBidder ||
                      submittingBid ||
                      preset > selfTeam.coinBalance
                    }
                    onClick={() => {
                      setBidAmount(String(preset));
                      void placeBid(preset);
                    }}
                    className="min-h-[40px] rounded-lg border border-[#223552] bg-[#172740] px-3.5 text-xs font-mono font-semibold text-[#EEF5FF] hover:border-[#51D6E8] disabled:opacity-40 transition-colors"
                  >
                    Quick Bid {preset} coins
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Right Column: Live Bids, Leaderboard & Recent Transactions */}
          <div className="lg:col-span-5 space-y-4">
            <div className="grid grid-cols-3 gap-1 rounded-xl border border-[#223552] bg-[#111E31] p-1">
              <button
                type="button"
                onClick={() => setActiveTab('bids')}
                className={`min-h-[40px] rounded-lg text-xs font-semibold transition-colors ${
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
                className={`min-h-[40px] rounded-lg text-xs font-semibold transition-colors ${
                  activeTab === 'leaderboard'
                    ? 'bg-[#172740] text-[#51D6E8]'
                    : 'text-[#9BB0CA] hover:text-[#EEF5FF]'
                }`}
              >
                Leaderboard
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('transactions')}
                className={`min-h-[40px] rounded-lg text-xs font-semibold transition-colors ${
                  activeTab === 'transactions'
                    ? 'bg-[#172740] text-[#51D6E8]'
                    : 'text-[#9BB0CA] hover:text-[#EEF5FF]'
                }`}
              >
                Ledger ({snapshot.recentTransactions.length})
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
                          #{b.sequenceNumber} · {new Date(b.serverTimestamp).toLocaleTimeString()}
                        </p>
                      </div>
                      <span className="font-mono tabular-nums text-base font-bold text-[#51D6E8]">
                        {b.bidAmount}c
                      </span>
                    </div>
                  ))
                )}
              </div>
            ) : activeTab === 'leaderboard' ? (
              <LeaderboardTable
                entries={snapshot.leaderboard}
                highlightTeamId={selfTeam.id}
                compact
              />
            ) : (
              <div className="rounded-2xl border border-[#223552] bg-[#111E31] p-4 space-y-2 max-h-[420px] overflow-y-auto">
                {snapshot.recentTransactions.length === 0 ? (
                  <p className="py-8 text-center text-sm text-[#9BB0CA]">
                    No Coin or Point transactions yet.
                  </p>
                ) : (
                  snapshot.recentTransactions.map((tx) => (
                    <div
                      key={tx.id}
                      className="rounded-xl border border-[#223552]/80 bg-[#08111F]/80 px-3.5 py-2.5 text-xs flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-[#EEF5FF] truncate">{tx.reason}</p>
                        <p className="text-[11px] font-mono text-[#9BB0CA]">
                          {tx.currencyType} · {tx.transactionType} ·{' '}
                          {new Date(tx.timestamp).toLocaleTimeString()}
                        </p>
                      </div>
                      <div className="text-right font-mono tabular-nums shrink-0">
                        <span
                          className={`block font-bold ${
                            tx.actualChange >= 0
                              ? tx.currencyType === 'COINS'
                                ? 'text-[#51D6E8]'
                                : 'text-[#B9F36B]'
                              : 'text-[#F05252]'
                          }`}
                        >
                          {tx.actualChange >= 0 ? `+${tx.actualChange}` : tx.actualChange}{' '}
                          {tx.currencyType === 'COINS' ? 'c' : 'pts'}
                        </span>
                        <span className="text-[11px] text-[#9BB0CA]">Bal: {tx.newBalance}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Mobile Sticky Bottom Thumb-Zone Bidding Controls */}
      {room.machineState !== 'ROOM_COMPLETED' && (
        <div className="lg:hidden fixed bottom-0 left-0 right-0 z-30 border-t border-[#223552] bg-[#08111F]/95 backdrop-blur-md px-3 py-3">
          <div className="mx-auto max-w-lg space-y-2">
            <div className="flex items-center justify-between text-xs text-[#9BB0CA]">
              <span className="font-mono tabular-nums">
                Min: {minRequiredBid}c (+{inc}) · Coins: {selfTeam.coinBalance}
              </span>
              {isHighestBidder && isAuctionOpen && (
                <span className="font-semibold text-[#B9F36B]">You lead!</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={!isAuctionOpen}
                onClick={() =>
                  setBidAmount(
                    String(Math.max(minRequiredBid, Number(bidAmount || minRequiredBid) - inc)),
                  )
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
                  setBidAmount(
                    String(Math.max(minRequiredBid, Number(bidAmount || minRequiredBid) + inc)),
                  )
                }
                className="min-h-[48px] min-w-[48px] flex items-center justify-center rounded-xl border border-[#223552] bg-[#172740] text-[#EEF5FF] disabled:opacity-40"
                aria-label="Increase bid"
              >
                <Plus className="h-5 w-5" />
              </button>
              <button
                type="button"
                disabled={
                  !isAuctionOpen ||
                  isHighestBidder ||
                  submittingBid ||
                  Number(bidAmount) > selfTeam.coinBalance
                }
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
