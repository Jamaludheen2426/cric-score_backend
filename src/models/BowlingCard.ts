import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

export interface BowlingCardAttributes {
  id: number;
  innings_id: number;
  player_id: number;
  overs: number;
  runs: number;
  wickets: number;
  extras: number;
  legal_balls: number;
}

export interface BowlingCardCreationAttributes extends Optional<BowlingCardAttributes, 'id' | 'overs' | 'runs' | 'wickets' | 'extras' | 'legal_balls'> {}

class BowlingCard extends Model<BowlingCardAttributes, BowlingCardCreationAttributes> implements BowlingCardAttributes {
  public id!: number;
  public innings_id!: number;
  public player_id!: number;
  public overs!: number;
  public runs!: number;
  public wickets!: number;
  public extras!: number;
  public legal_balls!: number;
}

BowlingCard.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    innings_id: { type: DataTypes.INTEGER, allowNull: false },
    player_id: { type: DataTypes.INTEGER, allowNull: false },
    overs: { type: DataTypes.DECIMAL(5, 1), defaultValue: 0 },
    runs: { type: DataTypes.INTEGER, defaultValue: 0 },
    wickets: { type: DataTypes.INTEGER, defaultValue: 0 },
    extras: { type: DataTypes.INTEGER, defaultValue: 0 },
    legal_balls: { type: DataTypes.INTEGER, defaultValue: 0 },
  },
  {
    sequelize,
    tableName: 'bowling_cards',
    timestamps: false,
    indexes: [
      { fields: ['innings_id'] },
      { fields: ['player_id'] },
    ],
  }
);

export default BowlingCard;
