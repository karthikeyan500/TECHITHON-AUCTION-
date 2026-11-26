import { signInWithPopup } from 'firebase/auth';
import { LogIn, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { auth, googleProvider } from '../lib/firebase.ts';
import { ensureHostProfileDoc } from '../lib/firestoreAuction.ts';
import type { HostUser } from '../shared/types.ts';

interface HostAuthViewProps {
  title?: string;
  subtitle?: string;
  onAuthenticated: (host: HostUser) => void;
}

export function HostAuthView({
  title = 'Host Authentication',
  subtitle = 'Sign in with your Google account to create auction rooms, configure Coin & Point rules, and control live events.',
  onAuthenticated,
}: HostAuthViewProps) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleGoogleSignIn = async () => {
    setError(null);
    setLoading(true);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      const user = cred.user;
      if (!user.emailVerified) {
        setError(
          'Your Google account email must be verified before accessing host controls.',
        );
        return;
      }

      const host: HostUser = {
        id: user.uid,
        username: user.email || user.uid,
        displayName: user.displayName || user.email?.split('@')[0] || 'Event Host',
        email: user.email || undefined,
        role: 'HOST',
        createdAt: Date.now(),
      };

      await ensureHostProfileDoc(host);
      onAuthenticated(host);
    } catch (err) {
      const code =
        typeof err === 'object' && err && 'code' in err
          ? String((err as { code?: string }).code)
          : '';
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        setError('Sign-in was cancelled. Click the button below to try again.');
      } else if (code === 'auth/popup-blocked') {
        setError(
          'Sign-in popup was blocked by your browser. Please allow popups for this site and try again.',
        );
      } else if (code === 'auth/unauthorized-domain') {
        setError(
          'This domain is not authorized for Firebase Google Sign-In. Add the current hostname in Firebase Authentication Authorized Domains.',
        );
      } else {
        setError(err instanceof Error ? err.message : 'Google Sign-In failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:py-16">
      <div className="rounded-2xl border border-[#223552] bg-[#111E31] p-6 sm:p-8 shadow-xl space-y-6">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#51D6E8]/15 text-[#51D6E8]">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <div>
            <h1 className="font-display text-xl font-bold text-[#EEF5FF]">{title}</h1>
            <p className="text-xs text-[#9BB0CA]">Organizer access via Google Sign-In</p>
          </div>
        </div>

        <p className="text-sm leading-relaxed text-[#9BB0CA]">{subtitle}</p>

        <div className="rounded-xl border border-[#223552] bg-[#08111F] p-4 text-xs text-[#9BB0CA] space-y-1.5">
          <p className="font-semibold text-[#EEF5FF]">Cloud Sync &amp; Cross-Device Ready</p>
          <p>
            Your rooms, custom items, and reusable question bank persist in cloud Firestore across
            devices. Participating teams join using only your Room Code — no Google login needed for
            teams.
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-xl border border-[#F05252]/40 bg-[#F05252]/10 px-4 py-3 text-sm text-[#F05252]"
          >
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={loading}
          className="min-h-[48px] w-full flex items-center justify-center gap-2.5 rounded-xl bg-[#51D6E8] px-5 py-3 text-sm font-bold text-[#08111F] hover:bg-[#6ee0ef] transition-colors disabled:opacity-50"
        >
          <LogIn className="h-4 w-4" />
          {loading ? 'Signing in with Google...' : 'Continue with Google'}
        </button>
      </div>
    </div>
  );
}
