import { Prisma } from '@prisma/client';
import { cacheGetOrSet, CACHE_TTL } from '../lib/cache';
import { prisma } from '../lib/prisma';

// Success metrics from the product brief, computed from the records the
// features already write. Scoped to one user, or to everyone (admin) when
// userId is undefined.

function rate(part: number, whole: number): number | null {
  return whole === 0 ? null : Math.round((part / whole) * 1000) / 1000;
}

export async function computeInsights(userId: string | undefined, days: number) {
  const since = new Date(Date.now() - days * 86_400_000);
  const owner = userId ? { userId } : {};
  const ownerSql = userId ? Prisma.sql`AND "userId" = ${userId}` : Prisma.empty;

  const [
    confirmedDrafts, uncorrectedDrafts, discardedDrafts, rulesDrafts,
    fieldCorrections,
    onTime,
    suggestionsByStatus, suggestionFallbacks,
    digestsTotal, digestFallbacks,
    aiSpend,
  ] = await Promise.all([
    prisma.taskDraft.count({ where: { ...owner, status: 'confirmed', resolvedAt: { gte: since } } }),
    prisma.taskDraft.count({ where: { ...owner, status: 'confirmed', resolvedAt: { gte: since }, correctedFields: { isEmpty: true } } }),
    prisma.taskDraft.count({ where: { ...owner, status: 'discarded', resolvedAt: { gte: since } } }),
    prisma.taskDraft.count({ where: { ...owner, fallbackUsed: true, createdAt: { gte: since } } }),
    // Which fields users fix most: tells you which part of the capture prompt to improve
    prisma.$queryRaw<{ field: string; count: bigint }[]>`
      SELECT unnest("correctedFields") AS field, COUNT(*) AS count
      FROM "TaskDraft"
      WHERE status = 'confirmed' AND "resolvedAt" >= ${since} ${ownerSql}
      GROUP BY field ORDER BY count DESC
    `,
    prisma.$queryRaw<{ total: bigint; on_time: bigint }[]>`
      SELECT COUNT(*) AS total,
             COUNT(*) FILTER (WHERE "completedAt" <= "dueDate") AS on_time
      FROM "Task"
      WHERE status = 'done' AND "dueDate" IS NOT NULL AND "deletedAt" IS NULL
        AND "completedAt" >= ${since} ${ownerSql}
    `,
    prisma.prioritySuggestion.groupBy({
      by: ['status'],
      where: { ...owner, createdAt: { gte: since } },
      _count: true,
    }),
    prisma.prioritySuggestion.count({ where: { ...owner, createdAt: { gte: since }, fallbackUsed: true } }),
    prisma.digest.count({ where: { ...owner, createdAt: { gte: since } } }),
    prisma.digest.count({ where: { ...owner, createdAt: { gte: since }, fallbackUsed: true } }),
    prisma.usageLog.aggregate({
      where: { ...owner, createdAt: { gte: since }, action: { in: ['ai_completion', 'agent_run', 'ai_embedding'] } },
      _sum: { costUsd: true, tokens: true },
    }),
  ]);

  const suggestions = Object.fromEntries(suggestionsByStatus.map(s => [s.status, s._count]));
  const resolvedSuggestions = (suggestions.accepted ?? 0) + (suggestions.partially_accepted ?? 0) + (suggestions.dismissed ?? 0);
  const suggestionsTotal = Object.values(suggestions).reduce((a, b) => a + b, 0);
  const completion = onTime[0] ?? { total: 0n, on_time: 0n };

  return {
    windowDays: days,
    capture: {
      confirmed: confirmedDrafts,
      discarded: discardedDrafts,
      // KPI: share of captures confirmed with no manual correction
      parseAccuracy: rate(uncorrectedDrafts, confirmedDrafts),
      mostCorrectedFields: fieldCorrections.map(f => ({ field: f.field, count: Number(f.count) })),
      rulesFallbackDrafts: rulesDrafts,
    },
    completion: {
      completedWithDueDate: Number(completion.total),
      // KPI: completed by their due date
      onTimeRate: rate(Number(completion.on_time), Number(completion.total)),
    },
    prioritization: {
      suggestions: suggestionsTotal,
      byStatus: suggestions,
      // KPI: suggestions the user acted on (fully or partly)
      acceptanceRate: rate((suggestions.accepted ?? 0) + (suggestions.partially_accepted ?? 0), resolvedSuggestions),
      fallbackSuggestions: suggestionFallbacks,
    },
    digests: {
      generated: digestsTotal,
      fallbackRate: rate(digestFallbacks, digestsTotal),
    },
    ai: {
      costUsd: Math.round((aiSpend._sum.costUsd ?? 0) * 10000) / 10000,
      tokens: aiSpend._sum.tokens ?? 0,
    },
  };
}

export async function getUserInsights(userId: string, days: number) {
  return cacheGetOrSet(
    `insights:${userId}:${days}`,
    CACHE_TTL.INSIGHTS,
    () => computeInsights(userId, days),
  );
}
