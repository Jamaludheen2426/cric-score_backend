import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

export interface BallAttributes {
  id: number;
  over_id: number;
  ball_number: number;
  batsman_player_id: number;
  runs: number;
  is_wide: boolean;
  is_noball: boolean;
  is_wicket: boolean;
  wicket_type?: 'bowled' | 'caught' | 'lbw' | 'run_out' | 'stumped' | 'hit_wicket' | 'obstructing_field' | 'retired';
  dismissed_player_id?: number;
  extras: number;
}

export interface BallCreationAttributes extends Optional<BallAttributes, 'id' | 'is_wide' | 'is_noball' | 'is_wicket' | 'extras'> {}

class Ball extends Model<BallAttributes, BallCreationAttributes> implements BallAttributes {
  public id!: number;
  public over_id!: number;
  public ball_number!: number;
  public batsman_player_id!: number;
  public runs!: number;
  public is_wide!: boolean;
  public is_noball!: boolean;
  public is_wicket!: boolean;
  public wicket_type?: 'bowled' | 'caught' | 'lbw' | 'run_out' | 'stumped' | 'hit_wicket' | 'obstructing_field' | 'retired';
  public dismissed_player_id?: number;
  public extras!: number;
}

Ball.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    over_id: { type: DataTypes.INTEGER, allowNull: false },
    ball_number: { type: DataTypes.INTEGER, allowNull: false },
    batsman_player_id: { type: DataTypes.INTEGER, allowNull: false },
    runs: { type: DataTypes.INTEGER, defaultValue: 0 },
    is_wide: { type: DataTypes.BOOLEAN, defaultValue: false },
    is_noball: { type: DataTypes.BOOLEAN, defaultValue: false },
    is_wicket: { type: DataTypes.BOOLEAN, defaultValue: false },
    wicket_type: {
      type: DataTypes.ENUM('bowled', 'caught', 'lbw', 'run_out', 'stumped', 'hit_wicket', 'obstructing_field', 'retired'),
      allowNull: true,
    },
    dismissed_player_id: { type: DataTypes.INTEGER, allowNull: true },
    extras: { type: DataTypes.INTEGER, defaultValue: 0 },
  },
  {
    sequelize,
    tableName: 'balls',
    timestamps: false,
  }
);

export default Ball;
