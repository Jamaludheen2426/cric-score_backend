import { Request, Response } from 'express';
import * as tournamentService from '../services/tournament.service';

const ok = (res: Response, data: any) => res.json({ success: true, data });
const err = (res: Response, e: any, code = 400) => res.status(code).json({ success: false, error: e?.message || String(e) });

export async function listTournaments(_req: Request, res: Response) {
  try { ok(res, await tournamentService.getAllTournaments()); } catch (e) { err(res, e); }
}

export async function getTournament(req: Request, res: Response) {
  try {
    const tournament = await tournamentService.getTournamentById(Number(req.params.id));
    if (!tournament) return res.status(404).json({ success: false, error: 'Tournament not found' });
    ok(res, tournament);
  } catch (e) { err(res, e); }
}

export async function createTournament(req: Request, res: Response) {
  try { ok(res, await tournamentService.createTournament(req.body)); } catch (e) { err(res, e); }
}

export async function generateFixtures(req: Request, res: Response) {
  try { ok(res, await tournamentService.generateFixtures(Number(req.params.id))); } catch (e) { err(res, e); }
}

export async function createDemoTournament(_req: Request, res: Response) {
  try { ok(res, await tournamentService.createDemoTournament()); } catch (e) { err(res, e); }
}
