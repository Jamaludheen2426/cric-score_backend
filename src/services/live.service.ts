import { Match, Innings, Over, Ball, BattingCard, BowlingCard, Player, Team } from '../models';

/**
 * Compute partnerships and fall-of-wickets for a single innings by
 * walking the ball-by-ball log in order.
 *
 * Partnerships:
 *   Every pair of batsmen at the crease accumulates runs together until a
 *   wicket separates them. The next partnership starts with the surviving
 *   batsman + whoever's next in the batting order (the card at the next
 *   batting_position slot).
 *
 * Fall of wickets:
 *   For each wicket ball, record the team score and over notation at the
 *   moment the wicket fell, plus who got out.
 */
function computeNarratives(innings: any, ballRows: any[]) {
  const sortedCards = (innings.battingCards || [])
    .slice()
    .sort((a: any, b: any) => a.batting_position - b.batting_position);
  const playerName = (id?: number | null) =>
    sortedCards.find((c: any) => c.player_id === id)?.player?.name || '';

  // Opening pair = positions 1 and 2 from batting cards.
  let strikerId = sortedCards[0]?.player_id ?? innings.current_batsman1_id;
  let nonStrikerId = sortedCards[1]?.player_id ?? innings.current_batsman2_id;
  let nextSlot = 2; // next batting_position to assign on a wicket

  let runningRuns = 0;
  let runningLegalBalls = 0;

  let partnerRuns = 0;
  let partnerBalls = 0;
  let partnerWicketIndex = 1; // this partnership is BEFORE wicket #N

  const partnerships: any[] = [];
  const fallOfWickets: any[] = [];

  const oversNotation = () => {
    const ov = Math.floor(runningLegalBalls / 6);
    const b = runningLegalBalls % 6;
    return `${ov}.${b}`;
  };

  for (const ball of ballRows) {
    const ballRuns = ball.runs + ball.extras;
    runningRuns += ballRuns;
    partnerRuns += ballRuns;
    if (!ball.is_wide && !ball.is_noball) {
      runningLegalBalls += 1;
      partnerBalls += 1;
    }
    if (ball.is_wicket) {
      const dismissedId = ball.dismissed_player_id || ball.batsman_player_id;
      fallOfWickets.push({
        wicket_number: fallOfWickets.length + 1,
        score: runningRuns,
        overs: oversNotation(),
        dismissed_player_id: dismissedId,
        dismissed_player_name: playerName(dismissedId),
        wicket_type: ball.wicket_type || null,
      });
      partnerships.push({
        wicket_number: partnerWicketIndex,
        batsman1_id: strikerId,
        batsman2_id: nonStrikerId,
        batsman1_name: playerName(strikerId),
        batsman2_name: playerName(nonStrikerId),
        runs: partnerRuns,
        balls: partnerBalls,
        ended: true,
      });

      // Start new partnership: surviving batsman + next batsman in order
      const survivingId = strikerId === dismissedId ? nonStrikerId : strikerId;
      const nextCard = sortedCards[nextSlot];
      nextSlot += 1;
      strikerId = survivingId;
      nonStrikerId = nextCard?.player_id ?? null;
      partnerRuns = 0;
      partnerBalls = 0;
      partnerWicketIndex += 1;
    }
  }

  // Add the current/last (still-going) partnership if it scored anything
  // OR if no wickets have fallen yet (the opening partnership counts even
  // at 0/0).
  if (partnerships.length === 0 || partnerRuns > 0 || partnerBalls > 0) {
    partnerships.push({
      wicket_number: partnerWicketIndex,
      batsman1_id: strikerId,
      batsman2_id: nonStrikerId,
      batsman1_name: playerName(strikerId),
      batsman2_name: playerName(nonStrikerId),
      runs: partnerRuns,
      balls: partnerBalls,
      ended: false,
    });
  }

  return { partnerships, fallOfWickets };
}

export async function getLiveScore(shareToken: string) {
  const match = await Match.findOne({
    where: { share_token: shareToken },
    include: [
      { model: Team, as: 'teamA' },
      { model: Team, as: 'teamB' },
    ],
  });

  if (!match) throw new Error('Match not found');

  const allInnings = await Innings.findAll({
    where: { match_id: match.id },
    include: [
      { model: Team, as: 'battingTeam' },
      { model: Team, as: 'bowlingTeam' },
      { model: Player, as: 'batsman1' },
      { model: Player, as: 'batsman2' },
      { model: Player, as: 'currentBowler' },
      { model: Player, as: 'onStrike' },
      {
        model: BattingCard,
        as: 'battingCards',
        include: [
          { model: Player, as: 'player' },
          { model: Player, as: 'bowler' },
        ],
      },
      {
        model: BowlingCard,
        as: 'bowlingCards',
        include: [{ model: Player, as: 'player' }],
      },
    ],
    order: [['innings_number', 'ASC']],
  });

  const currentInnings = allInnings.find(i => i.status === 'live');

  // One shot: pull every ball for every innings of this match, ordered.
  // Used to compute partnerships and fall-of-wickets per innings without
  // additional N+1 trips. ~120-260 rows per innings even at 50 overs.
  const inningsIds = allInnings.map(i => i.id);
  const allBallRows = inningsIds.length > 0 ? await Ball.findAll({
    attributes: ['id', 'over_id', 'ball_number', 'batsman_player_id', 'runs', 'is_wide', 'is_noball', 'is_wicket', 'wicket_type', 'dismissed_player_id', 'extras'],
    include: [{
      model: Over,
      as: 'over',
      attributes: ['id', 'innings_id', 'over_number', 'bowler_player_id'],
      where: { innings_id: inningsIds },
    }],
    order: [
      [{ model: Over, as: 'over' }, 'innings_id',  'ASC'],
      [{ model: Over, as: 'over' }, 'over_number', 'ASC'],
      ['ball_number', 'ASC'],
    ],
  }) : [];

  const ballsByInnings = new Map<number, any[]>();
  for (const b of allBallRows as any[]) {
    const innId = b.over?.innings_id;
    if (!innId) continue;
    const arr = ballsByInnings.get(innId) || [];
    arr.push(b);
    ballsByInnings.set(innId, arr);
  }

  const narrativesByInnings = new Map<number, { partnerships: any[]; fallOfWickets: any[] }>();
  // Per-bowler wides and no-balls conceded — derived from the ball log so we
  // don't have to add columns to bowling_cards. Keyed by `${inningsId}:${bowlerPlayerId}`.
  const bowlerExtras = new Map<string, { wides: number; noballs: number }>();
  for (const inn of allInnings) {
    const balls = ballsByInnings.get(inn.id) || [];
    narrativesByInnings.set(inn.id, computeNarratives(inn, balls));
    for (const b of balls as any[]) {
      if (!b.is_wide && !b.is_noball) continue;
      const bowlerId = b.over?.bowler_player_id;
      if (!bowlerId) continue;
      const key = `${inn.id}:${bowlerId}`;
      const cur = bowlerExtras.get(key) || { wides: 0, noballs: 0 };
      if (b.is_wide)   cur.wides   += 1;
      if (b.is_noball) cur.noballs += 1;
      bowlerExtras.set(key, cur);
    }
  }

  // Current over balls
  let currentOverBalls: any[] = [];
  let currentOver: any = null;

  if (currentInnings) {
    currentOver = await Over.findOne({
      where: { innings_id: currentInnings.id, status: 'live' },
      include: [{ model: Player, as: 'bowler' }],
      order: [['over_number', 'DESC']],
    });

    if (currentOver) {
      const balls = await Ball.findAll({
        where: { over_id: currentOver.id },
        include: [{ model: Player, as: 'batsman' }],
        order: [['ball_number', 'ASC']],
      });
      currentOverBalls = balls.map(b => ({
        runs: b.runs,
        is_wide: b.is_wide,
        is_noball: b.is_noball,
        is_wicket: b.is_wicket,
        wicket_type: b.wicket_type,
        extras: b.extras,
        batsman: (b as any).batsman?.name,
      }));
    }
  }

  // Recent balls (last 12 legal balls across overs)
  let recentBalls: any[] = [];
  if (currentInnings) {
    const recentOvers = await Over.findAll({
      where: { innings_id: currentInnings.id },
      order: [['over_number', 'DESC']],
      limit: 3,
    });
    for (const o of recentOvers) {
      const balls = await Ball.findAll({ where: { over_id: o.id }, order: [['ball_number', 'DESC']], limit: 6 });
      recentBalls.push(...balls.map(b => ({
        runs: b.runs,
        is_wide: b.is_wide,
        is_noball: b.is_noball,
        is_wicket: b.is_wicket,
        extras: b.extras,
      })));
    }
    recentBalls = recentBalls.slice(0, 12).reverse();
  }

  // Run rate calculations
  let runRate = 0;
  let requiredRate: number | null = null;
  let runsNeeded: number | null = null;
  let ballsLeft: number | null = null;

  if (currentInnings) {
    const oversFloat = currentInnings.total_overs_bowled;
    const fullOvers = Math.floor(oversFloat);
    const partialBalls = Math.round((oversFloat - fullOvers) * 10);
    const totalBalls = fullOvers * 6 + partialBalls;
    runRate = totalBalls > 0 ? (currentInnings.total_runs / totalBalls) * 6 : 0;

    if (currentInnings.target && currentInnings.innings_number === 2) {
      runsNeeded = Math.max(0, currentInnings.target - currentInnings.total_runs);
      const totalMatchBalls = match.total_overs * 6;
      const ballsUsed = totalBalls;
      ballsLeft = Math.max(0, totalMatchBalls - ballsUsed);
      requiredRate = ballsLeft > 0 ? (runsNeeded / ballsLeft) * 6 : 0;
    }
  }

  return {
    match: {
      id: match.id,
      title: match.title,
      status: match.status,
      total_overs: match.total_overs,
      players_per_side: match.players_per_side,
      death_overs_from: match.death_overs_from,
      wide_rule: match.wide_rule,
      share_token: match.share_token,
      teamA: (match as any).teamA,
      teamB: (match as any).teamB,
    },
    innings: allInnings.map(inn => {
      const narr = narrativesByInnings.get(inn.id) || { partnerships: [], fallOfWickets: [] };
      // Decorate each bowling card with wides + noballs conceded from the ball log
      const decoratedBowling = ((inn as any).bowlingCards || []).map((bc: any) => {
        const e = bowlerExtras.get(`${inn.id}:${bc.player_id}`) || { wides: 0, noballs: 0 };
        const plain = typeof bc.toJSON === 'function' ? bc.toJSON() : bc;
        return { ...plain, wides: e.wides, noballs: e.noballs };
      });
      return {
        id: inn.id,
        innings_number: inn.innings_number,
        status: inn.status,
        batting_team_id: inn.batting_team_id,
        bowling_team_id: inn.bowling_team_id,
        battingTeam: (inn as any).battingTeam,
        bowlingTeam: (inn as any).bowlingTeam,
        total_runs: inn.total_runs,
        total_wickets: inn.total_wickets,
        total_overs_bowled: inn.total_overs_bowled,
        extras: inn.extras,
        target: inn.target,
        current_batsman1_id: inn.current_batsman1_id,
        current_batsman2_id: inn.current_batsman2_id,
        current_bowler_id: inn.current_bowler_id,
        on_strike_batsman_id: inn.on_strike_batsman_id,
        batsman1: (inn as any).batsman1,
        batsman2: (inn as any).batsman2,
        currentBowler: (inn as any).currentBowler,
        onStrike: (inn as any).onStrike,
        battingCards: (inn as any).battingCards,
        bowlingCards: decoratedBowling,
        partnerships: narr.partnerships,
        fallOfWickets: narr.fallOfWickets,
        run_rate: inn === currentInnings ? runRate : null,
        required_rate: inn === currentInnings ? requiredRate : null,
        runs_needed: inn === currentInnings ? runsNeeded : null,
        balls_left: inn === currentInnings ? ballsLeft : null,
      };
    }),
    currentOver: currentOver ? {
      id: currentOver.id,
      over_number: currentOver.over_number,
      bowler: (currentOver as any).bowler,
      runs: currentOver.runs,
      wickets: currentOver.wickets,
      legal_balls: currentOver.legal_balls,
    } : null,
    currentOverBalls,
    recentBalls,
  };
}
