import { AI_PROVIDER } from '../../config/ai-models';
import { geminiBreaker } from './gemini.breaker';
import { openaiBreaker } from './openai.breaker';

// Both providers speak the OpenAI request/response format, so callers just
// fire('/chat/completions' | '/embeddings', body) against whichever is active
export const aiBreaker = AI_PROVIDER === 'openai' ? openaiBreaker : geminiBreaker;
