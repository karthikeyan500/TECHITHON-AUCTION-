import { Award, Medal, Trophy } from 'lucide-react';
import { formatResponseTime, type LeaderboardEntry } from '../shared/types.ts';

interface PodiumDisplayProps {
  entries: LeaderboardEntry[];
  large?: boolean;
}

export function PodiumDisplay({ entries, large = false }: PodiumDisplayProps) {
  const first = entries[0];
  const second = entries[1];
  const third = entries[2];

  if (!first) {
    return (
      <div className="rounded-2xl border border-[#223552] bg-[#111E31] p-8 text-center text-sm text-[#9BB0CA]">
        No standings recorded yet.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
      {/* Second Place */}
      <div className="order-2 md:order-1 rounded-2xl border border-[#223552] bg-[#111E31] p-6 text-center">
        {second ? (
          <>
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-[#9BB0CA]/15 text-[#EEF5FF]">
              <Medal className="h-6 w-6" />
            </div>
            <p className="mt-3 text-xs font-semibold text-[#9BB0CA]">
              Rank #{second.rank} · Runner-Up
            </p>
            <h3
              className={`mt-1 font-display font-bold text-[#EEF5FF] truncate ${
                large ? 'text-2xl' : 'text-xl'
              }`}
            >
              {second.teamName}
            </h3>
            <p
              className={`mt-3 font-mono tabular-nums font-bold text-[#51D6E8] ${
                large ? 'text-4xl' : 'text-3xl'
              }`}
            >
              {second.balance} <span className="text-sm font-normal text-[#9BB0CA]">pts</span>
            </p>
            <p className="mt-2 text-xs text-[#9BB0CA] font-mono tabular-nums">
              {second.correctCount} correct · {second.wrongCount} wrong ·{' '}
              {formatResponseTime(second.totalResponseTimeMs)}
            </p>
          </>
        ) : (
          <p className="py-6 text-sm text-[#9BB0CA]">2nd Place Unclaimed</p>
        )}
      </div>

      {/* First Place */}
      <div className="order-1 md:order-2 rounded-2xl border border-[#F5B731]/60 bg-[#172740] p-7 text-center shadow-xl">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-[#F5B731]/20 text-[#F5B731]">
          <Trophy className="h-7 w-7" />
        </div>
        <p className="mt-3 text-xs font-semibold text-[#F5B731]">
          Rank #{first.rank} · Champion
        </p>
        <h3
          className={`mt-1 font-display font-extrabold text-[#EEF5FF] truncate ${
            large ? 'text-3xl' : 'text-2xl'
          }`}
        >
          {first.teamName}
        </h3>
        <p
          className={`mt-3 font-mono tabular-nums font-extrabold text-[#B9F36B] ${
            large ? 'text-5xl' : 'text-4xl'
          }`}
        >
          {first.balance} <span className="text-base font-normal text-[#9BB0CA]">pts</span>
        </p>
        <p className="mt-2 text-xs text-[#9BB0CA] font-mono tabular-nums">
          {first.correctCount} correct · {first.wrongCount} wrong ·{' '}
          {formatResponseTime(first.totalResponseTimeMs)}
        </p>
      </div>

      {/* Third Place */}
      <div className="order-3 rounded-2xl border border-[#223552] bg-[#111E31] p-6 text-center">
        {third ? (
          <>
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-[#51D6E8]/15 text-[#51D6E8]">
              <Award className="h-6 w-6" />
            </div>
            <p className="mt-3 text-xs font-semibold text-[#51D6E8]">
              Rank #{third.rank} · Third Place
            </p>
            <h3
              className={`mt-1 font-display font-bold text-[#EEF5FF] truncate ${
                large ? 'text-2xl' : 'text-xl'
              }`}
            >
              {third.teamName}
            </h3>
            <p
              className={`mt-3 font-mono tabular-nums font-bold text-[#51D6E8] ${
                large ? 'text-4xl' : 'text-3xl'
              }`}
            >
              {third.balance} <span className="text-sm font-normal text-[#9BB0CA]">pts</span>
            </p>
            <p className="mt-2 text-xs text-[#9BB0CA] font-mono tabular-nums">
              {third.correctCount} correct · {third.wrongCount} wrong ·{' '}
              {formatResponseTime(third.totalResponseTimeMs)}
            </p>
          </>
        ) : (
          <p className="py-6 text-sm text-[#9BB0CA]">3rd Place Unclaimed</p>
        )}
      </div>
    </div>
  );
}
