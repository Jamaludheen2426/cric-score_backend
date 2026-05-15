import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

export interface PlayerAttributes {
  id: number;
  team_id: number;
  name: string;
  batting_order?: number;
  role?: 'batsman' | 'bowler' | 'allrounder' | 'wicketkeeper';
  created_at?: Date;
}

export interface PlayerCreationAttributes extends Optional<PlayerAttributes, 'id'> {}

class Player extends Model<PlayerAttributes, PlayerCreationAttributes> implements PlayerAttributes {
  public id!: number;
  public team_id!: number;
  public name!: string;
  public batting_order?: number;
  public role?: 'batsman' | 'bowler' | 'allrounder' | 'wicketkeeper';
  public created_at?: Date;
}

Player.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    team_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'teams', key: 'id' } },
    name: { type: DataTypes.STRING(100), allowNull: false },
    batting_order: { type: DataTypes.INTEGER, allowNull: true },
    role: { type: DataTypes.ENUM('batsman', 'bowler', 'allrounder', 'wicketkeeper'), defaultValue: 'batsman' },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    sequelize,
    tableName: 'players',
    timestamps: false,
  }
);

export default Player;
