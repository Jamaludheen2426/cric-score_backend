import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

export interface TournamentAttributes {
  id: number;
  name: string;
  format: 'league' | 'knockout';
  total_overs: number;
  players_per_side: number;
  death_overs_from?: number;
  wide_rule: 'normal' | 'strict';
  scorer_pin: string;
  status: 'upcoming' | 'live' | 'completed';
  created_at?: Date;
}

export interface TournamentCreationAttributes extends Optional<TournamentAttributes, 'id' | 'status'> {}

class Tournament extends Model<TournamentAttributes, TournamentCreationAttributes> implements TournamentAttributes {
  public id!: number;
  public name!: string;
  public format!: 'league' | 'knockout';
  public total_overs!: number;
  public players_per_side!: number;
  public death_overs_from?: number;
  public wide_rule!: 'normal' | 'strict';
  public scorer_pin!: string;
  public status!: 'upcoming' | 'live' | 'completed';
  public created_at?: Date;
}

Tournament.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING(200), allowNull: false },
    format: { type: DataTypes.ENUM('league', 'knockout'), defaultValue: 'league' },
    total_overs: { type: DataTypes.INTEGER, allowNull: false },
    players_per_side: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 11 },
    death_overs_from: { type: DataTypes.INTEGER, allowNull: true },
    wide_rule: { type: DataTypes.ENUM('normal', 'strict'), defaultValue: 'normal' },
    scorer_pin: { type: DataTypes.STRING(10), allowNull: false },
    status: { type: DataTypes.ENUM('upcoming', 'live', 'completed'), defaultValue: 'upcoming' },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    sequelize,
    tableName: 'tournaments',
    timestamps: false,
    indexes: [{ fields: ['status'] }],
  }
);

export default Tournament;
