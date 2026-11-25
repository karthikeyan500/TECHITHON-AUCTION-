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
  X,
} from 'lucide-react';
import { useState } from 'react';
import { apiRequest, ApiError } from '../../lib/api.ts';
import { useServerCountdown } from '../../lib/useServerCountdown.ts';
import { formatResponseTime, type HostRoomSnapshot } from '../../shared/types.ts';

interface LiveAuctionSectionProps {
  snapshot: HostRoomSnapshot;
  onSnapshotUpdate: (snap: HostRoomSnapshot) => void;
  onShowResults: () => void;
}

export function LiveAuctionSection({
  snapshot,
  onSnapshotUpdate,
  onShowResults,
}: LiveAuctionSectionProps) {
  const { room, currentHostItem, currentAuction, currentAnswerSession, allAuctionBids } = snapshot;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const callAction = async (path: string, body?: unknown) => {
    setError(null);
    setBusy(true);
    try {
      const next = await apiRequest<HostRoomSnapshot>(`/api/host/rooms/${room.id}${path}`, {
        method: 'POST',
        authMode: 'host',
        body: body ? JSON.stringify(body) : undefined,
      });
      onSnapshotUpdate(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Action failed.');
    } finally {
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
            {/* Current Item & Host-Only Question Card */}
            <div className="rounded-2xl border border-[#223552] bg-[#111E31] p-6 space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold text-[#51D6E8]">
                    {room.humanStatus} · Item {Math.min(room.currentItemIndex + 1, Math.max(1, room.itemCount))} of {room.itemCount}
                  </p>
                  <h2 className="mt-1 font-display text-2xl font-extrabold text-[#EEF5FF]">
                    {currentHostItem ? (
                      <>
                        <span className="mr-2">{currentHostItem.imageOrEmoji}</span>
                        {currentHostItem.itemName}
                      </>
                    ) : (
                      'No Auction Item Selected'
                    )}
                  </h2>
                  {currentHostItem && (
                    <p className="mt-1 text-xs text-[#9BB0CA]">
                      {currentHostItem.category}
                      {currentHostItem.difficulty ? ` · ${currentHostItem.difficulty}` : ''}
                      {' · '}Starting Bid {currentHostItem.startingBid} coins
                    </p>
                  )}
                </div>

                <div className="text-right">
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

              {/* Host-Only Question Prompt */}
              {currentHostItem && (
                <div className="rounded-xl border border-[#223552] bg-[#08111F] p-4 space-y-1.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-[#F5B731]">
                    Host-Only Question (Read Verbally to Winning Team)
                  </p>
                  <p className="text-base font-bold text-[#EEF5FF]">
                    {currentHostItem.questionTitle}
                  </p>
                  {currentHostItem.questionDescription && (
                    <p className="text-sm text-[#9BB0CA]">{currentHostItem.questionDescription}</p>
                  )}
                </div>
              )}

              {/* Highest Bid Readout */}
              <div className="grid grid-cols-2 gap-3 rounded-xl border border-[#223552] bg-[#172740]/60 p-4">
                <div>
                  <p className="text-xs text-[#9BB0CA]">Highest Bid</p>
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
                    onClick={() => callAction('/auction/start')}
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
                    onClick={() => callAction('/auction/pause')}
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
                    onClick={() => callAction('/auction/resume')}
                    className="min-h-[46px] inline-flex items-center gap-2 rounded-xl bg-[#B9F36B] px-5 text-sm font-bold text-[#08111F] hover:bg-[#c8f68a]"
                  >
                    <Play className="h-4 w-4" />
                    Resume
                  </button>
                )}

                {isAuctionOpen && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => callAction('/auction/end')}
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
                      disabled={busy}
                      onClick={() => callAction('/auction/restart')}
                      className="min-h-[46px] inline-flex items-center gap-2 rounded-xl bg-[#51D6E8] px-5 text-sm font-bold text-[#08111F]"
                    >
                      <RotateCcw className="h-4 w-4" />
                      Restart Auction
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => callAction('/answer/evaluate', { decision: 'SKIPPED' })}
                      className="min-h-[46px] inline-flex items-center gap-2 rounded-xl border border-[#223552] bg-[#172740] px-4 text-sm font-semibold text-[#EEF5FF]"
                    >
                      <SkipForward className="h-4 w-4" />
                      Skip Item
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Answer Evaluation Panel */}
            {isWinnerStage && currentAnswerSession && (
              <div className="rounded-2xl border border-[#B9F36B]/50 bg-[#172740] p-6 space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-[#B9F36B]">
                      Winning Team Selected
                    </p>
                    <h3 className="mt-0.5 font-display text-2xl font-extrabold text-[#EEF5FF]">
                      {currentAnswerSession.winningTeamName}
                    </h3>
                    <p className="text-xs text-[#9BB0CA] font-mono">
                      Final Bid: {currentAuction?.highestBid || 0} coins
                    </p>
                  </div>

                  {room.machineState !== 'ANSWER_RUNNING' && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => callAction('/answer/start')}
                      className="min-h-[46px] inline-flex items-center gap-2 rounded-xl bg-[#F5B731] px-5 text-sm font-bold text-[#08111F] hover:bg-[#f7c557]"
                    >
                      <Timer className="h-4 w-4" />
                      Start Answer Timer ({currentHostItem?.answerDurationOverride || room.settings.answerDurationSec}s)
                    </button>
                  )}
                </div>

                {answerTimerExpired && (
                  <div
                    role="alert"
                    className="rounded-xl border border-[#F5B731]/50 bg-[#F5B731]/15 px-4 py-3 flex items-center gap-2.5 text-sm font-semibold text-[#F5B731]"
                  >
                    <AlertTriangle className="h-5 w-5 shrink-0" />
                    <span>
                      Answer time is over. Listen to the final response and manually record Wrong,
                      Correct, or Skip below.
                    </span>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => callAction('/answer/evaluate', { decision: 'CORRECT' })}
                    className="min-h-[56px] flex items-center justify-center gap-2 rounded-xl bg-[#B9F36B] px-5 py-3 text-base font-extrabold text-[#08111F] hover:bg-[#c8f68a] transition-colors disabled:opacity-50"
                  >
                    <Check className="h-5 w-5" />
                    CORRECT ANSWER: +{room.settings.correctPoints}
                  </button>

                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => callAction('/answer/evaluate', { decision: 'WRONG' })}
                    className="min-h-[56px] flex items-center justify-center gap-2 rounded-xl bg-[#F05252] px-5 py-3 text-base font-extrabold text-white hover:bg-[#e13f3f] transition-colors disabled:opacity-50"
                  >
                    <X className="h-5 w-5" />
                    WRONG ANSWER: -{room.settings.wrongDeduction}
                  </button>
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => callAction('/answer/evaluate', { decision: 'SKIPPED' })}
                    className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-[#223552] bg-[#111E31] px-4 text-xs font-semibold text-[#9BB0CA] hover:text-[#EEF5FF]"
                  >
                    <SkipForward className="h-3.5 w-3.5" />
                    Skip / No Answer (0 pts)
                  </button>
                </div>
              </div>
            )}

            {/* Post-Evaluation Next Item Panel */}
            {room.machineState === 'ANSWER_EVALUATED' && (
              <div className="rounded-2xl border border-[#51D6E8]/40 bg-[#111E31] p-6 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold text-[#51D6E8]">Evaluation Recorded</p>
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
                  onClick={() => callAction('/auction/next')}
                  className="min-h-[48px] inline-flex items-center gap-2 rounded-xl bg-[#51D6E8] px-6 text-sm font-bold text-[#08111F] hover:bg-[#6de0ef]"
                >
                  {room.unusedItemCount > 0 ? 'Next Question' : 'Finish Event & Final Results'}
                  <ArrowRight className="h-4 w-4" />
                </button>
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
                        {b.bidAmount} · {b.status}
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
    </div>
  );
}
