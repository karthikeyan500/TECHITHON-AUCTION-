let inMemoryHostToken: string | null = null;
let inMemoryTeamToken: string | null = null;

export function setHostToken(token: string | null): void {
  inMemoryHostToken = token;
}

export function getHostToken(): string | null {
  return inMemoryHostToken;
}

export function setTeamToken(token: string | null): void {
  inMemoryTeamToken = token;
}

export function getTeamToken(): string | null {
  return inMemoryTeamToken;
}

export class ApiError extends Error {
  status: number;
  data: unknown;

  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export async function apiRequest<T>(
  url: string,
  options: RequestInit & { authMode?: 'host' | 'team' | 'none' } = {},
): Promise<T> {
  const { authMode = 'none', headers: customHeaders, ...rest } = options;
  const headers = new Headers(customHeaders);
  headers.set('X-Requested-With', 'XMLHttpRequest');

  if (rest.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (authMode === 'host' && inMemoryHostToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${inMemoryHostToken}`);
  } else if (authMode === 'team' && inMemoryTeamToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${inMemoryTeamToken}`);
  }

  const res = await fetch(url, {
    credentials: 'include',
    ...rest,
    headers,
  });

  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  if (text) {
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      parsed = { error: text };
    }
  }

  if (!res.ok) {
    const msg =
      typeof parsed.error === 'string'
        ? parsed.error
        : typeof parsed.message === 'string'
          ? parsed.message
          : `Request failed (${res.status})`;
    throw new ApiError(msg, res.status, parsed);
  }

  return parsed as T;
}
