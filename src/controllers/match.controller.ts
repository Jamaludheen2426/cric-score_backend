import { Request, Response } from 'express';
import * as matchService from '../services/match.service';
import * as scoringService from '../services/scoring.service';
import * as scoringFast from '../services/scoring-fast.service';
import * as liveService from '../services/live.service';
import { addSseClient } from '../middleware/sse';
import { v4 as uuidv4 } from 'uuid';

// addBall implementation switch.
//   default = fast raw-SQL path (collapses ~6 round-trips into 2).
//   USE_LEGACY_ADDBALL=true reverts to the Sequelize implementation
//   for one-deploy rollback safety while we burn in the new code.
const useFastAddBall = process.env.USE_LEGACY_ADDBALL !== 'true';

const ok = (res: Response, data: any) => res.json({ success: true, data });
const err = (res: Response, e: any, code = 400) => res.status(code).json({ success: false, error: e?.message || String(e) });

export async function listMatches(req: Request, res: Response) {
  try { ok(res, await matchService.getAllMatches()); } catch (e) { err(res, e); }
}

export async function getMatch(req: Request, res: Response) {
  try {
    const match = await matchService.getMatchById(Number(req.params.id));
    if (!match) return res.status(404).json({ success: false, error: 'Match not found' });
    ok(res, match);
  } catch (e) { err(res, e); }
}

export async function createMatch(req: Request, res: Response) {
  try { ok(res, await matchService.createMatch(req.body)); } catch (e) { err(res, e); }
}

export async function verifyPin(req: Request, res: Response) {
  try {
    const token = await matchService.verifyPin(Number(req.params.id), req.body.pin, Boolean(req.body.force));
    ok(res, { token });
  } catch (e) { err(res, e, 401); }
}

export async function startMatch(req: Request, res: Response) {
  try { ok(res, await matchService.startMatch(Number(req.params.id), req.body)); } catch (e) { err(res, e); }
}

export async function addBall(req: Request, res: Response) {
  try {
    const impl = useFastAddBall ? scoringFast.addBall : scoringService.addBall;
    ok(res, await impl(Number(req.params.id), req.body));
  } catch (e) { err(res, e); }
}

export async function endOver(req: Request, res: Response) {
  try { ok(res, await scoringService.endOver(Number(req.params.id), req.body.next_bowler_id)); } catch (e) { err(res, e); }
}

export async function correctPlayers(req: Request, res: Response) {
  try { ok(res, await scoringService.correctCurrentPlayers(Number(req.params.id), req.body)); } catch (e) { err(res, e); }
}

export async function reviseTarget(req: Request, res: Response) {
  try { ok(res, await scoringService.reviseTarget(Number(req.params.id), Number(req.body.target))); } catch (e) { err(res, e); }
}

export async function addPenalty(req: Request, res: Response) {
  try { ok(res, await scoringService.addPenaltyRuns(Number(req.params.id), Number(req.body.runs), req.body.reason)); } catch (e) { err(res, e); }
}

export async function auditLogs(req: Request, res: Response) {
  try { ok(res, await scoringService.getAuditLogs(Number(req.params.id))); } catch (e) { err(res, e); }
}

export async function exportCsv(req: Request, res: Response) {
  try {
    const match = await matchService.getMatchById(Number(req.params.id));
    if (!match) return res.status(404).send('Match not found');
    const live = await liveService.getLiveScore(match.share_token);
    const rows = ['innings,section,name,runs,balls,wickets,overs,extras,notes'];
    for (const innings of live.innings || []) {
      for (const card of innings.battingCards || []) {
        rows.push([innings.innings_number, 'batting', card.player?.name || '', card.runs, card.balls, '', '', '', card.is_out ? card.dismissal_type || 'out' : 'not out'].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
      }
      for (const card of innings.bowlingCards || []) {
        rows.push([innings.innings_number, 'bowling', card.player?.name || '', card.runs, '', card.wickets, card.overs, card.extras, ''].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
      }
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="match-${match.id}-score.csv"`);
    res.send(rows.join('\n'));
  } catch (e) { err(res, e); }
}

function pdfEscape(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function simplePdf(lines: string[]) {
  const content = [
    'BT',
    '/F1 12 Tf',
    '50 790 Td',
    ...lines.flatMap((line, index) => [
      index === 0 ? '/F1 16 Tf' : '/F1 12 Tf',
      `(${pdfEscape(line)}) Tj`,
      '0 -18 Td',
    ]),
    'ET',
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach(offset => { pdf += `${String(offset).padStart(10, '0')} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

export async function exportPdf(req: Request, res: Response) {
  try {
    const match = await matchService.getMatchById(Number(req.params.id));
    if (!match) return res.status(404).send('Match not found');
    const live = await liveService.getLiveScore(match.share_token);
    const lines = [
      match.title,
      `${(match as any).teamA?.name || ''} vs ${(match as any).teamB?.name || ''}`,
      '',
      ...live.innings.flatMap((innings: any) => [
        `${innings.battingTeam?.name || 'Innings'} ${innings.total_runs}/${innings.total_wickets} (${innings.total_overs_bowled}/${match.total_overs})`,
        `Extras ${innings.extras}`,
        ...(innings.battingCards || []).slice(0, 8).map((card: any) => `${card.player?.name || ''} ${card.runs} (${card.balls})`),
        '',
      ]),
    ];
    const pdf = simplePdf(lines.slice(0, 44));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="match-${match.id}-scorecard.pdf"`);
    res.send(pdf);
  } catch (e) { err(res, e); }
}

export async function unlockMatch(req: Request, res: Response) {
  try { ok(res, await matchService.unlockMatch(Number(req.params.id))); } catch (e) { err(res, e); }
}

export async function endInnings(req: Request, res: Response) {
  try { ok(res, await scoringService.endInnings(Number(req.params.id), req.body)); } catch (e) { err(res, e); }
}

export async function endMatch(req: Request, res: Response) {
  try { ok(res, await matchService.endMatch(Number(req.params.id), req.body.result)); } catch (e) { err(res, e); }
}

export async function undoBall(req: Request, res: Response) {
  try { ok(res, await scoringService.undoLastBall(Number(req.params.id))); } catch (e) { err(res, e); }
}

export async function editBall(req: Request, res: Response) {
  try { ok(res, await scoringService.editBall(Number(req.params.id), Number(req.params.ballId), req.body)); } catch (e) { err(res, e); }
}

export async function liveScore(req: Request, res: Response) {
  try { ok(res, await liveService.getLiveScore(req.params.shareToken)); } catch (e) { err(res, e, 404); }
}

export async function sseStream(req: Request, res: Response) {
  const { shareToken } = req.params;
  const clientId = uuidv4();
  addSseClient(shareToken, clientId, res);

  // Send initial score immediately
  try {
    const score = await liveService.getLiveScore(shareToken);
    res.write(`data: ${JSON.stringify(score)}\n\n`);
  } catch (_) {
    res.write(`data: ${JSON.stringify({ error: 'Match not found' })}\n\n`);
  }
}
