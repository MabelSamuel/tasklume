import { logger, serializeError } from '../lib/logger';
import { aiFallbacks } from '../lib/metrics';
import { taskRepository } from '../repositories/task.repository';
import { generateEmbeddingCached } from './embedding.service';

// Below this cosine similarity a hit is noise rather than "about the same thing"
const MIN_SCORE = 0.35;

export interface TaskSearchResult {
  mode: 'semantic' | 'keyword';
  results: {
    id: string;
    title: string;
    status: string;
    priority: string;
    dueDate: Date | null;
    projectName: string | null;
    score: number | null;
  }[];
}

// Search by meaning ("the thing about the vendor contract"). If embeddings
// are unavailable, fall back to keyword search so search never just fails.
export async function searchTasks(options: {
  userId: string;
  query: string;
  topK?: number;
  includeDone?: boolean;
  correlationId?: string | undefined;
}): Promise<TaskSearchResult> {
  const { userId, query, topK = 10, includeDone = false, correlationId } = options;
  const startTime = Date.now();

  try {
    const embedding = await generateEmbeddingCached(query, { userId });
    const hits = await taskRepository.semanticSearch({ userId, embedding, topK, includeDone });
    const results = hits
      .map(h => ({ ...h, score: Number(h.score) }))
      .filter(h => h.score >= MIN_SCORE);

    logger.info('Semantic task search completed', {
      correlationId,
      totalResults: hits.length,
      filteredResults: results.length,
      topScore: results[0]?.score?.toFixed(4),
      durationMs: Date.now() - startTime,
    });

    return { mode: 'semantic', results };
  } catch (error) {
    aiFallbacks.inc({ feature: 'search' });
    logger.warn('Semantic search unavailable, using keyword search', {
      correlationId,
      error: serializeError(error).message,
    });

    const tasks = await taskRepository.findAll(
      { userId, search: query, ...(!includeDone && { status: 'open' as const }) },
      topK,
    );
    return {
      mode: 'keyword',
      results: tasks.map(t => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        dueDate: t.dueDate,
        projectName: t.project?.name ?? null,
        score: null,
      })),
    };
  }
}
