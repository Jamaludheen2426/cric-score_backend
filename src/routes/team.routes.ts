import { Router } from 'express';
import * as ctrl from '../controllers/team.controller';

const router = Router();

router.get('/', ctrl.listTeams);
router.post('/', ctrl.createTeam);
router.get('/:id', ctrl.getTeam);
router.put('/:id', ctrl.updateTeam);
router.delete('/:id', ctrl.deleteTeam);

// Players under team
router.get('/:teamId/players', ctrl.listPlayers);
router.post('/:teamId/players', ctrl.createPlayer);
router.put('/:teamId/players/:playerId', ctrl.updatePlayer);
router.delete('/:teamId/players/:playerId', ctrl.deletePlayer);

export default router;
