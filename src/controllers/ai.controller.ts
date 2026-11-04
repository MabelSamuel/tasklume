import { Request, Response } from 'express';
import { runAgent } from '../agents/executor';
import * as captureService from '../services/capture.service';
import * as digestService from '../services/digest.service';
import * as prioritizationService from '../services/prioritization.service';

// Every AI endpoint returns a recommendation plus how it was made
// (fallbackUsed / model), so the client can label it honestly.

function correlationId(req: Request): string {
  return req.correlationId ?? `req-${Date.now()}`;
}

// ── Capture ──────────────────────────────────────────

export async function capture(req: Request, res: Response) {
  const result = await captureService.captureTasks({
    userId: req.user!.id,
    input: req.body.input,
    autoConfirm: req.body.autoConfirm,
    correlationId: correlationId(req),
  });
  // 201 when every task was created; 200 when drafts await review
  res.status(result.needsReview ? 200 : 201).json({ success: true, data: result });
}

export async function listDrafts(req: Request, res: Response) {
  const drafts = await captureService.listDrafts(req.user!.id, req.query.status as string);
  res.json({ success: true, data: drafts });
}

export async function confirmDraft(req: Request, res: Response) {
  const result = await captureService.confirmDraft(
    req.params.id as string,
    req.user!.id,
    req.body,
    { correlationId: req.correlationId },
  );
  res.status(201).json({ success: true, data: result });
}

export async function discardDraft(req: Request, res: Response) {
  await captureService.discardDraft(req.params.id as string, req.user!.id);
  res.status(204).send();
}

// ── Prioritization ───────────────────────────────────

export async function suggestPriorities(req: Request, res: Response) {
  const suggestion = await prioritizationService.suggestPriorities({
    userId: req.user!.id,
    projectId: req.body.projectId,
    correlationId: correlationId(req),
  });
  if (!suggestion) {
    return res.json({ success: true, data: null, meta: { message: 'No open tasks to prioritize' } });
  }
  res.status(201).json({ success: true, data: suggestion });
}

export async function listSuggestions(req: Request, res: Response) {
  const suggestions = await prioritizationService.listSuggestions(req.user!.id);
  res.json({ success: true, data: suggestions });
}

export async function getSuggestion(req: Request, res: Response) {
  const suggestion = await prioritizationService.getSuggestion(req.params.id as string, req.user!.id);
  res.json({ success: true, data: suggestion });
}

export async function acceptSuggestion(req: Request, res: Response) {
  const result = await prioritizationService.acceptSuggestion(
    req.params.id as string,
    req.user!.id,
    req.body.taskIds,
  );
  res.json({ success: true, data: result });
}

export async function dismissSuggestion(req: Request, res: Response) {
  await prioritizationService.dismissSuggestion(req.params.id as string, req.user!.id);
  res.status(204).send();
}

// ── Digests ──────────────────────────────────────────

export async function generateDigest(req: Request, res: Response) {
  const digest = await digestService.generateDigest({
    userId: req.user!.id,
    period: req.body.period,
    trigger: 'manual',
    correlationId: correlationId(req),
  });
  res.status(201).json({ success: true, data: digest });
}

export async function getLatestDigest(req: Request, res: Response) {
  const digest = await digestService.getLatestDigest(
    req.user!.id,
    req.query.period as digestService.DigestPeriod | undefined,
  );
  res.json({ success: true, data: digest });
}

export async function listDigests(req: Request, res: Response) {
  const digests = await digestService.listDigests(req.user!.id, Number(req.query.limit));
  res.json({ success: true, data: digests });
}

// ── Assistant ────────────────────────────────────────

export async function askAssistant(req: Request, res: Response) {
  const { trace, ...result } = await runAgent({
    message: req.body.message,
    userId: req.user!.id,
    correlationId: correlationId(req),
  });
  res.json({ success: true, data: req.body.includeTrace ? { ...result, trace } : result });
}
