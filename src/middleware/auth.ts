import { Request, Response, NextFunction } from 'express';
import { MatchSession } from '../models';

/**
 * In-memory cache of verified scorer tokens.
 *
 * Every authenticated request used to hit the DB for MatchSession.findOne —
 * one full Render→Aiven round-trip (~150-300ms) for every single ball post.
 * Tokens are stable for the life of a session (we already issue them with a
 * 12-hour expiry), so caching them in process memory cuts that round-trip
 * out of every request after the first.
 *
 * Cache entries are evicted:
 *   • when the session's expires_at has passed (checked on every read)
 *   • when verifyPin issues a new token for a match (handled in the
 *     match service — see invalidateSessionCacheForMatch below)
 *
 * Server restarts naturally clear the cache; the next request just does
 * the lookup once and re-populates.
 */
type CacheEntry = { matchId: number; expiresAt: Date };
const cache = new Map<string, CacheEntry>();

export function invalidateSessionCacheForMatch(matchId: number) {
  for (const [token, entry] of cache.entries()) {
    if (entry.matchId === matchId) cache.delete(token);
  }
}

export async function requireScorerAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const matchId = parseInt(req.params.id || req.params.matchId || '0');

  if (!token) {
    return res.status(401).json({ success: false, error: 'No scorer token provided' });
  }
  if (!matchId) {
    return res.status(400).json({ success: false, error: 'Invalid match ID' });
  }

  // Cache hit — skip the DB round-trip entirely.
  const cached = cache.get(token);
  if (cached) {
    if (cached.matchId !== matchId) {
      return res.status(401).json({ success: false, error: 'Token does not match this match' });
    }
    if (new Date() > cached.expiresAt) {
      cache.delete(token);
      return res.status(401).json({ success: false, error: 'Scorer session expired' });
    }
    return next();
  }

  // Cold lookup — populate the cache for subsequent requests.
  const session = await MatchSession.findOne({ where: { token, match_id: matchId } });
  if (!session) {
    return res.status(401).json({ success: false, error: 'Invalid or expired scorer token' });
  }
  if (new Date() > session.expires_at) {
    await session.destroy();
    return res.status(401).json({ success: false, error: 'Scorer session expired' });
  }

  cache.set(token, { matchId: session.match_id, expiresAt: session.expires_at });
  next();
}
