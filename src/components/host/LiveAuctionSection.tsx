import {
  AlertTriangle,
  ArrowRight,
  Check,
  Pause,
  Play,
  RotateCcw,
  SkipForward,
  Square,
  Timer,
  Undo2,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  advanceToNextItem,
  closeAuctionTransaction,
  evaluateAnswerTransaction,
  pauseCurrentSession,
  refundCancelledAuctionTransaction,
  restartClosedAuction,
  resumeCurrentSession,
  RoomActionError,
  startAnswerTimer,
  startAuction,
} from '../../lib/firestoreAuction.ts';
import { useServerCountdown } from '../../lib/useServerCountdown.ts';
import { isRenderableImageSrc, formatResponseTime, type HostRoomSnapshot } from '../../shared/types.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';

interface LiveAuctionSectionProps {
  snapshot: HostRoomSnapshot;
  onShowResults: () => void;
}

export function LiveAuctionSection({ snapshot, onShowResults }: LiveAuctionSectionProps) {
  const { room, currentHostItem, currentAuction, currentAnswerSession, allAuctionBids } = snapshot;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRefundOpen, setConfirmRefundOpen] = useState(false);
  const autoClosedAuctionRef = useRef<string | null>(null);
  const actionLockRef = useRef(false);

  const auctionRemainingMs = useServerCountdown(
    room.machineState === 'AUCTION_OPEN' ? currentAuction?.deadlineTimestamp : null,
    snapshot.serverTime,
    room.isPaused,
    room.pausedRemainingMs,
  );

  const answerRemainingMs = useServerCountdown(
    room.machineState === 'ANSWER_RUNNING'
      ? currentAnswerSession?.answerDeadlineTimestamp
      : null,
    snapshot.serverTime,
    room.isPaused,
    room.pausedRemainingMs,
  );

  const answerTimerExpired =
    room.machineState === 'ANSWER_RUNNING' && !room.isPaused && answerRemainingMs === 0;

  // Automatically close the auction atomically in Firestore when timer hits 0.0s
  useEffect(() => {
    if (
      room.machineState === 'AUCTION_OPEN' &&
      !room.isPaused &&
      currentAuction &&
      currentAuction.auctionStatus === 'OPEN' &&
      auctionRemainingMs === 0 &&
      autoClosedAuctionRef.current !== currentAuction.id
    ) {
      autoClosedAuctionRef.current = currentAuction.id;
      closeAuctionTransaction(room.id, currentAuction.id).catch((err) => {
        autoClosedAuctionRef.current = null;
        setError(err instanceof Error ? err.message : 'Unable to close expired auction.');
      });
    }
  }, [room.id, room.machineState, room.isPaused, currentAuction, auctionRemainingMs]);

  const runAction = async (fn: () => Promise<unknown>) => {
    if (actionLockRef.current || busy) return;
    actionLockRef.current = true;
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(
        err instanceof RoomActionError || err instanceof Error ? err.message : 'Action failed.',
      );
    } finally {
      actionLockRef.current = false;
      setBusy(false);
    }
  };

  const canStartAuction = ['ROOM_WAITING', 'ROOM_READY', 'NEXT_ITEM_PENDING'].includes(
    room.machineState,
  );
  const isAuctionOpen = room.machineState === 'AUCTION_OPEN';
  const isWinnerStage = ['WINNER_SELECTED', 'ANSWER_PENDING', 'ANSWER_RUNNING'].includes(
    room.machineState,
  );

  const canRefundCancelled =
    Boolean(currentAuction?.bidDeducted) &&
    !currentAuction?.bidRefunded &&
    (isWinnerStage || room.machineState === 'AUCTION_CLOSED');

  const currentItemIdx = currentHostItem
    ? snapshot.items.findIndex((i) => i.id === currentHostItem.id)
    : -1;
  const displayItemNumber =
    currentItemIdx >= 0
      ? currentItemIdx + 1
      : Math.min(room.currentItemIndex + 1, Math.max(1, room.itemCount));

  const winningTeam = currentAnswerSession
    ? snapshot.teams.find((t) => t.id === currentAnswerSession.winningTeamId) ?? null
    : null;

  const currCoins = winningTeam?.coinBalance ?? 0;
  const currPts = winningTeam?.points ?? 0;
  const correctNewCoins = currCoins + room.settings.correctCoinReward;
  const correctNewPts = currPts + room.settings.correctPointReward;
  const wrongNewCoins = Math.max(0, currCoins - room.settings.wrongCoinPenalty);
  const wrongNewPts = room.settings.allowNegativePoints
    ? currPts - room.settings.wrongPointPenalty
    : Math.max(0, currPts - room.settings.wrongPointPenalty);

  const hasItemPhoto = isRenderableImageSrc(currentHostItem?.imageOrEmoji);

  return (
    <div className="space-y-6">
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-[#F05252]/40 bg-[#F05252]/10 px-4 py-3 text-sm text-[#F05252]"
        >
          {error}
        </div>
      )}

      {room.machineState === 'ROOM_COMPLETED' ? (
        <div className="rounded-2xl border border-[#B9F36B]/40 bg-[#172740] p-8 text-center space-y-4">
          <h2 className="font-display text-2xl font-extrabold text-[#EEF5FF]">
            Auction Event Completed
          </h2>
          <p className="text-sm text-[#9BB0CA]">
            All items are finished. Review the final podium, export CSV reports, or create a new
            room.
          </p>
          <button
            type="button"
            onClick={onShowResults}
            className="min-h-[44px] rounded-xl bg-[#51D6E8] px-6 text-sm font-bold text-[#08111F]"
          >
            View Final Results
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Control Panel (7 cols) */}
          <div className="lg:col-span-7 space-y-5">
            {/* Current Item & Photograph Display */}
            <div className="rounded-2xl border border-[#223552] bg-[#111E31] p-6 space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-[#51D6E8]">
                    {room.humanStatus} · Item #{displayItemNumber} of {room.itemCount}
                  </p>
                  <h2 className="mt-1 font-display text-2xl font-extrabold text-[#EEF5FF]">
                    {currentHostItem ? currentHostItem.itemName : 'No Auction Item Selected'}
                  </h2>
                  {currentHostItem && (
                    <p className="mt-1 text-xs text-[#9BB0CA]">
                      {currentHostItem.category}
                      {' · '}Starting Bid {currentHostItem.startingBid} coins
                    </p>
                  )}
                </div>

                <div className="text-right shrink-0">
                  <p className="text-xs text-[#9BB0CA]">
                    {room.machineState === 'ANSWER_RUNNING' ? 'Answer Timer' : 'Auction Timer'}
                  </p>
                  <p
                    className={`font-mono tabular-nums text-4xl font-extrabold ${
                      room.isPaused
                        ? 'text-[#F5B731]'
                        : isAuctionOpen
                          ? 'text-[#51D6E8]'
                          : room.machineState === 'ANSWER_RUNNING'
                            ? 'text-[#F5B731]'
                            : 'text-[#9BB0CA]'
                    }`}
                  >
                    {isAuctionOpen
                      ? `${(auctionRemainingMs / 1000).toFixed(1)}s`
                      : room.machineState === 'ANSWER_RUNNING'
                        ? `${(answerRemainingMs / 1000).toFixed(1)}s`
                        : room.isPaused
                          ? 'PAUSED'
                          : '—'}
                  </p>
                </div>
              </div>

              {/* Crisp Auction Item Photograph Display */}
              {currentHostItem && (
                <div className="aspect-video max-h-[260px] w-full rounded-xl border border-[#223552] bg-[#08111F] overflow-hidden flex items-center justify-center">
                  {hasItemPhoto ? (
                    <img
                      src={currentHostItem.imageOrEmoji}
                      alt={currentHostItem.itemName}
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <div className="text-center space-y-1 p-4">
                      <span className="block text-6xl">
                        {currentHostItem.imageOrEmoji || '💻'}
                      </span>
                      <span className="block text-xs text-[#9BB0CA]">
                        Item #{displayItemNumber} · {currentHostItem.itemName}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Highest Bid Readout */}
              <div className="grid grid-cols-2 gap-3 rounded-xl border border-[#223552] bg-[#172740]/60 p-4">
                <div>
                  <p className="text-xs text-[#9BB0CA]">Highest Bid (Coins)</p>
                  <p className="font-mono tabular-nums text-2xl font-extrabold text-[#51D6E8]">
                    {currentAuction?.highestBidderTeamId ? currentAuction.highestBid : 0}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[#9BB0CA]">Leading Team</p>
                  <p className="font-display text-lg font-bold text-[#B9F36B] truncate">
                    {currentAuction?.highestBidderTeamName || 'No bids yet'}
                  </p>
                </div>
              </div>

              {/* Auction Stage Controls */}
              <div className="flex flex-wrap gap-2.5">
                {canStartAuction && (
                  <button
                    type="button"
                    disabled={busy || !currentHostItem}
                    onClick={() =>
                      currentHostItem && runAction(() => startAuction(room.id, currentHostItem))
                    }
                    className="min-h-[46px] inline-flex items-center gap-2 rounded-xl bg-[#51D6E8] px-5 text-sm font-bold text-[#08111F] hover:bg-[#6de0ef] disabled:opacity-40"
                  >
                    <Play className="h-4 w-4" />
                    Start Auction
                  </button>
                )}

                {(isAuctionOpen || room.machineState === 'ANSWER_RUNNING') && !room.isPaused && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => runAction(() => pauseCurrentSession(room.id))}
                    className="min-h-[46px] inline-flex items-center gap-2 rounded-xl border border-[#F5B731]/50 bg-[#F5B731]/10 px-4 text-sm font-semibold text-[#F5B731] hover:bg-[#F5B731]/20"
                  >
                    <Pause className="h-4 w-4" />
                    Pause
                  </button>
                )}

                {room.isPaused && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => runAction(() => resumeCurrentSession(room.id))}
                    className="min-h-[46px] inline-flex items-center gap-2 rounded-xl bg-[#B9F36B] px-5 text-sm font-bold text-[#08111F] hover:bg-[#c8f68a]"
                  >
                    <Play className="h-4 w-4" />
                    Resume
                  </button>
                )}

                {isAuctionOpen && currentAuction && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      runAction(() => closeAuctionTransaction(room.id, currentAuction.id))
                    }
                    className="min-h-[46px] inline-flex items-center gap-2 rounded-xl border border-[#F05252]/50 bg-[#F05252]/10 px-4 text-sm font-semibold text-[#F05252] hover:bg-[#F05252]/20"
                  >
                    <Square className="h-4 w-4" />
                    End Auction Now
                  </button>
                )}

                {room.machineState === 'AUCTION_CLOSED' && (
                  <>
                    <button
                      type="button"
                      disabled={busy || !currentHostItem}
                      onClick={() =>
                        currentHostItem &&
                        runAction(() => restartClosedAuction(room.id, currentHostItem))
                      }
                      className="min-h-[46px] inline-flex items-center gap-2 rounded-xl bg-[#51D6E8] px-5 text-sm font-bold text-[#08111F]"
                    >
                      <RotateCcw className="h-4 w-4" />
                      Restart Auction
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => runAction(() => evaluateAnswerTransaction(room.id, 'SKIPPED'))}
                      className="min-h-[46px] inline-flex items-center gap-2 rounded-xl border border-[#223552] bg-[#172740] px-4 text-sm font-semibold text-[#EEF5FF]"
                    >
                      <SkipForward className="h-4 w-4" />
                      Skip Item
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Host Answer Evaluation Panel (Feature 5) */}
            {isWinnerStage && currentAnswerSession && (
              <div className="rounded-2xl border border-[#B9F36B]/50 bg-[#172740] p-6 space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex items-center gap-3.5 min-w-0">
                    {currentHostItem && (
                      <div className="h-14 w-16 shrink-0 rounded-xl border border-[#223552] bg-[#08111F] overflow-hidden flex items-center justify-center">
                        {hasItemPhoto ? (
                          <img
                            src={currentHostItem.imageOrEmoji}
                            alt={currentHostItem.itemName}
                            referrerPolicy="no-referrer"
                            className="h-full w-full object-contain"
                          />
                        ) : (
                          <span className="text-2xl">{currentHostItem.imageOrEmoji || '💻'}</span>
                        )}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-wider text-[#B9F36B]">
                        Host Answer Evaluation · Item #{displayItemNumber}
                      </p>
                      <h3 className="mt-0.5 font-display text-2xl font-extrabold text-[#EEF5FF] truncate">
                        {currentAnswerSession.winningTeamName}
                      </h3>
                      <p className="text-xs text-[#9BB0CA]">
                        Item: <span className="font-semibold text-[#EEF5FF]">{currentHostItem?.itemName}</span>
                        {' · '}
                        <span className="font-mono">
                          Winning Bid: {currentAuction?.highestBid || 0} coins
                          {currentAuction?.bidDeducted
                            ? ` (${currentAuction.deductedAmount} coins deducted)`
                            : ' (not deducted)'}
                        </span>
                      </p>
                    </div>
                  </div>

                  {room.machineState !== 'ANSWER_RUNNING' && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        runAction(() =>
                          startAnswerTimer(
                            room.id,
                            currentAnswerSession.id,
                            currentHostItem?.answerDurationOverride ?? null,
                          ),
                        )
                      }
                      className="min-h-[46px] inline-flex items-center gap-2 rounded-xl bg-[#F5B731] px-5 text-sm font-bold text-[#08111F] hover:bg-[#f7c557]"
                    >
                      <Timer className="h-4 w-4" />
                      Start Answer Timer (
                      {currentHostItem?.answerDurationOverride || room.settings.answerDurationSec}s)
                    </button>
                  )}
                </div>

                {/* Winning Team's Current Coin & Points Balances */}
                <div className="grid grid-cols-2 gap-3 rounded-xl border border-[#223552] bg-[#08111F] p-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-[#51D6E8]">
                      Remaining Coin Balance
                    </p>
                    <p className="mt-0.5 font-mono tabular-nums text-2xl font-extrabold text-[#51D6E8]">
                      {winningTeam ? `${currCoins} coins` : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-[#B9F36B]">
                      Current Points Balance
                    </p>
                    <p className="mt-0.5 font-mono tabular-nums text-2xl font-extrabold text-[#B9F36B]">
                      {winningTeam ? `${currPts} pts` : '—'}
                    </p>
                  </div>
                </div>

                {answerTimerExpired && (
                  <div
                    role="alert"
                    className="rounded-xl border border-[#F5B731]/50 bg-[#F5B731]/15 px-4 py-3 flex items-center gap-2.5 text-sm font-semibold text-[#F5B731]"
                  >
                    <AlertTriangle className="h-5 w-5 shrink-0" />
                    <span>
                      Answer time is over. Evaluate the winning team&apos;s verbal response below.
                    </span>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => runAction(() => evaluateAnswerTransaction(room.id, 'CORRECT'))}
                    className="min-h-[82px] flex flex-col items-center justify-center rounded-xl bg-[#B9F36B] px-5 py-3 text-[#08111F] hover:bg-[#c8f68a] transition-colors disabled:opacity-50"
                  >
                    <span className="inline-flex items-center gap-2 text-base font-extrabold">
                      <Check className="h-5 w-5" />
                      CORRECT ANSWER
                    </span>
                    <span className="mt-0.5 font-mono text-xs font-bold">
                      +{room.settings.correctCoinReward} Coins · +
                      {room.settings.correctPointReward} Points
                    </span>
                    {winningTeam && (
                      <span className="mt-1 font-mono text-[11px] font-semibold text-[#08111F]/80">
                        Coins: {currCoins} → {correctNewCoins} | Pts: {currPts} → {correctNewPts}
                      </span>
                    )}
                  </button>

                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => runAction(() => evaluateAnswerTransaction(room.id, 'WRONG'))}
                    className="min-h-[82px] flex flex-col items-center justify-center rounded-xl bg-[#F05252] px-5 py-3 text-white hover:bg-[#e13f3f] transition-colors disabled:opacity-50"
                  >
                    <span className="inline-flex items-center gap-2 text-base font-extrabold">
                      <X className="h-5 w-5" />
                      WRONG ANSWER
                    </span>
                    <span className="mt-0.5 font-mono text-xs font-bold">
                      -{room.settings.wrongCoinPenalty} Coins · -{room.settings.wrongPointPenalty}{' '}
                      Points
                    </span>
                    {winningTeam && (
                      <span className="mt-1 font-mono text-[11px] font-semibold text-white/90">
                        Coins: {currCoins} → {wrongNewCoins} | Pts: {currPts} → {wrongNewPts}
                      </span>
                    )}
                  </button>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  {canRefundCancelled && currentAuction && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setConfirmRefundOpen(true)}
                      className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-[#F5B731]/50 bg-[#F5B731]/10 px-4 text-xs font-semibold text-[#F5B731] hover:bg-[#F5B731]/20"
                    >
                      <Undo2 className="h-3.5 w-3.5" />
                      Cancel Auction &amp; Refund {currentAuction.deductedAmount} Coins
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => runAction(() => evaluateAnswerTransaction(room.id, 'SKIPPED'))}
                    className="ml-auto min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-[#223552] bg-[#111E31] px-4 text-xs font-semibold text-[#9BB0CA] hover:text-[#EEF5FF]"
                  >
                    <SkipForward className="h-3.5 w-3.5" />
                    Skip / No Answer (0 Coins, 0 Pts)
                  </button>
                </div>
              </div>
            )}

            {/* Post-Evaluation Next Item Panel */}
            {room.machineState === 'ANSWER_EVALUATED' && (
              <div className="rounded-2xl border border-[#51D6E8]/40 bg-[#111E31] p-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold text-[#51D6E8]">
                      Evaluation Recorded · Item #{displayItemNumber}
                    </p>
                    <p className="mt-1 text-base font-bold text-[#EEF5FF]">
                      {snapshot.lastAnnouncement}
                    </p>
                    {currentAnswerSession?.responseTimeMs !== null &&
                      currentAnswerSession?.responseTimeMs !== undefined && (
                        <p className="text-xs font-mono text-[#9BB0CA]">
                          Response Time: {formatResponseTime(currentAnswerSession.responseTimeMs)}
                        </p>
                      )}
                  </div>

                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => runAction(() => advanceToNextItem(room.id))}
                    className="min-h-[48px] inline-flex items-center gap-2 rounded-xl bg-[#51D6E8] px-6 text-sm font-bold text-[#08111F] hover:bg-[#6de0ef]"
                  >
                    {room.unusedItemCount > 0 ? 'Next Item' : 'Finish Event & Final Results'}
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>

                {winningTeam && (
                  <div className="grid grid-cols-2 gap-3 rounded-xl border border-[#223552] bg-[#08111F] p-3.5">
                    <div>
                      <p className="text-[11px] text-[#9BB0CA]">
                        {winningTeam.teamName} · Updated Coins
                      </p>
                      <p className="font-mono tabular-nums text-lg font-extrabold text-[#51D6E8]">
                        {winningTeam.coinBalance} coins
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] text-[#9BB0CA]">
                        {winningTeam.teamName} · Updated Points
                      </p>
                      <p className="font-mono tabular-nums text-lg font-extrabold text-[#B9F36B]">
                        {winningTeam.points} pts
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Live Bid History Feed (5 cols) */}
          <div className="lg:col-span-5 rounded-2xl border border-[#223552] bg-[#111E31] p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-[#223552] pb-3">
              <h3 className="font-display text-base font-bold text-[#EEF5FF]">
                Live Bid Stream
              </h3>
              <span className="text-xs font-mono text-[#9BB0CA]">
                {allAuctionBids.length} attempts
              </span>
            </div>

            {allAuctionBids.length === 0 ? (
              <p className="py-10 text-center text-sm text-[#9BB0CA]">
                Waiting for incoming team bids...
              </p>
            ) : (
              <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
                {allAuctionBids.map((b) => (
                  <div
                    key={b.id}
                    className={`rounded-xl border px-3.5 py-2.5 text-xs ${
                      b.status === 'ACCEPTED'
                        ? 'border-[#223552] bg-[#08111F]'
                        : 'border-[#F05252]/30 bg-[#F05252]/5'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-[#EEF5FF] truncate">{b.teamName}</span>
                      <span
                        className={`font-mono tabular-nums font-bold ${
                          b.status === 'ACCEPTED' ? 'text-[#51D6E8]' : 'text-[#F05252]'
                        }`}
                      >
                        {b.bidAmount} coins · {b.status}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[11px] text-[#9BB0CA] font-mono">
                      <span>
                        Seq #{b.sequenceNumber} ·{' '}
                        {new Date(b.serverTimestamp).toLocaleTimeString()}
                      </span>
                      {b.rejectionReason && (
                        <span className="text-[#F05252] truncate max-w-[180px]">
                          {b.rejectionReason}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmRefundOpen}
        title="Cancel Auction & Refund Bid?"
        description={`Cancel the current round and refund ${currentAuction?.deductedAmount || 0} Bidding Coins back to ${currentAuction?.highestBidderTeamName || 'the winning team'}?`}
        confirmLabel="Refund Coins & Skip Item"
        variant="primary"
        busy={busy}
        onConfirm={() => {
          if (!currentAuction) return;
          setConfirmRefundOpen(false);
          runAction(() => refundCancelledAuctionTransaction(room.id, currentAuction.id));
        }}
        onCancel={() => setConfirmRefundOpen(false)}
      />
    </div>
  );
}
