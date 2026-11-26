import { ArrowRight, CheckCircle2, Coins, Clock, Gavel, Shield } from 'lucide-react';
import type { AppRoute } from '../components/Navbar.tsx';

interface AboutPageProps {
  onNavigate: (route: AppRoute) => void;
}

export function AboutPage({ onNavigate }: AboutPageProps) {
  return (
    <main className="mx-auto max-w-4xl px-4 sm:px-6 py-10 sm:py-14 space-y-10">
      <div className="space-y-3 border-b border-[#223552] pb-6">
        <p className="text-xs font-semibold tracking-wider text-[#51D6E8] uppercase">
          Official Event Rules &amp; Guide
        </p>
        <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-[#EEF5FF]">
          About TECH AUCTION 2026
        </h1>
        <p className="text-base text-[#9BB0CA] leading-relaxed">
          Everything teams, hosts, and audience members need to know before the first gavel drops.
        </p>
      </div>

      <section className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div className="rounded-2xl border border-[#223552] bg-[#111E31] p-6 space-y-3">
          <div className="flex items-center gap-2.5 text-[#51D6E8]">
            <Gavel className="h-5 w-5" />
            <h2 className="font-display text-lg font-bold text-[#EEF5FF]">1. Bidding &amp; Winning</h2>
          </div>
          <p className="text-sm text-[#9BB0CA] leading-relaxed">
            Each round opens bidding on a technical item or concept. Teams bid from their mobile
            phones before the server-synchronized countdown ends. You cannot outbid yourself, and
            every valid bid must meet the minimum increment.
          </p>
        </div>

        <div className="rounded-2xl border border-[#223552] bg-[#111E31] p-6 space-y-3">
          <div className="flex items-center gap-2.5 text-[#B9F36B]">
            <Coins className="h-5 w-5" />
            <h2 className="font-display text-lg font-bold text-[#EEF5FF]">
              2. Separate Coins &amp; Points
            </h2>
          </div>
          <p className="text-sm text-[#9BB0CA] leading-relaxed">
            Bidding Coins (default 100) are used to bid in auctions—only the winning team&apos;s
            final bid is deducted. Competition Points (default 0) determine final leaderboard
            rankings (+10 Coins &amp; +20 Points for correct, -10 Coins &amp; -10 Points for wrong
            by default).
          </p>
        </div>

        <div className="rounded-2xl border border-[#223552] bg-[#111E31] p-6 space-y-3">
          <div className="flex items-center gap-2.5 text-[#F5B731]">
            <Shield className="h-5 w-5" />
            <h2 className="font-display text-lg font-bold text-[#EEF5FF]">
              3. Host-Controlled Evaluation
            </h2>
          </div>
          <p className="text-sm text-[#9BB0CA] leading-relaxed">
            When a team wins an item, the host asks the technical question verbally. The team
            answers aloud, and the host manually records Correct or Wrong. No automated AI or
            pre-stored answer key is used.
          </p>
        </div>

        <div className="rounded-2xl border border-[#223552] bg-[#111E31] p-6 space-y-3">
          <div className="flex items-center gap-2.5 text-[#51D6E8]">
            <Clock className="h-5 w-5" />
            <h2 className="font-display text-lg font-bold text-[#EEF5FF]">
              4. Leaderboard Ranking
            </h2>
          </div>
          <p className="text-sm text-[#9BB0CA] leading-relaxed">
            Teams with higher total points rank first. If two teams are tied on points, the team with
            the lower total server-measured response time across its answered questions ranks higher.
          </p>
        </div>
      </section>

      <section className="rounded-2xl border border-[#223552] bg-[#111E31] p-6 sm:p-8 space-y-4">
        <h2 className="font-display text-xl font-bold text-[#EEF5FF]">Quick Start Checklist</h2>
        <ul className="space-y-2.5 text-sm text-[#9BB0CA]">
          <li className="flex items-start gap-2.5">
            <CheckCircle2 className="h-4 w-4 text-[#B9F36B] mt-0.5 shrink-0" />
            <span>
              <strong className="text-[#EEF5FF]">Organizers:</strong> Sign in on the Host Dashboard,
              create a room, add your custom tech items, and share the 6-character room code.
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <CheckCircle2 className="h-4 w-4 text-[#B9F36B] mt-0.5 shrink-0" />
            <span>
              <strong className="text-[#EEF5FF]">Teams:</strong> Open Join Room on your phone, enter
              the room code and your team name, and keep your screen open for live bidding.
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <CheckCircle2 className="h-4 w-4 text-[#B9F36B] mt-0.5 shrink-0" />
            <span>
              <strong className="text-[#EEF5FF]">Projector Operator:</strong> Open Audience Display
              with the room code and toggle full-screen mode for the auditorium screen.
            </span>
          </li>
        </ul>

        <div className="pt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => onNavigate('/join')}
            className="min-h-[44px] inline-flex items-center gap-2 rounded-xl bg-[#51D6E8] px-5 py-2.5 text-sm font-bold text-[#08111F] hover:bg-[#6de0ef] transition-colors"
          >
            Join a Room
            <ArrowRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onNavigate('/create-room')}
            className="min-h-[44px] rounded-xl border border-[#223552] bg-[#172740] px-5 py-2.5 text-sm font-semibold text-[#EEF5FF] hover:bg-[#1e3252] transition-colors"
          >
            Create a Room
          </button>
        </div>
      </section>
    </main>
  );
}
