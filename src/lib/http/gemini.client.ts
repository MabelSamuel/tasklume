import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { config } from '../config';
import { logger } from '../logger';

type TimedConfig = InternalAxiosRequestConfig & { metadata?: { startTime: number } };

// Gemini's OpenAI-compatible endpoint: same /chat/completions and /embeddings
// request/response shapes as OpenAI, so call sites don't need to change
export const geminiClient: AxiosInstance = axios.create({
  baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
  timeout: 30000, // 30 seconds for AI responses
  headers: {
    ...(config.GEMINI_API_KEY && { Authorization: `Bearer ${config.GEMINI_API_KEY}` }),
    'Content-Type': 'application/json',
    'User-Agent': 'TaskLume/1.0',
  },
});

// Request interceptor: stamp the start time
geminiClient.interceptors.request.use((req: TimedConfig) => {
  req.metadata = { startTime: Date.now() };
  logger.debug('Gemini request', {
    method: req.method?.toUpperCase(),
    url: req.url,
  });
  return req;
});

// Response interceptor: log timing and normalize errors
geminiClient.interceptors.response.use(
  (response) => {
    const startTime = (response.config as TimedConfig).metadata?.startTime;
    logger.debug('Gemini response', {
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
      // Server responded with error status (503 = model overloaded, 404 = model retired)
      logger.error('Gemini error response', {
        status: error.response.status,
        url: error.config?.url,
        durationMs,
        responseData: error.response.data,
      });
    } else if (error.request) {
      // No response received (timeout, network error)
      logger.error('Gemini no response', {
        url: error.config?.url,
        durationMs,
        error: error.message,
      });
    } else {
      logger.error('Gemini request setup error', { error: error.message });
    }

    return Promise.reject(error);
  }
);

// Normalize the compat embeddings response: Gemini omits `index` on the first
// item (protobuf drops zero values) and returns no `usage` block
geminiClient.interceptors.response.use((response) => {
  if (response.config.url === '/embeddings' && Array.isArray(response.data?.data)) {
    response.data.data.forEach((item: { index?: number }, i: number) => {
      item.index ??= i;
    });
    response.data.usage ??= { prompt_tokens: 0, total_tokens: 0 };
  }
  return response;
});
