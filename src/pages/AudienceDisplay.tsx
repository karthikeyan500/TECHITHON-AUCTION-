import { Maximize2, Minimize2, MonitorPlay, Trophy, Users, Wifi, WifiOff } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { LeaderboardTable } from '../components/LeaderboardTable.tsx';
import { PodiumDisplay } from '../components/PodiumDisplay.tsx';
import {
  fetchPublicRoomByCode,
  RoomActionError,
  subscribePublicRoom,
} from '../lib/firestoreAuction.ts';
import { useServerCountdown } from '../lib/useServerCountdown.ts';
import {
  formatResponseTime,
  isRenderableImageSrc,
  type PublicRoomSnapshot,
} from '../shared/types.ts';

export function AudienceDisplay() {
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<PublicRoomSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const loadRoom = useCallback(async (code: string) => {
    const normalized = code.trim().toUpperCase();
    if (!normalized) return;
    setLoading(true);
    setError(null);
    try {
      const snap = await fetchPublicRoomByCode(normalized);
      setSnapshot(snap);
      setActiveRoomId(snap.room.id);
      const url = new URL(window.location.href);
      url.searchParams.set('code', normalized);
      window.history.replaceState({}, '', url.toString());
    } catch (err) {
      setError(
        err instanceof RoomActionError || err instanceof Error
          ? err.message
          : 'Unable to load room.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code') || params.get('room');
    if (code) {
      setRoomCodeInput(code.toUpperCase());
      void loadRoom(code);
    }
  }, [loadRoom]);

  useEffect(() => {
    if (!activeRoomId) return;
    setConnected(true);
    const unsub = subscribePublicRoom(
      activeRoomId,
      (next) => {
        if (!next) {
          setError('Room has been closed by host.');
          setSnapshot(null);
          setActiveRoomId(null);
          return;
        }
        setConnected(true);
        setSnapshot(next);
      },
      () => {
        setConnected(false);
      },
    );
    return () => unsub();
  }, [activeRoomId]);

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggleFullscreen = async () => {
    if (!containerRef.current) return;
    try {
      if (!document.fullscreenElement) {
        await containerRef.current.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // ignore if fullscreen is blocked by iframe sandbox
    }
  };

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

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void loadRoom(roomCodeInput);
  };

  if (!snapshot) {
    return (
      <main className="mx-auto max-w-lg px-4 py-14">
        <div className="rounded-2xl border border-[#223552] bg-[#111E31] p-8 space-y-5 shadow-xl">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#51D6E8]/15 text-[#51D6E8]">
              <MonitorPlay className="h-6 w-6" />
            </div>
            <div>
              <h1 className="font-display text-2xl font-bold text-[#EEF5FF]">
                Audience Projector Display
              </h1>
              <p className="text-xs text-[#9BB0CA]">
                Enter the room code to mirror live auction status on stage
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="audience-room-code"
                className="block text-xs font-semibold text-[#9BB0CA] mb-1.5"
              >
                Room Code
              </label>
              <input
                id="audience-room-code"
                type="text"
                required
                value={roomCodeInput}
                onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())}
                placeholder="e.g. K7M4PQ"
                className="w-full min-h-[50px] rounded-xl border border-[#223552] bg-[#08111F] px-4 font-mono text-lg font-bold tracking-widest uppercase text-[#51D6E8] focus:border-[#51D6E8] focus:outline-none"
              />
            </div>

            {error && (
              <div
                role="alert"
                className="rounded-xl border border-[#F05252]/40 bg-[#F05252]/10 px-4 py-3 text-sm text-[#F05252]"
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="min-h-[48px] w-full rounded-xl bg-[#51D6E8] px-6 py-3 text-sm font-bold text-[#08111F] hover:bg-[#6de0ef] transition-colors disabled:opacity-50"
            >
              {loading ? 'Connecting...' : 'Launch Audience Display'}
            </button>
          </form>
        </div>
      </main>
    );
  }

  const { room, currentItem, currentAuction, currentAnswerSession, leaderboard } = snapshot;
  const displayItemNumber = Math.min(room.currentItemIndex + 1, Math.max(1, room.itemCount));
  const hasItemPhoto = isRenderableImageSrc(currentItem?.imageOrEmoji);
  const evaluatedEntry = currentAnswerSession
    ? leaderboard.find((e) => e.teamId === currentAnswerSession.winningTeamId) ?? null
    : null;

  return (
    <div
      ref={containerRef}
      className="min-h-[calc(100dvh-3.5rem)] bg-[#08111F] text-[#EEF5FF] px-4 sm:px-8 py-6 flex flex-col justify-between gap-6"
    >
      {/* Top Projector Bar */}
      <div className="mx-auto w-full max-w-7xl flex flex-wrap items-center justify-between gap-4 border-b border-[#223552] pb-4">
        <div>
          <p className="text-xs font-semibold tracking-wider text-[#51D6E8] uppercase">
            TECH AUCTION 2026 · Room {room.roomCode}
          </p>
          <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-[#EEF5FF]">
            {room.roomName}
          </h1>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-sm text-[#9BB0CA]">
            <Users className="h-4 w-4 text-[#51D6E8]" />
            <span className="font-mono tabular-nums font-bold text-[#EEF5FF]">
              {room.teamCount}
            </span>
            <span>Teams</span>
          </div>

          <div className="text-sm font-semibold text-[#B9F36B]">{room.humanStatus}</div>

          <div className="flex items-center gap-1.5 text-xs">
            {connected ? (
              <>
                <Wifi className="h-4 w-4 text-[#B9F36B]" />
                <span className="text-[#B9F36B]">Live</span>
              </>
            ) : (
              <>
                <WifiOff className="h-4 w-4 text-[#F5B731]" />
                <span className="text-[#F5B731]">Reconnecting</span>
              </>
            )}
          </div>

          <button
            type="button"
            onClick={toggleFullscreen}
            className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-[#223552] bg-[#111E31] px-3.5 py-2 text-xs font-semibold text-[#EEF5FF] hover:bg-[#172740] transition-colors"
          >
            {isFullscreen ? (
              <>
                <Minimize2 className="h-4 w-4" /> Exit Fullscreen
              </>
            ) : (
              <>
                <Maximize2 className="h-4 w-4" /> Fullscreen
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setSnapshot(null);
              setActiveRoomId(null);
            }}
            className="min-h-[40px] rounded-xl border border-[#223552] px-3 py-2 text-xs text-[#9BB0CA] hover:text-[#EEF5FF]"
          >
            Switch Room
          </button>
        </div>
      </div>

      {/* Main Stage Area */}
      <div className="mx-auto w-full max-w-7xl flex-1 flex flex-col justify-center">
        {room.machineState === 'ROOM_COMPLETED' ? (
          <div className="space-y-8">
            <div className="text-center space-y-2">
              <Trophy className="mx-auto h-14 w-14 text-[#F5B731]" />
              <h2 className="font-display text-4xl sm:text-5xl font-extrabold text-[#EEF5FF]">
                Final Event Standings
              </h2>
              <p className="text-base text-[#9BB0CA]">
                Congratulations to our winners! Ranked by Competition Points and response speed.
              </p>
            </div>
            <PodiumDisplay entries={leaderboard} large />
            <LeaderboardTable entries={leaderboard} />
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* Stage Spotlight (7 cols) */}
            <div className="lg:col-span-7 space-y-6">
              {room.machineState === 'ROOM_WAITING' && !currentItem ? (
                <div className="rounded-3xl border border-[#223552] bg-[#111E31] p-10 text-center space-y-6">
                  <p className="text-sm font-semibold tracking-wider text-[#51D6E8] uppercase">
                    Lobby Open
                  </p>
                  <h2 className="font-display text-4xl sm:text-5xl font-extrabold text-[#EEF5FF]">
                    Waiting for Teams to Join
                  </h2>
                  <p className="text-lg text-[#9BB0CA]">
                    Join on your mobile phone using Room Code:
                  </p>
                  <p className="font-mono text-5xl sm:text-6xl font-extrabold tracking-widest text-[#B9F36B]">
                    {room.roomCode}
                  </p>
                  <p className="text-sm text-[#9BB0CA]">
                    {room.teamCount} / {room.settings.maxTeams} teams connected
                  </p>
                </div>
              ) : (
                <div className="rounded-3xl border border-[#223552] bg-[#111E31] p-7 sm:p-9 space-y-6">
                  {currentItem && (
                    <>
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-[#51D6E8]">
                            Item #{displayItemNumber} of {room.itemCount} · {currentItem.category}
                            {' · '}Start {currentItem.startingBid} coins
                          </p>
                          <h2 className="mt-1 font-display text-3xl sm:text-4xl font-extrabold text-[#EEF5FF]">
                            {currentItem.itemName}
                          </h2>
                        </div>

                        <div className="text-left sm:text-right shrink-0">
                          <p className="text-xs font-semibold uppercase tracking-wider text-[#9BB0CA]">
                            {room.machineState === 'ANSWER_RUNNING'
                              ? 'Answer Countdown'
                              : 'Auction Countdown'}
                          </p>
                          <p
                            className={`font-mono tabular-nums text-5xl sm:text-6xl font-extrabold ${
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
                              ? `${(auctionRemainingMs / 1000).toFixed(1)}s`
                              : room.machineState === 'ANSWER_RUNNING'
                                ? `${(answerRemainingMs / 1000).toFixed(1)}s`
                                : room.isPaused
                                  ? 'PAUSED'
                                  : '—'}
                          </p>
                        </div>
                      </div>

                      {/* Crisp Uploaded Item Photograph Spotlight */}
                      <div className="aspect-video max-h-[300px] w-full rounded-2xl border border-[#223552] bg-[#08111F] overflow-hidden flex items-center justify-center">
                        {hasItemPhoto ? (
                          <img
                            src={currentItem.imageOrEmoji}
                            alt={currentItem.itemName}
                            referrerPolicy="no-referrer"
                            className="h-full w-full object-contain"
                          />
                        ) : (
                          <div className="text-center space-y-2 p-6">
                            <span className="block text-7xl">
                              {currentItem.imageOrEmoji || '💻'}
                            </span>
                            <span className="block text-sm text-[#9BB0CA]">
                              Item #{displayItemNumber} · {currentItem.itemName}
                            </span>
                          </div>
                        )}
                      </div>
                    </>
                  )}

                  {['WINNER_SELECTED', 'ANSWER_PENDING', 'ANSWER_RUNNING'].includes(
                    room.machineState,
                  ) && currentAnswerSession ? (
                    <div className="rounded-2xl border border-[#B9F36B]/50 bg-[#B9F36B]/10 p-6 sm:p-7 text-center space-y-2">
                      <p className="text-sm font-bold uppercase tracking-wider text-[#B9F36B]">
                        Auction Winner · Evaluating Response
                      </p>
                      <p className="font-display text-4xl sm:text-5xl font-extrabold text-[#EEF5FF]">
                        {currentAnswerSession.winningTeamName}
                      </p>
                      <p className="font-mono tabular-nums text-2xl font-bold text-[#51D6E8]">
                        Winning Bid: {currentAuction?.highestBid || 0} coins
                      </p>
                    </div>
                  ) : room.machineState === 'ANSWER_EVALUATED' && currentAnswerSession ? (
                    <div
                      className={`rounded-2xl border p-6 sm:p-7 text-center space-y-4 ${
                        currentAnswerSession.hostDecision === 'CORRECT'
                          ? 'border-[#B9F36B]/50 bg-[#B9F36B]/10'
                          : currentAnswerSession.hostDecision === 'WRONG'
                            ? 'border-[#F05252]/50 bg-[#F05252]/10'
                            : 'border-[#223552] bg-[#172740]'
                      }`}
                    >
                      <div className="space-y-1.5">
                        <p className="text-sm font-bold uppercase tracking-wider text-[#9BB0CA]">
                          Evaluation Complete
                        </p>
                        <p className="font-display text-4xl font-extrabold text-[#EEF5FF]">
                          {currentAnswerSession.winningTeamName} —{' '}
                          <span
                            className={
                              currentAnswerSession.hostDecision === 'CORRECT'
                                ? 'text-[#B9F36B]'
                                : currentAnswerSession.hostDecision === 'WRONG'
                                  ? 'text-[#F05252]'
                                  : 'text-[#9BB0CA]'
                            }
                          >
                            {currentAnswerSession.hostDecision}
                          </span>
                        </p>
                        {currentAnswerSession.responseTimeMs !== null && (
                          <p className="font-mono tabular-nums text-base text-[#9BB0CA]">
                            Response Time: {formatResponseTime(currentAnswerSession.responseTimeMs)}
                          </p>
                        )}
                      </div>

                      {evaluatedEntry && (
                        <div className="grid grid-cols-2 gap-4 rounded-xl border border-[#223552] bg-[#08111F]/90 p-4 text-left">
                          <div>
                            <p className="text-xs text-[#9BB0CA]">Updated Virtual Coins</p>
                            <p className="font-mono tabular-nums text-2xl font-extrabold text-[#51D6E8]">
                              {evaluatedEntry.coinBalance} coins
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-[#9BB0CA]">Updated Competition Points</p>
                            <p className="font-mono tabular-nums text-2xl font-extrabold text-[#B9F36B]">
                              {evaluatedEntry.points} pts
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-2xl border border-[#223552] bg-[#08111F] p-6">
                      <div>
                        <p className="text-sm text-[#9BB0CA]">Current Highest Bid (Coins)</p>
                        <p className="mt-1 font-mono tabular-nums text-5xl font-extrabold text-[#51D6E8]">
                          {currentAuction?.highestBidderTeamId
                            ? currentAuction.highestBid
                            : currentItem?.startingBid ?? 0}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-[#9BB0CA]">Highest Bidding Team</p>
                        <p className="mt-2 font-display text-3xl font-extrabold text-[#B9F36B] truncate">
                          {currentAuction?.highestBidderTeamName || 'Awaiting First Bid'}
                        </p>
                      </div>
                    </div>
                  )}

                  {snapshot.lastAnnouncement && (
                    <p className="text-base font-medium text-[#EEF5FF] border-t border-[#223552] pt-4">
                      {snapshot.lastAnnouncement}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Live Leaderboard Panel (5 cols) */}
            <div className="lg:col-span-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-xl font-bold text-[#EEF5FF]">Live Standings</h2>
                <span className="text-xs text-[#9BB0CA]">Points · Coins · Response Time</span>
              </div>
              <LeaderboardTable entries={leaderboard.slice(0, 12)} compact />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
