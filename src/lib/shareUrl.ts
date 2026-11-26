let cachedShareBaseUrl: string | null = null;

export function toPublicShareOrigin(origin: string): string {
  try {
    const url = new URL(origin);
    if (url.hostname.startsWith('ais-dev-')) {
      url.hostname = url.hostname.replace(/^ais-dev-/, 'ais-pre-');
    }
    return url.origin;
  } catch {
    return origin.replace('://ais-dev-', '://ais-pre-');
  }
}

export async function resolveShareBaseUrl(): Promise<string> {
  if (cachedShareBaseUrl) return cachedShareBaseUrl;
  const fallback = toPublicShareOrigin(window.location.origin);
  try {
    const res = await fetch('/api/config', { cache: 'no-store' });
    if (res.ok) {
      const data = (await res.json()) as { shareBaseUrl?: string };
      if (data.shareBaseUrl && data.shareBaseUrl.startsWith('http')) {
        cachedShareBaseUrl = toPublicShareOrigin(data.shareBaseUrl);
        return cachedShareBaseUrl;
      }
    }
  } catch {
    // Fallback to client origin conversion
  }
  cachedShareBaseUrl = fallback;
  return cachedShareBaseUrl;
}

export function buildRoomJoinLink(baseOrigin: string, roomCode: string): string {
  const cleanOrigin = toPublicShareOrigin(baseOrigin).replace(/\/+$/, '');
  return `${cleanOrigin}/join?code=${encodeURIComponent(roomCode.trim().toUpperCase())}`;
}
