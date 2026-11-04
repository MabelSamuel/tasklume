import { Request, Response } from 'express';
import * as projectService from '../services/project.service';

export async function listProjects(req: Request, res: Response) {
  const { includeArchived } = req.query as unknown as { includeArchived: boolean };
  const projects = await projectService.listProjects(req.user!.id, includeArchived);
  res.json({ success: true, data: projects });
}

export async function createProject(req: Request, res: Response) {
  const project = await projectService.createProject({ ...req.body, userId: req.user!.id });
  res.status(201).json({ success: true, data: project });
}

export async function updateProject(req: Request, res: Response) {
  const project = await projectService.updateProject(req.params.id as string, req.user!.id, req.body);
  res.json({ success: true, data: project });
}

export async function deleteProject(req: Request, res: Response) {
  await projectService.deleteProject(req.params.id as string, req.user!.id);
  res.status(204).send();
}
