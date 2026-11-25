import { Lock, ShieldCheck, UserPlus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { apiRequest, ApiError, setHostToken } from '../lib/api.ts';
import type { HostUser } from '../shared/types.ts';

interface HostAuthViewProps {
  title?: string;
  subtitle?: string;
  onAuthenticated: (host: HostUser, token: string) => void;
}

export function HostAuthView({
  title = 'Host Authentication',
  subtitle = 'Sign in with your organizer account or register a new host profile to create and control auction rooms.',
  onAuthenticated,
}: HostAuthViewProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === 'login') {
        const res = await apiRequest<{ host: HostUser; token: string }>('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ username, password }),
        });
        setHostToken(res.token);
        onAuthenticated(res.host, res.token);
      } else {
        const res = await apiRequest<{ host: HostUser; token: string }>('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({ username, displayName, password }),
        });
        setHostToken(res.token);
        onAuthenticated(res.host, res.token);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to reach server.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:py-16">
      <div className="rounded-2xl border border-[#223552] bg-[#111E31] p-6 sm:p-8 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#51D6E8]/15 text-[#51D6E8]">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <div>
            <h1 className="font-display text-xl font-bold text-[#EEF5FF]">{title}</h1>
            <p className="text-xs text-[#9BB0CA]">Protected organizer access</p>
          </div>
        </div>

        <p className="mt-4 text-sm leading-relaxed text-[#9BB0CA]">{subtitle}</p>

        <div className="mt-6 grid grid-cols-2 gap-1 rounded-xl bg-[#08111F] p-1 border border-[#223552]">
          <button
            type="button"
            onClick={() => {
              setMode('login');
              setError(null);
            }}
            className={`min-h-[40px] rounded-lg px-3 text-sm font-semibold transition-colors ${
              mode === 'login'
                ? 'bg-[#172740] text-[#51D6E8]'
                : 'text-[#9BB0CA] hover:text-[#EEF5FF]'
            }`}
          >
            Host Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('register');
              setError(null);
            }}
            className={`min-h-[40px] rounded-lg px-3 text-sm font-semibold transition-colors ${
              mode === 'register'
                ? 'bg-[#172740] text-[#51D6E8]'
                : 'text-[#9BB0CA] hover:text-[#EEF5FF]'
            }`}
          >
            Create Host Account
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label
              htmlFor="host-username"
              className="block text-xs font-semibold text-[#9BB0CA] mb-1.5"
            >
              Username
            </label>
            <input
              id="host-username"
              type="text"
              required
              minLength={3}
              maxLength={40}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. organizer_cs"
              className="w-full min-h-[44px] rounded-xl border border-[#223552] bg-[#08111F] px-3.5 text-sm text-[#EEF5FF] placeholder:text-[#9BB0CA]/50 focus:border-[#51D6E8] focus:outline-none"
            />
          </div>

          {mode === 'register' && (
            <div>
              <label
                htmlFor="host-display-name"
                className="block text-xs font-semibold text-[#9BB0CA] mb-1.5"
              >
                Organizer / Club Name
              </label>
              <input
                id="host-display-name"
                type="text"
                maxLength={60}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. IEEE Student Chapter"
                className="w-full min-h-[44px] rounded-xl border border-[#223552] bg-[#08111F] px-3.5 text-sm text-[#EEF5FF] placeholder:text-[#9BB0CA]/50 focus:border-[#51D6E8] focus:outline-none"
              />
            </div>
          )}

          <div>
            <label
              htmlFor="host-password"
              className="block text-xs font-semibold text-[#9BB0CA] mb-1.5"
            >
              Password
            </label>
            <input
              id="host-password"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Minimum 6 characters"
              className="w-full min-h-[44px] rounded-xl border border-[#223552] bg-[#08111F] px-3.5 text-sm text-[#EEF5FF] placeholder:text-[#9BB0CA]/50 focus:border-[#51D6E8] focus:outline-none"
            />
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
            type="submit"
            disabled={loading}
            className="min-h-[48px] w-full flex items-center justify-center gap-2 rounded-xl bg-[#51D6E8] px-5 py-3 text-sm font-bold text-[#08111F] hover:bg-[#6ee0ef] transition-colors disabled:opacity-50"
          >
            {mode === 'login' ? (
              <>
                <Lock className="h-4 w-4" />
                {loading ? 'Signing in...' : 'Sign In to Host Console'}
              </>
            ) : (
              <>
                <UserPlus className="h-4 w-4" />
                {loading ? 'Creating account...' : 'Create Host Account'}
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
