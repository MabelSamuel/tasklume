import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { cacheRedis } from '../lib/cache';
import { config } from '../lib/config';

const router = Router();

// Basic health check
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: config.NODE_ENV,
  });
});

// Liveness: is the process running?
router.get('/health/live', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Readiness: can the process handle requests?
router.get('/health/ready', async (req, res) => {
  const checks: Record<string, { status: 'ok' | 'error'; message?: string }> = {};

  // Check database
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = { status: 'ok' };
  } catch (error) {
    checks.database = { status: 'error', message: (error as Error).message };
  }

  // Check Redis
  try {
    await cacheRedis.ping();
    checks.redis = { status: 'ok' };
  } catch (error) {
    checks.redis = { status: 'error', message: (error as Error).message };
  }

  const allHealthy = Object.values(checks).every(c => c.status === 'ok');

  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    checks,
  });
});

export { router as healthRoutes };
