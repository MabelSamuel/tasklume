import CircuitBreaker from 'opossum';
import { openaiClient } from './openai.client';
import { withRetry } from './retry';
import { logger } from '../logger';
import { ServiceUnavailableError } from '../errors';

// The function we're protecting: retries inside, breaker outside
async function callOpenAI(path: string, body: unknown) {
  return withRetry(() => openaiClient.post(path, body));
}

// Usage: const res = await openaiBreaker.fire('/chat/completions', payload);
export const openaiBreaker = new CircuitBreaker(callOpenAI, {
  timeout: 35000,               // Slightly longer than the client timeout
  errorThresholdPercentage: 50, // Open if 50% of recent requests fail
  resetTimeout: 30000,          // Try again after 30 seconds
  rollingCountTimeout: 60000,   // Track failures over a 60-second window
  rollingCountBuckets: 10,
});

// Fallback when the breaker is open: fail fast with a 503
openaiBreaker.fallback(() => {
  throw new ServiceUnavailableError('OpenAI is temporarily unavailable. Please try again shortly.');
});

// Visibility into state changes
openaiBreaker.on('open', () =>
  logger.warn('OpenAI circuit breaker OPENED — requests will fail fast', { breaker: 'openai', state: 'open' }));
openaiBreaker.on('halfOpen', () =>
  logger.warn('OpenAI circuit breaker HALF-OPEN — testing recovery', { breaker: 'openai', state: 'halfOpen' }));
openaiBreaker.on('close', () =>
  logger.info('OpenAI circuit breaker CLOSED — normal operation', { breaker: 'openai', state: 'closed' }));
