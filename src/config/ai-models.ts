import { config } from '../lib/config';

export const AI_PROVIDER = config.AI_PROVIDER;

// Without a key every call would 401, so callers check this and go
// straight to their non-AI fallback instead
export const AI_ENABLED = Boolean(
  AI_PROVIDER === 'openai' ? config.OPENAI_API_KEY : config.GEMINI_API_KEY,
);

export interface ModelConfig {
  name: string;
  costPerMillionInput: number;
  costPerMillionOutput: number;
  maxTokens: number;
}

// Costs are estimates for budgeting/cost ceilings — verify current prices
// with the provider before relying on them
export const MODELS: Record<string, ModelConfig> = {
  'gemini-3.8-flash': {
    name: 'gemini-3.8-flash',
    costPerMillionInput: 0.30,
    costPerMillionOutput: 2.50,
    maxTokens: 1_000_000,
  },
  'gemini-3.5-flash': {
    name: 'gemini-3.5-flash',
    costPerMillionInput: 0.30,
    costPerMillionOutput: 2.50,
    maxTokens: 1_000_000,
  },
  'gemini-3.5-flash-lite': {
    name: 'gemini-3.5-flash-lite',
    costPerMillionInput: 0.10,
    costPerMillionOutput: 0.40,
    maxTokens: 1_000_000,
  },
  'gpt-4o': {
    name: 'gpt-4o',
    costPerMillionInput: 2.50,
    costPerMillionOutput: 10.00,
    maxTokens: 128000,
  },
  'gpt-4o-mini': {
    name: 'gpt-4o-mini',
    costPerMillionInput: 0.15,
    costPerMillionOutput: 0.60,
    maxTokens: 128000,
  },
};

interface ProviderModels {
  capture: string;    // Structured extraction — cheap model is fine
  categorize: string; // Pick one project from a short list
  prioritize: string; // Reasoning over many tasks and the user's goals
  digest: string;     // Summaries are straightforward
  agent: string;      // Agents need strong reasoning
  embedding: string;
  embeddingCostPerMillion: number;
  // Primary model → models to try in order when it fails
  fallbackChains: Record<string, string[]>;
}

const PROVIDER_MODELS: Record<typeof AI_PROVIDER, ProviderModels> = {
  gemini: {
    capture: 'gemini-3.5-flash-lite',
    categorize: 'gemini-3.5-flash-lite',
    prioritize: 'gemini-3.5-flash',
    digest: 'gemini-3.5-flash-lite',
    agent: 'gemini-3.5-flash',
    embedding: 'gemini-embedding-001',
    embeddingCostPerMillion: 0.15,
    // 3.8-flash often returns 503 under high demand, so it's only a fallback
    fallbackChains: {
      'gemini-3.5-flash': ['gemini-3.5-flash', 'gemini-3.8-flash'],
      'gemini-3.5-flash-lite': ['gemini-3.5-flash-lite', 'gemini-3.5-flash'],
    },
  },
  openai: {
    capture: 'gpt-4o-mini',
    categorize: 'gpt-4o-mini',
    prioritize: 'gpt-4o',
    digest: 'gpt-4o-mini',
    agent: 'gpt-4o',
    embedding: 'text-embedding-3-small',
    embeddingCostPerMillion: 0.02,
    fallbackChains: {
      'gpt-4o': ['gpt-4o', 'gpt-4o-mini'],
      'gpt-4o-mini': ['gpt-4o-mini', 'gpt-4o'],
    },
  },
};

export const AI_MODELS = PROVIDER_MODELS[AI_PROVIDER];

// Must match the vector(1536) column in prisma/schema.prisma
export const EMBEDDING_DIMENSIONS = 1536;
