// First-line defence against prompt injection. Pattern matching can't catch
// everything, so prompts must ALSO treat user and tool text as data, not
// instructions. Use this on anything that ends up inside an LLM prompt:
// user input, MCP tool arguments, external tool results and descriptions.

// No /g flag: a global regex keeps lastIndex between .test() calls, which
// would make every other check on the same pattern silently miss
const DANGEROUS_PATTERNS = [
  /ignore (all )?(previous|prior|above) instructions/i,
  /disregard (all )?(previous|prior|above)/i,
  /you are now/i,
  /pretend (you are|to be)/i,
  /system prompt:/i,
  /new instructions:/i,
];

export function detectPromptInjection(input: string): {
  isSuspicious: boolean;
  sanitized: string;
} {
  let sanitized = input;
  let isSuspicious = false;

  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(sanitized)) {
      isSuspicious = true;
      sanitized = sanitized.replace(new RegExp(pattern.source, 'gi'), '[FILTERED]');
    }
  }

  return { isSuspicious, sanitized };
}

// Runs detectPromptInjection over every string in a nested value (tool arguments)
export function sanitizeToolArgs<T>(args: T): { isSuspicious: boolean; sanitized: T } {
  let isSuspicious = false;

  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') {
      const result = detectPromptInjection(value);
      if (result.isSuspicious) isSuspicious = true;
      return result.sanitized;
    }
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, v]) => [key, walk(v)]),
      );
    }
    return value;
  };

  const sanitized = walk(args) as T;
  return { isSuspicious, sanitized };
}
