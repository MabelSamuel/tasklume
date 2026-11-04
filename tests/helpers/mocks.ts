// Shared in-memory stand-ins for Redis and Prisma so AI-path tests never
// touch a database, a cache, or a real AI provider.

export function chatResponse(message: { content?: string | null; tool_calls?: unknown[] }) {
  return {
    data: {
      choices: [{ message: { role: 'assistant', content: message.content ?? null, tool_calls: message.tool_calls } }],
      usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 },
    },
  };
}

export function toolCall(name: string, args: unknown, id = `call_${Math.random().toString(36).slice(2, 8)}`) {
  return {
    id,
    type: 'function',
    function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) },
  };
}

export function cacheModuleMock() {
  return {
    CACHE_TTL: { PROMPT: 300, EMBEDDING: 1, TASK: 1, PREFERENCES: 1, PROJECTS: 1, INSIGHTS: 1, PERMISSIONS: 1 },
    cacheGet: vi.fn(async () => null),
    cacheSet: vi.fn(async () => undefined),
    cacheDel: vi.fn(async () => undefined),
    cacheGetOrSet: vi.fn(async (_k: string, _t: number, fn: () => Promise<unknown>) => fn()),
    cacheRedis: {
      get: vi.fn(async () => '0'),
      set: vi.fn(async () => 'OK'),
      incrbyfloat: vi.fn(async () => '0'),
      expire: vi.fn(async () => 1),
    },
  };
}
