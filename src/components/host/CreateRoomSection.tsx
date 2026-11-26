import {
  Coins,
  ImagePlus,
  Minus,
  Plus,
  PlusCircle,
  RefreshCw,
  RotateCcw,
  Trash2,
  Trophy,
  X,
} from 'lucide-react';
import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  createRoom,
  RoomActionError,
  type CreateRoomItemInput,
} from '../../lib/firestoreAuction.ts';
import { compressUploadedImage } from '../../lib/imageUpload.ts';
import {
  DEFAULT_ROOM_SETTINGS,
  isRenderableImageSrc,
  type HostRoomSnapshot,
  type RoomSettings,
} from '../../shared/types.ts';

interface CreateRoomSectionProps {
  onRoomCreated: (snapshot: HostRoomSnapshot) => void;
}

interface DraftInitialItem extends CreateRoomItemInput {
  localId: string;
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
  const [draftItems, setDraftItems] = useState<DraftInitialItem[]>([]);
  const [uploadingItemId, setUploadingItemId] = useState<string | null>(null);

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

  const addDraftItem = () => {
    setDraftItems((prev) => [
      ...prev,
      {
        localId: `draft_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        itemName: '',
        imageOrEmoji: '💻',
        startingBid: settings.minStartingBid,
      },
    ]);
  };

  const updateDraftItem = (localId: string, patch: Partial<DraftInitialItem>) => {
    setDraftItems((prev) =>
      prev.map((item) => (item.localId === localId ? { ...item, ...patch } : item)),
    );
  };

  const removeDraftItem = (localId: string) => {
    setDraftItems((prev) => prev.filter((item) => item.localId !== localId));
  };

  const handleDraftImageUpload = async (localId: string, e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setUploadingItemId(localId);
    try {
      const compressed = await compressUploadedImage(file);
      updateDraftItem(localId, { imageOrEmoji: compressed });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to process image upload.');
    } finally {
      setUploadingItemId(null);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submittingRef.current || loading) return;

    const cleanName = roomName.trim();
    if (cleanName.length < 2 || cleanName.length > 80) {
      setError('Room name must be between 2 and 80 characters.');
      return;
    }

    const emptyNamedItem = draftItems.some((item) => !item.itemName.trim());
    if (emptyNamedItem) {
      setError('Every added auction item must have an Item Name (or remove unused rows).');
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
        initialItems: draftItems.map((d) => ({
          itemName: d.itemName.trim(),
          imageOrEmoji: d.imageOrEmoji,
          startingBid: d.startingBid,
        })),
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
            Configure room capacity, timers, separate Virtual Coins &amp; Competition Points rules,
            and optional auction items with photographs.
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
                COIN &amp; POINT REWARD SETTINGS
              </h3>
              <p className="text-xs text-[#9BB0CA]">
                Virtual Coins fund auction bids; Competition Points determine leaderboard standings.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Virtual Coins */}
            <div className="rounded-xl border border-[#51D6E8]/30 bg-[#111E31]/80 p-4 space-y-4">
              <div className="flex items-center gap-2 text-[#51D6E8]">
                <Coins className="h-4 w-4" />
                <span className="font-display text-sm font-bold">
                  Virtual Coins (Auction Currency)
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <StepperField
                  id="cr-start-coins"
                  label="Starting Virtual Coins"
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
                  Deduct Winning Bid from Virtual Coins (Default: Enabled)
                </span>
                <span className="block text-xs text-[#9BB0CA]">
                  Only the winning team&apos;s final bid is deducted once confirmed. Losing teams
                  keep all coins.
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
                  Allow Negative Competition Points (Default: Enabled)
                </span>
                <span className="block text-xs text-[#9BB0CA]">
                  Wrong-answer point penalties can take points below 0. Virtual Coins always floor
                  at 0.
                </span>
              </div>
            </label>
          </div>
        </div>

        {/* Optional Initial Auction Items (Name + Photo) */}
        <div className="rounded-2xl border border-[#223552] bg-[#08111F]/70 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#223552] pb-3">
            <div>
              <h3 className="font-display text-base font-bold text-[#EEF5FF]">
                Auction Items &amp; Photographs ({draftItems.length})
              </h3>
              <p className="text-xs text-[#9BB0CA]">
                Add items now with a name and photo—or add/edit them anytime inside the Host Control
                Dashboard. Questions are asked verbally by the host.
              </p>
            </div>
            <button
              type="button"
              onClick={addDraftItem}
              className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl border border-[#51D6E8]/50 bg-[#111E31] px-3.5 text-xs font-bold text-[#51D6E8] hover:bg-[#172740]"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Auction Item
            </button>
          </div>

          {draftItems.length > 0 && (
            <div className="space-y-3">
              {draftItems.map((item, idx) => {
                const hasPhoto = isRenderableImageSrc(item.imageOrEmoji);
                const isUploading = uploadingItemId === item.localId;
                return (
                  <div
                    key={item.localId}
                    className="rounded-xl border border-[#223552] bg-[#111E31] p-4 flex flex-col sm:flex-row sm:items-center gap-4"
                  >
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="font-mono text-xs font-bold text-[#51D6E8] w-10">
                        #{idx + 1}
                      </span>
                      <div className="h-16 w-20 rounded-xl border border-[#223552] bg-[#08111F] overflow-hidden flex items-center justify-center">
                        {hasPhoto ? (
                          <img
                            src={item.imageOrEmoji}
                            alt={item.itemName || `Item #${idx + 1}`}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <span className="text-2xl">{item.imageOrEmoji || '💻'}</span>
                        )}
                      </div>
                    </div>

                    <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="sm:col-span-2">
                        <label className="block text-[11px] font-semibold text-[#9BB0CA] mb-1">
                          Item Name
                        </label>
                        <input
                          type="text"
                          required
                          maxLength={120}
                          value={item.itemName}
                          onChange={(e) =>
                            updateDraftItem(item.localId, { itemName: e.target.value })
                          }
                          placeholder={`e.g. Quantum Dev Kit #${idx + 1}`}
                          className="w-full min-h-[40px] rounded-xl border border-[#223552] bg-[#08111F] px-3 text-sm text-[#EEF5FF] focus:border-[#51D6E8] focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-[#9BB0CA] mb-1">
                          Starting Bid (Coins)
                        </label>
                        <input
                          type="number"
                          min={1}
                          value={item.startingBid ?? settings.minStartingBid}
                          onChange={(e) =>
                            updateDraftItem(item.localId, {
                              startingBid: Math.max(1, Math.trunc(Number(e.target.value || 10))),
                            })
                          }
                          className="w-full min-h-[40px] rounded-xl border border-[#223552] bg-[#08111F] px-3 font-mono text-sm text-[#51D6E8] focus:border-[#51D6E8] focus:outline-none"
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <label className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl border border-[#223552] bg-[#08111F] px-3 text-xs font-semibold text-[#EEF5FF] hover:border-[#51D6E8] cursor-pointer">
                        {hasPhoto ? (
                          <RefreshCw className="h-3.5 w-3.5 text-[#51D6E8]" />
                        ) : (
                          <ImagePlus className="h-3.5 w-3.5 text-[#51D6E8]" />
                        )}
                        {isUploading ? 'Processing...' : hasPhoto ? 'Replace' : 'Upload Photo'}
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp,image/gif"
                          onChange={(e) => void handleDraftImageUpload(item.localId, e)}
                          className="hidden"
                        />
                      </label>

                      {hasPhoto && (
                        <button
                          type="button"
                          onClick={() => updateDraftItem(item.localId, { imageOrEmoji: '💻' })}
                          className="min-h-[38px] rounded-xl border border-[#223552] px-2.5 text-xs text-[#9BB0CA] hover:text-[#F05252]"
                          title="Remove image"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => removeDraftItem(item.localId)}
                        className="min-h-[38px] rounded-xl p-2 text-[#9BB0CA] hover:bg-[#F05252]/15 hover:text-[#F05252]"
                        title="Remove item"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
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
          disabled={loading || Boolean(uploadingItemId)}
          className="min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#51D6E8] px-6 py-3 text-sm font-bold text-[#08111F] hover:bg-[#6de0ef] transition-colors disabled:opacity-50"
        >
          <PlusCircle className="h-4 w-4" />
          {loading ? 'Creating Room...' : 'Create Room & Open Host Control'}
        </button>
      </form>
    </div>
  );
}

