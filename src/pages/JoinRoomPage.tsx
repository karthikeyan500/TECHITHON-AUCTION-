import { ArrowRight, KeyRound, LogIn, Smartphone } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { apiRequest, ApiError, setTeamToken } from '../lib/api.ts';
import type { TeamRoomSnapshot } from '../shared/types.ts';

interface JoinRoomPageProps {
  existingTeamSnapshot: TeamRoomSnapshot | null;
  onJoined: (snapshot: TeamRoomSnapshot, token: string) => void;
  onResumeTeam: () => void;
}

export function JoinRoomPage({
  existingTeamSnapshot,
  onJoined,
  onResumeTeam,
}: JoinRoomPageProps) {
  const [roomCode, setRoomCode] = useState('');
  const [teamName, setTeamName] = useState('');
  const [roomPin, setRoomPin] = useState('');
  const [teamPin, setTeamPin] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (code) {
      setRoomCode(code.toUpperCase().slice(0, 10));
    }
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiRequest<{
        snapshot: TeamRoomSnapshot;
        token: string;
        reconnected: boolean;
      }>('/api/rooms/join', {
        method: 'POST',
        body: JSON.stringify({
          roomCode: roomCode.trim().toUpperCase(),
          teamName: teamName.trim(),
          roomPin: roomPin.trim() || undefined,
          teamPin: teamPin.trim() || undefined,
        }),
      });
      setTeamToken(res.token);
      onJoined(res.snapshot, res.token);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401 && err.message.toLowerCase().includes('pin')) {
          setShowAdvanced(true);
        }
        setError(err.message);
      } else {
        setError('Connection failure. Please check your internet and try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="mx-auto max-w-lg px-4 py-10 sm:py-14 space-y-6">
      {existingTeamSnapshot && (
        <div className="rounded-2xl border border-[#51D6E8]/40 bg-[#172740] p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-[#51D6E8]">Active Team Session Found</p>
            <p className="mt-1 font-display text-base font-bold text-[#EEF5FF]">
              {existingTeamSnapshot.selfTeam.teamName} · {existingTeamSnapshot.room.roomName}
            </p>
            <p className="text-xs text-[#9BB0CA] font-mono tabular-nums">
              Room {existingTeamSnapshot.room.roomCode} · Balance:{' '}
              {existingTeamSnapshot.selfTeam.balance} pts
            </p>
          </div>
          <button
            type="button"
            onClick={onResumeTeam}
            className="min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#51D6E8] px-4 py-2 text-sm font-bold text-[#08111F] hover:bg-[#6de0ef] transition-colors whitespace-nowrap shrink-0"
          >
            Resume Session
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="rounded-2xl border border-[#223552] bg-[#111E31] p-6 sm:p-8 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#51D6E8]/15 text-[#51D6E8]">
            <Smartphone className="h-6 w-6" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold text-[#EEF5FF]">Join Auction Room</h1>
            <p className="text-xs text-[#9BB0CA]">
              Enter the room code shared by your event host
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          <div>
            <label
              htmlFor="join-room-code"
              className="block text-xs font-semibold text-[#9BB0CA] mb-1.5"
            >
              Room Code
            </label>
            <input
              id="join-room-code"
              type="text"
              required
              autoComplete="off"
              maxLength={10}
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              placeholder="e.g. K7M4PQ"
              className="w-full min-h-[50px] rounded-xl border border-[#223552] bg-[#08111F] px-4 font-mono text-lg font-bold tracking-widest uppercase text-[#51D6E8] placeholder:text-[#9BB0CA]/40 focus:border-[#51D6E8] focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="join-team-name"
              className="block text-xs font-semibold text-[#9BB0CA] mb-1.5"
            >
              Team Name
            </label>
            <input
              id="join-team-name"
              type="text"
              required
              minLength={2}
              maxLength={40}
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="e.g. Quantum Mavericks"
              className="w-full min-h-[48px] rounded-xl border border-[#223552] bg-[#08111F] px-4 text-base text-[#EEF5FF] placeholder:text-[#9BB0CA]/40 focus:border-[#51D6E8] focus:outline-none"
            />
          </div>

          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#9BB0CA] hover:text-[#51D6E8] transition-colors"
            >
              <KeyRound className="h-3.5 w-3.5" />
              {showAdvanced
                ? 'Hide PIN / Reconnect Passcode'
                : 'Have a Room PIN or Team Reconnect Passcode?'}
            </button>

            {showAdvanced && (
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-[#223552]">
                <div>
                  <label
                    htmlFor="join-room-pin"
                    className="block text-xs font-semibold text-[#9BB0CA] mb-1.5"
                  >
                    Room PIN (if configured)
                  </label>
                  <input
                    id="join-room-pin"
                    type="password"
                    value={roomPin}
                    onChange={(e) => setRoomPin(e.target.value)}
                    placeholder="Optional room PIN"
                    className="w-full min-h-[44px] rounded-xl border border-[#223552] bg-[#08111F] px-3.5 text-sm text-[#EEF5FF] placeholder:text-[#9BB0CA]/40 focus:border-[#51D6E8] focus:outline-none"
                  />
                </div>
                <div>
                  <label
                    htmlFor="join-team-pin"
                    className="block text-xs font-semibold text-[#9BB0CA] mb-1.5"
                  >
                    Team Passcode (optional)
                  </label>
                  <input
                    id="join-team-pin"
                    type="password"
                    value={teamPin}
                    onChange={(e) => setTeamPin(e.target.value)}
                    placeholder="For multi-phone / rejoin"
                    className="w-full min-h-[44px] rounded-xl border border-[#223552] bg-[#08111F] px-3.5 text-sm text-[#EEF5FF] placeholder:text-[#9BB0CA]/40 focus:border-[#51D6E8] focus:outline-none"
                  />
                </div>
              </div>
            )}
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
            className="min-h-[52px] w-full flex items-center justify-center gap-2 rounded-xl bg-[#51D6E8] px-6 py-3.5 text-base font-bold text-[#08111F] hover:bg-[#6de0ef] active:scale-[0.99] transition-all disabled:opacity-50"
          >
            <LogIn className="h-5 w-5" />
            {loading ? 'Joining Room...' : 'Join Room'}
          </button>
        </form>
      </div>
    </main>
  );
}
