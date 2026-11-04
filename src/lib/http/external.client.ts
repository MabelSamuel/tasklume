import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { config } from '../config';
import { logger } from '../logger';

// Template client for a third-party HTTP API. Point EXTERNAL_API_BASE_URL
// at the service you integrate with, or copy this file per provider.

type TimedConfig = InternalAxiosRequestConfig & { metadata?: { startTime: number } };

export const externalClient: AxiosInstance = axios.create({
  ...(config.EXTERNAL_API_BASE_URL && { baseURL: config.EXTERNAL_API_BASE_URL }),
  timeout: 10000,
  headers: {
    ...(config.EXTERNAL_API_KEY && { Authorization: `Bearer ${config.EXTERNAL_API_KEY}` }),
    'Content-Type': 'application/json',
    'User-Agent': 'TaskLume/1.0',
  },
});

// Request interceptor: stamp the start time
externalClient.interceptors.request.use((req: TimedConfig) => {
  req.metadata = { startTime: Date.now() };
  logger.debug('External request', {
    method: req.method?.toUpperCase(),
    url: req.url,
  });
  return req;
});

// Response interceptor: log timing and normalize errors
externalClient.interceptors.response.use(
  (response) => {
    const startTime = (response.config as TimedConfig).metadata?.startTime;
    logger.debug('External response', {
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
      logger.error('External error response', {
        status: error.response.status,
        url: error.config?.url,
        durationMs,
      });
    } else if (error.request) {
      // No response received (timeout, network error)
      logger.error('External no response', {
        url: error.config?.url,
        durationMs,
        error: error.message,
      });
    } else {
      logger.error('External request setup error', { error: error.message });
    }

    return Promise.reject(error);
  }
);
