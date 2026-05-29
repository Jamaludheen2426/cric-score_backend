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
  wicket_type?: 'bowled' | 'caught' | 'lbw' | 'run_out' | 'stumped' | 'hit_wicket' | 'obstructing_field' | 'retired' | 'retired_hurt' | 'retired_out';
  dismissed_player_id?: number;
  extras: number;
  extra_type?: 'bye' | 'leg_bye' | 'wide' | 'no_ball';
  next_striker_id?: number;
  new_batsman_id?: number;
  is_free_hit: boolean;
}

export interface BallCreationAttributes extends Optional<BallAttributes, 'id' | 'is_wide' | 'is_noball' | 'is_wicket' | 'extras' | 'is_free_hit'> {}

class Ball extends Model<BallAttributes, BallCreationAttributes> implements BallAttributes {
  public id!: number;
  public over_id!: number;
  public ball_number!: number;
  public batsman_player_id!: number;
  public runs!: number;
  public is_wide!: boolean;
  public is_noball!: boolean;
  public is_wicket!: boolean;
  public wicket_type?: 'bowled' | 'caught' | 'lbw' | 'run_out' | 'stumped' | 'hit_wicket' | 'obstructing_field' | 'retired' | 'retired_hurt' | 'retired_out';
  public dismissed_player_id?: number;
  public extras!: number;
  public extra_type?: 'bye' | 'leg_bye' | 'wide' | 'no_ball';
  public next_striker_id?: number;
  public new_batsman_id?: number;
  public is_free_hit!: boolean;
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
      type: DataTypes.ENUM('bowled', 'caught', 'lbw', 'run_out', 'stumped', 'hit_wicket', 'obstructing_field', 'retired', 'retired_hurt', 'retired_out'),
      allowNull: true,
    },
    dismissed_player_id: { type: DataTypes.INTEGER, allowNull: true },
    extras: { type: DataTypes.INTEGER, defaultValue: 0 },
    extra_type: { type: DataTypes.ENUM('bye', 'leg_bye', 'wide', 'no_ball'), allowNull: true },
    next_striker_id: { type: DataTypes.INTEGER, allowNull: true },
    new_batsman_id: { type: DataTypes.INTEGER, allowNull: true },
    is_free_hit: { type: DataTypes.BOOLEAN, defaultValue: false },
  },
  {
    sequelize,
    tableName: 'balls',
    timestamps: false,
    indexes: [
      { fields: ['over_id'] },
      { fields: ['batsman_player_id'] },
      { fields: ['dismissed_player_id'] },
    ],
  }
);

export default Ball;
