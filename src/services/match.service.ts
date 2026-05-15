import { v4 as uuidv4 } from 'uuid';
import { Match, MatchSession, Team, Innings, Player } from '../models';

export async function getAllMatches() {
  return Match.findAll({
    include: [
      { model: Team, as: 'teamA' },
      { model: Team, as: 'teamB' },
    ],
    order: [['created_at', 'DESC']],
  });
}

export async function getMatchById(id: number) {
  return Match.findByPk(id, {
    include: [
      { model: Team, as: 'teamA', include: [{ model: Player, as: 'players' }] },
      { model: Team, as: 'teamB', include: [{ model: Player, as: 'players' }] },
    ],
  });
}

export async function createMatch(data: {
  title: string;
  team_a_id: number;
  team_b_id: number;
  total_overs: number;
  players_per_side: number;
  death_overs_from?: number;
  wide_rule: 'normal' | 'strict';
  scorer_pin: string;
}) {
  const share_token = uuidv4().replace(/-/g, '');
  return Match.create({ ...data, share_token, status: 'pending' });
}

export async function verifyPin(matchId: number, pin: string) {
  const match = await Match.findByPk(matchId);
  if (!match) throw new Error('Match not found');
  if (match.scorer_pin !== pin) throw new Error('Invalid PIN');

  // Revoke existing sessions
  await MatchSession.destroy({ where: { match_id: matchId } });

  const token = uuidv4() + uuidv4();
  const expires_at = new Date(Date.now() + 12 * 60 * 60 * 1000); // 12h

  await MatchSession.create({ match_id: matchId, token, expires_at });
  return token;
}

export async function startMatch(matchId: number, data: {
  toss_winner_team_id: number;
  elected_to: 'bat' | 'bowl';
  opening_batsman1_id: number;
  opening_batsman2_id: number;
  opening_bowler_id: number;
}) {
  const match = await Match.findByPk(matchId);
  if (!match) throw new Error('Match not found');
  if (match.status !== 'pending') throw new Error('Match already started');

  // Determine batting/bowling teams
  const batting_team_id = data.elected_to === 'bat'
    ? data.toss_winner_team_id
    : (data.toss_winner_team_id === match.team_a_id ? match.team_b_id : match.team_a_id);

  const bowling_team_id = batting_team_id === match.team_a_id ? match.team_b_id : match.team_a_id;

  await match.update({ status: 'live', toss_winner_team_id: data.toss_winner_team_id, elected_to: data.elected_to });

  // Create first innings
  const innings = await Innings.create({
    match_id: matchId,
    batting_team_id,
    bowling_team_id,
    innings_number: 1,
    current_batsman1_id: data.opening_batsman1_id,
    current_batsman2_id: data.opening_batsman2_id,
    current_bowler_id: data.opening_bowler_id,
    on_strike_batsman_id: data.opening_batsman1_id,
  });

  // Create batting cards for openers
  const battingPos = { [data.opening_batsman1_id]: 1, [data.opening_batsman2_id]: 2 };

  for (const [playerId, pos] of Object.entries(battingPos)) {
    const { BattingCard } = await import('../models');
    await BattingCard.create({ innings_id: innings.id, player_id: Number(playerId), batting_position: pos });
  }

  // Create first over
  const { Over } = await import('../models');
  await Over.create({ innings_id: innings.id, over_number: 1, bowler_player_id: data.opening_bowler_id });

  // Create bowling card for opener bowler
  const { BowlingCard } = await import('../models');
  await BowlingCard.create({ innings_id: innings.id, player_id: data.opening_bowler_id });

  return innings;
}

export async function endMatch(matchId: number, _result?: string) {
  const match = await Match.findByPk(matchId);
  if (!match) throw new Error('Match not found');

  // Close any live innings for this match
  const { Innings, Over } = await import('../models');
  const liveInnings = await Innings.findAll({ where: { match_id: matchId, status: 'live' } });
  for (const inn of liveInnings) {
    await inn.update({ status: 'completed' });
    await Over.update({ status: 'completed' }, { where: { innings_id: inn.id, status: 'live' } });
  }

  await match.update({ status: 'completed' });
  return match;
}
