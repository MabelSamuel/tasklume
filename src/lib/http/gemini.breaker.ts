import CircuitBreaker from 'opossum';
import { geminiClient } from './gemini.client';
import { withRetry } from './retry';
import { logger } from '../logger';
import { ServiceUnavailableError } from '../errors';

// The function we're protecting: retries inside, breaker outside
async function callGemini(path: string, body: unknown) {
  return withRetry(() => geminiClient.post(path, body));
}

// Usage: const res = await geminiBreaker.fire('/chat/completions', payload);
export const geminiBreaker = new CircuitBreaker(callGemini, {
  timeout: 35000,               // Slightly longer than the client timeout
  errorThresholdPercentage: 50, // Open if 50% of recent requests fail
  resetTimeout: 30000,          // Try again after 30 seconds
  rollingCountTimeout: 60000,   // Track failures over a 60-second window
  rollingCountBuckets: 10,
});

// Fallback when the breaker is open: fail fast with a 503
geminiBreaker.fallback(() => {
  throw new ServiceUnavailableError('Gemini is temporarily unavailable. Please try again shortly.');
});

// Visibility into state changes
geminiBreaker.on('open', () =>
  logger.warn('Gemini circuit breaker OPENED — requests will fail fast', { breaker: 'gemini', state: 'open' }));
geminiBreaker.on('halfOpen', () =>
  logger.warn('Gemini circuit breaker HALF-OPEN — testing recovery', { breaker: 'gemini', state: 'halfOpen' }));
geminiBreaker.on('close', () =>
  logger.info('Gemini circuit breaker CLOSED — normal operation', { breaker: 'gemini', state: 'closed' }));
