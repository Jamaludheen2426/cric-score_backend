import { Match, Innings, Over, Ball, BattingCard, BowlingCard, Player } from '../models';
import { broadcastToMatch } from '../middleware/sse';
import { getLiveScore } from './live.service';

async function getMaxBattersForInnings(match: Match, innings: Innings) {
  const rosterCount = await Player.count({ where: { team_id: innings.batting_team_id } });
  const configuredCount = Number(match.players_per_side) || rosterCount || 11;
  return Math.max(1, Math.min(configuredCount, rosterCount || configuredCount));
}

async function completeInnings(match: Match, innings: Innings, over: Over) {
  await innings.update({ status: 'completed' });
  await over.update({ status: 'completed' });
  if (innings.innings_number === 2) {
    await match.update({ status: 'completed' });
  }
  const liveScore = await getLiveScore(match.share_token);
  broadcastToMatch(match.share_token, liveScore);
}
async function recalcInningsOvers(inningsId: number, innings: Innings) {
  const allOvers = await Over.findAll({ where: { innings_id: inningsId } });
  let total = 0;
  for (const o of allOvers) total += o.legal_balls;
  const inningsOvers = Math.floor(total / 6) + (total % 6) / 10;
  await innings.update({ total_overs_bowled: inningsOvers });
}

export interface BallInput {
  runs: number;
  is_wide?: boolean;
  is_noball?: boolean;
  is_wicket?: boolean;
  wicket_type?: string;
  dismissed_player_id?: number;
  new_batsman_id?: number; // Required when wicket falls
  extras?: number;
}

const WICKET_TYPES_ALLOWED_ON_NO_BALL = new Set(['run_out', 'obstructing_field', 'retired']);

function wicketCounts(input: BallInput) {
  if (!input.is_wicket) return false;
  if (!input.is_noball) return true;
  return WICKET_TYPES_ALLOWED_ON_NO_BALL.has(input.wicket_type || '');
}

export async function addBall(matchId: number, input: BallInput) {
  const match = await Match.findByPk(matchId);
  if (!match) throw new Error('Match not found');
  if (match.status !== 'live') throw new Error('Match is not live');

  const innings = await Innings.findOne({
    where: { match_id: matchId, status: 'live' },
    order: [['innings_number', 'DESC']],
  });
  if (!innings) throw new Error('No active innings');

  const over = await Over.findOne({
    where: { innings_id: innings.id, status: 'live' },
    order: [['over_number', 'DESC']],
  });
  if (!over) throw new Error('No active over');

  const strikerId = innings.on_strike_batsman_id!;
  const strikerCardBeforeBall = await BattingCard.findOne({ where: { innings_id: innings.id, player_id: strikerId } });
  if (strikerCardBeforeBall?.is_out) {
    await completeInnings(match, innings, over);
    return {
      allOut: true,
      matchEnded: innings.innings_number === 2,
      innings: await innings.reload(),
    };
  }

  const countsAsWicket = wicketCounts(input);
  if (input.is_wicket && !countsAsWicket) {
    throw new Error('This wicket type is not valid on a no-ball');
  }

  const maxBatters = await getMaxBattersForInnings(match, innings);
  const wicketsAfterThisBall = innings.total_wickets + (countsAsWicket ? 1 : 0);
  const battingCardCount = await BattingCard.count({ where: { innings_id: innings.id } });
  const noReplacementAvailable = countsAsWicket && !input.new_batsman_id && (
    wicketsAfterThisBall >= maxBatters - 1 || battingCardCount >= maxBatters
  );

  if (countsAsWicket && !input.new_batsman_id && !noReplacementAvailable) {
    throw new Error('New batsman is required before scoring the next ball');
  }

  const isLegal = !input.is_wide && !input.is_noball;
  const inDeathOvers = match.death_overs_from != null && over.over_number >= match.death_overs_from;
  const ballExtras = (input.is_wide || input.is_noball)
    ? (input.is_wide && inDeathOvers ? 2 : 1)
    : 0;
  const batRuns = input.is_wide ? 0 : input.runs;
  const totalExtras = input.is_wide
    ? input.runs + ballExtras
    : (input.extras || 0) + ballExtras;

  // Ball number: count all balls (legal + extra) in this over
  const existingBalls = await Ball.count({ where: { over_id: over.id } });
  const ball_number = existingBalls + 1;

  // Create ball record
  const ball = await Ball.create({
    over_id: over.id,
    ball_number,
    batsman_player_id: innings.on_strike_batsman_id!,
    runs: batRuns,
    is_wide: input.is_wide || false,
    is_noball: input.is_noball || false,
    is_wicket: countsAsWicket,
    wicket_type: input.wicket_type as any,
    dismissed_player_id: input.dismissed_player_id,
    extras: totalExtras,
  });

  const runsThisBall = batRuns + totalExtras;

  // Update over stats
  await over.update({
    runs: over.runs + runsThisBall,
    wickets: over.wickets + (countsAsWicket ? 1 : 0),
    extras: over.extras + totalExtras,
    legal_balls: over.legal_balls + (isLegal ? 1 : 0),
  });

  // Update innings stats
  await innings.update({
    total_runs: innings.total_runs + runsThisBall,
    total_wickets: innings.total_wickets + (countsAsWicket ? 1 : 0),
    extras: innings.extras + totalExtras,
  });

  // Update batting card for on-strike batsman
  const battingCard = await BattingCard.findOne({ where: { innings_id: innings.id, player_id: strikerId } });
  if (battingCard) {
    const isOut = countsAsWicket && (input.dismissed_player_id === strikerId || !input.dismissed_player_id);
    await battingCard.update({
      runs: battingCard.runs + batRuns,
      balls: battingCard.balls + (isLegal ? 1 : 0),
      fours: battingCard.fours + (batRuns === 4 ? 1 : 0),
      sixes: battingCard.sixes + (batRuns === 6 ? 1 : 0),
      is_out: isOut,
      dismissal_type: isOut ? input.wicket_type : battingCard.dismissal_type,
      bowler_id: isOut ? over.bowler_player_id : battingCard.bowler_id,
    });
  }

  // If run-out, update non-striker's card if they were dismissed
  if (countsAsWicket && input.dismissed_player_id && input.dismissed_player_id !== strikerId) {
    const nonStrikerCard = await BattingCard.findOne({ where: { innings_id: innings.id, player_id: input.dismissed_player_id } });
    if (nonStrikerCard) {
      await nonStrikerCard.update({
        is_out: true,
        dismissal_type: 'run_out',
      });
    }
  }

  // Update bowling card
  const bowlingCard = await BowlingCard.findOne({ where: { innings_id: innings.id, player_id: over.bowler_player_id } });
  if (bowlingCard) {
    const newLegalBalls = bowlingCard.legal_balls + (isLegal ? 1 : 0);
    const oversFloat = Math.floor(newLegalBalls / 6) + (newLegalBalls % 6) / 10;
    await bowlingCard.update({
      runs: bowlingCard.runs + runsThisBall,
      wickets: bowlingCard.wickets + (countsAsWicket && input.wicket_type !== 'run_out' ? 1 : 0),
      extras: bowlingCard.extras + totalExtras,
      legal_balls: newLegalBalls,
      overs: oversFloat,
    });
  }

  // Handle new batsman coming in
  if (countsAsWicket && input.new_batsman_id) {
    if (battingCardCount >= maxBatters) {
      throw new Error('No batting slots remain for a new batsman');
    }

    const newBatsman = await Player.findOne({ where: { id: input.new_batsman_id, team_id: innings.batting_team_id } });
    if (!newBatsman) throw new Error('New batsman must belong to batting team');

    const existingNewBatsmanCard = await BattingCard.findOne({ where: { innings_id: innings.id, player_id: input.new_batsman_id } });
    if (existingNewBatsmanCard) throw new Error('New batsman has already batted in this innings');

    const dismissedId = input.dismissed_player_id || strikerId;
    const existingBatCount = await BattingCard.count({ where: { innings_id: innings.id } });

    await BattingCard.create({
      innings_id: innings.id,
      player_id: input.new_batsman_id,
      batting_position: existingBatCount + 1,
    });

    // Update innings current batsmen
    const isStriker = dismissedId === innings.current_batsman1_id;
    await innings.update({
      current_batsman1_id: isStriker ? input.new_batsman_id : innings.current_batsman1_id,
      current_batsman2_id: !isStriker ? input.new_batsman_id : innings.current_batsman2_id,
      on_strike_batsman_id: isStriker ? input.new_batsman_id : innings.on_strike_batsman_id,
    });
  }

  // Rotate strike on odd runs (non-wide, non-wicket)
  if (isLegal && !countsAsWicket && batRuns % 2 === 1) {
    await innings.reload();
    const newOnStrike = innings.on_strike_batsman_id === innings.current_batsman1_id
      ? innings.current_batsman2_id!
      : innings.current_batsman1_id!;
    await innings.update({ on_strike_batsman_id: newOnStrike });
  }

  // Refresh innings + overs count
  await innings.reload();
  await recalcInningsOvers(innings.id, innings);
  await innings.reload();

  // â”€â”€ End-of-innings / end-of-match checks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const allOut = Boolean(countsAsWicket && !input.new_batsman_id && noReplacementAvailable);
  const oversFinished = Number(innings.total_overs_bowled) >= match.total_overs;
  const targetReached = innings.innings_number === 2 && innings.target != null && innings.total_runs >= innings.target;

  if (allOut || oversFinished || targetReached) {
    await completeInnings(match, innings, over);
    return {
      ball,
      innings: await innings.reload(),
      allOut,
      oversFinished,
      targetReached,
      matchEnded: innings.innings_number === 2,
    };
  }

  // Broadcast via SSE
  const liveScore = await getLiveScore(match.share_token);
  broadcastToMatch(match.share_token, liveScore);

  return { ball, innings: await innings.reload() };
}

export async function endOver(matchId: number, nextBowlerId: number) {
  const match = await Match.findByPk(matchId);
  if (!match) throw new Error('Match not found');
  if (match.status !== 'live') throw new Error('Match is not live');

  const innings = await Innings.findOne({
    where: { match_id: matchId, status: 'live' },
    order: [['innings_number', 'DESC']],
  });
  if (!innings) throw new Error('No active innings');

  const over = await Over.findOne({
    where: { innings_id: innings.id, status: 'live' },
    order: [['over_number', 'DESC']],
  });
  if (!over) throw new Error('No active over');
  if (over.legal_balls < 6) throw new Error('Over is not complete');
  if (nextBowlerId === over.bowler_player_id) throw new Error('Same bowler cannot bowl consecutive overs');

  const nextBowler = await Player.findOne({ where: { id: nextBowlerId, team_id: innings.bowling_team_id } });
  if (!nextBowler) throw new Error('Next bowler must belong to bowling team');

  // Close current over
  await over.update({ status: 'completed' });

  // Rotate strike at end of over
  const newOnStrike = innings.on_strike_batsman_id === innings.current_batsman1_id
    ? innings.current_batsman2_id!
    : innings.current_batsman1_id!;

  await innings.update({
    current_bowler_id: nextBowlerId,
    on_strike_batsman_id: newOnStrike,
  });

  // Create new over
  const newOverNumber = over.over_number + 1;
  const newOver = await Over.create({
    innings_id: innings.id,
    over_number: newOverNumber,
    bowler_player_id: nextBowlerId,
  });

  // Ensure bowling card exists for new bowler
  const existingCard = await BowlingCard.findOne({ where: { innings_id: innings.id, player_id: nextBowlerId } });
  if (!existingCard) {
    await BowlingCard.create({ innings_id: innings.id, player_id: nextBowlerId });
  }

  const liveScore = await getLiveScore(match.share_token);
  broadcastToMatch(match.share_token, liveScore);

  return newOver;
}

export async function endInnings(matchId: number, data: {
  opening_batsman1_id: number;
  opening_batsman2_id: number;
  opening_bowler_id: number;
}) {
  const match = await Match.findByPk(matchId);
  if (!match) throw new Error('Match not found');
  if (match.status !== 'live') throw new Error('Match is not live');

  // Accept both a live innings (manual end) or last completed innings (all-out auto-end)
  const liveInnings = await Innings.findOne({
    where: { match_id: matchId, status: 'live' },
    order: [['innings_number', 'DESC']],
  });
  const currentInnings = liveInnings || await Innings.findOne({
    where: { match_id: matchId, status: 'completed' },
    order: [['innings_number', 'DESC']],
  });
  if (!currentInnings) throw new Error('No innings found');
  if (currentInnings.innings_number >= 2) {
    throw new Error('Second innings already exists; end the match instead');
  }

  if (data.opening_batsman1_id === data.opening_batsman2_id) {
    throw new Error('Opening batsmen must be different players');
  }

  const newBattingTeamId = currentInnings.bowling_team_id;
  const newBowlingTeamId = currentInnings.batting_team_id;
  const validOpeners = await Player.count({
    where: { id: [data.opening_batsman1_id, data.opening_batsman2_id], team_id: newBattingTeamId },
  });
  if (validOpeners !== 2) throw new Error('Opening batsmen must belong to batting team');

  const validBowler = await Player.findOne({ where: { id: data.opening_bowler_id, team_id: newBowlingTeamId } });
  if (!validBowler) throw new Error('Opening bowler must belong to bowling team');

  // Close innings and over only if still live
  if (liveInnings) {
    await currentInnings.update({ status: 'completed' });
    await Over.update({ status: 'completed' }, { where: { innings_id: currentInnings.id, status: 'live' } });
  }

  // Target = current innings runs + 1
  const target = currentInnings.total_runs + 1;

  // Swap batting/bowling teams
  const newInnings = await Innings.create({
    match_id: matchId,
    batting_team_id: newBattingTeamId,
    bowling_team_id: newBowlingTeamId,
    innings_number: currentInnings.innings_number + 1,
    current_batsman1_id: data.opening_batsman1_id,
    current_batsman2_id: data.opening_batsman2_id,
    current_bowler_id: data.opening_bowler_id,
    on_strike_batsman_id: data.opening_batsman1_id,
    target,
  });

  // Create batting cards
  for (let i = 0; i < 2; i++) {
    const pid = i === 0 ? data.opening_batsman1_id : data.opening_batsman2_id;
    await BattingCard.create({ innings_id: newInnings.id, player_id: pid, batting_position: i + 1 });
  }

  // Create first over of second innings
  await Over.create({ innings_id: newInnings.id, over_number: 1, bowler_player_id: data.opening_bowler_id });
  await BowlingCard.create({ innings_id: newInnings.id, player_id: data.opening_bowler_id });

  const liveScore = await getLiveScore(match.share_token);
  broadcastToMatch(match.share_token, liveScore);

  return newInnings;
}

export async function undoLastBall(matchId: number) {
  const match = await Match.findByPk(matchId);
  if (!match) throw new Error('Match not found');
  if (match.status !== 'live') throw new Error('Match is not live');

  const innings = await Innings.findOne({
    where: { match_id: matchId, status: 'live' },
    order: [['innings_number', 'DESC']],
  });
  if (!innings) throw new Error('No active innings');

  const over = await Over.findOne({
    where: { innings_id: innings.id, status: 'live' },
    order: [['over_number', 'DESC']],
  });
  if (!over) throw new Error('No active over');

  const lastBall = await Ball.findOne({
    where: { over_id: over.id },
    order: [['ball_number', 'DESC']],
  });
  if (!lastBall) throw new Error('No balls to undo in this over');

  const isLegal = !lastBall.is_wide && !lastBall.is_noball;
  const runsThisBall = lastBall.runs + lastBall.extras;

  // Reverse over stats
  await over.update({
    runs: over.runs - runsThisBall,
    wickets: over.wickets - (lastBall.is_wicket ? 1 : 0),
    extras: over.extras - lastBall.extras,
    legal_balls: over.legal_balls - (isLegal ? 1 : 0),
  });

  // Reverse innings stats
  await innings.update({
    total_runs: innings.total_runs - runsThisBall,
    total_wickets: innings.total_wickets - (lastBall.is_wicket ? 1 : 0),
    extras: innings.extras - lastBall.extras,
  });

  // Reverse striker's batting card
  const strikerId = lastBall.batsman_player_id;
  const battingCard = await BattingCard.findOne({ where: { innings_id: innings.id, player_id: strikerId } });
  if (battingCard) {
    const wasOut = lastBall.is_wicket && (lastBall.dismissed_player_id === strikerId || !lastBall.dismissed_player_id);
    await battingCard.update({
      runs: battingCard.runs - (lastBall.is_wide ? 0 : lastBall.runs),
      balls: battingCard.balls - (lastBall.is_wide ? 0 : 1),
      fours: battingCard.fours - (lastBall.runs === 4 && !lastBall.is_wide ? 1 : 0),
      sixes: battingCard.sixes - (lastBall.runs === 6 ? 1 : 0),
      ...(wasOut ? { is_out: false, dismissal_type: null, bowler_id: null } : {}),
    } as any);
  }

  // Reverse non-striker card for run-out
  if (lastBall.is_wicket && lastBall.dismissed_player_id && lastBall.dismissed_player_id !== strikerId) {
    const nonStrikerCard = await BattingCard.findOne({ where: { innings_id: innings.id, player_id: lastBall.dismissed_player_id } });
    if (nonStrikerCard) {
      await nonStrikerCard.update({ is_out: false, dismissal_type: null } as any);
    }
  }

  // Reverse bowling card
  const bowlingCard = await BowlingCard.findOne({ where: { innings_id: innings.id, player_id: over.bowler_player_id } });
  if (bowlingCard) {
    const newLegalBalls = bowlingCard.legal_balls - (isLegal ? 1 : 0);
    const oversFloat = Math.floor(newLegalBalls / 6) + (newLegalBalls % 6) / 10;
    await bowlingCard.update({
      runs: bowlingCard.runs - runsThisBall,
      wickets: bowlingCard.wickets - (lastBall.is_wicket && lastBall.wicket_type !== 'run_out' ? 1 : 0),
      extras: bowlingCard.extras - lastBall.extras,
      legal_balls: newLegalBalls,
      overs: oversFloat,
    });
  }

  // Restore innings batsmen state
  const inningsUpdate: Record<string, any> = {
    on_strike_batsman_id: strikerId, // always restore striker to who faced the ball
  };

  if (lastBall.is_wicket) {
    const dismissedId = lastBall.dismissed_player_id || strikerId;
    // New batsman = the one with the highest batting_position (came in last)
    const allCards = await BattingCard.findAll({
      where: { innings_id: innings.id },
      order: [['batting_position', 'DESC']],
    });
    const newBatsmanCard = allCards[0];
    if (newBatsmanCard && newBatsmanCard.player_id !== dismissedId) {
      const newBatsmanId = newBatsmanCard.player_id;
      if (innings.current_batsman1_id === newBatsmanId) {
        inningsUpdate.current_batsman1_id = dismissedId;
      } else if (innings.current_batsman2_id === newBatsmanId) {
        inningsUpdate.current_batsman2_id = dismissedId;
      }
      await newBatsmanCard.destroy();
    }
  }

  await innings.update(inningsUpdate);
  await recalcInningsOvers(innings.id, innings);

  // Delete the ball
  await lastBall.destroy();

  // Broadcast
  const liveScore = await getLiveScore(match.share_token);
  broadcastToMatch(match.share_token, liveScore);

  return { undone: true };
}




