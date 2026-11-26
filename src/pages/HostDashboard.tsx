import { signOut } from 'firebase/auth';
import {
  Activity,
  Award,
  BarChart3,
  BookMarked,
  Check,
  CheckCircle2,
  Coins,
  Copy,
  Download,
  ExternalLink,
  Gavel,
  History,
  LayoutDashboard,
  Layers,
  LogOut,
  Plus,
  Power,
  Settings,
  Share2,
  Sliders,
  Trash2,
  Trophy,
  Users,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog.tsx';
import { CreateRoomSection } from '../components/host/CreateRoomSection.tsx';
import { CustomItemsSection } from '../components/host/CustomItemsSection.tsx';
import {
  AuctionHistorySection,
  RoomSettingsAndAdjustSection,
} from '../components/host/HistoryAndSettingsSection.tsx';
import { LiveAuctionSection } from '../components/host/LiveAuctionSection.tsx';
import { HostAuthView } from '../components/HostAuthView.tsx';
import { LeaderboardTable } from '../components/LeaderboardTable.tsx';
import type { AppRoute } from '../components/Navbar.tsx';
import { PodiumDisplay } from '../components/PodiumDisplay.tsx';
import { auth } from '../lib/firebase.ts';
import {
  addItemsFromQuestionBank,
  completeRoom,
  deleteQuestionBankItem,
  deleteRoom,
  exportResultsCsv,
  listHostRooms,
  listQuestionBank,
  markRoomReady,
  removeTeamFromRoom,
  RoomActionError,
  subscribeHostRoom,
  toggleRoomActive,
} from '../lib/firestoreAuction.ts';
import { buildRoomJoinLink, resolveShareBaseUrl } from '../lib/shareUrl.ts';
import {
  formatResponseTime,
  type HostRoomSnapshot,
  type HostUser,
  type QuestionBankItem,
  type RoomSummary,
  type Team,
} from '../shared/types.ts';

export type HostSection =
  | 'overview'
  | 'create-room'
  | 'my-rooms'
  | 'items'
  | 'question-bank'
  | 'live-auction'
  | 'teams'
  | 'live-bids'
  | 'leaderboard'
  | 'history'
  | 'results'
  | 'settings';

interface HostDashboardProps {
  hostUser: HostUser | null;
  currentRoute: AppRoute;
  onNavigate: (route: AppRoute, search?: string) => void;
  onAuthenticated: (host: HostUser) => void;
  onLoggedOut: () => void;
  onOpenAudience: (roomCode: string) => void;
}

const HOST_NAV_ITEMS: Array<{ id: HostSection; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'overview', label: 'Room Overview', icon: LayoutDashboard },
  { id: 'create-room', label: 'Create Room', icon: Plus },
  { id: 'my-rooms', label: 'My Rooms', icon: Layers },
  { id: 'items', label: 'Auction Items', icon: BookMarked },
  { id: 'question-bank', label: 'Question Bank', icon: BookMarked },
  { id: 'live-auction', label: 'Auction Controls', icon: Gavel },
  { id: 'teams', label: 'Team Management', icon: Users },
  { id: 'live-bids', label: 'Live Bids', icon: Activity },
  { id: 'leaderboard', label: 'Live Leaderboard', icon: BarChart3 },
  { id: 'history', label: 'Auction History', icon: History },
  { id: 'results', label: 'Final Results', icon: Trophy },
  { id: 'settings', label: 'Room Settings', icon: Settings },
];

export function HostDashboard({
  hostUser,
  currentRoute,
  onNavigate,
  onAuthenticated,
  onLoggedOut,
  onOpenAudience,
}: HostDashboardProps) {
  const [section, setSection] = useState<HostSection>(() =>
    currentRoute === '/create-room' ? 'create-room' : 'overview',
  );
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<HostRoomSnapshot | null>(null);
  const [questionBank, setQuestionBank] = useState<QuestionBankItem[]>([]);
  const [selectedBankIds, setSelectedBankIds] = useState<string[]>([]);
  const [shareOrigin, setShareOrigin] = useState<string>('');
  const [createdBanner, setCreatedBanner] = useState<{
    roomName: string;
    roomCode: string;
  } | null>(null);
  const [adjustTargetTeamId, setAdjustTargetTeamId] = useState<string | null>(null);

  const [copiedNotice, setCopiedNotice] = useState<string | null>(null);
  const [deleteRoomTarget, setDeleteRoomTarget] = useState<RoomSummary | null>(null);
  const [removeTeamTarget, setRemoveTeamTarget] = useState<Team | null>(null);
  const [completeRoomConfirm, setCompleteRoomConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (currentRoute === '/create-room') {
      setSection('create-room');
    } else if (currentRoute === '/host' && section === 'create-room') {
      setSection('overview');
    }
  }, [currentRoute]);

  useEffect(() => {
    resolveShareBaseUrl()
      .then((origin) => setShareOrigin(origin))
      .catch(() => {});
  }, []);

  const fetchRoomsAndBank = useCallback(async () => {
    if (!hostUser) return;
    try {
      const [roomList, bankList] = await Promise.all([
        listHostRooms(hostUser.id),
        listQuestionBank(hostUser.id),
      ]);
      setRooms(roomList);
      setQuestionBank(bankList);
      setSelectedRoomId((prev) => {
        if (prev && roomList.some((r) => r.id === prev)) return prev;
        return roomList[0]?.id || null;
      });
    } catch (err) {
      setError(
        err instanceof RoomActionError || err instanceof Error
          ? err.message
          : 'Unable to load host workspace.',
      );
    }
  }, [hostUser]);

  useEffect(() => {
    void fetchRoomsAndBank();
  }, [fetchRoomsAndBank]);

  // Real-time Firestore room subscription for active selected room
  useEffect(() => {
    if (!hostUser || !selectedRoomId) {
      setSnapshot(null);
      return;
    }
    const unsub = subscribeHostRoom(
      selectedRoomId,
      hostUser.id,
      (nextSnap) => {
        setSnapshot(nextSnap);
        if (nextSnap) {
          setRooms((prev) => prev.map((r) => (r.id === nextSnap.room.id ? nextSnap.room : r)));
        }
      },
      (err) => {
        setError(err.message);
      },
    );
    return () => unsub();
  }, [hostUser, selectedRoomId]);

  if (!hostUser) {
    return (
      <HostAuthView
        title={section === 'create-room' ? 'Sign In to Create a Room' : 'Host Control Center'}
        onAuthenticated={onAuthenticated}
      />
    );
  }

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedNotice(`${label} copied`);
      setTimeout(() => setCopiedNotice(null), 2500);
    } catch {
      setCopiedNotice('Copy unavailable');
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch {
      // ignore
    }
    onLoggedOut();
  };

  const handleRoomCreated = (nextSnap: HostRoomSnapshot) => {
    setError(null);
    setRooms((prev) => [nextSnap.room, ...prev.filter((r) => r.id !== nextSnap.room.id)]);
    setSelectedRoomId(nextSnap.room.id);
    setSnapshot(nextSnap);
    setCreatedBanner({
      roomName: nextSnap.room.roomName,
      roomCode: nextSnap.room.roomCode,
    });
    setSection('overview');
    if (currentRoute !== '/host') {
      onNavigate('/host');
    }
  };

  const handleToggleActive = async (room: RoomSummary) => {
    setBusy(true);
    setError(null);
    try {
      await toggleRoomActive(room.id, room.roomCode, room.isActive);
      await fetchRoomsAndBank();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update room status.');
    } finally {
      setBusy(false);
    }
  };

  const handleMarkReady = async (room: RoomSummary) => {
    setError(null);
    setBusy(true);
    try {
      await markRoomReady(room.id, room.roomCode);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to mark room ready.');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteRoom = async () => {
    if (!deleteRoomTarget) return;
    setBusy(true);
    setError(null);
    try {
      await deleteRoom(deleteRoomTarget.id, deleteRoomTarget.roomCode);
      const remaining = rooms.filter((r) => r.id !== deleteRoomTarget.id);
      setRooms(remaining);
      if (selectedRoomId === deleteRoomTarget.id) {
        setSelectedRoomId(remaining[0]?.id || null);
      }
      setDeleteRoomTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete room.');
    } finally {
      setBusy(false);
    }
  };

  const handleCompleteRoom = async () => {
    if (!snapshot) return;
    setBusy(true);
    setError(null);
    try {
      await completeRoom(snapshot.room.id, snapshot.room.roomCode);
      setCompleteRoomConfirm(false);
      setSection('results');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to complete room.');
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveTeam = async () => {
    if (!snapshot || !removeTeamTarget) return;
    setBusy(true);
    setError(null);
    try {
      await removeTeamFromRoom(snapshot.room.id, removeTeamTarget);
      setRemoveTeamTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to remove team.');
    } finally {
      setBusy(false);
    }
  };

  const handleAddFromBank = async () => {
    if (!snapshot || selectedBankIds.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const chosen = questionBank.filter((b) => selectedBankIds.includes(b.id));
      await addItemsFromQuestionBank(snapshot.room.id, chosen);
      setSelectedBankIds([]);
      setSection('items');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to add items from bank.');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteBankItem = async (bankId: string) => {
    try {
      await deleteQuestionBankItem(hostUser.id, bankId);
      setQuestionBank((prev) => prev.filter((b) => b.id !== bankId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete question bank item.');
    }
  };

  const joinShareUrl = snapshot
    ? buildRoomJoinLink(shareOrigin || window.location.origin, snapshot.room.roomCode)
    : '';

  const bannerShareUrl = createdBanner
    ? buildRoomJoinLink(shareOrigin || window.location.origin, createdBanner.roomCode)
    : '';

  const usedItemsCount = snapshot ? snapshot.items.filter((i) => i.status !== 'PENDING').length : 0;

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6 sm:py-8">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Sidebar Navigation */}
        <aside className="lg:col-span-3 rounded-2xl border border-[#223552] bg-[#111E31] p-4 space-y-4">
          <div className="flex items-center justify-between border-b border-[#223552] pb-3">
            <div className="min-w-0">
              <p className="text-[11px] text-[#9BB0CA]">Host Organizer</p>
              <p className="font-display text-sm font-bold text-[#EEF5FF] truncate">
                {hostUser.displayName}
              </p>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="min-h-[36px] inline-flex items-center gap-1 rounded-lg border border-[#223552] px-2.5 text-xs text-[#9BB0CA] hover:text-[#F05252]"
              title="Log out"
            >
              <LogOut className="h-3.5 w-3.5" />
              Logout
            </button>
          </div>

          {rooms.length > 0 && (
            <div>
              <label
                htmlFor="active-room-select"
                className="block text-[11px] font-semibold text-[#9BB0CA] mb-1"
              >
                Active Room Workspace
              </label>
              <select
                id="active-room-select"
                value={selectedRoomId || ''}
                onChange={(e) => {
                  setSelectedRoomId(e.target.value);
                  setCreatedBanner(null);
                  if (section === 'create-room' || section === 'my-rooms') {
                    setSection('overview');
                  }
                }}
                className="w-full min-h-[40px] rounded-xl border border-[#223552] bg-[#08111F] px-3 text-xs font-semibold text-[#51D6E8]"
              >
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.roomCode} · {r.roomName}
                  </option>
                ))}
              </select>
            </div>
          )}

          <nav className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-1 gap-1">
            {HOST_NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = section === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setSection(item.id);
                    if (item.id === 'create-room' && currentRoute !== '/create-room') {
                      onNavigate('/create-room');
                    } else if (item.id !== 'create-room' && currentRoute === '/create-room') {
                      onNavigate('/host');
                    }
                  }}
                  className={`min-h-[40px] flex items-center gap-2.5 rounded-xl px-3 text-xs font-semibold transition-colors text-left whitespace-nowrap ${
                    active
                      ? 'bg-[#172740] text-[#51D6E8]'
                      : 'text-[#9BB0CA] hover:bg-[#08111F]/60 hover:text-[#EEF5FF]'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Main Workspace Content */}
        <section className="lg:col-span-9 space-y-6 min-w-0">
          {/* Room Creation Success Banner */}
          {createdBanner && section !== 'create-room' && (
            <div
              role="status"
              className="rounded-2xl border border-[#B9F36B]/50 bg-[#172740] px-5 py-4 flex flex-wrap items-center justify-between gap-4"
            >
              <div className="flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-[#B9F36B] mt-0.5 shrink-0" />
                <div>
                  <p className="font-display text-sm font-bold text-[#B9F36B]">
                    Room &quot;{createdBanner.roomName}&quot; Created &amp; Active
                  </p>
                  <p className="text-xs text-[#9BB0CA] mt-0.5">
                    Share code{' '}
                    <span className="font-mono font-bold text-[#EEF5FF]">
                      {createdBanner.roomCode}
                    </span>{' '}
                    or the public join link below so teams on any device can join.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => copyText(createdBanner.roomCode, 'Room code')}
                  className="min-h-[36px] inline-flex items-center gap-1.5 rounded-xl border border-[#223552] bg-[#08111F] px-3 text-xs font-semibold text-[#EEF5FF]"
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy Code
                </button>
                <button
                  type="button"
                  onClick={() => copyText(bannerShareUrl, 'Join link')}
                  className="min-h-[36px] inline-flex items-center gap-1.5 rounded-xl bg-[#B9F36B] px-3 text-xs font-bold text-[#08111F]"
                >
                  <Share2 className="h-3.5 w-3.5" />
                  Copy Join Link
                </button>
                <button
                  type="button"
                  onClick={() => setCreatedBanner(null)}
                  className="rounded-lg p-1.5 text-[#9BB0CA] hover:text-[#EEF5FF]"
                  aria-label="Dismiss notification"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* Room Quick Share Header when a room is selected */}
          {snapshot && section !== 'create-room' && section !== 'my-rooms' && (
            <div className="rounded-2xl border border-[#223552] bg-[#111E31] px-5 py-4 flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-[#9BB0CA]">
                  <span className="font-mono font-bold text-[#51D6E8] text-base tracking-wider">
                    {snapshot.room.roomCode}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{snapshot.room.humanStatus}</span>
                  <span aria-hidden="true">·</span>
                  <span>{snapshot.room.teamCount} Teams</span>
                  <span aria-hidden="true">·</span>
                  <span>{snapshot.room.itemCount} Items</span>
                </div>
                <h1 className="mt-0.5 font-display text-xl font-bold text-[#EEF5FF]">
                  {snapshot.room.roomName}
                </h1>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {copiedNotice && (
                  <span className="text-xs font-semibold text-[#B9F36B]">{copiedNotice}</span>
                )}
                <button
                  type="button"
                  onClick={() => copyText(snapshot.room.roomCode, 'Room code')}
                  className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl border border-[#223552] bg-[#172740] px-3 text-xs font-semibold text-[#EEF5FF] hover:bg-[#1e3252]"
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy Code
                </button>
                <button
                  type="button"
                  onClick={() => copyText(joinShareUrl, 'Join link')}
                  className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl border border-[#223552] bg-[#172740] px-3 text-xs font-semibold text-[#EEF5FF] hover:bg-[#1e3252]"
                >
                  <Share2 className="h-3.5 w-3.5" />
                  Share Join Link
                </button>
                <button
                  type="button"
                  onClick={() => onOpenAudience(snapshot.room.roomCode)}
                  className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl bg-[#51D6E8] px-3.5 text-xs font-bold text-[#08111F] hover:bg-[#6de0ef]"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Projector View
                </button>
              </div>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="rounded-xl border border-[#F05252]/40 bg-[#F05252]/10 px-4 py-3 text-sm text-[#F05252]"
            >
              {error}
            </div>
          )}

          {/* Section Routing */}
          {section === 'create-room' && <CreateRoomSection onRoomCreated={handleRoomCreated} />}

          {section === 'my-rooms' && (
            <div className="rounded-2xl border border-[#223552] bg-[#111E31] p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-[#223552] pb-4">
                <h2 className="font-display text-xl font-bold text-[#EEF5FF]">
                  My Auction Rooms ({rooms.length})
                </h2>
                <button
                  type="button"
                  onClick={() => {
                    setSection('create-room');
                    onNavigate('/create-room');
                  }}
                  className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl bg-[#51D6E8] px-4 text-xs font-bold text-[#08111F]"
                >
                  <Plus className="h-4 w-4" />
                  New Room
                </button>
              </div>

              {rooms.length === 0 ? (
                <p className="py-8 text-center text-sm text-[#9BB0CA]">
                  No rooms created yet. Create your first room to get a shareable code.
                </p>
              ) : (
                <div className="divide-y divide-[#223552]">
                  {rooms.map((r) => (
                    <div
                      key={r.id}
                      className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div>
                        <div className="flex items-center gap-2 text-xs text-[#9BB0CA]">
                          <span className="font-mono font-bold text-[#51D6E8]">{r.roomCode}</span>
                          <span>·</span>
                          <span>{r.humanStatus}</span>
                          <span>·</span>
                          <span>{r.isActive ? 'Accepting Teams' : 'Paused/Inactive'}</span>
                        </div>
                        <p className="mt-1 font-display text-base font-bold text-[#EEF5FF]">
                          {r.roomName}
                        </p>
                        <p className="text-xs text-[#9BB0CA]">
                          {r.teamCount}/{r.settings.maxTeams} teams · {r.itemCount} items · Start{' '}
                          {r.settings.startingCoins}c / {r.settings.startingPoints}p
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedRoomId(r.id);
                            setCreatedBanner(null);
                            setSection('overview');
                          }}
                          className="min-h-[38px] rounded-xl bg-[#172740] border border-[#223552] px-3.5 text-xs font-semibold text-[#EEF5FF] hover:border-[#51D6E8]"
                        >
                          Open Control Dashboard
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleToggleActive(r)}
                          className="min-h-[38px] inline-flex items-center gap-1 rounded-xl border border-[#223552] px-3 text-xs font-semibold text-[#9BB0CA] hover:text-[#EEF5FF]"
                        >
                          <Power className="h-3.5 w-3.5" />
                          {r.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteRoomTarget(r)}
                          className="min-h-[38px] rounded-xl p-2 text-[#9BB0CA] hover:bg-[#F05252]/15 hover:text-[#F05252]"
                          title="Delete room"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {section === 'question-bank' && (
            <div className="rounded-2xl border border-[#223552] bg-[#111E31] p-6 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#223552] pb-4">
                <div>
                  <h2 className="font-display text-xl font-bold text-[#EEF5FF]">
                    Reusable Question Bank ({questionBank.length})
                  </h2>
                  <p className="text-xs text-[#9BB0CA]">
                    Items saved across rooms. Select items to import into{' '}
                    {snapshot ? snapshot.room.roomName : 'your active room'}.
                  </p>
                </div>

                {snapshot && selectedBankIds.length > 0 && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleAddFromBank}
                    className="min-h-[40px] rounded-xl bg-[#B9F36B] px-4 text-xs font-bold text-[#08111F]"
                  >
                    Add {selectedBankIds.length} Selected to Room
                  </button>
                )}
              </div>

              {questionBank.length === 0 ? (
                <p className="py-8 text-center text-sm text-[#9BB0CA]">
                  Your Question Bank is empty. Check &quot;Also save to my reusable Question
                  Bank&quot; when creating custom auction items.
                </p>
              ) : (
                <div className="divide-y divide-[#223552]">
                  {questionBank.map((b) => {
                    const checked = selectedBankIds.includes(b.id);
                    return (
                      <div key={b.id} className="py-3.5 flex items-center justify-between gap-3">
                        <label className="flex items-start gap-3 cursor-pointer min-w-0 flex-1">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) =>
                              setSelectedBankIds((prev) =>
                                e.target.checked ? [...prev, b.id] : prev.filter((x) => x !== b.id),
                              )
                            }
                            className="mt-1 h-4 w-4 accent-[#51D6E8]"
                          />
                          <div className="min-w-0">
                            <p className="font-semibold text-[#EEF5FF] truncate">
                              {b.imageOrEmoji} {b.itemName}
                            </p>
                            <p className="text-xs text-[#9BB0CA] truncate">{b.questionTitle}</p>
                            <p className="text-[11px] text-[#9BB0CA]">
                              {b.category} · Start {b.startingBid} coins
                            </p>
                          </div>
                        </label>

                        <button
                          type="button"
                          onClick={() => handleDeleteBankItem(b.id)}
                          className="rounded-lg p-2 text-[#9BB0CA] hover:bg-[#F05252]/15 hover:text-[#F05252]"
                          title="Delete from bank"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Room-dependent sections */}
          {!snapshot &&
            section !== 'create-room' &&
            section !== 'my-rooms' &&
            section !== 'question-bank' && (
              <div className="rounded-2xl border border-[#223552] bg-[#111E31] p-10 text-center space-y-4">
                <Gavel className="mx-auto h-10 w-10 text-[#51D6E8]" />
                <h2 className="font-display text-2xl font-bold text-[#EEF5FF]">
                  Create Your First Auction Room
                </h2>
                <p className="text-sm text-[#9BB0CA] max-w-md mx-auto">
                  You don&apos;t have an auction room yet. Create a room to generate a join code,
                  add custom tech questions, and run live bidding.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSection('create-room');
                    onNavigate('/create-room');
                  }}
                  className="min-h-[46px] rounded-xl bg-[#51D6E8] px-6 text-sm font-bold text-[#08111F]"
                >
                  Create Room
                </button>
              </div>
            )}

          {snapshot && section === 'overview' && (
            <div className="space-y-6">
              {/* Room Overview Stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="rounded-2xl border border-[#223552] bg-[#111E31] p-5">
                  <p className="text-xs text-[#9BB0CA]">Joined Teams</p>
                  <p className="mt-1 font-mono tabular-nums text-3xl font-extrabold text-[#51D6E8]">
                    {snapshot.room.teamCount}
                    <span className="text-sm font-normal text-[#9BB0CA]">
                      /{snapshot.room.settings.maxTeams}
                    </span>
                  </p>
                </div>
                <div className="rounded-2xl border border-[#223552] bg-[#111E31] p-5">
                  <p className="text-xs text-[#9BB0CA]">Auction Items</p>
                  <p className="mt-1 font-mono tabular-nums text-2xl font-extrabold text-[#EEF5FF]">
                    {snapshot.room.itemCount}{' '}
                    <span className="block text-xs font-normal text-[#9BB0CA]">
                      {usedItemsCount} used · {snapshot.room.unusedItemCount} unused
                    </span>
                  </p>
                </div>
                <div className="rounded-2xl border border-[#223552] bg-[#111E31] p-5">
                  <p className="text-xs text-[#9BB0CA]">Timers (Auc / Ans)</p>
                  <p className="mt-1 font-mono tabular-nums text-2xl font-extrabold text-[#F5B731]">
                    {snapshot.room.settings.auctionDurationSec}s /{' '}
                    {snapshot.room.settings.answerDurationSec}s
                  </p>
                </div>
                <div className="rounded-2xl border border-[#223552] bg-[#111E31] p-5">
                  <p className="text-xs text-[#9BB0CA]">Highest Bid</p>
                  <p className="mt-1 font-mono tabular-nums text-2xl font-extrabold text-[#B9F36B]">
                    {snapshot.currentAuction?.highestBidderTeamId
                      ? `${snapshot.currentAuction.highestBid}c`
                      : '—'}
                    <span className="block text-xs font-normal text-[#9BB0CA] truncate">
                      {snapshot.currentAuction?.highestBidderTeamName || 'No active bids'}
                    </span>
                  </p>
                </div>
              </div>

              {/* Economy Configuration Summary */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="rounded-2xl border border-[#51D6E8]/30 bg-[#111E31] p-5 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <Coins className="h-6 w-6 text-[#51D6E8] shrink-0" />
                    <div>
                      <p className="text-xs font-semibold text-[#51D6E8]">
                        Bidding Coins Economy
                      </p>
                      <p className="mt-0.5 font-mono text-xs text-[#EEF5FF]">
                        Start: {snapshot.room.settings.startingCoins} · Correct: +
                        {snapshot.room.settings.correctCoinReward} · Wrong: -
                        {snapshot.room.settings.wrongCoinPenalty}
                      </p>
                      <p className="text-[11px] text-[#9BB0CA]">
                        Winning bid deduction:{' '}
                        {snapshot.room.settings.deductWinningBid ? 'Enabled' : 'Disabled'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-[#B9F36B]/30 bg-[#111E31] p-5 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <Trophy className="h-6 w-6 text-[#B9F36B] shrink-0" />
                    <div>
                      <p className="text-xs font-semibold text-[#B9F36B]">
                        Competition Points Economy
                      </p>
                      <p className="mt-0.5 font-mono text-xs text-[#EEF5FF]">
                        Start: {snapshot.room.settings.startingPoints} · Correct: +
                        {snapshot.room.settings.correctPointReward} · Wrong: -
                        {snapshot.room.settings.wrongPointPenalty}
                      </p>
                      <p className="text-[11px] text-[#9BB0CA]">
                        Rankings depend solely on Points &amp; Response Time
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Quick Navigation & Controls Bar */}
              <div className="rounded-2xl border border-[#223552] bg-[#111E31] p-6 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold text-[#51D6E8]">
                    Status: {snapshot.room.humanStatus} ·{' '}
                    {snapshot.room.isActive ? 'Open to Teams' : 'Entry Paused'}
                  </p>
                  <h2 className="mt-1 font-display text-xl font-bold text-[#EEF5FF]">
                    {snapshot.currentHostItem
                      ? `Current Item: ${snapshot.currentHostItem.itemName}`
                      : 'Add Custom Items to Begin'}
                  </h2>
                  <p className="mt-1 text-xs text-[#9BB0CA]">
                    {snapshot.room.unusedItemCount} of {snapshot.room.itemCount} items remaining
                  </p>
                </div>

                <div className="flex flex-wrap gap-2.5">
                  {snapshot.room.machineState === 'ROOM_WAITING' && (
                    <button
                      type="button"
                      disabled={busy || snapshot.room.itemCount === 0}
                      onClick={() => handleMarkReady(snapshot.room)}
                      className="min-h-[42px] inline-flex items-center gap-1.5 rounded-xl border border-[#B9F36B]/50 bg-[#B9F36B]/10 px-4 text-xs font-bold text-[#B9F36B] disabled:opacity-40"
                    >
                      <Check className="h-4 w-4" />
                      Mark Ready
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setSection('items')}
                    className="min-h-[42px] rounded-xl border border-[#223552] bg-[#172740] px-4 text-xs font-semibold text-[#EEF5FF]"
                  >
                    Auction Items
                  </button>
                  <button
                    type="button"
                    onClick={() => setSection('teams')}
                    className="min-h-[42px] rounded-xl border border-[#223552] bg-[#172740] px-4 text-xs font-semibold text-[#EEF5FF]"
                  >
                    Team Management
                  </button>
                  <button
                    type="button"
                    onClick={() => setSection('settings')}
                    className="min-h-[42px] rounded-xl border border-[#223552] bg-[#172740] px-4 text-xs font-semibold text-[#EEF5FF]"
                  >
                    Room Settings
                  </button>
                  <button
                    type="button"
                    onClick={() => setSection('live-auction')}
                    className="min-h-[42px] rounded-xl bg-[#51D6E8] px-5 text-xs font-bold text-[#08111F]"
                  >
                    Go to Auction Controls
                  </button>
                  {snapshot.room.machineState !== 'ROOM_COMPLETED' && (
                    <button
                      type="button"
                      onClick={() => setCompleteRoomConfirm(true)}
                      className="min-h-[42px] rounded-xl border border-[#F05252]/40 px-4 text-xs font-semibold text-[#F05252]"
                    >
                      End Room
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="font-display text-lg font-bold text-[#EEF5FF]">
                  Current Standings
                </h3>
                <LeaderboardTable entries={snapshot.leaderboard} showConnection />
              </div>
            </div>
          )}

          {snapshot && section === 'items' && <CustomItemsSection snapshot={snapshot} />}

          {snapshot && section === 'live-auction' && (
            <LiveAuctionSection
              snapshot={snapshot}
              onShowResults={() => setSection('results')}
            />
          )}

          {snapshot && section === 'teams' && (
            <div className="rounded-2xl border border-[#223552] bg-[#111E31] p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-[#223552] pb-4">
                <div>
                  <h2 className="font-display text-xl font-bold text-[#EEF5FF]">
                    Joined Teams ({snapshot.teams.length} / {snapshot.room.settings.maxTeams})
                  </h2>
                  <p className="text-xs text-[#9BB0CA]">
                    Independent Bidding Coins &amp; Competition Points, response speeds, and quick
                    balance adjustment controls.
                  </p>
                </div>
              </div>

              {snapshot.teams.length === 0 ? (
                <p className="py-8 text-center text-sm text-[#9BB0CA]">
                  Share Room Code{' '}
                  <span className="font-mono font-bold text-[#51D6E8]">
                    {snapshot.room.roomCode}
                  </span>{' '}
                  or your Share Join Link so teams can join from any device.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b border-[#223552] text-xs text-[#9BB0CA]">
                        <th className="py-3 pr-3">Team Name</th>
                        <th className="py-3 px-3">Connection</th>
                        <th className="py-3 px-3 text-right">Bidding Coins</th>
                        <th className="py-3 px-3 text-right">Comp. Points</th>
                        <th className="py-3 px-3 text-right">C / W</th>
                        <th className="py-3 px-3 text-right">Response Time</th>
                        <th className="py-3 pl-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#223552]/70">
                      {snapshot.teams.map((t) => (
                        <tr key={t.id}>
                          <td className="py-3 pr-3 font-semibold text-[#EEF5FF]">{t.teamName}</td>
                          <td className="py-3 px-3 text-xs">
                            <span
                              className={
                                t.connectionStatus === 'ONLINE'
                                  ? 'text-[#B9F36B] font-semibold'
                                  : 'text-[#9BB0CA]'
                              }
                            >
                              {t.connectionStatus === 'ONLINE' ? 'Online' : 'Offline'}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums font-bold text-[#51D6E8]">
                            {t.coinBalance}
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums font-bold text-[#B9F36B]">
                            {t.points}
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums text-xs text-[#9BB0CA]">
                            {t.correctCount} / {t.wrongCount}
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums text-[#9BB0CA]">
                            {formatResponseTime(t.totalResponseTimeMs)}
                          </td>
                          <td className="py-3 pl-3 text-right">
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  setAdjustTargetTeamId(t.id);
                                  setSection('settings');
                                }}
                                className="rounded-lg px-2 py-1.5 text-xs font-semibold text-[#F5B731] hover:bg-[#F5B731]/15 inline-flex items-center gap-1"
                                title="Adjust Coins or Points"
                              >
                                <Sliders className="h-3.5 w-3.5" />
                                Adjust
                              </button>
                              <button
                                type="button"
                                onClick={() => setRemoveTeamTarget(t)}
                                className="rounded-lg p-1.5 text-[#9BB0CA] hover:bg-[#F05252]/15 hover:text-[#F05252]"
                                title="Remove team"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {snapshot && section === 'live-bids' && (
            <div className="rounded-2xl border border-[#223552] bg-[#111E31] p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-[#223552] pb-4">
                <h2 className="font-display text-xl font-bold text-[#EEF5FF]">
                  Immutable Bid Log (Current Auction)
                </h2>
                <span className="text-xs font-mono text-[#9BB0CA]">
                  {snapshot.allAuctionBids.length} records
                </span>
              </div>
              {snapshot.allAuctionBids.length === 0 ? (
                <p className="py-8 text-center text-sm text-[#9BB0CA]">
                  No bids recorded for the active auction yet.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-[#223552] text-[#9BB0CA]">
                        <th className="py-2.5 pr-3">Seq #</th>
                        <th className="py-2.5 px-3">Team</th>
                        <th className="py-2.5 px-3 text-right">Bid (Coins)</th>
                        <th className="py-2.5 px-3">Status</th>
                        <th className="py-2.5 px-3">Note</th>
                        <th className="py-2.5 pl-3 text-right">Timestamp</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#223552]/70">
                      {snapshot.allAuctionBids.map((b) => (
                        <tr key={b.id}>
                          <td className="py-2.5 pr-3 font-mono text-[#9BB0CA]">
                            #{b.sequenceNumber}
                          </td>
                          <td className="py-2.5 px-3 font-semibold text-[#EEF5FF]">{b.teamName}</td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-[#51D6E8]">
                            {b.bidAmount}
                          </td>
                          <td className="py-2.5 px-3 font-semibold">
                            <span
                              className={
                                b.status === 'ACCEPTED' ? 'text-[#B9F36B]' : 'text-[#F05252]'
                              }
                            >
                              {b.status}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-[#9BB0CA]">
                            {b.rejectionReason || 'Accepted as highest bid'}
                          </td>
                          <td className="py-2.5 pl-3 text-right font-mono text-[#9BB0CA]">
                            {new Date(b.serverTimestamp).toLocaleTimeString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {snapshot && section === 'leaderboard' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-xl font-bold text-[#EEF5FF]">Live Leaderboard</h2>
                <span className="text-xs text-[#9BB0CA]">
                  Sorted by Competition Points DESC, Response Time ASC
                </span>
              </div>
              <LeaderboardTable entries={snapshot.leaderboard} showConnection />
            </div>
          )}

          {snapshot && section === 'history' && <AuctionHistorySection snapshot={snapshot} />}

          {snapshot && section === 'results' && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#223552] bg-[#111E31] p-6">
                <div className="flex items-center gap-3">
                  <Award className="h-8 w-8 text-[#F5B731]" />
                  <div>
                    <h2 className="font-display text-2xl font-bold text-[#EEF5FF]">
                      Final Event Results
                    </h2>
                    <p className="text-xs text-[#9BB0CA]">
                      {snapshot.room.roomName} · Status: {snapshot.room.humanStatus}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => exportResultsCsv(snapshot)}
                    className="min-h-[42px] inline-flex items-center gap-1.5 rounded-xl bg-[#51D6E8] px-4 text-xs font-bold text-[#08111F]"
                  >
                    <Download className="h-4 w-4" />
                    Export Results CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => setSection('history')}
                    className="min-h-[42px] rounded-xl border border-[#223552] bg-[#172740] px-4 text-xs font-semibold text-[#EEF5FF]"
                  >
                    View Auction History
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSection('create-room');
                      onNavigate('/create-room');
                    }}
                    className="min-h-[42px] rounded-xl border border-[#223552] px-4 text-xs font-semibold text-[#9BB0CA] hover:text-[#EEF5FF]"
                  >
                    Start New Room
                  </button>
                </div>
              </div>

              <PodiumDisplay entries={snapshot.leaderboard} />
              <LeaderboardTable entries={snapshot.leaderboard} />
            </div>
          )}

          {snapshot && section === 'settings' && (
            <RoomSettingsAndAdjustSection
              snapshot={snapshot}
              preselectedTeamId={adjustTargetTeamId}
            />
          )}
        </section>
      </div>

      <ConfirmDialog
        open={Boolean(deleteRoomTarget)}
        title="Delete Auction Room?"
        description={`Permanently delete "${deleteRoomTarget?.roomName}" (${deleteRoomTarget?.roomCode}) along with all teams, bids, and history? This cannot be undone.`}
        confirmLabel="Delete Room"
        variant="danger"
        busy={busy}
        onConfirm={handleDeleteRoom}
        onCancel={() => setDeleteRoomTarget(null)}
      />

      <ConfirmDialog
        open={Boolean(removeTeamTarget)}
        title="Remove Team from Room?"
        description={`Remove "${removeTeamTarget?.teamName}" from the active room? They will be disconnected immediately.`}
        confirmLabel="Remove Team"
        variant="danger"
        busy={busy}
        onConfirm={handleRemoveTeam}
        onCancel={() => setRemoveTeamTarget(null)}
      />

      <ConfirmDialog
        open={completeRoomConfirm}
        title="End Room & Finalize Results?"
        description="Mark this room as Completed? Teams will no longer be able to place bids, and the final podium results will be displayed."
        confirmLabel="Complete Event"
        variant="primary"
        busy={busy}
        onConfirm={handleCompleteRoom}
        onCancel={() => setCompleteRoomConfirm(false)}
      />
    </div>
  );
}
