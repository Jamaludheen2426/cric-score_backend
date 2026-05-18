import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

export interface OverAttributes {
  id: number;
  innings_id: number;
  over_number: number;
  bowler_player_id: number;
  runs: number;
  wickets: number;
  extras: number;
  status: 'pending' | 'live' | 'completed';
  legal_balls: number;
}

export interface OverCreationAttributes extends Optional<OverAttributes, 'id' | 'runs' | 'wickets' | 'extras' | 'status' | 'legal_balls'> {}

class Over extends Model<OverAttributes, OverCreationAttributes> implements OverAttributes {
  public id!: number;
  public innings_id!: number;
  public over_number!: number;
  public bowler_player_id!: number;
  public runs!: number;
  public wickets!: number;
  public extras!: number;
  public status!: 'pending' | 'live' | 'completed';
  public legal_balls!: number;
}

Over.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    innings_id: { type: DataTypes.INTEGER, allowNull: false },
    over_number: { type: DataTypes.INTEGER, allowNull: false },
    bowler_player_id: { type: DataTypes.INTEGER, allowNull: false },
    runs: { type: DataTypes.INTEGER, defaultValue: 0 },
    wickets: { type: DataTypes.INTEGER, defaultValue: 0 },
    extras: { type: DataTypes.INTEGER, defaultValue: 0 },
    legal_balls: { type: DataTypes.INTEGER, defaultValue: 0 },
    status: { type: DataTypes.ENUM('pending', 'live', 'completed'), defaultValue: 'live' },
  },
  {
    sequelize,
    tableName: 'overs',
    timestamps: false,
    indexes: [
      { fields: ['innings_id'] },
      { fields: ['bowler_player_id'] },
    ],
  }
);

export default Over;
