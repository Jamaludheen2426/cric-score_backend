import { Team, Player } from '../models';
import type { PlayerAttributes } from '../models/Player';

export async function getAllTeams() {
  return Team.findAll({
    include: [{ model: Player, as: 'players', required: false }],
    order: [['created_at', 'DESC']],
  });
}

export async function getTeamById(id: number) {
  return Team.findByPk(id, {
    include: [{ model: Player, as: 'players', order: [['batting_order', 'ASC']] }],
  });
}

export async function createTeam(name: string, logo_url?: string) {
  return Team.create({ name, logo_url });
}

export async function updateTeam(id: number, data: Partial<{ name: string; logo_url: string }>) {
  const team = await Team.findByPk(id);
  if (!team) throw new Error('Team not found');
  return team.update(data);
}

export async function deleteTeam(id: number) {
  const team = await Team.findByPk(id);
  if (!team) throw new Error('Team not found');
  await team.destroy();
}

// Players
export async function getPlayersByTeam(teamId: number) {
  return Player.findAll({ where: { team_id: teamId }, order: [['batting_order', 'ASC']] });
}

type PlayerRole = PlayerAttributes['role'];

type PlayerInput = {
  name: string;
  batting_order?: number;
  role?: PlayerRole;
};

export async function createPlayer(teamId: number, data: PlayerInput) {
  return Player.create({ team_id: teamId, name: data.name, batting_order: data.batting_order, role: data.role });
}

export async function updatePlayer(id: number, data: Partial<PlayerInput>) {
  const player = await Player.findByPk(id);
  if (!player) throw new Error('Player not found');
  return player.update(data);
}

export async function deletePlayer(id: number) {
  const player = await Player.findByPk(id);
  if (!player) throw new Error('Player not found');
  await player.destroy();
}
