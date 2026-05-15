import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

export interface TeamAttributes {
  id: number;
  name: string;
  logo_url?: string;
  created_at?: Date;
}

export interface TeamCreationAttributes extends Optional<TeamAttributes, 'id'> {}

class Team extends Model<TeamAttributes, TeamCreationAttributes> implements TeamAttributes {
  public id!: number;
  public name!: string;
  public logo_url?: string;
  public created_at?: Date;
}

Team.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING(100), allowNull: false, unique: true },
    logo_url: { type: DataTypes.STRING(500), allowNull: true },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    sequelize,
    tableName: 'teams',
    timestamps: false,
  }
);

export default Team;
