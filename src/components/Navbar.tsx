import { Menu, X } from 'lucide-react';
import { useState } from 'react';

export type AppRoute =
  | '/'
  | '/create-room'
  | '/join'
  | '/host'
  | '/team'
  | '/audience'
  | '/leaderboard'
  | '/about';

interface NavbarProps {
  currentRoute: AppRoute;
  onNavigate: (route: AppRoute) => void;
}

const NAV_LINKS: Array<{ route: AppRoute; label: string }> = [
  { route: '/', label: 'Home' },
  { route: '/join', label: 'Join Room' },
  { route: '/host', label: 'Host Dashboard' },
  { route: '/team', label: 'Team Dashboard' },
  { route: '/audience', label: 'Audience Display' },
  { route: '/leaderboard', label: 'Leaderboard' },
  { route: '/about', label: 'About' },
];

export function Navbar({ currentRoute, onNavigate }: NavbarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const go = (route: AppRoute) => {
    setMobileOpen(false);
    onNavigate(route);
  };

  return (
    <header className="sticky top-0 z-40 border-b border-[#223552] bg-[#08111F]/95 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-8 px-4 sm:px-6">
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            go('/');
          }}
          className="font-display text-base sm:text-lg font-extrabold tracking-tight text-[#EEF5FF] whitespace-nowrap shrink-0"
        >
          TECH AUCTION 2026
        </a>

        <nav
          aria-label="Main navigation"
          className="hidden lg:flex items-center gap-6 text-sm font-medium text-[#9BB0CA]"
        >
          {NAV_LINKS.map((link) => {
            const active = currentRoute === link.route;
            return (
              <a
                key={link.route}
                href={link.route}
                onClick={(e) => {
                  e.preventDefault();
                  go(link.route);
                }}
                className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                  active
                    ? 'border-[#51D6E8] text-[#EEF5FF]'
                    : 'border-transparent hover:text-[#EEF5FF] hover:border-[#223552]'
                }`}
              >
                {link.label}
              </a>
            );
          })}
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => go('/create-room')}
            className="hidden sm:inline-flex min-h-[40px] items-center justify-center rounded-xl bg-[#51D6E8] px-4 py-2 text-sm font-bold text-[#08111F] hover:bg-[#6de0ef] transition-colors whitespace-nowrap shrink-0"
          >
            Create Room
          </button>

          <button
            type="button"
            onClick={() => setMobileOpen((prev) => !prev)}
            className="inline-flex lg:hidden min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-[#223552] bg-[#111E31] text-[#EEF5FF] hover:bg-[#172740] transition-colors"
            aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="lg:hidden border-t border-[#223552] bg-[#08111F] px-4 py-3">
          <nav className="flex flex-col gap-1">
            {NAV_LINKS.map((link) => {
              const active = currentRoute === link.route;
              return (
                <a
                  key={link.route}
                  href={link.route}
                  onClick={(e) => {
                    e.preventDefault();
                    go(link.route);
                  }}
                  className={`min-h-[44px] flex items-center rounded-xl px-3 text-sm font-medium transition-colors ${
                    active
                      ? 'bg-[#172740] text-[#51D6E8]'
                      : 'text-[#9BB0CA] hover:bg-[#111E31] hover:text-[#EEF5FF]'
                  }`}
                >
                  {link.label}
                </a>
              );
            })}
            <button
              type="button"
              onClick={() => go('/create-room')}
              className="mt-2 min-h-[44px] w-full rounded-xl bg-[#51D6E8] px-4 py-2.5 text-sm font-bold text-[#08111F] hover:bg-[#6de0ef] transition-colors"
            >
              Create Room
            </button>
          </nav>
        </div>
      )}
    </header>
  );
}
