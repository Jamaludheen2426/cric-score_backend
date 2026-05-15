import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

export interface MatchSessionAttributes {
  id: number;
  match_id: number;
  token: string;
  created_at?: Date;
  expires_at: Date;
}

export interface MatchSessionCreationAttributes extends Optional<MatchSessionAttributes, 'id'> {}

class MatchSession extends Model<MatchSessionAttributes, MatchSessionCreationAttributes> implements MatchSessionAttributes {
  public id!: number;
  public match_id!: number;
  public token!: string;
  public created_at?: Date;
  public expires_at!: Date;
}

MatchSession.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    match_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'matches', key: 'id' } },
    token: { type: DataTypes.STRING(128), allowNull: false, unique: true },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    expires_at: { type: DataTypes.DATE, allowNull: false },
  },
  {
    sequelize,
    tableName: 'match_sessions',
    timestamps: false,
  }
);

export default MatchSession;
