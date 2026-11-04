import crypto from 'crypto';
import { AI_ENABLED, AI_MODELS, EMBEDDING_DIMENSIONS } from '../config/ai-models';
import { AI_EVENTS } from '../events/ai.events';
import { cacheGet, cacheSet, CACHE_TTL } from '../lib/cache';
import { appEvents } from '../lib/events';
import { aiBreaker } from '../lib/http/ai.breaker';
import { logger } from '../lib/logger';
import { AIUnavailableError } from './mcp.service';

const EMBEDDING_MODEL = AI_MODELS.embedding;

interface EmbeddingContext {
  userId?: string | undefined;
  taskId?: string | undefined;
}

function contentHash(text: string): string {
  return crypto.createHash('sha256').update(`${EMBEDDING_MODEL}:${text}`).digest('hex');
}

export async function generateEmbedding(
  text: string,
  context: EmbeddingContext = {}
): Promise<number[]> {
  if (!AI_ENABLED) throw new AIUnavailableError();
  const startTime = Date.now();

  const response = await aiBreaker.fire('/embeddings', {
    input: text,
    model: EMBEDDING_MODEL,
    dimensions: EMBEDDING_DIMENSIONS,
  });

  const embedding: number[] = response.data.data[0].embedding;
  const tokensUsed: number = response.data.usage?.total_tokens ?? 0;

  logger.info('Embedding generated', {
    model: EMBEDDING_MODEL,
    inputLength: text.length,
    dimensions: embedding.length,
    durationMs: Date.now() - startTime,
    tokensUsed,
  });

  appEvents.emit(AI_EVENTS.EMBEDDING_GENERATED, {
    userId: context.userId,
    taskId: context.taskId,
    model: EMBEDDING_MODEL,
    tokensUsed,
    costUsd: (tokensUsed / 1_000_000) * AI_MODELS.embeddingCostPerMillion,
  });

  return embedding;
}

// Same input + model = same vector, so repeated searches cost nothing
export async function generateEmbeddingCached(
  text: string,
  context: EmbeddingContext = {}
): Promise<number[]> {
  const hash = contentHash(text);
  const cacheKey = `embed:${hash}`;

  const cached = await cacheGet<number[]>(cacheKey);
  if (cached) {
    logger.debug('Embedding cache hit', { hash: hash.substring(0, 12) });
    return cached;
  }

  const embedding = await generateEmbedding(text, context);
  await cacheSet(cacheKey, embedding, CACHE_TTL.EMBEDDING);
  return embedding;
}

// What a task "means" for search: title, details, tags and project
export function taskEmbeddingText(task: {
  title: string;
  description: string | null;
  tags: string[];
  project?: { name: string } | null;
}): string {
  return [
    task.title,
    task.description,
    task.tags.length ? `Tags: ${task.tags.join(', ')}` : null,
    task.project ? `Project: ${task.project.name}` : null,
  ].filter(Boolean).join('\n');
}
