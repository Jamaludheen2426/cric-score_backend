import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

export interface InningsAttributes {
  id: number;
  match_id: number;
  batting_team_id: number;
  bowling_team_id: number;
  innings_number: number;
  total_runs: number;
  total_wickets: number;
  total_overs_bowled: number;
  extras: number;
  status: 'live' | 'completed';
  current_batsman1_id?: number;
  current_batsman2_id?: number;
  current_bowler_id?: number;
  on_strike_batsman_id?: number;
  target?: number;
}

export interface InningsCreationAttributes extends Optional<InningsAttributes, 'id' | 'total_runs' | 'total_wickets' | 'total_overs_bowled' | 'extras' | 'status'> {}

class Innings extends Model<InningsAttributes, InningsCreationAttributes> implements InningsAttributes {
  public id!: number;
  public match_id!: number;
  public batting_team_id!: number;
  public bowling_team_id!: number;
  public innings_number!: number;
  public total_runs!: number;
  public total_wickets!: number;
  public total_overs_bowled!: number;
  public extras!: number;
  public status!: 'live' | 'completed';
  public current_batsman1_id?: number;
  public current_batsman2_id?: number;
  public current_bowler_id?: number;
  public on_strike_batsman_id?: number;
  public target?: number;
}

Innings.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    match_id: { type: DataTypes.INTEGER, allowNull: false },
    batting_team_id: { type: DataTypes.INTEGER, allowNull: false },
    bowling_team_id: { type: DataTypes.INTEGER, allowNull: false },
    innings_number: { type: DataTypes.INTEGER, allowNull: false },
    total_runs: { type: DataTypes.INTEGER, defaultValue: 0 },
    total_wickets: { type: DataTypes.INTEGER, defaultValue: 0 },
    total_overs_bowled: { type: DataTypes.DECIMAL(5, 1), defaultValue: 0 },
    extras: { type: DataTypes.INTEGER, defaultValue: 0 },
    status: { type: DataTypes.ENUM('live', 'completed'), defaultValue: 'live' },
    current_batsman1_id: { type: DataTypes.INTEGER, allowNull: true },
    current_batsman2_id: { type: DataTypes.INTEGER, allowNull: true },
    current_bowler_id: { type: DataTypes.INTEGER, allowNull: true },
    on_strike_batsman_id: { type: DataTypes.INTEGER, allowNull: true },
    target: { type: DataTypes.INTEGER, allowNull: true },
  },
  {
    sequelize,
    tableName: 'innings',
    timestamps: false,
  }
);

export default Innings;
