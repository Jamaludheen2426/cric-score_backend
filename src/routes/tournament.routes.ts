import { Router } from 'express';
import * as ctrl from '../controllers/tournament.controller';

const router = Router();

router.get('/', ctrl.listTournaments);
router.post('/', ctrl.createTournament);
router.post('/demo', ctrl.createDemoTournament);
router.get('/:id', ctrl.getTournament);
router.post('/:id/fixtures', ctrl.generateFixtures);

export default router;
