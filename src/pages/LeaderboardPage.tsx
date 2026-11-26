import { Search, Trophy } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { LeaderboardTable } from '../components/LeaderboardTable.tsx';
import { PodiumDisplay } from '../components/PodiumDisplay.tsx';
import {
  fetchPublicRoomByCode,
  RoomActionError,
  subscribePublicRoom,
} from '../lib/firestoreAuction.ts';
import type { PublicRoomSnapshot } from '../shared/types.ts';

export function LeaderboardPage() {
  const [roomCode, setRoomCode] = useState('');
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<PublicRoomSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRoom = useCallback(async (code: string) => {
    const clean = code.trim().toUpperCase();
    if (!clean) return;
    setLoading(true);
    setError(null);
    try {
      const snap = await fetchPublicRoomByCode(clean);
      setSnapshot(snap);
      setActiveRoomId(snap.room.id);
    } catch (err) {
      setError(
        err instanceof RoomActionError || err instanceof Error
          ? err.message
          : 'Unable to load leaderboard.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code') || params.get('room');
    if (code) {
      setRoomCode(code.toUpperCase());
      void loadRoom(code);
    }
  }, [loadRoom]);

  useEffect(() => {
    if (!activeRoomId) return;
    const unsub = subscribePublicRoom(
      activeRoomId,
      (next) => {
        if (next) setSnapshot(next);
      },
      (err) => {
        setError(err.message);
      },
    );
    return () => unsub();
  }, [activeRoomId]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void loadRoom(roomCode);
  };

  return (
    <main className="mx-auto max-w-5xl px-4 sm:px-6 py-10 space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-[#223552] pb-6">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-[#EEF5FF] flex items-center gap-3">
            <Trophy className="h-7 w-7 text-[#F5B731]" />
            Live Leaderboard
          </h1>
          <p className="mt-1 text-sm text-[#9BB0CA]">
            Ranked by highest Competition Points first, then fastest total response time.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <input
            type="text"
            required
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
            placeholder="Room Code"
            className="min-h-[44px] w-36 rounded-xl border border-[#223552] bg-[#111E31] px-3.5 font-mono text-sm font-bold uppercase text-[#51D6E8] focus:border-[#51D6E8] focus:outline-none"
          />
          <button
            type="submit"
            disabled={loading}
            className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl bg-[#51D6E8] px-4 text-sm font-bold text-[#08111F] hover:bg-[#6de0ef] transition-colors"
          >
            <Search className="h-4 w-4" />
            {loading ? 'Loading...' : 'View'}
          </button>
        </form>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-[#F05252]/40 bg-[#F05252]/10 px-4 py-3 text-sm text-[#F05252]"
        >
          {error}
        </div>
      )}

      {snapshot ? (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#223552] bg-[#111E31] px-5 py-4">
            <div>
              <p className="text-xs text-[#9BB0CA]">
                Room {snapshot.room.roomCode} · {snapshot.room.teamCount} Teams
              </p>
              <h2 className="font-display text-xl font-bold text-[#EEF5FF]">
                {snapshot.room.roomName}
              </h2>
            </div>
            <span className="text-sm font-semibold text-[#51D6E8]">
              {snapshot.room.humanStatus}
            </span>
          </div>

          {snapshot.room.machineState === 'ROOM_COMPLETED' && (
            <PodiumDisplay entries={snapshot.leaderboard} />
          )}

          <LeaderboardTable entries={snapshot.leaderboard} showConnection />
        </div>
      ) : (
        <div className="rounded-2xl border border-[#223552] bg-[#111E31] p-10 text-center text-sm text-[#9BB0CA]">
          Enter a room code above to view live rankings, Competition Points, and Bidding Coins.
        </div>
      )}
    </main>
  );
}
