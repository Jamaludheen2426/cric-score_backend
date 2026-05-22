import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

export interface TournamentTeamAttributes {
  id: number;
  tournament_id: number;
  team_id: number;
}

export interface TournamentTeamCreationAttributes extends Optional<TournamentTeamAttributes, 'id'> {}

class TournamentTeam extends Model<TournamentTeamAttributes, TournamentTeamCreationAttributes> implements TournamentTeamAttributes {
  public id!: number;
  public tournament_id!: number;
  public team_id!: number;
}

TournamentTeam.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    tournament_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'tournaments', key: 'id' } },
    team_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'teams', key: 'id' } },
  },
  {
    sequelize,
    tableName: 'tournament_teams',
    timestamps: false,
    indexes: [
      { unique: true, fields: ['tournament_id', 'team_id'] },
      { fields: ['team_id'] },
    ],
  }
);

export default TournamentTeam;
