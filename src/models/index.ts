import sequelize from '../config/database';
import Team from './Team';
import Player from './Player';
import Match from './Match';
import MatchSession from './MatchSession';
import Innings from './Innings';
import Over from './Over';
import Ball from './Ball';
import BattingCard from './BattingCard';
import BowlingCard from './BowlingCard';

// Team → Players
Team.hasMany(Player, { foreignKey: 'team_id', as: 'players' });
Player.belongsTo(Team, { foreignKey: 'team_id', as: 'team' });

// Match → Teams
Match.belongsTo(Team, { foreignKey: 'team_a_id', as: 'teamA' });
Match.belongsTo(Team, { foreignKey: 'team_b_id', as: 'teamB' });

// Match → Sessions
Match.hasMany(MatchSession, { foreignKey: 'match_id', as: 'sessions' });
MatchSession.belongsTo(Match, { foreignKey: 'match_id', as: 'match' });

// Match → Innings
Match.hasMany(Innings, { foreignKey: 'match_id', as: 'innings' });
Innings.belongsTo(Match, { foreignKey: 'match_id', as: 'match' });

// Innings → Teams
Innings.belongsTo(Team, { foreignKey: 'batting_team_id', as: 'battingTeam' });
Innings.belongsTo(Team, { foreignKey: 'bowling_team_id', as: 'bowlingTeam' });

// Innings → Players (current)
Innings.belongsTo(Player, { foreignKey: 'current_batsman1_id', as: 'batsman1' });
Innings.belongsTo(Player, { foreignKey: 'current_batsman2_id', as: 'batsman2' });
Innings.belongsTo(Player, { foreignKey: 'current_bowler_id', as: 'currentBowler' });
Innings.belongsTo(Player, { foreignKey: 'on_strike_batsman_id', as: 'onStrike' });

// Innings → Overs
Innings.hasMany(Over, { foreignKey: 'innings_id', as: 'overs' });
Over.belongsTo(Innings, { foreignKey: 'innings_id', as: 'innings' });

// Over → Player (bowler)
Over.belongsTo(Player, { foreignKey: 'bowler_player_id', as: 'bowler' });

// Over → Balls
Over.hasMany(Ball, { foreignKey: 'over_id', as: 'balls' });
Ball.belongsTo(Over, { foreignKey: 'over_id', as: 'over' });

// Ball → Players
Ball.belongsTo(Player, { foreignKey: 'batsman_player_id', as: 'batsman' });
Ball.belongsTo(Player, { foreignKey: 'dismissed_player_id', as: 'dismissedPlayer' });

// Innings → BattingCards
Innings.hasMany(BattingCard, { foreignKey: 'innings_id', as: 'battingCards' });
BattingCard.belongsTo(Innings, { foreignKey: 'innings_id', as: 'innings' });

// BattingCard → Players
BattingCard.belongsTo(Player, { foreignKey: 'player_id', as: 'player' });
BattingCard.belongsTo(Player, { foreignKey: 'bowler_id', as: 'bowler' });

// Innings → BowlingCards
Innings.hasMany(BowlingCard, { foreignKey: 'innings_id', as: 'bowlingCards' });
BowlingCard.belongsTo(Innings, { foreignKey: 'innings_id', as: 'innings' });

// BowlingCard → Player
BowlingCard.belongsTo(Player, { foreignKey: 'player_id', as: 'player' });

export {
  sequelize,
  Team,
  Player,
  Match,
  MatchSession,
  Innings,
  Over,
  Ball,
  BattingCard,
  BowlingCard,
};
