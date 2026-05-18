import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

export interface BattingCardAttributes {
  id: number;
  innings_id: number;
  player_id: number;
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  is_out: boolean;
  dismissal_type?: string;
  bowler_id?: number;
  batting_position: number;
}

export interface BattingCardCreationAttributes extends Optional<BattingCardAttributes, 'id' | 'runs' | 'balls' | 'fours' | 'sixes' | 'is_out'> {}

class BattingCard extends Model<BattingCardAttributes, BattingCardCreationAttributes> implements BattingCardAttributes {
  public id!: number;
  public innings_id!: number;
  public player_id!: number;
  public runs!: number;
  public balls!: number;
  public fours!: number;
  public sixes!: number;
  public is_out!: boolean;
  public dismissal_type?: string;
  public bowler_id?: number;
  public batting_position!: number;
}

BattingCard.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    innings_id: { type: DataTypes.INTEGER, allowNull: false },
    player_id: { type: DataTypes.INTEGER, allowNull: false },
    runs: { type: DataTypes.INTEGER, defaultValue: 0 },
    balls: { type: DataTypes.INTEGER, defaultValue: 0 },
    fours: { type: DataTypes.INTEGER, defaultValue: 0 },
    sixes: { type: DataTypes.INTEGER, defaultValue: 0 },
    is_out: { type: DataTypes.BOOLEAN, defaultValue: false },
    dismissal_type: { type: DataTypes.STRING(100), allowNull: true },
    bowler_id: { type: DataTypes.INTEGER, allowNull: true },
    batting_position: { type: DataTypes.INTEGER, allowNull: false },
  },
  {
    sequelize,
    tableName: 'batting_cards',
    timestamps: false,
    indexes: [
      { fields: ['innings_id'] },
      { fields: ['player_id'] },
    ],
  }
);

export default BattingCard;
