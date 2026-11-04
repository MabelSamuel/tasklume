import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

// Data access only: no business rules, no ownership checks, no events.

export const projectRepository = {
  async findById(id: string) {
    return prisma.project.findUnique({ where: { id } });
  },

  async listForUser(userId: string, includeArchived: boolean) {
    const projects = await prisma.project.findMany({
      where: {
        userId,
        deletedAt: null,
        ...(!includeArchived && { isArchived: false }),
      },
      orderBy: { name: 'asc' },
      include: {
        _count: {
          select: { tasks: { where: { deletedAt: null, status: { in: ['todo', 'in_progress'] } } } },
        },
      },
    });

    return projects.map(({ _count, ...p }) => ({ ...p, openTaskCount: _count.tasks }));
  },

  async findByName(userId: string, name: string) {
    return prisma.project.findFirst({
      where: { userId, deletedAt: null, name: { equals: name, mode: 'insensitive' } },
    });
  },

  async create(data: Prisma.ProjectUncheckedCreateInput) {
    return prisma.project.create({ data });
  },

  async updateById(id: string, data: Prisma.ProjectUncheckedUpdateInput) {
    return prisma.project.update({ where: { id }, data });
  },

  // Tasks keep existing but lose the project (the FK would only null them on hard delete)
  async softDelete(id: string, deletedBy: string) {
    return prisma.$transaction([
      prisma.task.updateMany({
        where: { projectId: id },
        data: { projectId: null, projectSetBy: null },
      }),
      prisma.project.update({
        where: { id },
        data: { deletedAt: new Date(), deletedBy },
      }),
    ]);
  },
};
