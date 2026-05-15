import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

export interface MatchAttributes {
  id: number;
  title: string;
  team_a_id: number;
  team_b_id: number;
  total_overs: number;
  players_per_side: number;
  death_overs_from?: number;
  wide_rule: 'normal' | 'strict';
  status: 'pending' | 'live' | 'completed';
  toss_winner_team_id?: number;
  elected_to?: 'bat' | 'bowl';
  scorer_pin: string;
  share_token: string;
  created_at?: Date;
}

export interface MatchCreationAttributes extends Optional<MatchAttributes, 'id' | 'status'> {}

class Match extends Model<MatchAttributes, MatchCreationAttributes> implements MatchAttributes {
  public id!: number;
  public title!: string;
  public team_a_id!: number;
  public team_b_id!: number;
  public total_overs!: number;
  public players_per_side!: number;
  public death_overs_from?: number;
  public wide_rule!: 'normal' | 'strict';
  public status!: 'pending' | 'live' | 'completed';
  public toss_winner_team_id?: number;
  public elected_to?: 'bat' | 'bowl';
  public scorer_pin!: string;
  public share_token!: string;
  public created_at?: Date;
}

Match.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    title: { type: DataTypes.STRING(200), allowNull: false },
    team_a_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'teams', key: 'id' } },
    team_b_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'teams', key: 'id' } },
    total_overs: { type: DataTypes.INTEGER, allowNull: false },
    players_per_side: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 11 },
    death_overs_from: { type: DataTypes.INTEGER, allowNull: true },
    wide_rule: { type: DataTypes.ENUM('normal', 'strict'), defaultValue: 'normal' },
    status: { type: DataTypes.ENUM('pending', 'live', 'completed'), defaultValue: 'pending' },
    toss_winner_team_id: { type: DataTypes.INTEGER, allowNull: true },
    elected_to: { type: DataTypes.ENUM('bat', 'bowl'), allowNull: true },
    scorer_pin: { type: DataTypes.STRING(10), allowNull: false },
    share_token: { type: DataTypes.STRING(64), allowNull: false, unique: true },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    sequelize,
    tableName: 'matches',
    timestamps: false,
  }
);

export default Match;
