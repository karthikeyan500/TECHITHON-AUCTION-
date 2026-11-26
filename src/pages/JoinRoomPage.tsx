import { ArrowRight, KeyRound, LogIn, Smartphone } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import {
  joinRoomPublic,
  lookupRoomByCode,
  RoomActionError,
} from '../lib/firestoreAuction.ts';
import type { TeamRoomSnapshot } from '../shared/types.ts';

interface JoinRoomPageProps {
  existingTeamSnapshot: TeamRoomSnapshot | null;
  onJoined: (snapshot: TeamRoomSnapshot) => void;
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
  const [roomPreview, setRoomPreview] = useState<{
    roomName: string;
    hasPin: boolean;
    isActive: boolean;
    teamCount: number;
    maxTeams: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code') || params.get('room');
    if (code) {
      setRoomCode(code.trim().toUpperCase().slice(0, 12));
    }
  }, []);

  // Proactively inspect room metadata from shared cloud Firestore when a 6-char code is entered
  useEffect(() => {
    const clean = roomCode.trim().toUpperCase();
    if (clean.length < 4) {
      setRoomPreview(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      lookupRoomByCode(clean)
        .then((meta) => {
          if (cancelled) return;
          setRoomPreview({
            roomName: meta.roomName,
            hasPin: meta.hasPin,
            isActive: meta.isActive,
            teamCount: meta.teamCount,
            maxTeams: meta.settings.maxTeams,
          });
          if (meta.hasPin) {
            setShowAdvanced(true);
          }
        })
        .catch(() => {
          if (!cancelled) setRoomPreview(null);
        });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [roomCode]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      const res = await joinRoomPublic({
        roomCode: roomCode.trim().toUpperCase(),
        teamName: teamName.trim(),
        roomPin: roomPin.trim() || undefined,
        teamPin: teamPin.trim() || undefined,
      });
      onJoined(res.snapshot);
    } catch (err) {
      if (err instanceof RoomActionError) {
        if (err.code === 'PIN_REQUIRED' || err.code === 'PIN_INVALID' || err.code === 'DUPLICATE_TEAM') {
          setShowAdvanced(true);
        }
        setError(err.message);
      } else {
        setError('Connection failure. Please check your internet connection and try again.');
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
              Room {existingTeamSnapshot.room.roomCode} ·{' '}
              {existingTeamSnapshot.selfTeam.coinBalance} coins ·{' '}
              {existingTeamSnapshot.selfTeam.points} pts
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
              Enter the room code shared by your host — no Google account required
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
              maxLength={12}
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              placeholder="e.g. K7M4PQ"
              className="w-full min-h-[50px] rounded-xl border border-[#223552] bg-[#08111F] px-4 font-mono text-lg font-bold tracking-widest uppercase text-[#51D6E8] placeholder:text-[#9BB0CA]/40 focus:border-[#51D6E8] focus:outline-none"
            />
            {roomPreview && (
              <p className="mt-1.5 text-xs text-[#B9F36B]">
                Room found: <strong>{roomPreview.roomName}</strong> ({roomPreview.teamCount}/
                {roomPreview.maxTeams} teams
                {roomPreview.hasPin ? ' · PIN protected' : ''})
              </p>
            )}
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
                    Room PIN {roomPreview?.hasPin ? '(Required)' : '(if configured)'}
                  </label>
                  <input
                    id="join-room-pin"
                    type="password"
                    value={roomPin}
                    onChange={(e) => setRoomPin(e.target.value)}
                    placeholder="Room access PIN"
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
