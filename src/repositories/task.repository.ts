import { Prisma, TaskPriority, TaskStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';

// Data access only: no business rules, no ownership checks, no events.
// Services decide WHAT to do; repositories know HOW to query it.

export const OPEN_STATUSES: TaskStatus[] = ['todo', 'in_progress'];

// Everything except the embedding (Prisma can't read Unsupported columns anyway)
export const taskSelect = {
  id: true,
  userId: true,
  projectId: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  dueDate: true,
  tags: true,
  completedAt: true,
  source: true,
  prioritySetBy: true,
  projectSetBy: true,
  enrichmentStatus: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  project: { select: { id: true, name: true, color: true } },
} satisfies Prisma.TaskSelect;

export type TaskRecord = Prisma.TaskGetPayload<{ select: typeof taskSelect }>;

export interface TaskListFilter {
  userId: string;
  status?: TaskStatus | 'open' | undefined;
  priority?: TaskPriority | undefined;
  projectId?: string | undefined;
  tag?: string | undefined;
  dueBefore?: Date | undefined;
  dueAfter?: Date | undefined;
  overdueAt?: Date | undefined; // Open and due before this instant
  search?: string | undefined;
}

function buildWhere(filter: TaskListFilter): Prisma.TaskWhereInput {
  const where: Prisma.TaskWhereInput = {
    userId: filter.userId,
    deletedAt: null, // Soft delete filter
  };

  if (filter.status === 'open') {
    where.status = { in: OPEN_STATUSES };
  } else if (filter.status) {
    where.status = filter.status;
  }
  if (filter.priority) where.priority = filter.priority;
  if (filter.projectId) where.projectId = filter.projectId;
  if (filter.tag) where.tags = { has: filter.tag };

  if (filter.dueBefore || filter.dueAfter) {
    where.dueDate = {
      ...(filter.dueAfter && { gte: filter.dueAfter }),
      ...(filter.dueBefore && { lt: filter.dueBefore }),
    };
  }

  if (filter.overdueAt) {
    where.status = { in: OPEN_STATUSES };
    where.dueDate = { lt: filter.overdueAt };
  }

  if (filter.search) {
    where.OR = [
      { title: { contains: filter.search, mode: 'insensitive' } },
      { description: { contains: filter.search, mode: 'insensitive' } },
    ];
  }

  return where;
}

export interface SemanticTaskHit {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: Date | null;
  projectName: string | null;
  score: number; // Cosine similarity (higher = more similar)
}

export const taskRepository = {
  async findById(id: string) {
    return prisma.task.findUnique({ where: { id }, select: taskSelect });
  },

  // Owner-scoped lookup of several tasks (agent tools, suggestion accept)
  async findManyOwned(userId: string, ids: string[]) {
    return prisma.task.findMany({
      where: { id: { in: ids }, userId, deletedAt: null },
      select: taskSelect,
    });
  },

  async list(
    filter: TaskListFilter,
    page: { skip: number; take: number },
    orderBy: Prisma.TaskOrderByWithRelationInput[],
  ) {
    const where = buildWhere(filter);

    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where,
        orderBy,
        skip: page.skip,
        take: page.take,
        select: taskSelect,
      }),
      prisma.task.count({ where }),
    ]);

    return { tasks, total };
  },

  async findAll(filter: TaskListFilter, take: number, orderBy?: Prisma.TaskOrderByWithRelationInput[]) {
    return prisma.task.findMany({
      where: buildWhere(filter),
      orderBy: orderBy ?? [{ dueDate: { sort: 'asc', nulls: 'last' } }],
      take,
      select: taskSelect,
    });
  },

  async count(filter: TaskListFilter) {
    return prisma.task.count({ where: buildWhere(filter) });
  },

  async countCompletedBetween(userId: string, from: Date, to: Date) {
    return prisma.task.count({
      where: { userId, deletedAt: null, status: 'done', completedAt: { gte: from, lt: to } },
    });
  },

  async findCompletedBetween(userId: string, from: Date, to: Date, take: number) {
    return prisma.task.findMany({
      where: { userId, deletedAt: null, status: 'done', completedAt: { gte: from, lt: to } },
      orderBy: { completedAt: 'desc' },
      take,
      select: taskSelect,
    });
  },

  async create(data: Prisma.TaskUncheckedCreateInput) {
    return prisma.task.create({ data, select: taskSelect });
  },

  async updateById(id: string, data: Prisma.TaskUncheckedUpdateInput) {
    return prisma.task.update({ where: { id }, data, select: taskSelect });
  },

  async softDelete(id: string, deletedBy: string) {
    return prisma.task.update({
      where: { id },
      data: { deletedAt: new Date(), deletedBy },
      select: { id: true },
    });
  },

  async storeEmbedding(id: string, embedding: number[]) {
    const vectorStr = `[${embedding.join(',')}]`;
    await prisma.$executeRaw`
      UPDATE "Task"
      SET embedding = ${vectorStr}::vector
      WHERE id = ${id}
    `;
  },

  async semanticSearch(options: {
    userId: string;
    embedding: number[];
    topK: number;
    includeDone: boolean;
  }): Promise<SemanticTaskHit[]> {
    const vectorStr = `[${options.embedding.join(',')}]`;
    return prisma.$queryRaw<SemanticTaskHit[]>`
      SELECT
        t.id,
        t.title,
        t.status,
        t.priority,
        t."dueDate",
        p.name AS "projectName",
        1 - (t.embedding <=> ${vectorStr}::vector) AS score
      FROM "Task" t
      LEFT JOIN "Project" p ON p.id = t."projectId"
      WHERE t."userId" = ${options.userId}
        AND t."deletedAt" IS NULL
        AND t.embedding IS NOT NULL
        ${options.includeDone ? Prisma.empty : Prisma.sql`AND t.status IN ('todo', 'in_progress')`}
      ORDER BY t.embedding <=> ${vectorStr}::vector
      LIMIT ${options.topK}
    `;
  },
};
