import { Request, Response } from 'express';
import * as teamService from '../services/team.service';

const ok = (res: Response, data: any) => res.json({ success: true, data });
const err = (res: Response, e: any, code = 400) => res.status(code).json({ success: false, error: e?.message || String(e) });

export async function listTeams(req: Request, res: Response) {
  try { ok(res, await teamService.getAllTeams()); } catch (e) { err(res, e); }
}

export async function getTeam(req: Request, res: Response) {
  try {
    const team = await teamService.getTeamById(Number(req.params.id));
    if (!team) return res.status(404).json({ success: false, error: 'Team not found' });
    ok(res, team);
  } catch (e) { err(res, e); }
}

export async function createTeam(req: Request, res: Response) {
  try { ok(res, await teamService.createTeam(req.body.name, req.body.logo_url)); } catch (e) { err(res, e); }
}

export async function updateTeam(req: Request, res: Response) {
  try { ok(res, await teamService.updateTeam(Number(req.params.id), req.body)); } catch (e) { err(res, e); }
}

export async function deleteTeam(req: Request, res: Response) {
  try { await teamService.deleteTeam(Number(req.params.id)); ok(res, { deleted: true }); } catch (e) { err(res, e); }
}

// Players
export async function listPlayers(req: Request, res: Response) {
  try { ok(res, await teamService.getPlayersByTeam(Number(req.params.teamId))); } catch (e) { err(res, e); }
}

export async function createPlayer(req: Request, res: Response) {
  try { ok(res, await teamService.createPlayer(Number(req.params.teamId), req.body)); } catch (e) { err(res, e); }
}

export async function updatePlayer(req: Request, res: Response) {
  try { ok(res, await teamService.updatePlayer(Number(req.params.playerId), req.body)); } catch (e) { err(res, e); }
}

export async function deletePlayer(req: Request, res: Response) {
  try { await teamService.deletePlayer(Number(req.params.playerId)); ok(res, { deleted: true }); } catch (e) { err(res, e); }
}
