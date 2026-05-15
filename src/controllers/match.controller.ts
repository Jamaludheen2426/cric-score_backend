import { Request, Response } from 'express';
import * as matchService from '../services/match.service';
import * as scoringService from '../services/scoring.service';
import * as liveService from '../services/live.service';
import { addSseClient } from '../middleware/sse';
import { v4 as uuidv4 } from 'uuid';

const ok = (res: Response, data: any) => res.json({ success: true, data });
const err = (res: Response, e: any, code = 400) => res.status(code).json({ success: false, error: e?.message || String(e) });

export async function listMatches(req: Request, res: Response) {
  try { ok(res, await matchService.getAllMatches()); } catch (e) { err(res, e); }
}

export async function getMatch(req: Request, res: Response) {
  try {
    const match = await matchService.getMatchById(Number(req.params.id));
    if (!match) return res.status(404).json({ success: false, error: 'Match not found' });
    ok(res, match);
  } catch (e) { err(res, e); }
}

export async function createMatch(req: Request, res: Response) {
  try { ok(res, await matchService.createMatch(req.body)); } catch (e) { err(res, e); }
}

export async function verifyPin(req: Request, res: Response) {
  try {
    const token = await matchService.verifyPin(Number(req.params.id), req.body.pin);
    ok(res, { token });
  } catch (e) { err(res, e, 401); }
}

export async function startMatch(req: Request, res: Response) {
  try { ok(res, await matchService.startMatch(Number(req.params.id), req.body)); } catch (e) { err(res, e); }
}

export async function addBall(req: Request, res: Response) {
  try { ok(res, await scoringService.addBall(Number(req.params.id), req.body)); } catch (e) { err(res, e); }
}

export async function endOver(req: Request, res: Response) {
  try { ok(res, await scoringService.endOver(Number(req.params.id), req.body.next_bowler_id)); } catch (e) { err(res, e); }
}

export async function endInnings(req: Request, res: Response) {
  try { ok(res, await scoringService.endInnings(Number(req.params.id), req.body)); } catch (e) { err(res, e); }
}

export async function endMatch(req: Request, res: Response) {
  try { ok(res, await matchService.endMatch(Number(req.params.id), req.body.result)); } catch (e) { err(res, e); }
}

export async function undoBall(req: Request, res: Response) {
  try { ok(res, await scoringService.undoLastBall(Number(req.params.id))); } catch (e) { err(res, e); }
}

export async function liveScore(req: Request, res: Response) {
  try { ok(res, await liveService.getLiveScore(req.params.shareToken)); } catch (e) { err(res, e, 404); }
}

export async function sseStream(req: Request, res: Response) {
  const { shareToken } = req.params;
  const clientId = uuidv4();
  addSseClient(shareToken, clientId, res);

  // Send initial score immediately
  try {
    const score = await liveService.getLiveScore(shareToken);
    res.write(`data: ${JSON.stringify(score)}\n\n`);
  } catch (_) {
    res.write(`data: ${JSON.stringify({ error: 'Match not found' })}\n\n`);
  }
}
