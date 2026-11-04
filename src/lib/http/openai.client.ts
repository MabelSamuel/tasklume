import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { config } from '../config';
import { logger } from '../logger';

type TimedConfig = InternalAxiosRequestConfig & { metadata?: { startTime: number } };

export const openaiClient: AxiosInstance = axios.create({
  baseURL: 'https://api.openai.com/v1',
  timeout: 30000, // 30 seconds for AI responses
  headers: {
    ...(config.OPENAI_API_KEY && { Authorization: `Bearer ${config.OPENAI_API_KEY}` }),
    'Content-Type': 'application/json',
    'User-Agent': 'TaskLume/1.0',
  },
});

// Request interceptor: stamp the start time
openaiClient.interceptors.request.use((req: TimedConfig) => {
  req.metadata = { startTime: Date.now() };
  logger.debug('OpenAI request', {
    method: req.method?.toUpperCase(),
    url: req.url,
  });
  return req;
});

// Response interceptor: log timing and normalize errors
openaiClient.interceptors.response.use(
  (response) => {
    const startTime = (response.config as TimedConfig).metadata?.startTime;
    logger.debug('OpenAI response', {
      status: response.status,
      url: response.config.url,
      durationMs: startTime ? Date.now() - startTime : 0,
    });
    return response;
  },
  (error) => {
    const startTime = error.config?.metadata?.startTime;
    const durationMs = startTime ? Date.now() - startTime : 0;

    if (error.response) {
      // Server responded with error status
      logger.error('OpenAI error response', {
        status: error.response.status,
        url: error.config?.url,
        durationMs,
        responseData: error.response.data,
      });
    } else if (error.request) {
      // No response received (timeout, network error)
      logger.error('OpenAI no response', {
        url: error.config?.url,
        durationMs,
        error: error.message,
      });
    } else {
      logger.error('OpenAI request setup error', { error: error.message });
    }

    return Promise.reject(error);
  }
);

// Warn before OpenAI starts returning 429s
openaiClient.interceptors.response.use((response) => {
  const remaining = parseInt(
    response.headers['x-ratelimit-remaining-requests'] || '999'
  );

  if (remaining < 50) {
    logger.warn('OpenAI rate limit getting low', { remaining });
  }

  return response;
});
