import CircuitBreaker from 'opossum';
import { externalClient } from './external.client';
import { withRetry } from './retry';
import { logger } from '../logger';
import { ServiceUnavailableError } from '../errors';

// The function we're protecting: retries inside, breaker outside
async function callExternal(path: string, body: unknown) {
  return withRetry(() => externalClient.post(path, body));
}

// Usage: const res = await externalBreaker.fire('/endpoint', payload);
export const externalBreaker = new CircuitBreaker(callExternal, {
  timeout: 35000,               // Longer than retries * client timeout
  errorThresholdPercentage: 50, // Open if 50% of recent requests fail
  resetTimeout: 30000,          // Try again after 30 seconds
  rollingCountTimeout: 60000,   // Track failures over a 60-second window
  rollingCountBuckets: 10,
});

// Fallback when the breaker is open: fail fast with a 503
externalBreaker.fallback(() => {
  throw new ServiceUnavailableError('External service is temporarily unavailable. Please try again shortly.');
});

// Visibility into state changes
externalBreaker.on('open', () =>
  logger.warn('External circuit breaker OPENED — requests will fail fast', { breaker: 'external', state: 'open' }));
externalBreaker.on('halfOpen', () =>
  logger.warn('External circuit breaker HALF-OPEN — testing recovery', { breaker: 'external', state: 'halfOpen' }));
externalBreaker.on('close', () =>
  logger.info('External circuit breaker CLOSED — normal operation', { breaker: 'external', state: 'closed' }));
