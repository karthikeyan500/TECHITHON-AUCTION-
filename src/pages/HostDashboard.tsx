import {
  Activity,
  Award,
  BarChart3,
  BookMarked,
  Check,
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
  Trash2,
  Trophy,
  Users,
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
import { PodiumDisplay } from '../components/PodiumDisplay.tsx';
import { apiRequest, ApiError, getHostToken, setHostToken } from '../lib/api.ts';
import { getSocket } from '../lib/socket.ts';
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
  initialSection?: HostSection;
  onAuthenticated: (host: HostUser, token: string) => void;
  onLoggedOut: () => void;
  onOpenAudience: (roomCode: string) => void;
}

const HOST_NAV_ITEMS: Array<{ id: HostSection; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'create-room', label: 'Create Room', icon: Plus },
  { id: 'my-rooms', label: 'My Rooms', icon: Layers },
  { id: 'items', label: 'Custom Items', icon: BookMarked },
  { id: 'question-bank', label: 'Question Bank', icon: BookMarked },
  { id: 'live-auction', label: 'Live Auction', icon: Gavel },
  { id: 'teams', label: 'Teams', icon: Users },
  { id: 'live-bids', label: 'Live Bids', icon: Activity },
  { id: 'leaderboard', label: 'Leaderboard', icon: BarChart3 },
  { id: 'history', label: 'Auction History', icon: History },
  { id: 'results', label: 'Final Results', icon: Trophy },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export function HostDashboard({
  hostUser,
  initialSection = 'overview',
  onAuthenticated,
  onLoggedOut,
  onOpenAudience,
}: HostDashboardProps) {
  const [section, setSection] = useState<HostSection>(initialSection);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<HostRoomSnapshot | null>(null);
  const [questionBank, setQuestionBank] = useState<QuestionBankItem[]>([]);
  const [selectedBankIds, setSelectedBankIds] = useState<string[]>([]);

  const [copiedNotice, setCopiedNotice] = useState<string | null>(null);
  const [deleteRoomTarget, setDeleteRoomTarget] = useState<RoomSummary | null>(null);
  const [removeTeamTarget, setRemoveTeamTarget] = useState<Team | null>(null);
  const [completeRoomConfirm, setCompleteRoomConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSection(initialSection);
  }, [initialSection]);

  const fetchRoomsAndBank = useCallback(async () => {
    if (!hostUser) return;
    try {
      const [roomsRes, bankRes] = await Promise.all([
        apiRequest<{ rooms: RoomSummary[] }>('/api/host/rooms', { authMode: 'host' }),
        apiRequest<{ items: QuestionBankItem[] }>('/api/host/question-bank', {
          authMode: 'host',
        }),
      ]);
      setRooms(roomsRes.rooms);
      setQuestionBank(bankRes.items);

      setSelectedRoomId((prev) => {
        if (prev && roomsRes.rooms.some((r) => r.id === prev)) return prev;
        return roomsRes.rooms[0]?.id || null;
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load host workspace.');
    }
  }, [hostUser]);

  useEffect(() => {
    fetchRoomsAndBank();
  }, [fetchRoomsAndBank]);

  const loadRoomSnapshot = useCallback(
    async (roomId: string) => {
      if (!hostUser) return;
      try {
        const snap = await apiRequest<HostRoomSnapshot>(`/api/host/rooms/${roomId}`, {
          authMode: 'host',
        });
        setSnapshot(snap);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Failed to load room details.');
      }
    },
    [hostUser],
  );

  useEffect(() => {
    if (selectedRoomId) {
      loadRoomSnapshot(selectedRoomId);
    } else {
      setSnapshot(null);
    }
  }, [selectedRoomId, loadRoomSnapshot]);

  // Real-time Host Socket.IO subscription & automatic recovery
  useEffect(() => {
    if (!hostUser || !selectedRoomId) return;
    const socket = getSocket();

    const subscribe = () => {
      socket.emit('subscribe:host', {
        roomId: selectedRoomId,
        token: getHostToken() || undefined,
      });
    };

    const onHostState = (next: HostRoomSnapshot) => {
      if (next.room.id === selectedRoomId) {
        setSnapshot(next);
        setRooms((prev) => prev.map((r) => (r.id === next.room.id ? next.room : r)));
      }
    };

    const onConnect = () => {
      subscribe();
      loadRoomSnapshot(selectedRoomId);
    };

    socket.on('connect', onConnect);
    socket.on('host:state', onHostState);

    if (socket.connected) {
      subscribe();
    } else {
      socket.connect();
    }

    return () => {
      socket.off('connect', onConnect);
      socket.off('host:state', onHostState);
    };
  }, [hostUser, selectedRoomId, loadRoomSnapshot]);

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
      setTimeout(() => setCopiedNotice(null), 2000);
    } catch {
      setCopiedNotice('Copy unavailable');
    }
  };

  const handleLogout = async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST', authMode: 'host' });
    } catch {
      // ignore
    }
    setHostToken(null);
    onLoggedOut();
  };

  const handleRoomCreated = (nextSnap: HostRoomSnapshot) => {
    setRooms((prev) => [nextSnap.room, ...prev]);
    setSelectedRoomId(nextSnap.room.id);
    setSnapshot(nextSnap);
    setSection('items');
  };

  const handleSnapshotUpdate = (next: HostRoomSnapshot) => {
    setSnapshot(next);
    setRooms((prev) => prev.map((r) => (r.id === next.room.id ? next.room : r)));
    fetchRoomsAndBank();
  };

  const handleToggleActive = async (roomId: string) => {
    setBusy(true);
    try {
      const next = await apiRequest<HostRoomSnapshot>(`/api/host/rooms/${roomId}/toggle-active`, {
        method: 'POST',
        authMode: 'host',
      });
      handleSnapshotUpdate(next);
    } finally {
      setBusy(false);
    }
  };

  const handleMarkReady = async (roomId: string) => {
    setError(null);
    setBusy(true);
    try {
      const next = await apiRequest<HostRoomSnapshot>(`/api/host/rooms/${roomId}/ready`, {
        method: 'POST',
        authMode: 'host',
      });
      handleSnapshotUpdate(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to mark room ready.');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteRoom = async () => {
    if (!deleteRoomTarget) return;
    setBusy(true);
    try {
      await apiRequest(`/api/host/rooms/${deleteRoomTarget.id}`, {
        method: 'DELETE',
        authMode: 'host',
      });
      const remaining = rooms.filter((r) => r.id !== deleteRoomTarget.id);
      setRooms(remaining);
      if (selectedRoomId === deleteRoomTarget.id) {
        setSelectedRoomId(remaining[0]?.id || null);
      }
      setDeleteRoomTarget(null);
    } finally {
      setBusy(false);
    }
  };

  const handleCompleteRoom = async () => {
    if (!snapshot) return;
    setBusy(true);
    try {
      const next = await apiRequest<HostRoomSnapshot>(
        `/api/host/rooms/${snapshot.room.id}/complete`,
        { method: 'POST', authMode: 'host' },
      );
      handleSnapshotUpdate(next);
      setCompleteRoomConfirm(false);
      setSection('results');
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveTeam = async () => {
    if (!snapshot || !removeTeamTarget) return;
    setBusy(true);
    try {
      const next = await apiRequest<HostRoomSnapshot>(
        `/api/host/rooms/${snapshot.room.id}/teams/${removeTeamTarget.id}`,
        { method: 'DELETE', authMode: 'host' },
      );
      handleSnapshotUpdate(next);
      setRemoveTeamTarget(null);
    } finally {
      setBusy(false);
    }
  };

  const handleAddFromBank = async () => {
    if (!snapshot || selectedBankIds.length === 0) return;
    setBusy(true);
    try {
      const next = await apiRequest<HostRoomSnapshot>(
        `/api/host/rooms/${snapshot.room.id}/items/from-bank`,
        {
          method: 'POST',
          authMode: 'host',
          body: JSON.stringify({ bankIds: selectedBankIds }),
        },
      );
      handleSnapshotUpdate(next);
      setSelectedBankIds([]);
      setSection('items');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteBankItem = async (bankId: string) => {
    await apiRequest(`/api/host/question-bank/${bankId}`, {
      method: 'DELETE',
      authMode: 'host',
    });
    setQuestionBank((prev) => prev.filter((b) => b.id !== bankId));
  };

  const joinShareUrl = snapshot
    ? `${window.location.origin}/join?code=${snapshot.room.roomCode}`
    : '';

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
                onChange={(e) => setSelectedRoomId(e.target.value)}
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
                  onClick={() => setSection(item.id)}
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
          {/* Room Quick Share Header when a room is selected */}
          {snapshot && section !== 'create-room' && section !== 'my-rooms' && (
            <div className="rounded-2xl border border-[#223552] bg-[#111E31] px-5 py-4 flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-[#9BB0CA]">
                  <span className="font-mono font-bold text-[#51D6E8] text-sm">
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
                  onClick={() => setSection('create-room')}
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
                          {r.teamCount}/{r.settings.maxTeams} teams · {r.itemCount} items · Created{' '}
                          {new Date(r.createdAt).toLocaleDateString()}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedRoomId(r.id);
                            setSection('live-auction');
                          }}
                          className="min-h-[38px] rounded-xl bg-[#172740] border border-[#223552] px-3.5 text-xs font-semibold text-[#EEF5FF] hover:border-[#51D6E8]"
                        >
                          Open Console
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleToggleActive(r.id)}
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
                              {b.category} · Start {b.startingBid}
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
                  onClick={() => setSection('create-room')}
                  className="min-h-[46px] rounded-xl bg-[#51D6E8] px-6 text-sm font-bold text-[#08111F]"
                >
                  Create Room
                </button>
              </div>
            )}

          {snapshot && section === 'overview' && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="rounded-2xl border border-[#223552] bg-[#111E31] p-5">
                  <p className="text-xs text-[#9BB0CA]">Active Rooms</p>
                  <p className="mt-1 font-mono tabular-nums text-3xl font-extrabold text-[#EEF5FF]">
                    {rooms.filter((r) => r.isActive && r.machineState !== 'ROOM_COMPLETED').length}
                  </p>
                </div>
                <div className="rounded-2xl border border-[#223552] bg-[#111E31] p-5">
                  <p className="text-xs text-[#9BB0CA]">Joined Teams</p>
                  <p className="mt-1 font-mono tabular-nums text-3xl font-extrabold text-[#51D6E8]">
                    {snapshot.room.teamCount}
                  </p>
                </div>
                <div className="rounded-2xl border border-[#223552] bg-[#111E31] p-5">
                  <p className="text-xs text-[#9BB0CA]">Highest Bid</p>
                  <p className="mt-1 font-mono tabular-nums text-3xl font-extrabold text-[#B9F36B]">
                    {snapshot.currentAuction?.highestBidderTeamId
                      ? snapshot.currentAuction.highestBid
                      : 0}
                  </p>
                </div>
                <div className="rounded-2xl border border-[#223552] bg-[#111E31] p-5">
                  <p className="text-xs text-[#9BB0CA]">Leading Team</p>
                  <p className="mt-2 font-display text-lg font-bold text-[#EEF5FF] truncate">
                    {snapshot.currentAuction?.highestBidderTeamName || '—'}
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border border-[#223552] bg-[#111E31] p-6 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold text-[#51D6E8]">
                    Status: {snapshot.room.humanStatus}
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
                      onClick={() => handleMarkReady(snapshot.room.id)}
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
                    Manage Items
                  </button>
                  <button
                    type="button"
                    onClick={() => setSection('live-auction')}
                    className="min-h-[42px] rounded-xl bg-[#51D6E8] px-5 text-xs font-bold text-[#08111F]"
                  >
                    Go to Live Auction
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

          {snapshot && section === 'items' && (
            <CustomItemsSection snapshot={snapshot} onSnapshotUpdate={handleSnapshotUpdate} />
          )}

          {snapshot && section === 'live-auction' && (
            <LiveAuctionSection
              snapshot={snapshot}
              onSnapshotUpdate={handleSnapshotUpdate}
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
                    Live presence status, unified points/coins balance, and completed answer
                    sessions.
                  </p>
                </div>
              </div>

              {snapshot.teams.length === 0 ? (
                <p className="py-8 text-center text-sm text-[#9BB0CA]">
                  Share Room Code{' '}
                  <span className="font-mono font-bold text-[#51D6E8]">
                    {snapshot.room.roomCode}
                  </span>{' '}
                  with teams so they can join on their mobile phones.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b border-[#223552] text-xs text-[#9BB0CA]">
                        <th className="py-3 pr-3">Team Name</th>
                        <th className="py-3 px-3">Connection</th>
                        <th className="py-3 px-3 text-right">Points / Coins</th>
                        <th className="py-3 px-3 text-right">Sessions</th>
                        <th className="py-3 px-3 text-right">Response Time</th>
                        <th className="py-3 px-3 text-right">Joined</th>
                        <th className="py-3 pl-3 text-right">Action</th>
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
                          <td className="py-3 px-3 text-right font-mono tabular-nums font-bold text-[#B9F36B]">
                            {t.balance}
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums text-[#9BB0CA]">
                            {t.answerSessionsCount}
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums text-[#9BB0CA]">
                            {formatResponseTime(t.totalResponseTimeMs)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono text-xs text-[#9BB0CA]">
                            {new Date(t.joinedAt).toLocaleTimeString()}
                          </td>
                          <td className="py-3 pl-3 text-right">
                            <button
                              type="button"
                              onClick={() => setRemoveTeamTarget(t)}
                              className="rounded-lg p-1.5 text-[#9BB0CA] hover:bg-[#F05252]/15 hover:text-[#F05252]"
                              title="Remove team"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
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
                        <th className="py-2.5 px-3 text-right">Amount</th>
                        <th className="py-2.5 px-3">Status</th>
                        <th className="py-2.5 px-3">Note</th>
                        <th className="py-2.5 pl-3 text-right">Server Time</th>
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
                  Sorted by Points DESC, Response Time ASC
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
                  <a
                    href={`/api/host/rooms/${snapshot.room.id}/export/results-csv`}
                    className="min-h-[42px] inline-flex items-center gap-1.5 rounded-xl bg-[#51D6E8] px-4 text-xs font-bold text-[#08111F]"
                  >
                    <Download className="h-4 w-4" />
                    Export Results CSV
                  </a>
                  <button
                    type="button"
                    onClick={() => setSection('history')}
                    className="min-h-[42px] rounded-xl border border-[#223552] bg-[#172740] px-4 text-xs font-semibold text-[#EEF5FF]"
                  >
                    View Auction History
                  </button>
                  <button
                    type="button"
                    onClick={() => setSection('create-room')}
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
              onSnapshotUpdate={handleSnapshotUpdate}
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
