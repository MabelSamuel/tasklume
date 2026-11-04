import IORedis from 'ioredis';
import crypto from 'crypto';
import { config } from './config';
import { cacheOperations } from './metrics';

// TTL constants in seconds
export const CACHE_TTL = {
  PERMISSIONS: 300,    // 5 minutes
  TASK: 600,           // 10 minutes
  PREFERENCES: 600,    // 10 minutes
  PROJECTS: 300,       // 5 minutes: the list the capture/categorize prompts see
  PROMPT: 300,         // 5 minutes: prompt changes go live quickly
  EMBEDDING: 604800,   // 7 days: same input + model = same vector
  INSIGHTS: 300,       // 5 minutes
} as const;

export const cacheRedis = new IORedis(config.REDIS_URL, {
  keyPrefix: 'tasklume:', // Namespace all keys
});

export async function cacheGet<T>(key: string): Promise<T | null> {
  const raw = await cacheRedis.get(key);
  cacheOperations.inc({ operation: 'get', result: raw ? 'hit' : 'miss' });
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function cacheSet(
  key: string,
  value: unknown,
  ttlSeconds: number
): Promise<void> {
  await cacheRedis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  cacheOperations.inc({ operation: 'set', result: 'ok' });
}

export async function cacheDel(key: string): Promise<void> {
  await cacheRedis.del(key);
}

export async function cacheDelPattern(pattern: string): Promise<void> {
  // Use SCAN, never KEYS (KEYS blocks Redis on large datasets).
  // SCAN matches full key names, so include the prefix; DEL re-adds it.
  const stream = cacheRedis.scanStream({ match: `tasklume:${pattern}`, count: 100 });
  const pipeline = cacheRedis.pipeline();

  for await (const keys of stream) {
    for (const key of keys as string[]) {
      pipeline.del(key.replace(/^tasklume:/, ''));
    }
  }

  await pipeline.exec();
}

export function hashKey(...parts: string[]): string {
  const data = parts.join(':');
  return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16);
}

export async function cacheGetOrSet<T>(
  key: string,
  ttlSeconds: number,
  fetchFn: () => Promise<T>
): Promise<T> {
  // 1. Try cache
  const cached = await cacheGet<T>(key);
  if (cached !== null) return cached;

  // 2. Try to acquire lock (prevents a cache stampede)
  const lockKey = `lock:${key}`;
  const acquired = await cacheRedis.set(
    lockKey, '1', 'EX', 5, 'NX'  // Expires in 5s, only if not exists
  );

  if (acquired) {
    // We got the lock. Fetch and cache.
    try {
      const value = await fetchFn();
      if (value !== null && value !== undefined) {
        await cacheSet(key, value, ttlSeconds);
      }
      return value;
    } finally {
      await cacheRedis.del(lockKey);
    }
  }

  // 3. Someone else has the lock. Wait briefly, then try cache again.
  await new Promise(resolve => setTimeout(resolve, 100));
  const retried = await cacheGet<T>(key);
  if (retried !== null) return retried;

  // 4. Lock holder failed or cache still empty. Just fetch directly.
  return fetchFn();
}
