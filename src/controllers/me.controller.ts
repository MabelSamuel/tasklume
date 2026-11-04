import { Request, Response } from 'express';
import { getUserInsights } from '../services/insights.service';
import { getPreferences, updatePreferences } from '../services/preferences.service';

export async function getMyPreferences(req: Request, res: Response) {
  const prefs = await getPreferences(req.user!.id);
  res.json({ success: true, data: prefs });
}

export async function updateMyPreferences(req: Request, res: Response) {
  const prefs = await updatePreferences(req.user!.id, req.body);
  res.json({ success: true, data: prefs });
}

export async function getMyInsights(req: Request, res: Response) {
  const insights = await getUserInsights(req.user!.id, Number(req.query.days));
  res.json({ success: true, data: insights });
}
