import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Enough for lib/config to validate. Unit tests mock the AI breaker and
    // gateway, so the placeholder key never reaches a real provider.
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://tasklume:tasklume@localhost:5432/tasklume_test',
      JWT_ACCESS_SECRET: 'test-access-secret-at-least-thirty-two-characters',
      JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-thirty-two-characters',
      AI_PROVIDER: 'openai',
      OPENAI_API_KEY: 'test-placeholder-not-a-real-key',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/config/**'],
    },
  },
});
