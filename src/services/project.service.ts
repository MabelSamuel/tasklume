import { PROJECT_EVENTS } from '../events/task.events';
import { cacheGetOrSet, CACHE_TTL } from '../lib/cache';
import { ConflictError, NotFoundError } from '../lib/errors';
import { appEvents } from '../lib/events';
import { projectRepository } from '../repositories/project.repository';

export async function listProjects(userId: string, includeArchived = false) {
  return projectRepository.listForUser(userId, includeArchived);
}

// The compact list the capture/categorize prompts choose from
export async function getProjectChoices(userId: string) {
  return cacheGetOrSet(`projects:${userId}`, CACHE_TTL.PROJECTS, async () => {
    const projects = await projectRepository.listForUser(userId, false);
    return projects.map(p => ({ id: p.id, name: p.name, description: p.description }));
  });
}

// 404 (not 403) for other users' projects so IDs can't be probed
export async function findOwnedProject(projectId: string, userId: string) {
  const project = await projectRepository.findById(projectId);
  if (!project || project.deletedAt || project.userId !== userId) {
    throw new NotFoundError('Project not found');
  }
  return project;
}

async function assertNameFree(userId: string, name: string, exceptId?: string) {
  const existing = await projectRepository.findByName(userId, name);
  if (existing && existing.id !== exceptId) {
    throw new ConflictError(`A project named "${name}" already exists`);
  }
}

export async function createProject(data: {
  userId: string;
  name: string;
  description?: string | undefined;
  color?: string | undefined;
}) {
  await assertNameFree(data.userId, data.name);
  const project = await projectRepository.create({
    userId: data.userId,
    name: data.name,
    description: data.description ?? null,
    color: data.color ?? null,
  });
  appEvents.emit(PROJECT_EVENTS.CREATED, { userId: data.userId, projectId: project.id });
  return project;
}

export async function updateProject(
  projectId: string,
  userId: string,
  data: {
    name?: string | undefined;
    description?: string | null | undefined;
    color?: string | null | undefined;
    isArchived?: boolean | undefined;
  },
) {
  await findOwnedProject(projectId, userId);
  if (data.name) await assertNameFree(userId, data.name, projectId);

  const updated = await projectRepository.updateById(projectId, {
    ...(data.name !== undefined && { name: data.name }),
    ...(data.description !== undefined && { description: data.description }),
    ...(data.color !== undefined && { color: data.color }),
    ...(data.isArchived !== undefined && { isArchived: data.isArchived }),
  });
  appEvents.emit(PROJECT_EVENTS.UPDATED, { userId, projectId });
  return updated;
}

export async function deleteProject(projectId: string, userId: string) {
  await findOwnedProject(projectId, userId);
  await projectRepository.softDelete(projectId, userId);
  appEvents.emit(PROJECT_EVENTS.DELETED, { userId, deletedBy: userId, projectId });
}
