import { formatResponseTime, type LeaderboardEntry } from '../shared/types.ts';

interface LeaderboardTableProps {
  entries: LeaderboardEntry[];
  highlightTeamId?: string | null;
  compact?: boolean;
  showConnection?: boolean;
}

export function LeaderboardTable({
  entries,
  highlightTeamId,
  compact = false,
  showConnection = false,
}: LeaderboardTableProps) {
  if (entries.length === 0) {
    return (
      <div className="rounded-2xl border border-[#223552] bg-[#111E31] px-6 py-10 text-center">
        <p className="text-sm font-medium text-[#EEF5FF]">No teams have joined yet</p>
        <p className="mt-1 text-xs text-[#9BB0CA]">
          Teams will appear here automatically as soon as they join using the room code.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-[#223552] bg-[#111E31]">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-[#223552] text-xs font-semibold text-[#9BB0CA]">
            <th className="py-3 pl-4 pr-3">Rank</th>
            <th className="py-3 px-3">Team</th>
            <th className="py-3 px-3 text-right">Points</th>
            <th className="py-3 px-3 text-right">Coins</th>
            {!compact && (
              <>
                <th className="py-3 px-3 text-right">Correct</th>
                <th className="py-3 px-3 text-right">Wrong</th>
                <th className="py-3 px-3 text-right">Sessions</th>
              </>
            )}
            <th className="py-3 pl-3 pr-4 text-right">Response Time</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#223552]/70 text-sm">
          {entries.map((entry) => {
            const isHighlighted = highlightTeamId && entry.teamId === highlightTeamId;
            return (
              <tr
                key={entry.teamId}
                className={
                  isHighlighted
                    ? 'bg-[#51D6E8]/10 text-[#EEF5FF]'
                    : 'text-[#EEF5FF] hover:bg-[#172740]/60 transition-colors'
                }
              >
                <td className="py-3 pl-4 pr-3 font-mono tabular-nums font-bold">
                  <span
                    className={
                      entry.rank === 1
                        ? 'text-[#F5B731]'
                        : entry.rank === 2
                          ? 'text-[#EEF5FF]'
                          : entry.rank === 3
                            ? 'text-[#51D6E8]'
                            : 'text-[#9BB0CA]'
                    }
                  >
                    #{entry.rank}
                  </span>
                </td>
                <td className="py-3 px-3 font-medium">
                  <div className="flex items-center gap-2">
                    <span className="truncate max-w-[180px] sm:max-w-[260px]">
                      {entry.teamName}
                    </span>
                    {isHighlighted && (
                      <span className="text-xs font-semibold text-[#51D6E8]">(You)</span>
                    )}
                    {showConnection && (
                      <span className="text-xs text-[#9BB0CA]">
                        · {entry.connectionStatus === 'ONLINE' ? 'Online' : 'Offline'}
                      </span>
                    )}
                  </div>
                </td>
                <td className="py-3 px-3 text-right font-mono tabular-nums font-bold text-[#B9F36B]">
                  {entry.points}
                </td>
                <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold text-[#51D6E8]">
                  {entry.coinBalance}
                </td>
                {!compact && (
                  <>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-[#B9F36B]">
                      {entry.correctCount}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-[#F05252]">
                      {entry.wrongCount}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-[#9BB0CA]">
                      {entry.answerSessionsCount}
                    </td>
                  </>
                )}
                <td className="py-3 pl-3 pr-4 text-right font-mono tabular-nums text-[#9BB0CA]">
                  {formatResponseTime(entry.totalResponseTimeMs)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
