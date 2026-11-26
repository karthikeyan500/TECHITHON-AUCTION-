import {
  ArrowDown,
  ArrowUp,
  Copy,
  Download,
  Edit3,
  Eye,
  Plus,
  Search,
  Shuffle,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  addCustomItem,
  deleteCustomItem,
  duplicateCustomItem,
  exportItemsCsv,
  importItemsFromCsv,
  randomizePendingItems,
  reorderCustomItems,
  RoomActionError,
  updateCustomItem,
} from '../../lib/firestoreAuction.ts';
import type { AuctionItem, DifficultyLevel, HostRoomSnapshot } from '../../shared/types.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';

interface CustomItemsSectionProps {
  snapshot: HostRoomSnapshot;
}

const EMOJI_PRESETS = ['💻', '🧠', '⚡', '🛰️', '🔐', '🗄️', '🤖', '🌐', '⚙️', '📡'];

export function CustomItemsSection({ snapshot }: CustomItemsSectionProps) {
  const { room, items } = snapshot;

  // Add / Edit form state — strictly NO correct-answer field anywhere
  const [editingId, setEditingId] = useState<string | null>(null);
  const [itemName, setItemName] = useState('');
  const [questionTitle, setQuestionTitle] = useState('');
  const [questionDescription, setQuestionDescription] = useState('');
  const [category, setCategory] = useState('Algorithms & Systems');
  const [imageOrEmoji, setImageOrEmoji] = useState('💻');
  const [difficulty, setDifficulty] = useState<DifficultyLevel | ''>('Medium');
  const [startingBid, setStartingBid] = useState<number>(room.settings.minStartingBid);
  const [auctionOverride, setAuctionOverride] = useState<string>('');
  const [answerOverride, setAnswerOverride] = useState<string>('');
  const [saveToBank, setSaveToBank] = useState(true);

  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [csvText, setCsvText] = useState('');
  const [showCsvModal, setShowCsvModal] = useState(false);
  const [previewItem, setPreviewItem] = useState<AuctionItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AuctionItem | null>(null);

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const resetForm = () => {
    setEditingId(null);
    setItemName('');
    setQuestionTitle('');
    setQuestionDescription('');
    setCategory('Algorithms & Systems');
    setImageOrEmoji('💻');
    setDifficulty('Medium');
    setStartingBid(room.settings.minStartingBid);
    setAuctionOverride('');
    setAnswerOverride('');
  };

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const i of items) set.add(i.category);
    return Array.from(set).sort();
  }, [items]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return items.filter((item) => {
      if (categoryFilter !== 'ALL' && item.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        item.itemName.toLowerCase().includes(q) ||
        item.questionTitle.toLowerCase().includes(q) ||
        item.questionDescription.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q)
      );
    });
  }, [items, searchQuery, categoryFilter]);

  const handleSaveItem = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setMessage(null);
    setBusy(true);
    try {
      const payload = {
        itemName,
        questionTitle,
        questionDescription,
        category,
        imageOrEmoji,
        difficulty,
        startingBid,
        auctionDurationOverride: auctionOverride ? Number(auctionOverride) : null,
        answerDurationOverride: answerOverride ? Number(answerOverride) : null,
        saveToBank: editingId ? false : saveToBank,
      };

      if (editingId) {
        await updateCustomItem(room.id, editingId, payload);
      } else {
        await addCustomItem(room.id, payload);
      }

      setMessage({
        type: 'success',
        text: editingId ? 'Item updated.' : 'Custom auction item added.',
      });
      resetForm();
    } catch (err) {
      setMessage({
        type: 'error',
        text:
          err instanceof RoomActionError || err instanceof Error
            ? err.message
            : 'Unable to save item.',
      });
    } finally {
      setBusy(false);
    }
  };

  const startEditing = (item: AuctionItem) => {
    setEditingId(item.id);
    setItemName(item.itemName);
    setQuestionTitle(item.questionTitle);
    setQuestionDescription(item.questionDescription);
    setCategory(item.category);
    setImageOrEmoji(item.imageOrEmoji);
    setDifficulty(item.difficulty);
    setStartingBid(item.startingBid);
    setAuctionOverride(item.auctionDurationOverride ? String(item.auctionDurationOverride) : '');
    setAnswerOverride(item.answerDurationOverride ? String(item.answerDurationOverride) : '');
  };

  const handleDuplicate = async (item: AuctionItem) => {
    setBusy(true);
    setMessage(null);
    try {
      await duplicateCustomItem(room.id, item);
      setMessage({ type: 'success', text: `Duplicated "${item.itemName}".` });
    } catch (err) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to duplicate item.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    setMessage(null);
    try {
      await deleteCustomItem(room.id, deleteTarget.id);
      setDeleteTarget(null);
    } catch (err) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to delete item.',
      });
    } finally {
      setBusy(false);
    }
  };

  const moveItem = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const ids = items.map((i) => i.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    await reorderCustomItems(room.id, ids);
  };

  const handleRandomize = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await randomizePendingItems(room.id, items);
      setMessage({ type: 'success', text: 'Pending question order randomized.' });
    } catch (err) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to randomize items.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleCsvFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setCsvText(reader.result);
    };
    reader.readAsText(file);
  };

  const handleCsvImport = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const imported = await importItemsFromCsv(room.id, csvText, room.settings.minStartingBid);
      setShowCsvModal(false);
      setCsvText('');
      setMessage({ type: 'success', text: `Imported ${imported} items from CSV.` });
    } catch (err) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'CSV import failed.',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Pre-Start Readiness Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl border border-[#223552] bg-[#111E31] p-4">
          <p className="text-xs text-[#9BB0CA]">Total Questions</p>
          <p className="mt-1 font-mono tabular-nums text-2xl font-bold text-[#EEF5FF]">
            {items.length}
          </p>
        </div>
        <div className="rounded-xl border border-[#223552] bg-[#111E31] p-4">
          <p className="text-xs text-[#9BB0CA]">Unused Questions</p>
          <p className="mt-1 font-mono tabular-nums text-2xl font-bold text-[#51D6E8]">
            {room.unusedItemCount}
          </p>
        </div>
        <div className="rounded-xl border border-[#223552] bg-[#111E31] p-4">
          <p className="text-xs text-[#9BB0CA]">Timers (Auc / Ans)</p>
          <p className="mt-1 font-mono tabular-nums text-lg font-bold text-[#EEF5FF]">
            {room.settings.auctionDurationSec}s / {room.settings.answerDurationSec}s
          </p>
        </div>
        <div className="rounded-xl border border-[#223552] bg-[#111E31] p-4">
          <p className="text-xs text-[#9BB0CA]">Rewards (Coins | Pts)</p>
          <p className="mt-1 font-mono tabular-nums text-sm font-bold text-[#B9F36B]">
            +{room.settings.correctCoinReward}/-{room.settings.wrongCoinPenalty}c · +
            {room.settings.correctPointReward}/-{room.settings.wrongPointPenalty}p
          </p>
        </div>
      </div>

      {/* Add / Edit Item Form (Strictly NO Correct Answer Field) */}
      <form
        onSubmit={handleSaveItem}
        className="rounded-2xl border border-[#223552] bg-[#111E31] p-6 space-y-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#223552] pb-4">
          <div>
            <h2 className="font-display text-xl font-bold text-[#EEF5FF]">
              {editingId ? 'Edit Auction Item' : 'Add Custom Auction Item'}
            </h2>
            <p className="text-xs text-[#9BB0CA]">
              Teams bid on the Item Name. You will ask the Question verbally and judge answers live
              (no answer key is stored).
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setShowCsvModal(true)}
              className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl border border-[#223552] bg-[#172740] px-3.5 text-xs font-semibold text-[#EEF5FF] hover:bg-[#1e3252]"
            >
              <Upload className="h-3.5 w-3.5" />
              Import CSV
            </button>
            <button
              type="button"
              onClick={() => exportItemsCsv(snapshot)}
              className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl border border-[#223552] bg-[#172740] px-3.5 text-xs font-semibold text-[#EEF5FF] hover:bg-[#1e3252]"
            >
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="item-name"
              className="block text-xs font-semibold text-[#9BB0CA] mb-1.5"
            >
              Item Name (visible to bidders)
            </label>
            <input
              id="item-name"
              type="text"
              required
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              placeholder="e.g. RISC-V Pipeline Core"
              className="w-full min-h-[44px] rounded-xl border border-[#223552] bg-[#08111F] px-3.5 text-sm text-[#EEF5FF] focus:border-[#51D6E8] focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="item-category"
              className="block text-xs font-semibold text-[#9BB0CA] mb-1.5"
            >
              Category
            </label>
            <input
              id="item-category"
              type="text"
              required
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. Computer Architecture"
              className="w-full min-h-[44px] rounded-xl border border-[#223552] bg-[#08111F] px-3.5 text-sm text-[#EEF5FF] focus:border-[#51D6E8] focus:outline-none"
            />
          </div>

          <div className="md:col-span-2">
            <label
              htmlFor="item-q-title"
              className="block text-xs font-semibold text-[#9BB0CA] mb-1.5"
            >
              Question Title (host-only, asked verbally)
            </label>
            <input
              id="item-q-title"
              type="text"
              required
              value={questionTitle}
              onChange={(e) => setQuestionTitle(e.target.value)}
              placeholder="e.g. Explain how data hazards are resolved with forwarding."
              className="w-full min-h-[44px] rounded-xl border border-[#223552] bg-[#08111F] px-3.5 text-sm text-[#EEF5FF] focus:border-[#51D6E8] focus:outline-none"
            />
          </div>

          <div className="md:col-span-2">
            <label
              htmlFor="item-q-desc"
              className="block text-xs font-semibold text-[#9BB0CA] mb-1.5"
            >
              Question Description / Host Prompt Notes
            </label>
            <textarea
              id="item-q-desc"
              rows={2}
              value={questionDescription}
              onChange={(e) => setQuestionDescription(e.target.value)}
              placeholder="Optional detailed prompt or judging criteria notes for the host..."
              className="w-full rounded-xl border border-[#223552] bg-[#08111F] p-3.5 text-sm text-[#EEF5FF] focus:border-[#51D6E8] focus:outline-none"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <div>
            <label
              htmlFor="item-emoji"
              className="block text-xs font-semibold text-[#9BB0CA] mb-1.5"
            >
              Emoji or Image URL
            </label>
            <input
              id="item-emoji"
              type="text"
              value={imageOrEmoji}
              onChange={(e) => setImageOrEmoji(e.target.value)}
              className="w-full min-h-[44px] rounded-xl border border-[#223552] bg-[#08111F] px-3.5 text-sm text-[#EEF5FF] focus:border-[#51D6E8] focus:outline-none"
            />
            <div className="mt-1.5 flex flex-wrap gap-1">
              {EMOJI_PRESETS.map((em) => (
                <button
                  key={em}
                  type="button"
                  onClick={() => setImageOrEmoji(em)}
                  className="rounded px-1.5 py-0.5 text-sm hover:bg-[#172740]"
                >
                  {em}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label
              htmlFor="item-diff"
              className="block text-xs font-semibold text-[#9BB0CA] mb-1.5"
            >
              Difficulty
            </label>
            <select
              id="item-diff"
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value as DifficultyLevel | '')}
              className="w-full min-h-[44px] rounded-xl border border-[#223552] bg-[#08111F] px-3 text-sm text-[#EEF5FF] focus:border-[#51D6E8] focus:outline-none"
            >
              <option value="">Unspecified</option>
              <option value="Easy">Easy</option>
              <option value="Medium">Medium</option>
              <option value="Hard">Hard</option>
              <option value="Expert">Expert</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="item-start-bid"
              className="block text-xs font-semibold text-[#9BB0CA] mb-1.5"
            >
              Starting Bid (Coins)
            </label>
            <input
              id="item-start-bid"
              type="number"
              min={1}
              required
              value={startingBid}
              onChange={(e) => setStartingBid(Number(e.target.value))}
              className="w-full min-h-[44px] rounded-xl border border-[#223552] bg-[#08111F] px-3.5 font-mono text-sm text-[#EEF5FF] focus:border-[#51D6E8] focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="item-auc-ovr"
              className="block text-xs font-semibold text-[#9BB0CA] mb-1.5"
            >
              Auction Sec (optional)
            </label>
            <input
              id="item-auc-ovr"
              type="number"
              min={5}
              max={600}
              value={auctionOverride}
              onChange={(e) => setAuctionOverride(e.target.value)}
              placeholder={`${room.settings.auctionDurationSec}s`}
              className="w-full min-h-[44px] rounded-xl border border-[#223552] bg-[#08111F] px-3.5 font-mono text-sm text-[#EEF5FF] focus:border-[#51D6E8] focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="item-ans-ovr"
              className="block text-xs font-semibold text-[#9BB0CA] mb-1.5"
            >
              Answer Sec (optional)
            </label>
            <input
              id="item-ans-ovr"
              type="number"
              min={5}
              max={300}
              value={answerOverride}
              onChange={(e) => setAnswerOverride(e.target.value)}
              placeholder={`${room.settings.answerDurationSec}s`}
              className="w-full min-h-[44px] rounded-xl border border-[#223552] bg-[#08111F] px-3.5 font-mono text-sm text-[#EEF5FF] focus:border-[#51D6E8] focus:outline-none"
            />
          </div>
        </div>

        {!editingId && (
          <label className="inline-flex items-center gap-2 text-xs text-[#9BB0CA] cursor-pointer">
            <input
              type="checkbox"
              checked={saveToBank}
              onChange={(e) => setSaveToBank(e.target.checked)}
              className="h-4 w-4 accent-[#51D6E8]"
            />
            Also save to my reusable Question Bank
          </label>
        )}

        {message && (
          <div
            role="status"
            className={`rounded-xl border px-4 py-2.5 text-sm ${
              message.type === 'success'
                ? 'border-[#B9F36B]/40 bg-[#B9F36B]/10 text-[#B9F36B]'
                : 'border-[#F05252]/40 bg-[#F05252]/10 text-[#F05252]'
            }`}
          >
            {message.text}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={busy}
            className="min-h-[44px] inline-flex items-center gap-2 rounded-xl bg-[#51D6E8] px-5 text-sm font-bold text-[#08111F] hover:bg-[#6de0ef] transition-colors disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            {editingId ? 'Save Changes' : 'Add Auction Item'}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={resetForm}
              className="min-h-[44px] rounded-xl border border-[#223552] px-4 text-sm text-[#9BB0CA] hover:text-[#EEF5FF]"
            >
              Cancel Edit
            </button>
          )}
        </div>
      </form>

      {/* Item Queue Search & Management */}
      <div className="rounded-2xl border border-[#223552] bg-[#111E31] p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-display text-lg font-bold text-[#EEF5FF]">
            Auction Queue ({filteredItems.length})
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9BB0CA]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search items..."
                className="min-h-[40px] rounded-xl border border-[#223552] bg-[#08111F] pl-9 pr-3 text-xs text-[#EEF5FF] focus:border-[#51D6E8] focus:outline-none"
              />
            </div>

            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="min-h-[40px] rounded-xl border border-[#223552] bg-[#08111F] px-3 text-xs text-[#EEF5FF] focus:border-[#51D6E8] focus:outline-none"
            >
              <option value="ALL">All Categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={handleRandomize}
              disabled={busy || items.length < 2}
              className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-[#223552] bg-[#172740] px-3 text-xs font-semibold text-[#EEF5FF] hover:bg-[#1e3252] disabled:opacity-40"
            >
              <Shuffle className="h-3.5 w-3.5" />
              Randomize
            </button>
          </div>
        </div>

        {filteredItems.length === 0 ? (
          <p className="py-8 text-center text-sm text-[#9BB0CA]">
            No items match your search. Add a custom auction item above or import from CSV.
          </p>
        ) : (
          <div className="divide-y divide-[#223552]">
            {filteredItems.map((item) => {
              const globalIdx = items.findIndex((x) => x.id === item.id);
              return (
                <div
                  key={item.id}
                  className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <span className="font-mono text-xs font-bold text-[#9BB0CA] mt-1 w-6 shrink-0">
                      #{globalIdx + 1}
                    </span>
                    <span className="text-2xl shrink-0">
                      {item.imageOrEmoji.startsWith('http') || item.imageOrEmoji.startsWith('/')
                        ? '🖼️'
                        : item.imageOrEmoji}
                    </span>
                    <div className="min-w-0">
                      <p className="font-semibold text-[#EEF5FF] truncate">{item.itemName}</p>
                      <p className="text-xs text-[#9BB0CA] truncate">{item.questionTitle}</p>
                      <p className="mt-0.5 text-[11px] text-[#9BB0CA]">
                        {item.category}
                        {item.difficulty ? ` · ${item.difficulty}` : ''}
                        {' · '}Start {item.startingBid} coins ·{' '}
                        <span
                          className={
                            item.status === 'COMPLETED'
                              ? 'text-[#B9F36B]'
                              : item.status === 'SKIPPED'
                                ? 'text-[#F5B731]'
                                : 'text-[#51D6E8]'
                          }
                        >
                          {item.status}
                        </span>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => moveItem(globalIdx, -1)}
                      disabled={globalIdx === 0}
                      className="rounded-lg p-2 text-[#9BB0CA] hover:bg-[#172740] hover:text-[#EEF5FF] disabled:opacity-30"
                      title="Move Up"
                    >
                      <ArrowUp className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveItem(globalIdx, 1)}
                      disabled={globalIdx === items.length - 1}
                      className="rounded-lg p-2 text-[#9BB0CA] hover:bg-[#172740] hover:text-[#EEF5FF] disabled:opacity-30"
                      title="Move Down"
                    >
                      <ArrowDown className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewItem(item)}
                      className="rounded-lg p-2 text-[#9BB0CA] hover:bg-[#172740] hover:text-[#51D6E8]"
                      title="Preview"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => startEditing(item)}
                      className="rounded-lg p-2 text-[#9BB0CA] hover:bg-[#172740] hover:text-[#EEF5FF]"
                      title="Edit"
                    >
                      <Edit3 className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDuplicate(item)}
                      className="rounded-lg p-2 text-[#9BB0CA] hover:bg-[#172740] hover:text-[#EEF5FF]"
                      title="Duplicate"
                    >
                      <Copy className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(item)}
                      className="rounded-lg p-2 text-[#9BB0CA] hover:bg-[#F05252]/15 hover:text-[#F05252]"
                      title="Delete"
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

      {/* Preview Modal */}
      {previewItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg rounded-2xl border border-[#223552] bg-[#111E31] p-6 space-y-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <span className="text-3xl">{previewItem.imageOrEmoji}</span>
                <div>
                  <p className="text-xs text-[#51D6E8]">{previewItem.category}</p>
                  <h3 className="font-display text-xl font-bold text-[#EEF5FF]">
                    {previewItem.itemName}
                  </h3>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPreviewItem(null)}
                className="rounded-lg p-1.5 text-[#9BB0CA] hover:bg-[#172740]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="rounded-xl border border-[#223552] bg-[#08111F] p-4 space-y-2">
              <p className="text-xs font-semibold text-[#9BB0CA]">Host Verbal Question</p>
              <p className="text-base font-semibold text-[#EEF5FF]">{previewItem.questionTitle}</p>
              {previewItem.questionDescription && (
                <p className="text-sm text-[#9BB0CA]">{previewItem.questionDescription}</p>
              )}
            </div>
            <p className="text-xs text-[#9BB0CA] font-mono">
              Starting Bid: {previewItem.startingBid} coins · Difficulty:{' '}
              {previewItem.difficulty || 'Standard'}
            </p>
          </div>
        </div>
      )}

      {/* CSV Import Modal */}
      {showCsvModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-xl rounded-2xl border border-[#223552] bg-[#111E31] p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold text-[#EEF5FF]">
                Import Auction Items from CSV
              </h3>
              <button
                type="button"
                onClick={() => setShowCsvModal(false)}
                className="rounded-lg p-1.5 text-[#9BB0CA] hover:bg-[#172740]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-xs text-[#9BB0CA]">
              Columns: itemName, questionTitle, questionDescription, category, imageOrEmoji,
              difficulty, startingBid (no correct-answer column).
            </p>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={handleCsvFile}
              className="block w-full text-xs text-[#9BB0CA] file:mr-3 file:rounded-lg file:border-0 file:bg-[#172740] file:px-3 file:py-2 file:text-xs file:font-semibold file:text-[#EEF5FF]"
            />
            <textarea
              rows={6}
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              placeholder={`itemName,questionTitle,questionDescription,category,imageOrEmoji,difficulty,startingBid\nKubernetes Pod,"What is the primary role of kube-proxy?","Explain ClusterIP vs NodePort.",Cloud & DevOps,☸️,Medium,15`}
              className="w-full rounded-xl border border-[#223552] bg-[#08111F] p-3 font-mono text-xs text-[#EEF5FF] focus:border-[#51D6E8] focus:outline-none"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCsvModal(false)}
                className="min-h-[40px] rounded-xl border border-[#223552] px-4 text-xs font-semibold text-[#9BB0CA]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || !csvText.trim()}
                onClick={handleCsvImport}
                className="min-h-[40px] rounded-xl bg-[#51D6E8] px-4 text-xs font-bold text-[#08111F] disabled:opacity-40"
              >
                {busy ? 'Importing...' : 'Import Items'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete Auction Item?"
        description={`Remove "${deleteTarget?.itemName}" from this room's auction queue?`}
        confirmLabel="Delete Item"
        variant="danger"
        busy={busy}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
