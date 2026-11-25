import { useEffect, useState } from 'react';
import { Navbar, type AppRoute } from './components/Navbar.tsx';
import { apiRequest, setHostToken, setTeamToken } from './lib/api.ts';
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
  const [route, setRoute] = useState<AppRoute>(() => normalizePath(window.location.pathname));
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

  // Hydrate existing authenticated Host and/or Team sessions from server cookies on load/refresh
  useEffect(() => {
    let active = true;
    Promise.allSettled([
      apiRequest<{ host: HostUser | null; token?: string }>('/api/auth/me'),
      apiRequest<{ snapshot: TeamRoomSnapshot; token: string }>('/api/team/me'),
    ])
      .then(([hostRes, teamRes]) => {
        if (!active) return;
        if (hostRes.status === 'fulfilled' && hostRes.value.host) {
          setHostUser(hostRes.value.host);
          if (hostRes.value.token) setHostToken(hostRes.value.token);
        }
        if (teamRes.status === 'fulfilled' && teamRes.value.snapshot) {
          setTeamSnapshot(teamRes.value.snapshot);
          if (teamRes.value.token) setTeamToken(teamRes.value.token);
        }
      })
      .finally(() => {
        if (active) setHydrating(false);
      });
    return () => {
      active = false;
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
          Restoring session...
        </div>
      ) : (
        <div className="flex-1">
          {route === '/' && <HomePage onNavigate={(r) => navigate(r)} />}

          {route === '/about' && <AboutPage onNavigate={(r) => navigate(r)} />}

          {route === '/join' && (
            <JoinRoomPage
              existingTeamSnapshot={teamSnapshot}
              onJoined={(snap, token) => {
                setTeamToken(token);
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
              initialSection={route === '/create-room' ? 'create-room' : 'overview'}
              onAuthenticated={(host, token) => {
                setHostToken(token);
                setHostUser(host);
              }}
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
