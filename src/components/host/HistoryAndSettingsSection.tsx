import { Download, Search, Sliders, Wrench } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { apiRequest, ApiError } from '../../lib/api.ts';
import { formatResponseTime, type HostRoomSnapshot } from '../../shared/types.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';

interface HistorySectionProps {
  snapshot: HostRoomSnapshot;
}

export function AuctionHistorySection({ snapshot }: HistorySectionProps) {
  const [search, setSearch] = useState('');
  const [teamFilter, setTeamFilter] = useState('ALL');
  const [viewMode, setViewMode] = useState<'auctions' | 'transactions'>('auctions');

  const filteredHistory = useMemo(() => {
    const q = search.trim().toLowerCase();
    return snapshot.history.filter((h) => {
      if (teamFilter !== 'ALL' && h.winningTeamId !== teamFilter) return false;
      if (!q) return true;
      return (
        h.itemName.toLowerCase().includes(q) ||
        h.questionTitle.toLowerCase().includes(q) ||
        (h.winningTeamName || '').toLowerCase().includes(q)
      );
    });
  }, [snapshot.history, search, teamFilter]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-xl border border-[#223552] bg-[#111E31] p-1">
          <button
            type="button"
            onClick={() => setViewMode('auctions')}
            className={`min-h-[38px] rounded-lg px-3.5 text-xs font-semibold ${
              viewMode === 'auctions'
                ? 'bg-[#172740] text-[#51D6E8]'
                : 'text-[#9BB0CA] hover:text-[#EEF5FF]'
            }`}
          >
            Auction Results ({snapshot.history.length})
          </button>
          <button
            type="button"
            onClick={() => setViewMode('transactions')}
            className={`min-h-[38px] rounded-lg px-3.5 text-xs font-semibold ${
              viewMode === 'transactions'
                ? 'bg-[#172740] text-[#51D6E8]'
                : 'text-[#9BB0CA] hover:text-[#EEF5FF]'
            }`}
          >
            Score Audit Log ({snapshot.scoreTransactions.length})
          </button>
        </div>

        <a
          href={`/api/host/rooms/${snapshot.room.id}/export/history-csv`}
          className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-[#223552] bg-[#172740] px-4 text-xs font-semibold text-[#EEF5FF] hover:bg-[#1e3252]"
        >
          <Download className="h-4 w-4" />
          Export History CSV
        </a>
      </div>

      {viewMode === 'auctions' ? (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9BB0CA]" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by item, question, or team..."
                className="w-full min-h-[40px] rounded-xl border border-[#223552] bg-[#111E31] pl-9 pr-3 text-xs text-[#EEF5FF] focus:border-[#51D6E8] focus:outline-none"
              />
            </div>

            <select
              value={teamFilter}
              onChange={(e) => setTeamFilter(e.target.value)}
              className="min-h-[40px] rounded-xl border border-[#223552] bg-[#111E31] px-3 text-xs text-[#EEF5FF] focus:border-[#51D6E8] focus:outline-none"
            >
              <option value="ALL">All Teams</option>
              {snapshot.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.teamName}
                </option>
              ))}
            </select>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-[#223552] bg-[#111E31]">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-[#223552] text-[#9BB0CA]">
                  <th className="py-3 pl-4 pr-3">Item &amp; Question</th>
                  <th className="py-3 px-3">Winner</th>
                  <th className="py-3 px-3 text-right">Final Bid</th>
                  <th className="py-3 px-3">Decision</th>
                  <th className="py-3 px-3 text-right">Response Time</th>
                  <th className="py-3 px-3 text-right">Points Change</th>
                  <th className="py-3 pl-3 pr-4 text-right">Recorded</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#223552]/70">
                {filteredHistory.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-[#9BB0CA]">
                      No auction history recorded yet.
                    </td>
                  </tr>
                ) : (
                  filteredHistory.map((h) => (
                    <tr key={h.id} className="hover:bg-[#172740]/50">
                      <td className="py-3 pl-4 pr-3">
                        <p className="font-semibold text-[#EEF5FF]">{h.itemName}</p>
                        <p className="text-[11px] text-[#9BB0CA] truncate max-w-[260px]">
                          {h.questionTitle}
                        </p>
                      </td>
                      <td className="py-3 px-3 text-[#EEF5FF]">
                        {h.winningTeamName || 'No Bids'}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-[#51D6E8]">
                        {h.finalBid}
                      </td>
                      <td className="py-3 px-3 font-semibold">
                        <span
                          className={
                            h.hostDecision === 'CORRECT'
                              ? 'text-[#B9F36B]'
                              : h.hostDecision === 'WRONG'
                                ? 'text-[#F05252]'
                                : 'text-[#9BB0CA]'
                          }
                        >
                          {h.hostDecision}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-[#9BB0CA]">
                        {formatResponseTime(h.responseTimeMs)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums font-bold">
                        <span
                          className={
                            h.pointsChange > 0
                              ? 'text-[#B9F36B]'
                              : h.pointsChange < 0
                                ? 'text-[#F05252]'
                                : 'text-[#9BB0CA]'
                          }
                        >
                          {h.pointsChange > 0 ? `+${h.pointsChange}` : h.pointsChange}
                        </span>
                      </td>
                      <td className="py-3 pl-3 pr-4 text-right font-mono text-[#9BB0CA]">
                        {new Date(h.timestamp).toLocaleTimeString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[#223552] bg-[#111E31]">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-[#223552] text-[#9BB0CA]">
                <th className="py-3 pl-4 pr-3">Time</th>
                <th className="py-3 px-3">Team</th>
                <th className="py-3 px-3">Type</th>
                <th className="py-3 px-3">Reason</th>
                <th className="py-3 px-3 text-right">Prev</th>
                <th className="py-3 px-3 text-right">Change</th>
                <th className="py-3 pl-3 pr-4 text-right">New</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#223552]/70">
              {snapshot.scoreTransactions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-[#9BB0CA]">
                    No score transactions yet.
                  </td>
                </tr>
              ) : (
                snapshot.scoreTransactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-[#172740]/50">
                    <td className="py-3 pl-4 pr-3 font-mono text-[#9BB0CA]">
                      {new Date(tx.timestamp).toLocaleTimeString()}
                    </td>
                    <td className="py-3 px-3 font-semibold text-[#EEF5FF]">{tx.teamName}</td>
                    <td className="py-3 px-3 text-[#9BB0CA]">{tx.decisionType}</td>
                    <td className="py-3 px-3 text-[#EEF5FF]">{tx.reason}</td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-[#9BB0CA]">
                      {tx.previousBalance}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums font-bold">
                      <span className={tx.actualChange >= 0 ? 'text-[#B9F36B]' : 'text-[#F05252]'}>
                        {tx.actualChange >= 0 ? `+${tx.actualChange}` : tx.actualChange}
                      </span>
                    </td>
                    <td className="py-3 pl-3 pr-4 text-right font-mono tabular-nums font-bold text-[#EEF5FF]">
                      {tx.newBalance}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface RoomSettingsSectionProps {
  snapshot: HostRoomSnapshot;
  onSnapshotUpdate: (snap: HostRoomSnapshot) => void;
}

export function RoomSettingsAndAdjustSection({
  snapshot,
  onSnapshotUpdate,
}: RoomSettingsSectionProps) {
  const { room, teams } = snapshot;

  // Room settings form
  const [roomName, setRoomName] = useState(room.roomName);
  const [maxTeams, setMaxTeams] = useState(room.settings.maxTeams);
  const [auctionDurationSec, setAuctionDurationSec] = useState(room.settings.auctionDurationSec);
  const [answerDurationSec, setAnswerDurationSec] = useState(room.settings.answerDurationSec);
  const [correctPoints, setCorrectPoints] = useState(room.settings.correctPoints);
  const [wrongDeduction, setWrongDeduction] = useState(room.settings.wrongDeduction);
  const [minStartingBid, setMinStartingBid] = useState(room.settings.minStartingBid);
  const [minBidIncrement, setMinBidIncrement] = useState(room.settings.minBidIncrement);
  const [deductWinningBid, setDeductWinningBid] = useState(room.settings.deductWinningBid);
  const [newPin, setNewPin] = useState('');
  const [clearPin, setClearPin] = useState(false);

  // Manual score adjustment
  const [adjTeamId, setAdjTeamId] = useState(teams[0]?.id || '');
  const [adjAmount, setAdjAmount] = useState('10');
  const [adjReason, setAdjReason] = useState('');
  const [confirmAdjOpen, setConfirmAdjOpen] = useState(false);

  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null,
  );

  const handleSaveSettings = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      const next = await apiRequest<HostRoomSnapshot>(`/api/host/rooms/${room.id}/settings`, {
        method: 'PATCH',
        authMode: 'host',
        body: JSON.stringify({
          roomName,
          maxTeams,
          auctionDurationSec,
          answerDurationSec,
          correctPoints,
          wrongDeduction,
          minStartingBid,
          minBidIncrement,
          deductWinningBid,
          roomPin: newPin.trim() || undefined,
          clearPin,
        }),
      });
      onSnapshotUpdate(next);
      setNewPin('');
      setClearPin(false);
      setFeedback({ type: 'success', text: 'Room settings updated.' });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof ApiError ? err.message : 'Unable to save settings.',
      });
    } finally {
      setBusy(false);
    }
  };

  const submitManualAdjust = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const next = await apiRequest<HostRoomSnapshot>(
        `/api/host/rooms/${room.id}/teams/${adjTeamId}/adjust-score`,
        {
          method: 'POST',
          authMode: 'host',
          body: JSON.stringify({
            amount: Math.trunc(Number(adjAmount)),
            reason: adjReason,
          }),
        },
      );
      onSnapshotUpdate(next);
      setConfirmAdjOpen(false);
      setAdjReason('');
      setFeedback({ type: 'success', text: 'Manual score adjustment recorded in audit history.' });
    } catch (err) {
      setConfirmAdjOpen(false);
      setFeedback({
        type: 'error',
        text: err instanceof ApiError ? err.message : 'Adjustment failed.',
      });
    } finally {
      setBusy(false);
    }
  };

  const selectedTeamName = teams.find((t) => t.id === adjTeamId)?.teamName || 'selected team';

  return (
    <div className="space-y-6">
      {feedback && (
        <div
          role="status"
          className={`rounded-xl border px-4 py-3 text-sm ${
            feedback.type === 'success'
              ? 'border-[#B9F36B]/40 bg-[#B9F36B]/10 text-[#B9F36B]'
              : 'border-[#F05252]/40 bg-[#F05252]/10 text-[#F05252]'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* Manual Score Adjustment */}
      <div className="rounded-2xl border border-[#223552] bg-[#111E31] p-6 space-y-4">
        <div className="flex items-center gap-2.5 border-b border-[#223552] pb-3">
          <Wrench className="h-5 w-5 text-[#F5B731]" />
          <div>
            <h3 className="font-display text-lg font-bold text-[#EEF5FF]">
              Manual Score Adjustment (Host Only)
            </h3>
            <p className="text-xs text-[#9BB0CA]">
              Every manual adjustment requires a reason and is permanently logged in the audit
              history. Balances cannot drop below 0.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label
              htmlFor="adj-team"
              className="block text-xs font-semibold text-[#9BB0CA] mb-1.5"
            >
              Select Team
            </label>
            <select
              id="adj-team"
              value={adjTeamId}
              onChange={(e) => setAdjTeamId(e.target.value)}
              className="w-full min-h-[44px] rounded-xl border border-[#223552] bg-[#08111F] px-3 text-sm text-[#EEF5FF]"
            >
              {teams.length === 0 && <option value="">No teams joined</option>}
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.teamName} ({t.balance} pts)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="adj-amount"
              className="block text-xs font-semibold text-[#9BB0CA] mb-1.5"
            >
              Points Change (e.g. 10 or -10)
            </label>
            <input
              id="adj-amount"
              type="number"
              value={adjAmount}
              onChange={(e) => setAdjAmount(e.target.value)}
              className="w-full min-h-[44px] rounded-xl border border-[#223552] bg-[#08111F] px-3.5 font-mono text-sm text-[#EEF5FF]"
            />
          </div>

          <div>
            <label
              htmlFor="adj-reason"
              className="block text-xs font-semibold text-[#9BB0CA] mb-1.5"
            >
              Audit Reason
            </label>
            <input
              id="adj-reason"
              type="text"
              value={adjReason}
              onChange={(e) => setAdjReason(e.target.value)}
              placeholder="e.g. Tie-break bonus / Appeal approved"
              className="w-full min-h-[44px] rounded-xl border border-[#223552] bg-[#08111F] px-3.5 text-sm text-[#EEF5FF]"
            />
          </div>
        </div>

        <button
          type="button"
          disabled={busy || !adjTeamId || !adjReason.trim() || Number(adjAmount) === 0}
          onClick={() => setConfirmAdjOpen(true)}
          className="min-h-[44px] rounded-xl bg-[#F5B731] px-5 text-sm font-bold text-[#08111F] disabled:opacity-40"
        >
          Apply Score Adjustment
        </button>
      </div>

      {/* Room Settings Editor */}
      <form
        onSubmit={handleSaveSettings}
        className="rounded-2xl border border-[#223552] bg-[#111E31] p-6 space-y-5"
      >
        <div className="flex items-center gap-2.5 border-b border-[#223552] pb-3">
          <Sliders className="h-5 w-5 text-[#51D6E8]" />
          <h3 className="font-display text-lg font-bold text-[#EEF5FF]">Room Configuration</h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-[#9BB0CA] mb-1.5">Room Name</label>
            <input
              type="text"
              required
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              className="w-full min-h-[44px] rounded-xl border border-[#223552] bg-[#08111F] px-3.5 text-sm text-[#EEF5FF]"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#9BB0CA] mb-1.5">Max Teams</label>
            <input
              type="number"
              min={2}
              max={200}
              value={maxTeams}
              onChange={(e) => setMaxTeams(Number(e.target.value))}
              className="w-full min-h-[44px] rounded-xl border border-[#223552] bg-[#08111F] px-3.5 font-mono text-sm text-[#EEF5FF]"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#9BB0CA] mb-1.5">
              Auction Timer (s)
            </label>
            <input
              type="number"
              min={5}
              max={600}
              value={auctionDurationSec}
              onChange={(e) => setAuctionDurationSec(Number(e.target.value))}
              className="w-full min-h-[44px] rounded-xl border border-[#223552] bg-[#08111F] px-3.5 font-mono text-sm text-[#EEF5FF]"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#9BB0CA] mb-1.5">
              Answer Timer (s)
            </label>
            <input
              type="number"
              min={5}
              max={300}
              value={answerDurationSec}
              onChange={(e) => setAnswerDurationSec(Number(e.target.value))}
              className="w-full min-h-[44px] rounded-xl border border-[#223552] bg-[#08111F] px-3.5 font-mono text-sm text-[#EEF5FF]"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#9BB0CA] mb-1.5">
              Correct Points (+)
            </label>
            <input
              type="number"
              min={1}
              value={correctPoints}
              onChange={(e) => setCorrectPoints(Number(e.target.value))}
              className="w-full min-h-[44px] rounded-xl border border-[#223552] bg-[#08111F] px-3.5 font-mono text-sm text-[#B9F36B]"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#9BB0CA] mb-1.5">
              Wrong Deduction (-)
            </label>
            <input
              type="number"
              min={0}
              value={wrongDeduction}
              onChange={(e) => setWrongDeduction(Number(e.target.value))}
              className="w-full min-h-[44px] rounded-xl border border-[#223552] bg-[#08111F] px-3.5 font-mono text-sm text-[#F05252]"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#9BB0CA] mb-1.5">
              Min Bid Increment
            </label>
            <input
              type="number"
              min={1}
              value={minBidIncrement}
              onChange={(e) => setMinBidIncrement(Number(e.target.value))}
              className="w-full min-h-[44px] rounded-xl border border-[#223552] bg-[#08111F] px-3.5 font-mono text-sm text-[#EEF5FF]"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#9BB0CA] mb-1.5">
              Default Starting Bid
            </label>
            <input
              type="number"
              min={1}
              value={minStartingBid}
              onChange={(e) => setMinStartingBid(Number(e.target.value))}
              className="w-full min-h-[44px] rounded-xl border border-[#223552] bg-[#08111F] px-3.5 font-mono text-sm text-[#EEF5FF]"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#9BB0CA] mb-1.5">
              New Room PIN
            </label>
            <input
              type="password"
              value={newPin}
              onChange={(e) => setNewPin(e.target.value)}
              placeholder={room.hasPin ? 'PIN active (leave blank to keep)' : 'No PIN set'}
              className="w-full min-h-[44px] rounded-xl border border-[#223552] bg-[#08111F] px-3.5 text-sm text-[#EEF5FF]"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-6">
          <label className="inline-flex items-center gap-2 text-xs text-[#9BB0CA]">
            <input
              type="checkbox"
              checked={deductWinningBid}
              onChange={(e) => setDeductWinningBid(e.target.checked)}
              className="h-4 w-4 accent-[#51D6E8]"
            />
            Deduct winning bid from balance
          </label>
          {room.hasPin && (
            <label className="inline-flex items-center gap-2 text-xs text-[#9BB0CA]">
              <input
                type="checkbox"
                checked={clearPin}
                onChange={(e) => setClearPin(e.target.checked)}
                className="h-4 w-4 accent-[#F05252]"
              />
              Remove Room PIN
            </label>
          )}
        </div>

        <button
          type="submit"
          disabled={busy}
          className="min-h-[44px] rounded-xl bg-[#51D6E8] px-6 text-sm font-bold text-[#08111F] hover:bg-[#6de0ef] disabled:opacity-50"
        >
          {busy ? 'Saving...' : 'Save Settings'}
        </button>
      </form>

      <ConfirmDialog
        open={confirmAdjOpen}
        title="Confirm Manual Score Adjustment"
        description={`Apply ${Number(adjAmount) > 0 ? `+${adjAmount}` : adjAmount} points to ${selectedTeamName} for reason: "${adjReason}"?`}
        confirmLabel="Apply Adjustment"
        variant="primary"
        busy={busy}
        onConfirm={submitManualAdjust}
        onCancel={() => setConfirmAdjOpen(false)}
      />
    </div>
  );
}
