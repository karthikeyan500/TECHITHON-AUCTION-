import {
  ArrowDown,
  ArrowUp,
  Copy,
  Download,
  Edit3,
  Eye,
  ImagePlus,
  Plus,
  RefreshCw,
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
import { compressUploadedImage } from '../../lib/imageUpload.ts';
import {
  isRenderableImageSrc,
  type AuctionItem,
  type HostRoomSnapshot,
} from '../../shared/types.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';

interface CustomItemsSectionProps {
  snapshot: HostRoomSnapshot;
}

export function CustomItemsSection({ snapshot }: CustomItemsSectionProps) {
  const { room, items } = snapshot;

  // Add / Edit form state — Item Name, Item Image, and Item Number (questions asked verbally by host)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [itemName, setItemName] = useState('');
  const [category, setCategory] = useState('Tech Auction');
  const [imageOrEmoji, setImageOrEmoji] = useState('💻');
  const [startingBid, setStartingBid] = useState<number>(room.settings.minStartingBid);
  const [auctionOverride, setAuctionOverride] = useState<string>('');
  const [answerOverride, setAnswerOverride] = useState<string>('');
  const [saveToBank, setSaveToBank] = useState(true);

  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [imageError, setImageError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [csvText, setCsvText] = useState('');
  const [showCsvModal, setShowCsvModal] = useState(false);
  const [previewItem, setPreviewItem] = useState<AuctionItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AuctionItem | null>(null);

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const editingItemNumber = useMemo(() => {
    if (!editingId) return items.length + 1;
    const idx = items.findIndex((i) => i.id === editingId);
    return idx >= 0 ? idx + 1 : items.length + 1;
  }, [editingId, items]);

  const resetForm = () => {
    setEditingId(null);
    setItemName('');
    setCategory('Tech Auction');
    setImageOrEmoji('💻');
    setImageError(null);
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
        item.category.toLowerCase().includes(q)
      );
    });
  }, [items, searchQuery, categoryFilter]);

  const handleImageUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setMessage(null);
    setImageError(null);
    setUploadingImage(true);
    setUploadProgress(10);
    try {
      const compressed = await compressUploadedImage(file, (pct) => setUploadProgress(pct));
      setImageOrEmoji(compressed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to upload image.';
      setImageError(msg);
      setMessage({
        type: 'error',
        text: msg,
      });
    } finally {
      setUploadingImage(false);
      setUploadProgress(0);
    }
  };

  const handleSaveItem = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || uploadingImage) return;
    setMessage(null);
    setBusy(true);
    try {
      const cleanName = itemName.trim();
      const payload = {
        itemName: cleanName,
        questionTitle: cleanName,
        questionDescription: '',
        category,
        imageOrEmoji,
        difficulty: '' as const,
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
        text: editingId
          ? `Item #${editingItemNumber} updated.`
          : `Item #${editingItemNumber} saved to room.`,
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
    setCategory(item.category);
    setImageOrEmoji(item.imageOrEmoji);
    setImageError(null);
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
      setMessage({ type: 'success', text: 'Pending item order randomized.' });
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

  const hasUploadedPhoto = isRenderableImageSrc(imageOrEmoji);

  return (
    <div className="space-y-6">
      {/* Pre-Start Readiness Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl border border-[#223552] bg-[#111E31] p-4">
          <p className="text-xs text-[#9BB0CA]">Total Items</p>
          <p className="mt-1 font-mono tabular-nums text-2xl font-bold text-[#EEF5FF]">
            {items.length}
          </p>
        </div>
        <div className="rounded-xl border border-[#223552] bg-[#111E31] p-4">
          <p className="text-xs text-[#9BB0CA]">Remaining Items</p>
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

      {/* Add / Edit Item Form (Item Number, Item Name, Item Image Upload) */}
      <form
        onSubmit={handleSaveItem}
        className="rounded-2xl border border-[#223552] bg-[#111E31] p-6 space-y-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#223552] pb-4">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="rounded-lg border border-[#51D6E8]/40 bg-[#08111F] px-2.5 py-0.5 font-mono text-xs font-bold text-[#51D6E8]">
                Item #{editingItemNumber}
              </span>
              <h2 className="font-display text-xl font-bold text-[#EEF5FF]">
                {editingId ? 'Edit Auction Item' : 'Add Auction Item'}
              </h2>
            </div>
            <p className="mt-1 text-xs text-[#9BB0CA]">
              Enter the Item Name and upload a photograph for live display. Questions and answers
              are handled verbally by the host during the event.
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

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Item Image Upload & Live Preview (5 cols) */}
          <div className="lg:col-span-5 space-y-2.5">
            <label className="block text-xs font-semibold tracking-wider text-[#9BB0CA]">
              ITEM IMAGE
            </label>
            <div className="rounded-2xl border border-[#223552] bg-[#08111F] p-4 space-y-3">
              <div className="aspect-video w-full rounded-xl border border-[#223552] bg-[#111E31] overflow-hidden flex items-center justify-center">
                {hasUploadedPhoto ? (
                  <img
                    src={imageOrEmoji}
                    alt={itemName || `Item #${editingItemNumber}`}
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <div className="text-center space-y-2 p-4">
                    <ImagePlus className="mx-auto h-10 w-10 text-[#51D6E8]/70" />
                    <p className="text-xs text-[#9BB0CA]">
                      Select JPG, JPEG, PNG, or WEBP from your computer to display live
                    </p>
                  </div>
                )}
              </div>

              {uploadingImage && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px] font-mono text-[#51D6E8]">
                    <span>Optimizing &amp; preparing image...</span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-[#111E31] overflow-hidden">
                    <div
                      className="h-full bg-[#51D6E8] transition-all duration-150"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <label className="min-h-[42px] flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-[#172740] border border-[#51D6E8]/40 px-4 text-xs font-bold text-[#51D6E8] hover:bg-[#1e3252] cursor-pointer">
                  {hasUploadedPhoto ? (
                    <RefreshCw className="h-3.5 w-3.5" />
                  ) : (
                    <ImagePlus className="h-3.5 w-3.5" />
                  )}
                  {uploadingImage
                    ? `Uploading (${uploadProgress}%)`
                    : hasUploadedPhoto
                      ? 'Replace Image'
                      : '+ Upload Image'}
                  <input
                    type="file"
                    accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                    onChange={(e) => void handleImageUpload(e)}
                    className="hidden"
                  />
                </label>

                {hasUploadedPhoto && (
                  <button
                    type="button"
                    onClick={() => {
                      setImageOrEmoji('💻');
                      setImageError(null);
                    }}
                    className="min-h-[42px] inline-flex items-center gap-1.5 rounded-xl border border-[#F05252]/40 bg-[#F05252]/10 px-3.5 text-xs font-semibold text-[#F05252] hover:bg-[#F05252]/20"
                  >
                    <X className="h-3.5 w-3.5" />
                    Remove Image
                  </button>
                )}
              </div>

              {imageError && (
                <p role="alert" className="text-xs font-medium text-[#F05252]">
                  {imageError}
                </p>
              )}
            </div>
          </div>

          {/* Item Details (7 cols) */}
          <div className="lg:col-span-7 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label
                  htmlFor="item-name"
                  className="block text-xs font-semibold tracking-wider text-[#9BB0CA] mb-1.5"
                >
                  ITEM NAME
                </label>
                <input
                  id="item-name"
                  type="text"
                  required
                  maxLength={120}
                  value={itemName}
                  onChange={(e) => setItemName(e.target.value)}
                  placeholder="Enter the auction item name"
                  className="w-full min-h-[46px] rounded-xl border border-[#223552] bg-[#08111F] px-3.5 text-sm font-medium text-[#EEF5FF] focus:border-[#51D6E8] focus:outline-none"
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
                  placeholder="e.g. Hardware & Systems"
                  className="w-full min-h-[44px] rounded-xl border border-[#223552] bg-[#08111F] px-3.5 text-sm text-[#EEF5FF] focus:border-[#51D6E8] focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="item-start-bid"
                  className="block text-xs font-semibold text-[#9BB0CA] mb-1.5"
                >
                  Starting Bid (Virtual Coins)
                </label>
                <input
                  id="item-start-bid"
                  type="number"
                  min={1}
                  required
                  value={startingBid}
                  onChange={(e) => setStartingBid(Number(e.target.value))}
                  className="w-full min-h-[44px] rounded-xl border border-[#223552] bg-[#08111F] px-3.5 font-mono text-sm text-[#51D6E8] focus:border-[#51D6E8] focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="item-auc-ovr"
                  className="block text-xs font-semibold text-[#9BB0CA] mb-1.5"
                >
                  Auction Timer Override (sec, optional)
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
                  Answer Timer Override (sec, optional)
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
                Also save item to my reusable catalog
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

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="submit"
                disabled={busy || uploadingImage}
                className="min-h-[44px] inline-flex items-center gap-2 rounded-xl bg-[#51D6E8] px-5 text-sm font-bold text-[#08111F] hover:bg-[#6de0ef] transition-colors disabled:opacity-50"
              >
                <Plus className="h-4 w-4" />
                {editingId ? `Save Item #${editingItemNumber}` : `Add Item #${editingItemNumber}`}
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
          </div>
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
            No items match your search. Add an auction item with a name and photo above.
          </p>
        ) : (
          <div className="divide-y divide-[#223552]">
            {filteredItems.map((item) => {
              const globalIdx = items.findIndex((x) => x.id === item.id);
              const isImg = isRenderableImageSrc(item.imageOrEmoji);
              return (
                <div
                  key={item.id}
                  className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <span className="font-mono text-xs font-bold text-[#51D6E8] w-7 shrink-0">
                      #{globalIdx + 1}
                    </span>
                    <div className="h-14 w-16 shrink-0 rounded-xl border border-[#223552] bg-[#08111F] overflow-hidden flex items-center justify-center">
                      {isImg ? (
                        <img
                          src={item.imageOrEmoji}
                          alt={item.itemName}
                          referrerPolicy="no-referrer"
                          className="h-full w-full object-contain"
                        />
                      ) : (
                        <span className="text-2xl">{item.imageOrEmoji || '💻'}</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-[#EEF5FF] truncate">{item.itemName}</p>
                      <p className="mt-0.5 text-[11px] text-[#9BB0CA]">
                        {item.category}
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
              <div>
                <p className="text-xs font-mono text-[#51D6E8]">
                  Item #{items.findIndex((i) => i.id === previewItem.id) + 1} · {previewItem.category}
                </p>
                <h3 className="font-display text-xl font-bold text-[#EEF5FF]">
                  {previewItem.itemName}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setPreviewItem(null)}
                className="rounded-lg p-1.5 text-[#9BB0CA] hover:bg-[#172740]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="aspect-video w-full rounded-xl border border-[#223552] bg-[#08111F] overflow-hidden flex items-center justify-center">
              {isRenderableImageSrc(previewItem.imageOrEmoji) ? (
                <img
                  src={previewItem.imageOrEmoji}
                  alt={previewItem.itemName}
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-contain"
                />
              ) : (
                <span className="text-6xl">{previewItem.imageOrEmoji || '💻'}</span>
              )}
            </div>
            <p className="text-xs text-[#9BB0CA] font-mono">
              Starting Bid: {previewItem.startingBid} Virtual Coins
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
              Columns: itemName, category, imageOrEmoji, startingBid
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
              placeholder={`itemName,category,imageOrEmoji,startingBid\nKubernetes Cluster Hardware,Cloud & DevOps,☸️,15`}
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

