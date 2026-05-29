import { Router } from 'express';
import * as ctrl from '../controllers/match.controller';
import { requireScorerAuth } from '../middleware/auth';

const router = Router();

// Public
router.get('/', ctrl.listMatches);
router.post('/', ctrl.createMatch);
router.get('/live/:shareToken', ctrl.liveScore);
router.get('/events/:shareToken', ctrl.sseStream);
router.post('/:id/verify-pin', ctrl.verifyPin);
router.get('/:id', ctrl.getMatch);

// Scorer-authenticated scoring endpoints
router.post('/:id/start', requireScorerAuth, ctrl.startMatch);
router.post('/:id/ball', requireScorerAuth, ctrl.addBall);
router.delete('/:id/ball/last', requireScorerAuth, ctrl.undoBall);
router.post('/:id/over/end', requireScorerAuth, ctrl.endOver);
router.post('/:id/corrections/players', requireScorerAuth, ctrl.correctPlayers);
router.post('/:id/corrections/target', requireScorerAuth, ctrl.reviseTarget);
router.post('/:id/penalty', requireScorerAuth, ctrl.addPenalty);
router.get('/:id/audit', requireScorerAuth, ctrl.auditLogs);
router.get('/:id/export.csv', requireScorerAuth, ctrl.exportCsv);
router.post('/:id/unlock', requireScorerAuth, ctrl.unlockMatch);
router.post('/:id/innings/end', requireScorerAuth, ctrl.endInnings);
router.post('/:id/end', requireScorerAuth, ctrl.endMatch);

export default router;
