import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

export interface ScoreAuditLogAttributes {
  id: number;
  match_id: number;
  action: string;
  details?: object;
  created_at?: Date;
}

export interface ScoreAuditLogCreationAttributes extends Optional<ScoreAuditLogAttributes, 'id' | 'created_at'> {}

class ScoreAuditLog extends Model<ScoreAuditLogAttributes, ScoreAuditLogCreationAttributes> implements ScoreAuditLogAttributes {
  public id!: number;
  public match_id!: number;
  public action!: string;
  public details?: object;
  public created_at?: Date;
}

ScoreAuditLog.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    match_id: { type: DataTypes.INTEGER, allowNull: false },
    action: { type: DataTypes.STRING(80), allowNull: false },
    details: { type: DataTypes.JSON, allowNull: true },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    sequelize,
    tableName: 'score_audit_logs',
    timestamps: false,
    indexes: [{ fields: ['match_id'] }, { fields: ['action'] }],
  }
);

export default ScoreAuditLog;
