import {
  Coins,
  Download,
  Minus,
  Plus,
  RotateCcw,
  Search,
  Sliders,
  Trophy,
  Wrench,
} from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  adjustTeamBalancesTransaction,
  exportHistoryCsv,
  RoomActionError,
  updateRoomSettings,
} from '../../lib/firestoreAuction.ts';
import {
  DEFAULT_ROOM_SETTINGS,
  formatResponseTime,
  type HostRoomSnapshot,
  type RoomSettings,
} from '../../shared/types.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';

interface HistorySectionProps {
  snapshot: HostRoomSnapshot;
}

export function AuctionHistorySection({ snapshot }: HistorySectionProps) {
  const [search, setSearch] = useState('');
  const [teamFilter, setTeamFilter] = useState('ALL');
  const [currencyFilter, setCurrencyFilter] = useState<'ALL' | 'COINS' | 'POINTS'>('ALL');
  const [viewMode, setViewMode] = useState<'auctions' | 'transactions'>('auctions');

  const filteredHistory = useMemo(() => {
    const q = search.trim().toLowerCase();
    return snapshot.history.filter((h) => {
      if (teamFilter !== 'ALL' && h.winningTeamId !== teamFilter) return false;
      if (!q) return true;
      return (
        h.itemName.toLowerCase().includes(q) ||
        (h.winningTeamName || '').toLowerCase().includes(q)
      );
    });
  }, [snapshot.history, search, teamFilter]);

  const filteredTransactions = useMemo(() => {
    return snapshot.transactions.filter((tx) => {
      if (currencyFilter !== 'ALL' && tx.currencyType !== currencyFilter) return false;
      if (teamFilter !== 'ALL' && tx.teamId !== teamFilter) return false;
      return true;
    });
  }, [snapshot.transactions, currencyFilter, teamFilter]);

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
            Coin &amp; Point Audit Log ({snapshot.transactions.length})
          </button>
        </div>

        <button
          type="button"
          onClick={() => exportHistoryCsv(snapshot)}
          className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-[#223552] bg-[#172740] px-4 text-xs font-semibold text-[#EEF5FF] hover:bg-[#1e3252]"
        >
          <Download className="h-4 w-4" />
          Export History CSV
        </button>
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
                placeholder="Search by item or team..."
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
                  <th className="py-3 pl-4 pr-3">Auction Item</th>
                  <th className="py-3 px-3">Winner</th>
                  <th className="py-3 px-3 text-right">Final Bid</th>
                  <th className="py-3 px-3">Decision</th>
                  <th className="py-3 px-3 text-right">Response Time</th>
                  <th className="py-3 px-3 text-right">Coins Δ</th>
                  <th className="py-3 px-3 text-right">Points Δ</th>
                  <th className="py-3 pl-3 pr-4 text-right">Recorded</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#223552]/70">
                {filteredHistory.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-[#9BB0CA]">
                      No auction history recorded yet.
                    </td>
                  </tr>
                ) : (
                  filteredHistory.map((h) => (
                    <tr key={h.id} className="hover:bg-[#172740]/50">
                      <td className="py-3 pl-4 pr-3">
                        <p className="font-semibold text-[#EEF5FF]">{h.itemName}</p>
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
                            h.coinsChange > 0
                              ? 'text-[#51D6E8]'
                              : h.coinsChange < 0
                                ? 'text-[#F05252]'
                                : 'text-[#9BB0CA]'
                          }
                        >
                          {h.coinsChange > 0 ? `+${h.coinsChange}` : h.coinsChange}
                        </span>
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
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1 rounded-xl border border-[#223552] bg-[#111E31] p-1">
              {(['ALL', 'COINS', 'POINTS'] as const).map((cur) => (
                <button
                  key={cur}
                  type="button"
                  onClick={() => setCurrencyFilter(cur)}
                  className={`min-h-[34px] rounded-lg px-3 text-xs font-semibold ${
                    currencyFilter === cur
                      ? 'bg-[#172740] text-[#51D6E8]'
                      : 'text-[#9BB0CA] hover:text-[#EEF5FF]'
                  }`}
                >
                  {cur === 'ALL' ? 'All Currencies' : cur === 'COINS' ? 'Coins Only' : 'Points Only'}
                </button>
              ))}
            </div>

            <select
              value={teamFilter}
              onChange={(e) => setTeamFilter(e.target.value)}
              className="min-h-[38px] rounded-xl border border-[#223552] bg-[#111E31] px-3 text-xs text-[#EEF5FF] focus:border-[#51D6E8] focus:outline-none"
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
                  <th className="py-3 pl-4 pr-3">Time</th>
                  <th className="py-3 px-3">Team</th>
                  <th className="py-3 px-3">Currency</th>
                  <th className="py-3 px-3">Event Type</th>
                  <th className="py-3 px-3">Reason</th>
                  <th className="py-3 px-3 text-right">Prev</th>
                  <th className="py-3 px-3 text-right">Change</th>
                  <th className="py-3 pl-3 pr-4 text-right">New</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#223552]/70">
                {filteredTransactions.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-[#9BB0CA]">
                      No economy transactions recorded yet.
                    </td>
                  </tr>
                ) : (
                  filteredTransactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-[#172740]/50">
                      <td className="py-3 pl-4 pr-3 font-mono text-[#9BB0CA]">
                        {new Date(tx.timestamp).toLocaleTimeString()}
                      </td>
                      <td className="py-3 px-3 font-semibold text-[#EEF5FF]">{tx.teamName}</td>
                      <td
                        className={`py-3 px-3 font-mono font-bold ${
                          tx.currencyType === 'COINS' ? 'text-[#51D6E8]' : 'text-[#B9F36B]'
                        }`}
                      >
                        {tx.currencyType}
                      </td>
                      <td className="py-3 px-3 text-[#9BB0CA]">{tx.transactionType}</td>
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
        </div>
      )}
    </div>
  );
}

function StepperControl({
  label,
  value,
  min,
  max,
  step = 1,
  accentClass = 'text-[#EEF5FF]',
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  accentClass?: string;
  onChange: (next: number) => void;
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.trunc(n)));
  return (
    <div>
      <label className="block text-xs font-semibold text-[#9BB0CA] mb-1.5">{label}</label>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onChange(clamp(value - step))}
          className="min-h-[42px] min-w-[38px] flex items-center justify-center rounded-xl border border-[#223552] bg-[#08111F] text-[#9BB0CA] hover:text-[#EEF5FF]"
          aria-label={`Decrease ${label}`}
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(clamp(Number(e.target.value || 0)))}
          className={`w-full min-h-[42px] rounded-xl border border-[#223552] bg-[#08111F] px-2 text-center font-mono text-sm font-bold ${accentClass}`}
        />
        <button
          type="button"
          onClick={() => onChange(clamp(value + step))}
          className="min-h-[42px] min-w-[38px] flex items-center justify-center rounded-xl border border-[#223552] bg-[#08111F] text-[#9BB0CA] hover:text-[#EEF5FF]"
          aria-label={`Increase ${label}`}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

interface RoomSettingsSectionProps {
  snapshot: HostRoomSnapshot;
  preselectedTeamId?: string | null;
}

export function RoomSettingsAndAdjustSection({
  snapshot,
  preselectedTeamId,
}: RoomSettingsSectionProps) {
  const { room, teams } = snapshot;

  // Room settings form
  const [roomName, setRoomName] = useState(room.roomName);
  const [settings, setSettings] = useState<RoomSettings>({ ...room.settings });
  const [newPin, setNewPin] = useState('');
  const [clearPin, setClearPin] = useState(false);

  // Manual independent Coin & Point adjustment
  const [adjTeamId, setAdjTeamId] = useState(preselectedTeamId || teams[0]?.id || '');
  const [coinDelta, setCoinDelta] = useState<number>(0);
  const [pointsDelta, setPointsDelta] = useState<number>(10);
  const [adjReason, setAdjReason] = useState('');
  const [confirmAdjOpen, setConfirmAdjOpen] = useState(false);
  const [confirmSettingsOpen, setConfirmSettingsOpen] = useState(false);

  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null,
  );

  useEffect(() => {
    setRoomName(room.roomName);
    setSettings({ ...room.settings });
  }, [room.id, room.roomName, room.settings]);

  useEffect(() => {
    if (preselectedTeamId && teams.some((t) => t.id === preselectedTeamId)) {
      setAdjTeamId(preselectedTeamId);
    } else if (!adjTeamId && teams[0]) {
      setAdjTeamId(teams[0].id);
    }
  }, [preselectedTeamId, teams, adjTeamId]);

  const updateSetting = <K extends keyof RoomSettings>(key: K, val: RoomSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: val }));
  };

  const economyChanged =
    settings.startingCoins !== room.settings.startingCoins ||
    settings.startingPoints !== room.settings.startingPoints ||
    settings.correctCoinReward !== room.settings.correctCoinReward ||
    settings.correctPointReward !== room.settings.correctPointReward ||
    settings.wrongCoinPenalty !== room.settings.wrongCoinPenalty ||
    settings.wrongPointPenalty !== room.settings.wrongPointPenalty ||
    settings.participationCoinReward !== room.settings.participationCoinReward ||
    settings.participationPointReward !== room.settings.participationPointReward ||
    settings.deductWinningBid !== room.settings.deductWinningBid ||
    settings.allowNegativePoints !== room.settings.allowNegativePoints;

  const commitSettings = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      await updateRoomSettings(room.id, room.roomCode, {
        roomName,
        settings,
        newPin: newPin.trim() || undefined,
        clearPin,
      });
      setNewPin('');
      setClearPin(false);
      setConfirmSettingsOpen(false);
      setFeedback({
        type: 'success',
        text: 'Room configuration saved. Updated economy rules apply from the next evaluation onward.',
      });
    } catch (err) {
      setConfirmSettingsOpen(false);
      setFeedback({
        type: 'error',
        text:
          err instanceof RoomActionError || err instanceof Error
            ? err.message
            : 'Unable to save settings.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSaveSettingsSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (economyChanged && (teams.length > 0 || snapshot.history.length > 0)) {
      setConfirmSettingsOpen(true);
    } else {
      void commitSettings();
    }
  };

  const submitManualAdjust = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      await adjustTeamBalancesTransaction({
        roomId: room.id,
        teamId: adjTeamId,
        coinDelta,
        pointsDelta,
        reason: adjReason,
      });
      setConfirmAdjOpen(false);
      setAdjReason('');
      setCoinDelta(0);
      setPointsDelta(0);
      setFeedback({
        type: 'success',
        text: 'Manual balance adjustment saved & permanently logged in audit history.',
      });
    } catch (err) {
      setConfirmAdjOpen(false);
      setFeedback({
        type: 'error',
        text:
          err instanceof RoomActionError || err instanceof Error
            ? err.message
            : 'Adjustment failed.',
      });
    } finally {
      setBusy(false);
    }
  };

  const selectedTeam = teams.find((t) => t.id === adjTeamId) || null;
  const previewNextCoins = selectedTeam ? Math.max(0, selectedTeam.coinBalance + coinDelta) : 0;
  const previewNextPoints = selectedTeam
    ? room.settings.allowNegativePoints
      ? selectedTeam.points + pointsDelta
      : Math.max(0, selectedTeam.points + pointsDelta)
    : 0;

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

      {/* Manual Independent Coin & Point Balance Adjustment */}
      <div className="rounded-2xl border border-[#223552] bg-[#111E31] p-6 space-y-5">
        <div className="flex items-center gap-2.5 border-b border-[#223552] pb-3">
          <Wrench className="h-5 w-5 text-[#F5B731]" />
          <div>
            <h3 className="font-display text-lg font-bold text-[#EEF5FF]">
              Manual Adjust Team Balance (Coins &amp; Points Independently)
            </h3>
            <p className="text-xs text-[#9BB0CA]">
              Adjust Bidding Coins and Competition Points independently. Every adjustment requires a
              reason and is recorded in the audit log.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
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
                  {t.teamName} ({t.coinBalance} coins · {t.points} pts)
                </option>
              ))}
            </select>
            {selectedTeam && (
              <p className="mt-1.5 text-xs font-mono text-[#9BB0CA]">
                Current: <span className="text-[#51D6E8]">{selectedTeam.coinBalance} coins</span> ·{' '}
                <span className="text-[#B9F36B]">{selectedTeam.points} pts</span>
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="adj-coins"
              className="block text-xs font-semibold text-[#51D6E8] mb-1.5"
            >
              Bidding Coins Adjustment (+/-)
            </label>
            <input
              id="adj-coins"
              type="number"
              value={coinDelta}
              onChange={(e) => setCoinDelta(Math.trunc(Number(e.target.value || 0)))}
              className="w-full min-h-[44px] rounded-xl border border-[#223552] bg-[#08111F] px-3.5 font-mono text-sm text-[#51D6E8]"
            />
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {[-20, -10, 0, 10, 20, 50].map((v) => (
                <button
                  key={`c-${v}`}
                  type="button"
                  onClick={() => setCoinDelta(v)}
                  className="rounded-lg border border-[#223552] bg-[#08111F] px-2 py-1 text-[11px] font-mono text-[#9BB0CA] hover:text-[#51D6E8]"
                >
                  {v > 0 ? `+${v}` : v}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label
              htmlFor="adj-points"
              className="block text-xs font-semibold text-[#B9F36B] mb-1.5"
            >
              Competition Points Adjustment (+/-)
            </label>
            <input
              id="adj-points"
              type="number"
              value={pointsDelta}
              onChange={(e) => setPointsDelta(Math.trunc(Number(e.target.value || 0)))}
              className="w-full min-h-[44px] rounded-xl border border-[#223552] bg-[#08111F] px-3.5 font-mono text-sm text-[#B9F36B]"
            />
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {[-20, -10, 0, 10, 20, 50].map((v) => (
                <button
                  key={`p-${v}`}
                  type="button"
                  onClick={() => setPointsDelta(v)}
                  className="rounded-lg border border-[#223552] bg-[#08111F] px-2 py-1 text-[11px] font-mono text-[#9BB0CA] hover:text-[#B9F36B]"
                >
                  {v > 0 ? `+${v}` : v}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
          <div className="sm:col-span-2">
            <label
              htmlFor="adj-reason"
              className="block text-xs font-semibold text-[#9BB0CA] mb-1.5"
            >
              Audit Reason (Required)
            </label>
            <input
              id="adj-reason"
              type="text"
              value={adjReason}
              onChange={(e) => setAdjReason(e.target.value)}
              placeholder="e.g. Bonus question reward / Appeal approved / Penalty correction"
              className="w-full min-h-[44px] rounded-xl border border-[#223552] bg-[#08111F] px-3.5 text-sm text-[#EEF5FF]"
            />
          </div>

          <button
            type="button"
            disabled={
              busy ||
              !adjTeamId ||
              !adjReason.trim() ||
              (coinDelta === 0 && pointsDelta === 0)
            }
            onClick={() => setConfirmAdjOpen(true)}
            className="min-h-[44px] rounded-xl bg-[#F5B731] px-5 text-sm font-bold text-[#08111F] disabled:opacity-40"
          >
            Preview &amp; Apply Adjustment
          </button>
        </div>
      </div>

      {/* Room & Economy Settings Editor */}
      <form
        onSubmit={handleSaveSettingsSubmit}
        className="rounded-2xl border border-[#223552] bg-[#111E31] p-6 space-y-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#223552] pb-3">
          <div className="flex items-center gap-2.5">
            <Sliders className="h-5 w-5 text-[#51D6E8]" />
            <div>
              <h3 className="font-display text-lg font-bold text-[#EEF5FF]">
                COIN &amp; POINT REWARD SETTINGS
              </h3>
              <p className="text-xs text-[#9BB0CA]">
                Can be updated anytime, including during an ongoing auction. Changes apply to future
                evaluations and newly joined teams only—past transactions are never recalculated.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setSettings({ ...DEFAULT_ROOM_SETTINGS })}
            className="min-h-[36px] inline-flex items-center gap-1.5 rounded-xl border border-[#223552] bg-[#08111F] px-3 text-xs font-semibold text-[#9BB0CA] hover:text-[#EEF5FF]"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset to Defaults
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-[#9BB0CA] mb-1.5">Room Name</label>
            <input
              type="text"
              required
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              className="w-full min-h-[42px] rounded-xl border border-[#223552] bg-[#08111F] px-3.5 text-sm text-[#EEF5FF]"
            />
          </div>
          <StepperControl
            label="Max Teams"
            value={settings.maxTeams}
            min={2}
            max={200}
            step={2}
            onChange={(v) => updateSetting('maxTeams', v)}
          />
          <div>
            <label className="block text-xs font-semibold text-[#9BB0CA] mb-1.5">
              New Room PIN
            </label>
            <input
              type="password"
              value={newPin}
              onChange={(e) => setNewPin(e.target.value)}
              placeholder={room.hasPin ? 'PIN active (blank keeps)' : 'No PIN set'}
              className="w-full min-h-[42px] rounded-xl border border-[#223552] bg-[#08111F] px-3.5 text-sm text-[#EEF5FF]"
            />
          </div>
          <StepperControl
            label="Auction Timer (s)"
            value={settings.auctionDurationSec}
            min={5}
            max={600}
            step={5}
            onChange={(v) => updateSetting('auctionDurationSec', v)}
          />
          <StepperControl
            label="Answer Timer (s)"
            value={settings.answerDurationSec}
            min={5}
            max={300}
            step={5}
            onChange={(v) => updateSetting('answerDurationSec', v)}
          />
          <StepperControl
            label="Default Starting Bid"
            value={settings.minStartingBid}
            min={1}
            max={10000}
            step={5}
            accentClass="text-[#51D6E8]"
            onChange={(v) => updateSetting('minStartingBid', v)}
          />
          <StepperControl
            label="Min Bid Increment"
            value={settings.minBidIncrement}
            min={1}
            max={1000}
            step={5}
            accentClass="text-[#51D6E8]"
            onChange={(v) => updateSetting('minBidIncrement', v)}
          />
        </div>

        {/* Coin & Point Economy Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-xl border border-[#51D6E8]/30 bg-[#08111F]/70 p-4 space-y-3">
            <div className="flex items-center gap-2 text-[#51D6E8] text-sm font-bold">
              <Coins className="h-4 w-4" />
              Bidding Coins Settings
            </div>
            <div className="grid grid-cols-2 gap-3">
              <StepperControl
                label="Starting Virtual Coins (New Teams)"
                value={settings.startingCoins}
                min={0}
                max={100000}
                step={10}
                accentClass="text-[#51D6E8]"
                onChange={(v) => updateSetting('startingCoins', v)}
              />
              <StepperControl
                label="Correct Answer (+Coins)"
                value={settings.correctCoinReward}
                min={0}
                max={10000}
                step={5}
                accentClass="text-[#B9F36B]"
                onChange={(v) => updateSetting('correctCoinReward', v)}
              />
              <StepperControl
                label="Wrong Answer (-Coins)"
                value={settings.wrongCoinPenalty}
                min={0}
                max={10000}
                step={5}
                accentClass="text-[#F05252]"
                onChange={(v) => updateSetting('wrongCoinPenalty', v)}
              />
              <StepperControl
                label="Participation (+Coins)"
                value={settings.participationCoinReward}
                min={0}
                max={5000}
                step={5}
                accentClass="text-[#51D6E8]"
                onChange={(v) => updateSetting('participationCoinReward', v)}
              />
            </div>
          </div>

          <div className="rounded-xl border border-[#B9F36B]/30 bg-[#08111F]/70 p-4 space-y-3">
            <div className="flex items-center gap-2 text-[#B9F36B] text-sm font-bold">
              <Trophy className="h-4 w-4" />
              Competition Points Settings
            </div>
            <div className="grid grid-cols-2 gap-3">
              <StepperControl
                label="Starting Points (New Teams)"
                value={settings.startingPoints}
                min={-10000}
                max={100000}
                step={10}
                accentClass="text-[#B9F36B]"
                onChange={(v) => updateSetting('startingPoints', v)}
              />
              <StepperControl
                label="Correct Answer (+Points)"
                value={settings.correctPointReward}
                min={0}
                max={10000}
                step={5}
                accentClass="text-[#B9F36B]"
                onChange={(v) => updateSetting('correctPointReward', v)}
              />
              <StepperControl
                label="Wrong Answer (-Points)"
                value={settings.wrongPointPenalty}
                min={0}
                max={10000}
                step={5}
                accentClass="text-[#F05252]"
                onChange={(v) => updateSetting('wrongPointPenalty', v)}
              />
              <StepperControl
                label="Participation (+Points)"
                value={settings.participationPointReward}
                min={0}
                max={5000}
                step={5}
                accentClass="text-[#B9F36B]"
                onChange={(v) => updateSetting('participationPointReward', v)}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-6">
          <label className="inline-flex items-center gap-2 text-xs text-[#9BB0CA]">
            <input
              type="checkbox"
              checked={settings.deductWinningBid}
              onChange={(e) => updateSetting('deductWinningBid', e.target.checked)}
              className="h-4 w-4 accent-[#51D6E8]"
            />
            Deduct winning bid from Bidding Coins
          </label>
          <label className="inline-flex items-center gap-2 text-xs text-[#9BB0CA]">
            <input
              type="checkbox"
              checked={settings.allowNegativePoints}
              onChange={(e) => updateSetting('allowNegativePoints', e.target.checked)}
              className="h-4 w-4 accent-[#B9F36B]"
            />
            Allow negative Competition Points
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
        title="Confirm Manual Balance Adjustment"
        description={
          selectedTeam
            ? `Adjust ${selectedTeam.teamName}: Coins ${selectedTeam.coinBalance} -> ${previewNextCoins} (${coinDelta >= 0 ? '+' : ''}${coinDelta}) | Points ${selectedTeam.points} -> ${previewNextPoints} (${pointsDelta >= 0 ? '+' : ''}${pointsDelta}). Reason: "${adjReason}"`
            : 'Apply balance adjustment?'
        }
        confirmLabel="Apply Adjustment"
        variant="primary"
        busy={busy}
        onConfirm={submitManualAdjust}
        onCancel={() => setConfirmAdjOpen(false)}
      />

      <ConfirmDialog
        open={confirmSettingsOpen}
        title="Update Live Room Economy?"
        description="Saving modified Coin or Point settings in an active room applies to future evaluations and newly joined teams only. Past transactions and balances remain untouched."
        confirmLabel="Confirm & Save Settings"
        variant="primary"
        busy={busy}
        onConfirm={() => void commitSettings()}
        onCancel={() => setConfirmSettingsOpen(false)}
      />
    </div>
  );
}
