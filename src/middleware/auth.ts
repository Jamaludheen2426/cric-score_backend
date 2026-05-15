import { Request, Response, NextFunction } from 'express';
import { MatchSession } from '../models';

export async function requireScorerAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const matchId = parseInt(req.params.id || req.params.matchId || '0');

  if (!token) {
    return res.status(401).json({ success: false, error: 'No scorer token provided' });
  }

  if (!matchId) {
    return res.status(400).json({ success: false, error: 'Invalid match ID' });
  }

  const session = await MatchSession.findOne({
    where: { token, match_id: matchId },
  });

  if (!session) {
    return res.status(401).json({ success: false, error: 'Invalid or expired scorer token' });
  }

  if (new Date() > session.expires_at) {
    await session.destroy();
    return res.status(401).json({ success: false, error: 'Scorer session expired' });
  }

  next();
}
