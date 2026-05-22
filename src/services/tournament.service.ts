import { Tournament, TournamentTeam, Team, Match, Player, Innings, BattingCard, BowlingCard } from '../models';
import { v4 as uuidv4 } from 'uuid';

const matchInclude = [
  { model: Team, as: 'teamA' },
  { model: Team, as: 'teamB' },
  {
    model: Innings,
    as: 'innings',
    include: [
      { model: Team, as: 'battingTeam' },
      { model: Team, as: 'bowlingTeam' },
      { model: BattingCard, as: 'battingCards', include: [{ model: Player, as: 'player' }] },
      { model: BowlingCard, as: 'bowlingCards', include: [{ model: Player, as: 'player' }] },
    ],
  },
];

export async function getAllTournaments() {
  return Tournament.findAll({
    include: [
      { model: Team, as: 'teams' },
      { model: Match, as: 'matches', include: matchInclude },
    ],
    order: [['created_at', 'DESC']],
  });
}

export async function getTournamentById(id: number) {
  return Tournament.findByPk(id, {
    include: [
      { model: Team, as: 'teams', include: [{ association: 'players' }] },
      { model: Match, as: 'matches', include: matchInclude },
    ],
    order: [[{ model: Match, as: 'matches' }, 'created_at', 'ASC']],
  });
}

async function createDemoTeam(name: string, players: string[]) {
  const team = await Team.create({ name });
  for (const [index, playerName] of players.entries()) {
    await Player.create({
      team_id: team.id,
      name: playerName,
      batting_order: index + 1,
      role: index < 2 ? 'batsman' : index < 4 ? 'allrounder' : 'bowler',
    });
  }
  return Team.findByPk(team.id, { include: [{ model: Player, as: 'players' }] });
}

function ballsToOvers(balls: number) {
  return Math.floor(balls / 6) + (balls % 6) / 10;
}

async function addCompletedInnings(match: Match, inningsNumber: number, battingTeam: Team, bowlingTeam: Team, runs: number, wickets: number, balls: number, batting: number[], bowling: Array<{ player: number; runs: number; wickets: number; balls: number }>, target?: number) {
  const battingPlayers = ((battingTeam as any).players || []) as Player[];
  const innings = await Innings.create({
    match_id: match.id,
    batting_team_id: battingTeam.id,
    bowling_team_id: bowlingTeam.id,
    innings_number: inningsNumber,
    total_runs: runs,
    total_wickets: wickets,
    total_overs_bowled: ballsToOvers(balls),
    extras: Math.max(0, runs - batting.reduce((sum, value) => sum + value, 0)),
    status: 'completed',
    target,
  });

  for (const [index, score] of batting.entries()) {
    const player = battingPlayers[index];
    if (!player) continue;
    await BattingCard.create({
      innings_id: innings.id,
      player_id: player.id,
      batting_position: index + 1,
      runs: score,
      balls: Math.max(1, Math.round(score * 0.75) || 1),
      fours: Math.floor(score / 18),
      sixes: Math.floor(score / 28),
      is_out: index < wickets,
      dismissal_type: index < wickets ? 'caught' : undefined,
    });
  }

  for (const item of bowling) {
    await BowlingCard.create({
      innings_id: innings.id,
      player_id: item.player,
      runs: item.runs,
      wickets: item.wickets,
      legal_balls: item.balls,
      overs: ballsToOvers(item.balls),
    });
  }
}

async function createCompletedDemoMatch(tournament: Tournament, teamA: Team, teamB: Team, scoreA: number, wicketsA: number, scoreB: number, wicketsB: number, playerOffset: number) {
  const teamAPlayers = ((teamA as any).players || []) as Player[];
  const teamBPlayers = ((teamB as any).players || []) as Player[];
  const match = await Match.create({
    tournament_id: tournament.id,
    title: `${tournament.name}: ${teamA.name} vs ${teamB.name}`,
    team_a_id: teamA.id,
    team_b_id: teamB.id,
    total_overs: tournament.total_overs,
    players_per_side: tournament.players_per_side,
    death_overs_from: tournament.death_overs_from,
    wide_rule: tournament.wide_rule,
    scorer_pin: tournament.scorer_pin,
    share_token: uuidv4().replace(/-/g, ''),
    status: 'completed',
  });
  const balls = tournament.total_overs * 6;
  await addCompletedInnings(match, 1, teamA, teamB, scoreA, wicketsA, balls, [38 + playerOffset, 24, 13, 8, 4], [
    { player: teamBPlayers[4].id, runs: 22, wickets: 2, balls: 12 },
    { player: teamBPlayers[5].id, runs: 26, wickets: 1, balls: 12 },
    { player: teamBPlayers[3].id, runs: Math.max(10, scoreA - 48), wickets: Math.max(0, wicketsA - 3), balls: balls - 24 },
  ]);
  await addCompletedInnings(match, 2, teamB, teamA, scoreB, wicketsB, balls, [32, 21 + playerOffset, 15, 7, 2], [
    { player: teamAPlayers[4].id, runs: 19, wickets: 2, balls: 12 },
    { player: teamAPlayers[5].id, runs: 28, wickets: 1, balls: 12 },
    { player: teamAPlayers[3].id, runs: Math.max(10, scoreB - 47), wickets: Math.max(0, wicketsB - 3), balls: balls - 24 },
  ], scoreA + 1);
}

export async function createDemoTournament() {
  const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, '');
  const teams = await Promise.all([
    createDemoTeam(`Falcons ${stamp}`, ['Arun Patel', 'Dev Shah', 'Rishi Kumar', 'Manav Singh', 'Kabir Rao', 'Neil Mehta']),
    createDemoTeam(`Strikers ${stamp}`, ['Ishan Roy', 'Varun Das', 'Karan Gill', 'Samir Khan', 'Adil Sheikh', 'Yuvraj Jain']),
    createDemoTeam(`Royals ${stamp}`, ['Rohit Nair', 'Aman Verma', 'Nikhil Bose', 'Sahil Kapoor', 'Farhan Ali', 'Tahir Ansari']),
    createDemoTeam(`Rangers ${stamp}`, ['Jay Menon', 'Om Prakash', 'Vikram Sethi', 'Harsh Vyas', 'Rayan Thomas', 'Milan Dutta']),
  ]);

  const tournament = await Tournament.create({
    name: `Demo Premier League ${stamp}`,
    format: 'league',
    total_overs: 8,
    players_per_side: 6,
    death_overs_from: 7,
    wide_rule: 'normal',
    scorer_pin: '1234',
    status: 'live',
  });

  for (const team of teams) {
    await TournamentTeam.create({ tournament_id: tournament.id, team_id: team!.id });
  }

  await createCompletedDemoMatch(tournament, teams[0]!, teams[1]!, 92, 4, 88, 5, 4);
  await createCompletedDemoMatch(tournament, teams[2]!, teams[3]!, 81, 5, 84, 3, 0);
  await createCompletedDemoMatch(tournament, teams[0]!, teams[2]!, 76, 5, 77, 4, 2);
  await createCompletedDemoMatch(tournament, teams[1]!, teams[3]!, 97, 3, 71, 6, 8);

  await generateFixtures(tournament.id);
  return getTournamentById(tournament.id);
}

export async function createTournament(data: {
  name: string;
  format?: 'league' | 'knockout';
  total_overs: number;
  players_per_side: number;
  death_overs_from?: number;
  wide_rule: 'normal' | 'strict';
  scorer_pin: string;
  team_ids: number[];
}) {
  const teamIds = [...new Set((data.team_ids || []).map(Number).filter(Boolean))];
  if (teamIds.length < 2) throw new Error('Select at least two teams');

  const teamCount = await Team.count({ where: { id: teamIds } });
  if (teamCount !== teamIds.length) throw new Error('One or more teams were not found');

  const tournament = await Tournament.create({
    name: data.name,
    format: data.format || 'league',
    total_overs: data.total_overs,
    players_per_side: data.players_per_side,
    death_overs_from: data.death_overs_from,
    wide_rule: data.wide_rule,
    scorer_pin: data.scorer_pin,
  });

  for (const teamId of teamIds) {
    await TournamentTeam.create({ tournament_id: tournament.id, team_id: teamId });
  }

  return getTournamentById(tournament.id);
}

export async function generateFixtures(tournamentId: number) {
  const tournament = await getTournamentById(tournamentId);
  if (!tournament) throw new Error('Tournament not found');
  const teams = ((tournament as any).teams || []) as Team[];
  if (teams.length < 2) throw new Error('Tournament needs at least two teams');

  const created: Match[] = [];
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      const teamA = teams[i];
      const teamB = teams[j];
      const existing = await Match.findOne({
        where: { tournament_id: tournament.id, team_a_id: teamA.id, team_b_id: teamB.id },
      });
      if (existing) continue;
      const match = await Match.create({
        tournament_id: tournament.id,
        title: `${tournament.name}: ${teamA.name} vs ${teamB.name}`,
        team_a_id: teamA.id,
        team_b_id: teamB.id,
        total_overs: tournament.total_overs,
        players_per_side: tournament.players_per_side,
        death_overs_from: tournament.death_overs_from,
        wide_rule: tournament.wide_rule,
        scorer_pin: tournament.scorer_pin,
        share_token: uuidv4().replace(/-/g, ''),
        status: 'pending',
      });
      created.push(match);
    }
  }

  return { created: created.length, tournament: await getTournamentById(tournament.id) };
}
