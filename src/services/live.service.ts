import { Match, Innings, Over, Ball, BattingCard, BowlingCard, Player, Team } from '../models';

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
    innings: allInnings.map(inn => ({
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
      bowlingCards: (inn as any).bowlingCards,
      run_rate: inn === currentInnings ? runRate : null,
      required_rate: inn === currentInnings ? requiredRate : null,
      runs_needed: inn === currentInnings ? runsNeeded : null,
      balls_left: inn === currentInnings ? ballsLeft : null,
    })),
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
