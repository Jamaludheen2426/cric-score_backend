/**
 * Fast-path addBall using raw multi-statement SQL.
 *
 * The Sequelize version (scoring.service.ts) needs ~6 sequential network
 * round-trips Render → Aiven, even with Promise.all batches, because each
 * batch has to await before the next can read its dependencies.
 *
 * This version collapses everything into TWO round-trips:
 *   1. ONE multi-statement read packet returns match + innings + over +
 *      cards + counts (chained via MySQL session variables).
 *   2. ONE multi-statement transaction packet writes ball + 4-6 updates.
 *
 * If anything end-of-innings-y happens (all out / overs done / target hit),
 * we delegate the close + broadcast to the existing Sequelize helpers —
 * those run once per innings, not per ball, so they aren't on the hot path.
 *
 * Same external signature, same return shape as scoring.service.addBall.
 */

import { rawPool } from '../config/db-raw';
import { Match, Innings, Over } from '../models';
import { broadcastToMatch } from '../middleware/sse';
import { getLiveScore } from './live.service';

export interface BallInput {
  runs: number;
  is_wide?: boolean;
  is_noball?: boolean;
  is_wicket?: boolean;
  wicket_type?: string;
  dismissed_player_id?: number;
  new_batsman_id?: number;
  extras?: number;
}

const WICKET_TYPES_ALLOWED_ON_NO_BALL = new Set(['run_out', 'obstructing_field', 'retired']);

function broadcastInBackground(shareToken: string) {
  setImmediate(async () => {
    try {
      const liveScore = await getLiveScore(shareToken);
      broadcastToMatch(shareToken, liveScore);
    } catch (err) {
      console.error('[sse] background broadcast failed:', (err as Error)?.message);
    }
  });
}

async function completeInningsFallback(matchId: number, inningsId: number, overId: number, isSecondInnings: boolean) {
  // One-off path — not on the per-ball hot path. Use Sequelize for clarity.
  const [match, innings, over] = await Promise.all([
    Match.findByPk(matchId),
    Innings.findByPk(inningsId),
    Over.findByPk(overId),
  ]);
  if (!match || !innings || !over) return;
  await Promise.all([
    innings.update({ status: 'completed' }),
    over.update({ status: 'completed' }),
    isSecondInnings ? match.update({ status: 'completed' }) : Promise.resolve(),
  ]);
  broadcastInBackground(match.share_token);
}

export async function addBall(matchId: number, input: BallInput) {
  const conn = await rawPool.getConnection();
  try {
    // ── ROUND-TRIP 1 ── Bulk read everything in one packet using session vars ──
    // The SETs run first inside MySQL, then the SELECTs can reference @innings_id
    // and @over_id without us having to make a second trip.
    const readSql = `
      SET @innings_id := (SELECT id FROM innings WHERE match_id = ? AND status = 'live' ORDER BY innings_number DESC LIMIT 1);
      SET @over_id    := (SELECT id FROM overs   WHERE innings_id = @innings_id AND status = 'live' ORDER BY over_number DESC LIMIT 1);
      SELECT id, status, total_overs, players_per_side, wide_rule, death_overs_from, share_token, team_a_id, team_b_id
        FROM matches WHERE id = ?;
      SELECT id, batting_team_id, bowling_team_id, innings_number, status, total_runs, total_wickets,
             total_overs_bowled, extras, target, current_batsman1_id, current_batsman2_id,
             current_bowler_id, on_strike_batsman_id
        FROM innings WHERE id = @innings_id;
      SELECT id, status, runs, wickets, extras, legal_balls, over_number, bowler_player_id
        FROM overs   WHERE id = @over_id;
      SELECT id, runs, balls, fours, sixes, is_out, bowler_id, dismissal_type
        FROM batting_cards
        WHERE innings_id = @innings_id
          AND player_id  = (SELECT on_strike_batsman_id FROM innings WHERE id = @innings_id);
      SELECT id, runs, wickets, extras, legal_balls
        FROM bowling_cards
        WHERE innings_id = @innings_id
          AND player_id  = (SELECT bowler_player_id FROM overs WHERE id = @over_id);
      SELECT COUNT(*) AS cnt FROM balls          WHERE over_id    = @over_id;
      SELECT COUNT(*) AS cnt FROM batting_cards  WHERE innings_id = @innings_id;
      SELECT COUNT(*) AS cnt FROM players
        WHERE team_id = (SELECT batting_team_id FROM innings WHERE id = @innings_id);
      SELECT id, is_out FROM batting_cards
        WHERE innings_id = @innings_id AND player_id = ?;
    `;
    const [results] = await conn.query(readSql, [
      matchId,
      matchId,
      input.dismissed_player_id ?? 0,   // for the non-striker card lookup (matches nothing if 0)
    ]);

    // mysql2 returns an array of result sets in the same order as the statements.
    // SET statements return OkPackets (objects, not arrays), SELECTs return row arrays.
    const sets = (results as any[]).filter(r => Array.isArray(r));
    const [
      matchRows,
      inningsRows,
      overRows,
      strikerCardRows,
      bowlingCardRows,
      ballCountRows,
      battingCardCountRows,
      playerCountRows,
      nonStrikerCardRows,
    ] = sets;

    const match     = matchRows?.[0];
    const innings   = inningsRows?.[0];
    const over      = overRows?.[0];
    const strikerCard  = strikerCardRows?.[0];
    const bowlingCard  = bowlingCardRows?.[0];
    const existingBalls       = ballCountRows?.[0]?.cnt ?? 0;
    const battingCardCount    = battingCardCountRows?.[0]?.cnt ?? 0;
    const rosterCount         = playerCountRows?.[0]?.cnt ?? 0;
    const nonStrikerCard      = nonStrikerCardRows?.[0];

    if (!match)   throw new Error('Match not found');
    if (match.status !== 'live') throw new Error('Match is not live');
    if (!innings) throw new Error('No active innings');
    if (!over)    throw new Error('No active over');

    // ── Validation + computation (pure JS, no DB) ────────────────────────
    const strikerId = innings.on_strike_batsman_id;
    if (strikerCard?.is_out) {
      // Defensive: striker already retired/out. Close innings via Sequelize fallback.
      await completeInningsFallback(matchId, innings.id, over.id, innings.innings_number === 2);
      return {
        allOut: true,
        matchEnded: innings.innings_number === 2,
      };
    }

    const countsAsWicket = input.is_wicket
      ? (!input.is_noball || WICKET_TYPES_ALLOWED_ON_NO_BALL.has(input.wicket_type || ''))
      : false;
    if (input.is_wicket && !countsAsWicket) {
      throw new Error('This wicket type is not valid on a no-ball');
    }

    const configuredCount = Number(match.players_per_side) || rosterCount || 11;
    const maxBatters = Math.max(1, Math.min(configuredCount, rosterCount || configuredCount));
    const wicketsAfterThisBall = innings.total_wickets + (countsAsWicket ? 1 : 0);
    const noReplacementAvailable = countsAsWicket && !input.new_batsman_id && (
      wicketsAfterThisBall >= maxBatters - 1 || battingCardCount >= maxBatters
    );
    if (countsAsWicket && !input.new_batsman_id && !noReplacementAvailable) {
      throw new Error('New batsman is required before scoring the next ball');
    }

    const isLegal = !input.is_wide && !input.is_noball;
    const inDeath = match.death_overs_from != null && over.over_number >= match.death_overs_from;
    // Local-tournament wide rule:
    //   • Normal over wide: NO penalty run, just re-bowled (ball not counted).
    //   • Death over wide:  +1 penalty + re-bowled.
    //   • Strict (T20):     +1 penalty + re-bowled (regardless of death).
    // Running runs on a wide always count.
    const widePenalty = input.is_wide && (inDeath || match.wide_rule === 'strict') ? 1 : 0;
    const noBallPenalty = input.is_noball ? 1 : 0;
    const ballExtras = widePenalty + noBallPenalty;
    const batRuns = input.is_wide ? 0 : input.runs;
    const totalExtras = input.is_wide
      ? input.runs + widePenalty                    // running on the wide + the (sometimes zero) wide penalty
      : (input.extras || 0) + ballExtras;
    const runsThisBall = batRuns + totalExtras;
    const ball_number = existingBalls + 1;

    const isStrikerOut = countsAsWicket && (input.dismissed_player_id === strikerId || !input.dismissed_player_id);
    const isNonStrikerOut = countsAsWicket && input.dismissed_player_id && input.dismissed_player_id !== strikerId;

    // New aggregate totals
    const newOverRuns    = over.runs        + runsThisBall;
    const newOverWickets = over.wickets     + (countsAsWicket ? 1 : 0);
    const newOverExtras  = over.extras      + totalExtras;
    const newOverLegal   = over.legal_balls + (isLegal ? 1 : 0);

    const newInnRuns     = innings.total_runs    + runsThisBall;
    const newInnWickets  = innings.total_wickets + (countsAsWicket ? 1 : 0);
    const newInnExtras   = innings.extras        + totalExtras;
    const totalLegalBalls = (over.over_number - 1) * 6 + newOverLegal;
    const newInnOversBowled = Math.floor(totalLegalBalls / 6) + (totalLegalBalls % 6) / 10;

    // Strike rotation — only on legal, non-wicket, odd-runs deliveries.
    let newOnStrike = innings.on_strike_batsman_id;
    if (isLegal && !countsAsWicket && batRuns % 2 === 1) {
      newOnStrike = newOnStrike === innings.current_batsman1_id
        ? innings.current_batsman2_id
        : innings.current_batsman1_id;
    }

    // Striker card update
    const sc = strikerCard;
    const newStrikerRuns  = sc ? sc.runs  + batRuns                                : 0;
    const newStrikerBalls = sc ? sc.balls + (isLegal ? 1 : 0)                      : 0;
    const newStrikerFours = sc ? sc.fours + (batRuns === 4 ? 1 : 0)                : 0;
    const newStrikerSixes = sc ? sc.sixes + (batRuns === 6 ? 1 : 0)                : 0;
    const newStrikerIsOut = isStrikerOut ? 1 : (sc?.is_out ? 1 : 0);
    const newStrikerDism  = isStrikerOut ? (input.wicket_type || null) : (sc?.dismissal_type ?? null);
    const newStrikerBwlr  = isStrikerOut ? over.bowler_player_id       : (sc?.bowler_id      ?? null);

    // Bowling card update
    const bc = bowlingCard;
    const newBwlRuns    = bc ? bc.runs        + runsThisBall                                         : 0;
    const newBwlWickets = bc ? bc.wickets     + (countsAsWicket && input.wicket_type !== 'run_out' ? 1 : 0) : 0;
    const newBwlExtras  = bc ? bc.extras      + totalExtras                                          : 0;
    const newBwlLegal   = bc ? bc.legal_balls + (isLegal ? 1 : 0)                                    : 0;
    const newBwlOvers   = Math.floor(newBwlLegal / 6) + (newBwlLegal % 6) / 10;

    // New-batsman handling — figure out which slot the dismissed player held.
    let inningsBatsman1 = innings.current_batsman1_id;
    let inningsBatsman2 = innings.current_batsman2_id;
    let inningsOnStrike = newOnStrike;
    if (countsAsWicket && input.new_batsman_id) {
      if (battingCardCount >= maxBatters) {
        throw new Error('No batting slots remain for a new batsman');
      }
      const dismissedId = input.dismissed_player_id || strikerId;
      const isInSlot1 = dismissedId === innings.current_batsman1_id;
      if (isInSlot1) {
        inningsBatsman1 = input.new_batsman_id;
        if (dismissedId === innings.on_strike_batsman_id) inningsOnStrike = input.new_batsman_id;
      } else {
        inningsBatsman2 = input.new_batsman_id;
        if (dismissedId === innings.on_strike_batsman_id) inningsOnStrike = input.new_batsman_id;
      }
    }

    // ── ROUND-TRIP 2 ── One transaction packet with all writes ──────────
    // Build the SQL dynamically — some statements are conditional.
    const writes: string[] = [];
    const params: any[] = [];

    writes.push('START TRANSACTION');

    writes.push(
      `INSERT INTO balls
        (over_id, ball_number, batsman_player_id, runs, is_wide, is_noball, is_wicket, wicket_type, dismissed_player_id, extras)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    params.push(
      over.id, ball_number, strikerId, batRuns,
      input.is_wide ? 1 : 0,
      input.is_noball ? 1 : 0,
      countsAsWicket ? 1 : 0,
      input.wicket_type || null,
      input.dismissed_player_id ?? null,
      totalExtras,
    );

    writes.push(`UPDATE overs SET runs = ?, wickets = ?, extras = ?, legal_balls = ? WHERE id = ?`);
    params.push(newOverRuns, newOverWickets, newOverExtras, newOverLegal, over.id);

    writes.push(`UPDATE innings SET total_runs = ?, total_wickets = ?, extras = ?, total_overs_bowled = ?, on_strike_batsman_id = ?, current_batsman1_id = ?, current_batsman2_id = ? WHERE id = ?`);
    params.push(newInnRuns, newInnWickets, newInnExtras, newInnOversBowled, inningsOnStrike, inningsBatsman1, inningsBatsman2, innings.id);

    if (sc) {
      writes.push(`UPDATE batting_cards SET runs = ?, balls = ?, fours = ?, sixes = ?, is_out = ?, dismissal_type = ?, bowler_id = ? WHERE id = ?`);
      params.push(newStrikerRuns, newStrikerBalls, newStrikerFours, newStrikerSixes, newStrikerIsOut, newStrikerDism, newStrikerBwlr, sc.id);
    }
    if (bc) {
      writes.push(`UPDATE bowling_cards SET runs = ?, wickets = ?, extras = ?, legal_balls = ?, overs = ? WHERE id = ?`);
      params.push(newBwlRuns, newBwlWickets, newBwlExtras, newBwlLegal, newBwlOvers, bc.id);
    }
    if (isNonStrikerOut && nonStrikerCard) {
      writes.push(`UPDATE batting_cards SET is_out = TRUE, dismissal_type = 'run_out' WHERE id = ?`);
      params.push(nonStrikerCard.id);
    }
    if (countsAsWicket && input.new_batsman_id) {
      writes.push(`INSERT INTO batting_cards (innings_id, player_id, batting_position) VALUES (?, ?, ?)`);
      params.push(innings.id, input.new_batsman_id, battingCardCount + 1);
    }

    writes.push('COMMIT');
    const writeSql = writes.join(';\n') + ';';

    let ballInsertId: number;
    try {
      const [writeResults] = await conn.query(writeSql, params);
      // The first OK packet after START TRANSACTION is the INSERT into balls.
      const okPackets = (writeResults as any[]).filter(r => !Array.isArray(r) && 'affectedRows' in r);
      ballInsertId = okPackets[1]?.insertId; // 0=START, 1=INSERT
    } catch (err) {
      try { await conn.query('ROLLBACK'); } catch {}
      throw err;
    }

    // ── End-of-innings checks (data already mutated above) ────────────────
    const allOut = Boolean(countsAsWicket && !input.new_batsman_id && noReplacementAvailable);
    const oversFinished = newInnOversBowled >= match.total_overs;
    const targetReached = innings.innings_number === 2 && innings.target != null && newInnRuns >= innings.target;

    if (allOut || oversFinished || targetReached) {
      await completeInningsFallback(matchId, innings.id, over.id, innings.innings_number === 2);
      return {
        ball: { id: ballInsertId, runs: batRuns, is_wide: !!input.is_wide, is_noball: !!input.is_noball, is_wicket: countsAsWicket, extras: totalExtras },
        allOut,
        oversFinished,
        targetReached,
        matchEnded: innings.innings_number === 2,
      };
    }

    broadcastInBackground(match.share_token);

    return {
      ball: { id: ballInsertId, runs: batRuns, is_wide: !!input.is_wide, is_noball: !!input.is_noball, is_wicket: countsAsWicket, extras: totalExtras },
    };
  } finally {
    conn.release();
  }
}
