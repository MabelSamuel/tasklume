import { Prisma } from '@prisma/client';
import { cacheDel, cacheGetOrSet, CACHE_TTL } from '../lib/cache';
import { prisma } from '../lib/prisma';

export interface Preferences {
  timezone: string;
  goals: string | null;
  projectWeights: Record<string, number>;
  dailyDigest: boolean;
  weeklyDigest: boolean;
  digestHour: number;
  weeklyDigestDay: number;
  autoConfirmCapture: boolean;
}

function toPreferences(row: Prisma.UserPreferencesGetPayload<object>): Preferences {
  return {
    timezone: row.timezone,
    goals: row.goals,
    projectWeights: (row.projectWeights ?? {}) as Record<string, number>,
    dailyDigest: row.dailyDigest,
    weeklyDigest: row.weeklyDigest,
    digestHour: row.digestHour,
    weeklyDigestDay: row.weeklyDigestDay,
    autoConfirmCapture: row.autoConfirmCapture,
  };
}

// Every AI feature reads these, so they're created with defaults on first use
export async function getPreferences(userId: string): Promise<Preferences> {
  return cacheGetOrSet(`preferences:${userId}`, CACHE_TTL.PREFERENCES, async () => {
    const row = await prisma.userPreferences.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });
    return toPreferences(row);
  });
}

export async function updatePreferences(
  userId: string,
  data: Partial<Omit<Preferences, 'projectWeights'>> & { projectWeights?: Record<string, number> | undefined },
): Promise<Preferences> {
  const { projectWeights, ...rest } = data;
  const fields = Object.fromEntries(
    Object.entries(rest).filter(([, v]) => v !== undefined),
  ) as Prisma.UserPreferencesUncheckedUpdateInput;

  const row = await prisma.userPreferences.upsert({
    where: { userId },
    update: { ...fields, ...(projectWeights && { projectWeights }) },
    create: {
      userId,
      ...(fields as Omit<Prisma.UserPreferencesUncheckedCreateInput, 'userId'>),
      ...(projectWeights && { projectWeights }),
    },
  });

  await cacheDel(`preferences:${userId}`);
  return toPreferences(row);
}
