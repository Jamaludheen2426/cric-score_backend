import { Match, Innings, Over, Ball, BattingCard, BowlingCard, Player } from '../models';
import { ScoreAuditLog } from '../models';
import { broadcastToMatch } from '../middleware/sse';
import { getLiveScore } from './live.service';
import { widePenaltyRuns } from './wide-rule';

/**
 * Fire-and-forget SSE broadcast. We DON'T await this so the API request can
 * return as soon as DB writes are persisted. The broadcast happens in the
 * background and is delivered to connected SSE viewers a moment later.
 *
 * On a typical Render→Aiven setup, awaiting getLiveScore() adds ~1-3s of
 * deep-include MySQL traffic per ball. With this helper, the user only
 * waits for the actual stat writes (~5-10 queries) instead of also having
 * to wait for the broadcast payload.
 */
function broadcastInBackground(shareToken: string) {
  // Defer so the current handler can return immediately. Errors are logged
  // but never thrown back to the caller.
  setImmediate(async () => {
    try {
      const liveScore = await getLiveScore(shareToken);
      broadcastToMatch(shareToken, liveScore);
    } catch (err) {
      console.error('[sse] background broadcast failed:', (err as Error)?.message);
    }
  });
}

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
  broadcastInBackground(match.share_token);
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
  extra_type?: 'bye' | 'leg_bye' | 'wide' | 'no_ball';
  next_striker_id?: number;
}

const WICKET_TYPES_ALLOWED_ON_NO_BALL = new Set(['run_out', 'obstructing_field', 'retired', 'retired_hurt', 'retired_out']);

function wicketCounts(input: BallInput) {
  if (!input.is_wicket) return false;
  if (input.wicket_type === 'retired_hurt') return false;
  if (input.wicket_type === 'retired_out') return true;
  if (!input.is_noball) return true;
  return WICKET_TYPES_ALLOWED_ON_NO_BALL.has(input.wicket_type || '');
}

function isRetiredHurt(input: BallInput) {
  return Boolean(input.is_wicket && input.wicket_type === 'retired_hurt');
}

async function audit(matchId: number, action: string, details?: object) {
  try {
    await ScoreAuditLog.create({ match_id: matchId, action, details });
  } catch (err) {
    console.error('[audit] write failed:', (err as Error)?.message);
  }
}

export async function addBall(matchId: number, input: BallInput) {
  // Match + innings are independent on matchId — fetch both in one round-trip
  // batch instead of two serial ones.
  const [match, innings] = await Promise.all([
    Match.findByPk(matchId),
    Innings.findOne({
      where: { match_id: matchId, status: 'live' },
      order: [['innings_number', 'DESC']],
    }),
  ]);
  if (!match) throw new Error('Match not found');
  if (match.status !== 'live') throw new Error('Match is not live');
  if (!innings) throw new Error('No active innings');

  // Over depends on innings.id so it must follow the lookup above.
  const over = await Over.findOne({
    where: { innings_id: innings.id, status: 'live' },
    order: [['over_number', 'DESC']],
  });
  if (!over) throw new Error('No active over');

  const strikerId = innings.on_strike_batsman_id!;
  const countsAsWicket = wicketCounts(input);
  const retiredHurt = isRetiredHurt(input);
  if (input.is_wicket && !countsAsWicket && !retiredHurt) {
    throw new Error('This wicket type is not valid on a no-ball');
  }

  // These three lookups are independent — fire them in parallel to
  // collapse three Render→Aiven round-trips into one batch.
  const [strikerCardBeforeBall, maxBatters, battingCardCount] = await Promise.all([
    BattingCard.findOne({ where: { innings_id: innings.id, player_id: strikerId } }),
    getMaxBattersForInnings(match, innings),
    BattingCard.count({ where: { innings_id: innings.id } }),
  ]);

  if (strikerCardBeforeBall?.is_out) {
    await completeInnings(match, innings, over);
    return {
      allOut: true,
      matchEnded: innings.innings_number === 2,
      innings: await innings.reload(),
    };
  }

  const wicketsAfterThisBall = innings.total_wickets + (countsAsWicket ? 1 : 0);
  const noReplacementAvailable = countsAsWicket && !input.new_batsman_id && (
    wicketsAfterThisBall >= maxBatters - 1 || battingCardCount >= maxBatters
  );

  if (countsAsWicket && !input.new_batsman_id && !noReplacementAvailable) {
    throw new Error('New batsman is required before scoring the next ball');
  }
  if (retiredHurt && !input.new_batsman_id) {
    throw new Error('New batsman is required for retired hurt');
  }

  const isLegal = !input.is_wide && !input.is_noball;
  const isByeLike = input.extra_type === 'bye' || input.extra_type === 'leg_bye';
  // Local-tournament wide rule (matches scoring-fast.service.ts):
  //   • Normal over wide: NO penalty run, just re-bowled.
  //   • Death over wide:  +1 penalty + re-bowled.
  //   • Strict (T20):     +1 penalty + re-bowled.
  const widePenalty = input.is_wide ? widePenaltyRuns(match, over) : 0;
  const noBallPenalty = input.is_noball ? 1 : 0;
  const ballExtras = widePenalty + noBallPenalty;
  const batRuns = input.is_wide || isByeLike ? 0 : input.runs;
  const totalExtras = input.is_wide
    ? input.runs + widePenalty
    : isByeLike
      ? input.runs + noBallPenalty
    : (input.extras || 0) + ballExtras;

  const runsThisBall = batRuns + totalExtras;
  const bowlerRunsThisBall = isByeLike ? noBallPenalty : runsThisBall;
  const strikeRuns = isByeLike ? input.runs : batRuns;

  // The striker's batting card was already loaded above (strikerCardBeforeBall).
  // Ball.count, the bowling card, and (for run-outs) the non-striker card
  // are independent lookups — fetch them in parallel so we pay one
  // Render→Aiven round-trip instead of three.
  const [existingBalls, bowlingCard, nonStrikerCard] = await Promise.all([
    Ball.count({ where: { over_id: over.id } }),
    BowlingCard.findOne({ where: { innings_id: innings.id, player_id: over.bowler_player_id } }),
    (countsAsWicket && input.dismissed_player_id && input.dismissed_player_id !== strikerId)
      ? BattingCard.findOne({ where: { innings_id: innings.id, player_id: input.dismissed_player_id } })
      : Promise.resolve(null),
  ]);
  const ball_number = existingBalls + 1;

  // Create ball + apply all stat updates in parallel.
  const isOut = countsAsWicket && (input.dismissed_player_id === strikerId || !input.dismissed_player_id);
  const newLegalBowlerBalls = (bowlingCard?.legal_balls || 0) + (isLegal ? 1 : 0);
  const newBowlerOversFloat = Math.floor(newLegalBowlerBalls / 6) + (newLegalBowlerBalls % 6) / 10;

  const [ball] = await Promise.all([
    Ball.create({
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
      extra_type: input.is_wide ? 'wide' : input.is_noball ? 'no_ball' : input.extra_type,
      next_striker_id: input.next_striker_id,
    }),
    over.update({
      runs: over.runs + runsThisBall,
      wickets: over.wickets + (countsAsWicket ? 1 : 0),
      extras: over.extras + totalExtras,
      legal_balls: over.legal_balls + (isLegal ? 1 : 0),
    }),
    innings.update({
      total_runs: innings.total_runs + runsThisBall,
      total_wickets: innings.total_wickets + (countsAsWicket ? 1 : 0),
      extras: innings.extras + totalExtras,
    }),
    strikerCardBeforeBall ? strikerCardBeforeBall.update({
      runs: strikerCardBeforeBall.runs + batRuns,
      balls: strikerCardBeforeBall.balls + (isLegal ? 1 : 0),
      fours: strikerCardBeforeBall.fours + (batRuns === 4 ? 1 : 0),
      sixes: strikerCardBeforeBall.sixes + (batRuns === 6 ? 1 : 0),
      is_out: isOut,
      dismissal_type: isOut ? input.wicket_type : strikerCardBeforeBall.dismissal_type,
      bowler_id: isOut ? over.bowler_player_id : strikerCardBeforeBall.bowler_id,
    }) : Promise.resolve(),
    bowlingCard ? bowlingCard.update({
      runs: bowlingCard.runs + bowlerRunsThisBall,
      wickets: bowlingCard.wickets + (countsAsWicket && input.wicket_type !== 'run_out' ? 1 : 0),
      extras: bowlingCard.extras + totalExtras,
      legal_balls: newLegalBowlerBalls,
      overs: newBowlerOversFloat,
    }) : Promise.resolve(),
    nonStrikerCard ? nonStrikerCard.update({
      is_out: true,
      dismissal_type: 'run_out',
    }) : Promise.resolve(),
  ]);

  // Handle new batsman coming in
  if ((countsAsWicket || retiredHurt) && input.new_batsman_id) {
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
    const nextBatsman1 = isStriker ? input.new_batsman_id : innings.current_batsman1_id!;
    const nextBatsman2 = !isStriker ? input.new_batsman_id : innings.current_batsman2_id!;
    const requestedStriker = input.next_striker_id;
    await innings.update({
      current_batsman1_id: nextBatsman1,
      current_batsman2_id: nextBatsman2,
      on_strike_batsman_id: requestedStriker && [nextBatsman1, nextBatsman2].includes(requestedStriker)
        ? requestedStriker
        : (isStriker ? input.new_batsman_id : innings.on_strike_batsman_id),
    });
  }

  // Rotate strike on odd runs (non-wide, non-wicket) AND recalc innings
  // overs in a single combined update — both target the same innings row,
  // so we save another Render→Aiven round-trip vs the previous two-step
  // (reload + update for strike, then findAll + update for overs).
  //
  // The new total_overs_bowled is derived from the new over.legal_balls
  // plus all completed overs already on this innings — we already know
  // legal_balls per over from in-memory state, but for completed overs
  // we'd need a sum. Approximate without a query: every completed over
  // has 6 legal balls, so completed_overs = over.over_number - 1.
  //   total_legal = (over.over_number - 1) * 6 + over.legal_balls
  const newOverLegalBalls = over.legal_balls;   // already mutated by the .update above
  const totalLegalBalls = (over.over_number - 1) * 6 + newOverLegalBalls;
  const newTotalOversBowled = Math.floor(totalLegalBalls / 6) + (totalLegalBalls % 6) / 10;

  const inningsPatch: Partial<{ on_strike_batsman_id: number; total_overs_bowled: number }> = {
    total_overs_bowled: newTotalOversBowled,
  };
  if (isLegal && !countsAsWicket && !retiredHurt && strikeRuns % 2 === 1) {
    inningsPatch.on_strike_batsman_id = innings.on_strike_batsman_id === innings.current_batsman1_id
      ? innings.current_batsman2_id!
      : innings.current_batsman1_id!;
  }
  await innings.update(inningsPatch);

  // ── End-of-innings / end-of-match checks ──────────────────────────
  const allOut = Boolean(countsAsWicket && !input.new_batsman_id && noReplacementAvailable);
  const oversFinished = Number(innings.total_overs_bowled) >= match.total_overs;
  const targetReached = innings.innings_number === 2 && innings.target != null && innings.total_runs >= innings.target;

  if (allOut || oversFinished || targetReached) {
    await completeInnings(match, innings, over);
    return {
      ball,
      innings,
      allOut,
      oversFinished,
      targetReached,
      matchEnded: innings.innings_number === 2,
    };
  }

  // Fire SSE broadcast in the background — the API can return now.
  broadcastInBackground(match.share_token);
  audit(matchId, 'ball_added', { input, ball_id: ball.id });

  return { ball, innings };
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

  broadcastInBackground(match.share_token);
  audit(matchId, 'over_ended', { next_bowler_id: nextBowlerId });
  return newOver;
}

export async function correctCurrentPlayers(matchId: number, data: {
  current_batsman1_id?: number;
  current_batsman2_id?: number;
  on_strike_batsman_id?: number;
  current_bowler_id?: number;
}) {
  const match = await Match.findByPk(matchId);
  if (!match) throw new Error('Match not found');
  if (match.status !== 'live') throw new Error('Match is not live');

  const innings = await Innings.findOne({ where: { match_id: matchId, status: 'live' } });
  if (!innings) throw new Error('No active innings');

  const patch: Record<string, number> = {};

  if (data.current_batsman1_id || data.current_batsman2_id || data.on_strike_batsman_id) {
    const batsman1Id = data.current_batsman1_id || innings.current_batsman1_id;
    const batsman2Id = data.current_batsman2_id || innings.current_batsman2_id;
    const onStrikeId = data.on_strike_batsman_id || innings.on_strike_batsman_id;

    if (!batsman1Id || !batsman2Id || !onStrikeId) throw new Error('Both batsmen and striker are required');
    if (batsman1Id === batsman2Id) throw new Error('Current batsmen must be different players');
    if (![batsman1Id, batsman2Id].includes(onStrikeId)) throw new Error('Striker must be one of the current batsmen');

    const validBatsmen = await Player.count({ where: { id: [batsman1Id, batsman2Id], team_id: innings.batting_team_id } });
    if (validBatsmen !== 2) throw new Error('Current batsmen must belong to batting team');

    const maxPosition = (await BattingCard.max('batting_position', { where: { innings_id: innings.id } }) as number | null) || 0;
    let nextPosition = maxPosition + 1;
    for (const playerId of [batsman1Id, batsman2Id]) {
      const card = await BattingCard.findOne({ where: { innings_id: innings.id, player_id: playerId } });
      if (card?.is_out) throw new Error('Cannot bring back a batter who is already out');
      if (!card) {
        await BattingCard.create({ innings_id: innings.id, player_id: playerId, batting_position: nextPosition });
        nextPosition += 1;
      }
    }

    patch.current_batsman1_id = batsman1Id;
    patch.current_batsman2_id = batsman2Id;
    patch.on_strike_batsman_id = onStrikeId;
  }

  if (data.current_bowler_id) {
    const bowler = await Player.findOne({ where: { id: data.current_bowler_id, team_id: innings.bowling_team_id } });
    if (!bowler) throw new Error('Current bowler must belong to bowling team');

    const over = await Over.findOne({ where: { innings_id: innings.id, status: 'live' }, order: [['over_number', 'DESC']] });
    if (!over) throw new Error('No active over');

    await over.update({ bowler_player_id: data.current_bowler_id });
    const card = await BowlingCard.findOne({ where: { innings_id: innings.id, player_id: data.current_bowler_id } });
    if (!card) await BowlingCard.create({ innings_id: innings.id, player_id: data.current_bowler_id });
    patch.current_bowler_id = data.current_bowler_id;
  }

  await innings.update(patch);
  broadcastInBackground(match.share_token);
  audit(matchId, 'players_corrected', data);
  return innings;
}

export async function reviseTarget(matchId: number, target: number) {
  const match = await Match.findByPk(matchId);
  if (!match) throw new Error('Match not found');
  if (match.status !== 'live') throw new Error('Match is not live');
  if (!Number.isFinite(target) || target < 1) throw new Error('Target must be a positive number');

  const innings = await Innings.findOne({
    where: { match_id: matchId, status: 'live' },
    order: [['innings_number', 'DESC']],
  });
  if (!innings) throw new Error('No active innings');
  await innings.update({ target });
  broadcastInBackground(match.share_token);
  audit(matchId, 'target_revised', { target });
  return innings;
}

export async function addPenaltyRuns(matchId: number, runs: number, reason?: string) {
  const match = await Match.findByPk(matchId);
  if (!match) throw new Error('Match not found');
  if (match.status !== 'live') throw new Error('Match is not live');
  if (!Number.isFinite(runs) || runs < 1) throw new Error('Penalty runs must be positive');

  const innings = await Innings.findOne({
    where: { match_id: matchId, status: 'live' },
    order: [['innings_number', 'DESC']],
  });
  if (!innings) throw new Error('No active innings');
  const over = await Over.findOne({ where: { innings_id: innings.id, status: 'live' }, order: [['over_number', 'DESC']] });

  await Promise.all([
    innings.update({ total_runs: innings.total_runs + runs, extras: innings.extras + runs }),
    over ? over.update({ runs: over.runs + runs, extras: over.extras + runs }) : Promise.resolve(),
  ]);
  broadcastInBackground(match.share_token);
  audit(matchId, 'penalty_runs_added', { runs, reason });
  return innings;
}

export async function getAuditLogs(matchId: number) {
  return ScoreAuditLog.findAll({
    where: { match_id: matchId },
    order: [['created_at', 'DESC']],
    limit: 100,
  });
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

  broadcastInBackground(match.share_token);
  audit(matchId, 'innings_started', data);
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
  const isByeLike = lastBall.extra_type === 'bye' || lastBall.extra_type === 'leg_bye';
  const bowlerRunsThisBall = isByeLike ? (lastBall.is_noball ? 1 : 0) : runsThisBall;

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
      balls: battingCard.balls - (isLegal ? 1 : 0),
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
      runs: bowlingCard.runs - bowlerRunsThisBall,
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

  // Fire SSE broadcast in the background
  broadcastInBackground(match.share_token);
  audit(matchId, 'ball_undone', { ball_id: lastBall.id });
  return { undone: true };
}
