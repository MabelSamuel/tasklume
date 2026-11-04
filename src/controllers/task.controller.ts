import { Request, Response } from 'express';
import * as taskService from '../services/task.service';
import { searchTasks as searchTasksService } from '../services/search.service';

export async function listTasks(req: Request, res: Response) {
  const result = await taskService.listTasks(
    req.user!.id,
    req.query as unknown as taskService.ListTasksOptions,
  );
  res.json({ success: true, ...result });
}

export async function searchTasks(req: Request, res: Response) {
  const { q, limit, includeDone } = req.query as unknown as { q: string; limit: number; includeDone: boolean };
  const result = await searchTasksService({
    userId: req.user!.id,
    query: q,
    topK: limit,
    includeDone,
    correlationId: req.correlationId,
  });
  res.json({ success: true, data: result.results, meta: { mode: result.mode } });
}

export async function getTask(req: Request, res: Response) {
  const task = await taskService.getTask(req.params.id as string, req.user!.id);
  res.json({ success: true, data: task });
}

export async function createTask(req: Request, res: Response) {
  const task = await taskService.createTask({
    ...req.body,
    userId: req.user!.id,
    correlationId: req.correlationId,
  });
  res.status(201).json({ success: true, data: task });
}

export async function updateTask(req: Request, res: Response) {
  const task = await taskService.updateTask(req.params.id as string, req.user!.id, req.body);
  res.json({ success: true, data: task });
}

export async function deleteTask(req: Request, res: Response) {
  await taskService.deleteTask(req.params.id as string, req.user!.id);
  res.status(204).send();
}
