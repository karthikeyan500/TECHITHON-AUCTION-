import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { db } from './db.ts';
import type { HostUser } from '../src/shared/types.ts';

const EPHEMERAL_SECRET = crypto.randomBytes(32).toString('hex');

function getSessionSecret(): string {
  const configured = process.env.SESSION_SECRET?.trim();
  return configured && configured.length >= 16 ? configured : EPHEMERAL_SECRET;
}

export const HOST_COOKIE_NAME = 'ta_host_session';
export const TEAM_COOKIE_NAME = 'ta_team_session';

export interface HostTokenPayload {
  type: 'host';
  userId: string;
  username: string;
  displayName: string;
  exp: number;
}

export interface TeamTokenPayload {
  type: 'team';
  teamId: string;
  roomId: string;
  roomCode: string;
  teamName: string;
  exp: number;
}

export type SessionTokenPayload = HostTokenPayload | TeamTokenPayload;

export function hashSecret(plain: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(plain, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifySecret(plain: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 2) return false;
  const [salt, hashHex] = parts;
  if (!salt || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(plain, salt, 64);
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

export function signToken(payload: SessionTokenPayload): string {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(data)
    .digest('base64url');
  return `${data}.${sig}`;
}

export function verifyToken<T extends SessionTokenPayload>(
  token: string | undefined | null,
  expectedType?: T['type'],
): T | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  if (!data || !sig) return null;

  const expectedSig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(data)
    .digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as T;
    if (!parsed || typeof parsed.exp !== 'number' || parsed.exp < Date.now()) {
      return null;
    }
    if (expectedType && parsed.type !== expectedType) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    const key = pair.slice(0, eq).trim();
    const val = pair.slice(eq + 1).trim();
    if (key) {
      try {
        out[key] = decodeURIComponent(val);
      } catch {
        out[key] = val;
      }
    }
  }
  return out;
}

function isHttpsRequest(req: Request): boolean {
  if (req.secure) return true;
  const fwd = req.headers['x-forwarded-proto'];
  if (typeof fwd === 'string' && fwd.split(',')[0].trim() === 'https') {
    return true;
  }
  return false;
}

export function setSessionCookie(
  req: Request,
  res: Response,
  name: string,
  value: string,
  maxAgeSec = 60 * 60 * 24,
): void {
  const https = isHttpsRequest(req);
  const attrs = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${maxAgeSec}`,
  ];
  if (https) {
    attrs.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    attrs.push('SameSite=Lax');
  }
  const existing = res.getHeader('Set-Cookie');
  const cookieStr = attrs.join('; ');
  if (!existing) {
    res.setHeader('Set-Cookie', cookieStr);
  } else if (Array.isArray(existing)) {
    res.setHeader('Set-Cookie', [...existing, cookieStr]);
  } else {
    res.setHeader('Set-Cookie', [String(existing), cookieStr]);
  }
}

export function clearSessionCookie(req: Request, res: Response, name: string): void {
  setSessionCookie(req, res, name, '', 0);
}

export function extractBearerToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }
  return null;
}

export function getHostFromRequest(req: Request): HostUser | null {
  const bearer = extractBearerToken(req);
  const cookies = parseCookies(req.headers.cookie);
  const token = bearer || cookies[HOST_COOKIE_NAME];
  const payload = verifyToken<HostTokenPayload>(token, 'host');
  if (!payload) return null;

  const row = db
    .prepare('SELECT id, username, display_name, role, created_at FROM users WHERE id = ?')
    .get(payload.userId) as
    | { id: string; username: string; display_name: string; role: 'HOST'; created_at: number }
    | undefined;

  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    createdAt: row.created_at,
  };
}

export function getTeamFromRequest(req: Request): TeamTokenPayload | null {
  const bearer = extractBearerToken(req);
  const cookies = parseCookies(req.headers.cookie);
  const token = bearer || cookies[TEAM_COOKIE_NAME];
  const payload = verifyToken<TeamTokenPayload>(token, 'team');
  if (!payload) return null;

  const row = db
    .prepare(
      'SELECT id, room_id, participation_status FROM teams WHERE id = ? AND room_id = ? AND participation_status = ?',
    )
    .get(payload.teamId, payload.roomId, 'ACTIVE') as
    | { id: string; room_id: string; participation_status: string }
    | undefined;

  if (!row) return null;
  return payload;
}

export function csrfProtectMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    next();
    return;
  }
  // Requests carrying an explicit Bearer token are immune to browser cookie CSRF
  if (extractBearerToken(req)) {
    next();
    return;
  }
  const cookies = parseCookies(req.headers.cookie);
  const usesCookieAuth = Boolean(cookies[HOST_COOKIE_NAME] || cookies[TEAM_COOKIE_NAME]);
  if (!usesCookieAuth) {
    next();
    return;
  }

  const xRequestedWith = req.headers['x-requested-with'];
  if (xRequestedWith === 'XMLHttpRequest') {
    next();
    return;
  }

  const origin = req.headers.origin;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (origin && host) {
    try {
      const parsedOrigin = new URL(origin);
      const hostValue = Array.isArray(host) ? host[0] : host;
      if (parsedOrigin.host === hostValue) {
        next();
        return;
      }
    } catch {
      // fall through to reject
    }
  }

  res.status(403).json({ error: 'Invalid request origin.' });
}

export interface AuthenticatedRequest extends Request {
  hostUser?: HostUser;
  teamSession?: TeamTokenPayload;
}

export function requireHost(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const host = getHostFromRequest(req);
  if (!host) {
    res.status(401).json({ error: 'Host authentication required.' });
    return;
  }
  req.hostUser = host;
  next();
}

export function requireTeam(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const team = getTeamFromRequest(req);
  if (!team) {
    res.status(401).json({ error: 'Valid team session required.' });
    return;
  }
  req.teamSession = team;
  next();
}

// Sliding window rate limiter
const rateBuckets = new Map<string, number[]>();

export function createRateLimiter(
  bucketName: string,
  maxRequests: number,
  windowMs: number,
  keyFn?: (req: Request) => string,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const keyPart = keyFn ? keyFn(req) : req.ip || 'unknown';
    const key = `${bucketName}:${keyPart}`;
    const timestamps = rateBuckets.get(key) || [];
    const cutoff = now - windowMs;
    const recent = timestamps.filter((ts) => ts > cutoff);
    if (recent.length >= maxRequests) {
      res.status(429).json({
        error: 'Too many requests in a short time. Please wait a moment and try again.',
      });
      return;
    }
    recent.push(now);
    rateBuckets.set(key, recent);
    if (rateBuckets.size > 5000) {
      for (const [k, list] of rateBuckets.entries()) {
        if (list.length === 0 || list[list.length - 1] <= cutoff) {
          rateBuckets.delete(k);
        }
      }
    }
    next();
  };
}
