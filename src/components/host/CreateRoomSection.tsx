import { PlusCircle } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { apiRequest, ApiError } from '../../lib/api.ts';
import type { HostRoomSnapshot } from '../../shared/types.ts';

interface CreateRoomSectionProps {
  onRoomCreated: (snapshot: HostRoomSnapshot) => void;
}

export function CreateRoomSection({ onRoomCreated }: CreateRoomSectionProps) {
  const [roomName, setRoomName] = useState('');
  const [roomPin, setRoomPin] = useState('');
  const [maxTeams, setMaxTeams] = useState(32);
  const [startingCoins, setStartingCoins] = useState(100);
  const [auctionDurationSec, setAuctionDurationSec] = useState(30);
  const [answerDurationSec, setAnswerDurationSec] = useState(20);
  const [correctPoints, setCorrectPoints] = useState(10);
  const [wrongDeduction, setWrongDeduction] = useState(10);
  const [minStartingBid, setMinStartingBid] = useState(10);
  const [minBidIncrement, setMinBidIncrement] = useState(5);
  const [deductWinningBid, setDeductWinningBid] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const snap = await apiRequest<HostRoomSnapshot>('/api/host/rooms', {
        method: 'POST',
        authMode: 'host',
        body: JSON.stringify({
          roomName,
          roomPin: roomPin.trim() || undefined,
          maxTeams,
          startingCoins,
          auctionDurationSec,
          answerDurationSec,
          correctPoints,
          wrongDeduction,
          minStartingBid,
          minBidIncrement,
          deductWinningBid,
        }),
      });
      onRoomCreated(snap);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to create room.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-2xl border border-[#223552] bg-[#111E31] p-6 sm:p-8 space-y-6">
      <div className="border-b border-[#223552] pb-4">
        <h2 className="font-display text-2xl font-bold text-[#EEF5FF]">Create Auction Room</h2>
        <p className="mt-1 text-sm text-[#9BB0CA]">
          Configure room limits, timers, and scoring rules. A unique 6-character room code will be
          generated automatically.
        </p>
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

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label
              htmlFor="cr-max-teams"
              className="block text-xs font-semibold text-[#9BB0CA] mb-1.5"
            >
              Maximum Teams
            </label>
            <input
              id="cr-max-teams"
              type="number"
              min={2}
              max={200}
              value={maxTeams}
              onChange={(e) => setMaxTeams(Number(e.target.value))}
              className="w-full min-h-[44px] rounded-xl border border-[#223552] bg-[#08111F] px-3.5 font-mono text-sm text-[#EEF5FF] focus:border-[#51D6E8] focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="cr-starting-coins"
              className="block text-xs font-semibold text-[#9BB0CA] mb-1.5"
            >
              Starting Coins / Points
            </label>
            <input
              id="cr-starting-coins"
              type="number"
              min={0}
              max={100000}
              value={startingCoins}
              onChange={(e) => setStartingCoins(Number(e.target.value))}
              className="w-full min-h-[44px] rounded-xl border border-[#223552] bg-[#08111F] px-3.5 font-mono text-sm text-[#EEF5FF] focus:border-[#51D6E8] focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="cr-auction-timer"
              className="block text-xs font-semibold text-[#9BB0CA] mb-1.5"
            >
              Auction Timer (seconds)
            </label>
            <input
              id="cr-auction-timer"
              type="number"
              min={5}
              max={600}
              value={auctionDurationSec}
              onChange={(e) => setAuctionDurationSec(Number(e.target.value))}
              className="w-full min-h-[44px] rounded-xl border border-[#223552] bg-[#08111F] px-3.5 font-mono text-sm text-[#EEF5FF] focus:border-[#51D6E8] focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="cr-answer-timer"
              className="block text-xs font-semibold text-[#9BB0CA] mb-1.5"
            >
              Answer Timer (seconds)
            </label>
            <input
              id="cr-answer-timer"
              type="number"
              min={5}
              max={300}
              value={answerDurationSec}
              onChange={(e) => setAnswerDurationSec(Number(e.target.value))}
              className="w-full min-h-[44px] rounded-xl border border-[#223552] bg-[#08111F] px-3.5 font-mono text-sm text-[#EEF5FF] focus:border-[#51D6E8] focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="cr-correct-pts"
              className="block text-xs font-semibold text-[#9BB0CA] mb-1.5"
            >
              Correct Answer Points (+)
            </label>
            <input
              id="cr-correct-pts"
              type="number"
              min={1}
              max={1000}
              value={correctPoints}
              onChange={(e) => setCorrectPoints(Number(e.target.value))}
              className="w-full min-h-[44px] rounded-xl border border-[#223552] bg-[#08111F] px-3.5 font-mono text-sm text-[#B9F36B] focus:border-[#51D6E8] focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="cr-wrong-pts"
              className="block text-xs font-semibold text-[#9BB0CA] mb-1.5"
            >
              Wrong Answer Deduction (-)
            </label>
            <input
              id="cr-wrong-pts"
              type="number"
              min={0}
              max={1000}
              value={wrongDeduction}
              onChange={(e) => setWrongDeduction(Number(e.target.value))}
              className="w-full min-h-[44px] rounded-xl border border-[#223552] bg-[#08111F] px-3.5 font-mono text-sm text-[#F05252] focus:border-[#51D6E8] focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="cr-min-start"
              className="block text-xs font-semibold text-[#9BB0CA] mb-1.5"
            >
              Default Min Starting Bid
            </label>
            <input
              id="cr-min-start"
              type="number"
              min={1}
              max={10000}
              value={minStartingBid}
              onChange={(e) => setMinStartingBid(Number(e.target.value))}
              className="w-full min-h-[44px] rounded-xl border border-[#223552] bg-[#08111F] px-3.5 font-mono text-sm text-[#EEF5FF] focus:border-[#51D6E8] focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="cr-min-inc"
              className="block text-xs font-semibold text-[#9BB0CA] mb-1.5"
            >
              Minimum Bid Increment
            </label>
            <input
              id="cr-min-inc"
              type="number"
              min={1}
              max={1000}
              value={minBidIncrement}
              onChange={(e) => setMinBidIncrement(Number(e.target.value))}
              className="w-full min-h-[44px] rounded-xl border border-[#223552] bg-[#08111F] px-3.5 font-mono text-sm text-[#EEF5FF] focus:border-[#51D6E8] focus:outline-none"
            />
          </div>
        </div>

        <label className="flex items-start gap-3 rounded-xl border border-[#223552] bg-[#08111F] p-4 cursor-pointer">
          <input
            type="checkbox"
            checked={deductWinningBid}
            onChange={(e) => setDeductWinningBid(e.target.checked)}
            className="mt-1 h-4 w-4 rounded accent-[#51D6E8]"
          />
          <div>
            <span className="block text-sm font-semibold text-[#EEF5FF]">
              Deduct Winning Bid from Team Balance (Default: OFF)
            </span>
            <span className="block text-xs text-[#9BB0CA]">
              By default, bids only determine floor priority and are NOT deducted. Enable only if
              your event rules subtract winning bids.
            </span>
          </div>
        </label>

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
          {loading ? 'Creating Room...' : 'Create Room & Generate Code'}
        </button>
      </form>
    </div>
  );
}
