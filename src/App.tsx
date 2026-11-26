import { onAuthStateChanged } from 'firebase/auth';
import { useEffect, useState } from 'react';
import { Navbar, type AppRoute } from './components/Navbar.tsx';
import { auth } from './lib/firebase.ts';
import {
  ensureHostProfileDoc,
  reconnectStoredTeamSession,
} from './lib/firestoreAuction.ts';
import { AboutPage } from './pages/AboutPage.tsx';
import { AudienceDisplay } from './pages/AudienceDisplay.tsx';
import { HomePage } from './pages/HomePage.tsx';
import { HostDashboard } from './pages/HostDashboard.tsx';
import { JoinRoomPage } from './pages/JoinRoomPage.tsx';
import { LeaderboardPage } from './pages/LeaderboardPage.tsx';
import { TeamDashboard } from './pages/TeamDashboard.tsx';
import type { HostUser, TeamRoomSnapshot } from './shared/types.ts';

function normalizePath(pathname: string): AppRoute {
  switch (pathname) {
    case '/create-room':
      return '/create-room';
    case '/join':
      return '/join';
    case '/host':
      return '/host';
    case '/team':
      return '/team';
    case '/audience':
      return '/audience';
    case '/leaderboard':
      return '/leaderboard';
    case '/about':
      return '/about';
    default:
      return '/';
  }
}

export default function App() {
  const [route, setRoute] = useState<AppRoute>(() => {
    const params = new URLSearchParams(window.location.search);
    const initialPath = normalizePath(window.location.pathname);
    if (initialPath === '/' && (params.get('room') || params.get('code'))) {
      const roomCode = (params.get('code') || params.get('room') || '').trim().toUpperCase();
      if (roomCode) {
        window.history.replaceState({}, '', `/join?code=${encodeURIComponent(roomCode)}`);
        return '/join';
      }
    }
    return initialPath;
  });

  const [hostUser, setHostUser] = useState<HostUser | null>(null);
  const [teamSnapshot, setTeamSnapshot] = useState<TeamRoomSnapshot | null>(null);
  const [hydrating, setHydrating] = useState(true);

  useEffect(() => {
    const onPopState = () => {
      setRoute(normalizePath(window.location.pathname));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Hydrate Firebase Host Auth + stored public Team session cleanly on load/refresh
  useEffect(() => {
    let active = true;
    let authSettled = false;
    let teamSettled = false;

    const finishIfReady = () => {
      if (active && authSettled && teamSettled) {
        setHydrating(false);
      }
    };

    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      if (!active) return;
      if (user && user.emailVerified) {
        const host: HostUser = {
          id: user.uid,
          username: user.email || user.uid,
          displayName: user.displayName || user.email?.split('@')[0] || 'Event Host',
          email: user.email || undefined,
          role: 'HOST',
          createdAt: Date.now(),
        };
        setHostUser(host);
        ensureHostProfileDoc(host).catch((err) => {
          console.error('Failed to sync host profile:', err);
        });
      } else {
        setHostUser(null);
      }
      authSettled = true;
      finishIfReady();
    });

    reconnectStoredTeamSession()
      .then((snap) => {
        if (active && snap) {
          setTeamSnapshot(snap);
        }
      })
      .catch(() => {
        // No active team session
      })
      .finally(() => {
        teamSettled = true;
        finishIfReady();
      });

    return () => {
      active = false;
      unsubAuth();
    };
  }, []);

  const navigate = (nextRoute: AppRoute, search?: string) => {
    const targetUrl = search ? `${nextRoute}${search}` : nextRoute;
    if (window.location.pathname + window.location.search !== targetUrl) {
      window.history.pushState({}, '', targetUrl);
    }
    setRoute(nextRoute);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="min-h-dvh flex flex-col bg-[#08111F] text-[#EEF5FF]">
      <Navbar currentRoute={route} onNavigate={(r) => navigate(r)} />

      {hydrating ? (
        <div className="flex-1 flex items-center justify-center p-10 text-sm text-[#9BB0CA]">
          Connecting to cloud workspace...
        </div>
      ) : (
        <div className="flex-1">
          {route === '/' && <HomePage onNavigate={(r) => navigate(r)} />}

          {route === '/about' && <AboutPage onNavigate={(r) => navigate(r)} />}

          {route === '/join' && (
            <JoinRoomPage
              existingTeamSnapshot={teamSnapshot}
              onJoined={(snap) => {
                setTeamSnapshot(snap);
                navigate('/team');
              }}
              onResumeTeam={() => navigate('/team')}
            />
          )}

          {route === '/team' && (
            <TeamDashboard
              initialSnapshot={teamSnapshot}
              onGoJoin={() => navigate('/join')}
              onLeftRoom={() => {
                setTeamSnapshot(null);
                navigate('/join');
              }}
            />
          )}

          {(route === '/host' || route === '/create-room') && (
            <HostDashboard
              hostUser={hostUser}
              currentRoute={route}
              onNavigate={navigate}
              onAuthenticated={(host) => setHostUser(host)}
              onLoggedOut={() => {
                setHostUser(null);
                navigate('/');
              }}
              onOpenAudience={(code) => navigate('/audience', `?code=${code}`)}
            />
          )}

          {route === '/audience' && <AudienceDisplay />}

          {route === '/leaderboard' && <LeaderboardPage />}
        </div>
      )}

      {route !== '/audience' && route !== '/team' && (
        <footer className="border-t border-[#223552] bg-[#08111F] py-6 px-4 sm:px-6">
          <div className="mx-auto max-w-7xl flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[#9BB0CA]">
            <span>TECH AUCTION 2026 — Think. Bid. Conquer.</span>
            <div className="flex items-center gap-5">
              <button
                type="button"
                onClick={() => navigate('/about')}
                className="hover:text-[#EEF5FF] transition-colors"
              >
                Rules
              </button>
              <button
                type="button"
                onClick={() => navigate('/join')}
                className="hover:text-[#EEF5FF] transition-colors"
              >
                Join Room
              </button>
              <button
                type="button"
                onClick={() => navigate('/host')}
                className="hover:text-[#EEF5FF] transition-colors"
              >
                Host Console
              </button>
              <button
                type="button"
                onClick={() => navigate('/audience')}
                className="hover:text-[#EEF5FF] transition-colors"
              >
                Projector View
              </button>
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}
