import { Coins, Minus, Plus, PlusCircle, RotateCcw, Trophy } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { createRoom, RoomActionError } from '../../lib/firestoreAuction.ts';
import {
  DEFAULT_ROOM_SETTINGS,
  type HostRoomSnapshot,
  type RoomSettings,
} from '../../shared/types.ts';

interface CreateRoomSectionProps {
  onRoomCreated: (snapshot: HostRoomSnapshot) => void;
}

function StepperField({
  id,
  label,
  value,
  min,
  max,
  step = 1,
  accentClass = 'text-[#EEF5FF]',
  onChange,
}: {
  id: string;
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
      <label htmlFor={id} className="block text-xs font-semibold text-[#9BB0CA] mb-1.5">
        {label}
      </label>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onChange(clamp(value - step))}
          className="min-h-[44px] min-w-[40px] flex items-center justify-center rounded-xl border border-[#223552] bg-[#08111F] text-[#9BB0CA] hover:text-[#EEF5FF] hover:border-[#51D6E8]"
          aria-label={`Decrease ${label}`}
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <input
          id={id}
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(clamp(Number(e.target.value || 0)))}
          className={`w-full min-h-[44px] rounded-xl border border-[#223552] bg-[#08111F] px-3 text-center font-mono text-sm font-bold focus:border-[#51D6E8] focus:outline-none ${accentClass}`}
        />
        <button
          type="button"
          onClick={() => onChange(clamp(value + step))}
          className="min-h-[44px] min-w-[40px] flex items-center justify-center rounded-xl border border-[#223552] bg-[#08111F] text-[#9BB0CA] hover:text-[#EEF5FF] hover:border-[#51D6E8]"
          aria-label={`Increase ${label}`}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

export function CreateRoomSection({ onRoomCreated }: CreateRoomSectionProps) {
  const [roomName, setRoomName] = useState('');
  const [roomPin, setRoomPin] = useState('');
  const [settings, setSettings] = useState<RoomSettings>({ ...DEFAULT_ROOM_SETTINGS });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submittingRef = useRef(false);

  const updateSetting = <K extends keyof RoomSettings>(key: K, val: RoomSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: val }));
  };

  const handleResetDefaults = () => {
    setSettings({ ...DEFAULT_ROOM_SETTINGS });
    setError(null);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submittingRef.current || loading) return;

    const cleanName = roomName.trim();
    if (cleanName.length < 2 || cleanName.length > 80) {
      setError('Room name must be between 2 and 80 characters.');
      return;
    }

    setError(null);
    setLoading(true);
    submittingRef.current = true;

    try {
      const snap = await createRoom({
        roomName: cleanName,
        roomPin: roomPin.trim() || undefined,
        settings,
      });
      onRoomCreated(snap);
    } catch (err) {
      setError(
        err instanceof RoomActionError || err instanceof Error
          ? err.message
          : 'Unable to create room in cloud database.',
      );
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  };

  return (
    <div className="rounded-2xl border border-[#223552] bg-[#111E31] p-6 sm:p-8 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#223552] pb-4">
        <div>
          <h2 className="font-display text-2xl font-bold text-[#EEF5FF]">Create Auction Room</h2>
          <p className="mt-1 text-sm text-[#9BB0CA]">
            Configure room capacity, timers, and separate Bidding Coins &amp; Competition Points
            rules. A shareable 6-character code will open directly in your Host Control Dashboard.
          </p>
        </div>

        <button
          type="button"
          onClick={handleResetDefaults}
          className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl border border-[#223552] bg-[#08111F] px-3.5 text-xs font-semibold text-[#9BB0CA] hover:text-[#EEF5FF] hover:border-[#51D6E8]"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset to Defaults
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <label
              htmlFor="cr-room-name"
              className="block text-xs font-semibold text-[#9BB0CA] mb-1.5"
            >
              Room Name
            </label>
            <input
              id="cr-room-name"
              type="text"
              required
              minLength={2}
              maxLength={80}
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              placeholder="e.g. Tech Symposium Finals 2026"
              className="w-full min-h-[44px] rounded-xl border border-[#223552] bg-[#08111F] px-3.5 text-sm text-[#EEF5FF] focus:border-[#51D6E8] focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="cr-room-pin"
              className="block text-xs font-semibold text-[#9BB0CA] mb-1.5"
            >
              Optional Room PIN (leave blank for open code entry)
            </label>
            <input
              id="cr-room-pin"
              type="password"
              value={roomPin}
              onChange={(e) => setRoomPin(e.target.value)}
              placeholder="Optional access PIN"
              className="w-full min-h-[44px] rounded-xl border border-[#223552] bg-[#08111F] px-3.5 text-sm text-[#EEF5FF] focus:border-[#51D6E8] focus:outline-none"
            />
          </div>
        </div>

        {/* Room Limits & Timers */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <StepperField
            id="cr-max-teams"
            label="Maximum Teams"
            value={settings.maxTeams}
            min={2}
            max={200}
            step={2}
            onChange={(v) => updateSetting('maxTeams', v)}
          />
          <StepperField
            id="cr-auction-timer"
            label="Auction Timer (s)"
            value={settings.auctionDurationSec}
            min={5}
            max={600}
            step={5}
            onChange={(v) => updateSetting('auctionDurationSec', v)}
          />
          <StepperField
            id="cr-answer-timer"
            label="Answer Timer (s)"
            value={settings.answerDurationSec}
            min={5}
            max={300}
            step={5}
            onChange={(v) => updateSetting('answerDurationSec', v)}
          />
          <StepperField
            id="cr-min-start"
            label="Min Starting Bid"
            value={settings.minStartingBid}
            min={1}
            max={10000}
            step={5}
            accentClass="text-[#51D6E8]"
            onChange={(v) => updateSetting('minStartingBid', v)}
          />
          <StepperField
            id="cr-min-inc"
            label="Min Bid Increment"
            value={settings.minBidIncrement}
            min={1}
            max={1000}
            step={5}
            accentClass="text-[#51D6E8]"
            onChange={(v) => updateSetting('minBidIncrement', v)}
          />
        </div>

        {/* Separate Coin & Point Economy Configuration */}
        <div className="rounded-2xl border border-[#223552] bg-[#08111F]/70 p-5 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#223552] pb-3">
            <div>
              <h3 className="font-display text-base font-bold text-[#EEF5FF]">
                Coin &amp; Point Economy Settings
              </h3>
              <p className="text-xs text-[#9BB0CA]">
                Bidding Coins fund auction bids; Competition Points determine leaderboard standings.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Bidding Coins */}
            <div className="rounded-xl border border-[#51D6E8]/30 bg-[#111E31]/80 p-4 space-y-4">
              <div className="flex items-center gap-2 text-[#51D6E8]">
                <Coins className="h-4 w-4" />
                <span className="font-display text-sm font-bold">
                  Bidding Coins (Auction Currency)
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <StepperField
                  id="cr-start-coins"
                  label="Starting Coins"
                  value={settings.startingCoins}
                  min={0}
                  max={100000}
                  step={10}
                  accentClass="text-[#51D6E8]"
                  onChange={(v) => updateSetting('startingCoins', v)}
                />
                <StepperField
                  id="cr-correct-coins"
                  label="Correct Answer (+Coins)"
                  value={settings.correctCoinReward}
                  min={0}
                  max={10000}
                  step={5}
                  accentClass="text-[#B9F36B]"
                  onChange={(v) => updateSetting('correctCoinReward', v)}
                />
                <StepperField
                  id="cr-wrong-coins"
                  label="Wrong Answer (-Coins)"
                  value={settings.wrongCoinPenalty}
                  min={0}
                  max={10000}
                  step={5}
                  accentClass="text-[#F05252]"
                  onChange={(v) => updateSetting('wrongCoinPenalty', v)}
                />
                <StepperField
                  id="cr-part-coins"
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

            {/* Competition Points */}
            <div className="rounded-xl border border-[#B9F36B]/30 bg-[#111E31]/80 p-4 space-y-4">
              <div className="flex items-center gap-2 text-[#B9F36B]">
                <Trophy className="h-4 w-4" />
                <span className="font-display text-sm font-bold">
                  Competition Points (Leaderboard Score)
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <StepperField
                  id="cr-start-pts"
                  label="Starting Points"
                  value={settings.startingPoints}
                  min={-10000}
                  max={100000}
                  step={10}
                  accentClass="text-[#B9F36B]"
                  onChange={(v) => updateSetting('startingPoints', v)}
                />
                <StepperField
                  id="cr-correct-pts"
                  label="Correct Answer (+Points)"
                  value={settings.correctPointReward}
                  min={0}
                  max={10000}
                  step={5}
                  accentClass="text-[#B9F36B]"
                  onChange={(v) => updateSetting('correctPointReward', v)}
                />
                <StepperField
                  id="cr-wrong-pts"
                  label="Wrong Answer (-Points)"
                  value={settings.wrongPointPenalty}
                  min={0}
                  max={10000}
                  step={5}
                  accentClass="text-[#F05252]"
                  onChange={(v) => updateSetting('wrongPointPenalty', v)}
                />
                <StepperField
                  id="cr-part-pts"
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
            <label className="flex items-start gap-3 rounded-xl border border-[#223552] bg-[#111E31] p-4 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.deductWinningBid}
                onChange={(e) => updateSetting('deductWinningBid', e.target.checked)}
                className="mt-1 h-4 w-4 rounded accent-[#51D6E8]"
              />
              <div>
                <span className="block text-sm font-semibold text-[#EEF5FF]">
                  Deduct Winning Bid from Coins (Default: Enabled)
                </span>
                <span className="block text-xs text-[#9BB0CA]">
                  Only the winning team&apos;s final bid is deducted from their Bidding Coins when
                  an auction closes. Losing teams keep all coins.
                </span>
              </div>
            </label>

            <label className="flex items-start gap-3 rounded-xl border border-[#223552] bg-[#111E31] p-4 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.allowNegativePoints}
                onChange={(e) => updateSetting('allowNegativePoints', e.target.checked)}
                className="mt-1 h-4 w-4 rounded accent-[#B9F36B]"
              />
              <div>
                <span className="block text-sm font-semibold text-[#EEF5FF]">
                  Allow Negative Competition Points (Default: Floor at 0)
                </span>
                <span className="block text-xs text-[#9BB0CA]">
                  When unchecked, Competition Points stop at 0. Bidding Coins always floor at 0.
                </span>
              </div>
            </label>
          </div>
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
          className="min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#51D6E8] px-6 py-3 text-sm font-bold text-[#08111F] hover:bg-[#6de0ef] transition-colors disabled:opacity-50"
        >
          <PlusCircle className="h-4 w-4" />
          {loading ? 'Creating Room...' : 'Create Room & Open Host Control'}
        </button>
      </form>
    </div>
  );
}
