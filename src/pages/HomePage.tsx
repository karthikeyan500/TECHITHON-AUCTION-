import {
  ArrowRight,
  Cpu,
  Gavel,
  MonitorPlay,
  ShieldCheck,
  Timer,
  Users,
} from 'lucide-react';
import { useState } from 'react';
import type { AppRoute } from '../components/Navbar.tsx';

interface HomePageProps {
  onNavigate: (route: AppRoute) => void;
}

export function HomePage({ onNavigate }: HomePageProps) {
  const [heroImgFailed, setHeroImgFailed] = useState(false);
  const [hardwareImgFailed, setHardwareImgFailed] = useState(false);

  return (
    <main className="mx-auto max-w-7xl px-4 sm:px-6 py-10 sm:py-14 space-y-16">
      {/* Hero Section */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
        <div className="lg:col-span-6 flex flex-col justify-center space-y-6 py-2">
          <p className="text-xs font-semibold tracking-wider text-[#51D6E8] uppercase">
            Live Multiplayer Tech Competition Platform
          </p>
          <h1
            className="font-display text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-[#EEF5FF] leading-[1.08]"
            style={{ textWrap: 'balance' }}
          >
            TECH AUCTION 2026
          </h1>
          <div className="space-y-2">
            <p className="font-display text-xl sm:text-2xl font-bold text-[#B9F36B]">
              THINK. BID. CONQUER.
            </p>
            <p className="text-base sm:text-lg text-[#9BB0CA] max-w-xl leading-relaxed">
              A Battle of Logic, Knowledge &amp; Creativity. Teams bid in real time on technical
              artifacts, win the floor, and defend their answers live before the host and audience.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => onNavigate('/join')}
              className="min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#51D6E8] px-6 py-3 text-sm font-bold text-[#08111F] hover:bg-[#6de0ef] transition-colors whitespace-nowrap shrink-0"
            >
              Join Room
              <ArrowRight className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={() => onNavigate('/create-room')}
              className="min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl border border-[#223552] bg-[#172740] px-6 py-3 text-sm font-semibold text-[#EEF5FF] hover:bg-[#1e3252] transition-colors whitespace-nowrap shrink-0"
            >
              Create Room
            </button>

            <button
              type="button"
              onClick={() => onNavigate('/about')}
              className="min-h-[48px] inline-flex items-center justify-center rounded-xl px-4 py-3 text-sm font-medium text-[#9BB0CA] hover:text-[#EEF5FF] transition-colors whitespace-nowrap shrink-0"
            >
              View Rules
            </button>
          </div>
        </div>

        <div className="lg:col-span-6 relative overflow-hidden rounded-2xl border border-[#223552] bg-[#111E31] min-h-[280px] lg:min-h-[380px]">
          {!heroImgFailed ? (
            <img
              src="/src/assets/images/hero_tech_arena_1795629351421.jpg"
              alt="Tech Auction 2026 live auditorium stage and competition pedestals"
              referrerPolicy="no-referrer"
              onError={() => setHeroImgFailed(true)}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-[#111E31] via-[#08111F] to-[#172740] p-8 text-center">
              <Gavel className="h-12 w-12 text-[#51D6E8]" />
              <p className="mt-4 font-display text-lg font-bold text-[#EEF5FF]">
                Live Tech Auction Arena
              </p>
            </div>
          )}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#08111F]/90 via-[#08111F]/20 to-transparent" />
          <div className="absolute bottom-4 left-4 right-4 flex flex-wrap items-center justify-between gap-2 text-xs text-[#EEF5FF]">
            <span className="font-medium">Synchronized Host, Team &amp; Projector Views</span>
            <span className="font-mono tabular-nums text-[#51D6E8]">60+ Concurrent Devices</span>
          </div>
        </div>
      </section>

      {/* Event Flow Section */}
      <section className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-[#223552] pb-4">
          <div>
            <h2 className="font-display text-2xl sm:text-3xl font-bold text-[#EEF5FF]">
              How Tech Auction Works
            </h2>
            <p className="mt-1 text-sm text-[#9BB0CA]">
              Four synchronized stages from mobile bidding to live podium rankings.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('/audience')}
            className="inline-flex items-center gap-2 text-sm font-semibold text-[#51D6E8] hover:underline whitespace-nowrap shrink-0"
          >
            <MonitorPlay className="h-4 w-4" />
            Open Audience Projector View
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          <div className="rounded-2xl border border-[#223552] bg-[#111E31] p-6 space-y-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#51D6E8]/15 text-[#51D6E8]">
              <Users className="h-5 w-5" />
            </div>
            <h3 className="font-display text-base font-bold text-[#EEF5FF]">
              01. Join via Room Code
            </h3>
            <p className="text-sm text-[#9BB0CA] leading-relaxed">
              Every team joins from its own mobile phone using the host&apos;s unique room code and
              starts with 100 unified points/coins.
            </p>
          </div>

          <div className="rounded-2xl border border-[#223552] bg-[#111E31] p-6 space-y-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#51D6E8]/15 text-[#51D6E8]">
              <Gavel className="h-5 w-5" />
            </div>
            <h3 className="font-display text-base font-bold text-[#EEF5FF]">
              02. Real-Time Bidding
            </h3>
            <p className="text-sm text-[#9BB0CA] leading-relaxed">
              Teams compete simultaneously against a server-synchronized countdown. Atomic transactions
              decide exact bid priority.
            </p>
          </div>

          <div className="rounded-2xl border border-[#223552] bg-[#111E31] p-6 space-y-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#B9F36B]/15 text-[#B9F36B]">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <h3 className="font-display text-base font-bold text-[#EEF5FF]">
              03. Live Verbal Answer
            </h3>
            <p className="text-sm text-[#9BB0CA] leading-relaxed">
              The winning team answers the technical question verbally to the host, who judges
              Correct (+10) or Wrong (-10) in real time.
            </p>
          </div>

          <div className="rounded-2xl border border-[#223552] bg-[#111E31] p-6 space-y-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#F5B731]/15 text-[#F5B731]">
              <Timer className="h-5 w-5" />
            </div>
            <h3 className="font-display text-base font-bold text-[#EEF5FF]">
              04. Speed Tie-Breaker
            </h3>
            <p className="text-sm text-[#9BB0CA] leading-relaxed">
              Standings rank by highest points first, then fastest total server-measured response
              time when points are tied.
            </p>
          </div>
        </div>
      </section>

      {/* Architecture / Interface Split */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch rounded-2xl border border-[#223552] bg-[#111E31] overflow-hidden">
        <div className="lg:col-span-5 relative min-h-[240px]">
          {!hardwareImgFailed ? (
            <img
              src="/src/assets/images/tech_hardware_module_1795629352119.jpg"
              alt="Precision hardware silicon module representing technical auction artifacts"
              referrerPolicy="no-referrer"
              onError={() => setHardwareImgFailed(true)}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-[#172740]">
              <Cpu className="h-12 w-12 text-[#51D6E8]" />
            </div>
          )}
        </div>
        <div className="lg:col-span-7 p-6 sm:p-10 flex flex-col justify-center space-y-6">
          <h2 className="font-display text-2xl sm:text-3xl font-bold text-[#EEF5FF]">
            Three Synchronized Event Interfaces
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 text-sm">
            <div className="space-y-1.5">
              <p className="font-display font-bold text-[#51D6E8]">Host Control Center</p>
              <p className="text-[#9BB0CA]">
                Manage custom items, CSV imports, timers, verbal answer evaluation, and full audit
                reports.
              </p>
            </div>
            <div className="space-y-1.5">
              <p className="font-display font-bold text-[#B9F36B]">Mobile Team View</p>
              <p className="text-[#9BB0CA]">
                Fast one-thumb bidding, live highest-bid alerts, balance tracking, and automatic
                reconnection.
              </p>
            </div>
            <div className="space-y-1.5">
              <p className="font-display font-bold text-[#F5B731]">Audience Projector</p>
              <p className="text-[#9BB0CA]">
                High-contrast large-type stage display for auditoriums showing bids, timers, and
                podium winners.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3 pt-2">
            <button
              type="button"
              onClick={() => onNavigate('/host')}
              className="min-h-[44px] rounded-xl bg-[#172740] border border-[#223552] px-5 py-2.5 text-sm font-semibold text-[#EEF5FF] hover:bg-[#1e3252] transition-colors"
            >
              Open Host Dashboard
            </button>
            <button
              type="button"
              onClick={() => onNavigate('/leaderboard')}
              className="min-h-[44px] rounded-xl border border-[#223552] px-5 py-2.5 text-sm font-semibold text-[#9BB0CA] hover:text-[#EEF5FF] transition-colors"
            >
              View Live Leaderboard
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
