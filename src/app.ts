import express from "express";
import cors from "cors";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import { config } from "./lib/config";
import { metricsRegistry } from "./lib/metrics";
import { swaggerSpec } from "./config/swagger";
import { bullBoardAdapter } from "./config/bull-board";

import { errorHandler } from "./middleware/error-handler";
import { apiLimiter, authLimiter } from "./middleware/rateLimiter";
import { sanitizeInput } from "./middleware/sanitize";
import { requestLogger } from "./middleware/requestLogger";
import { metricsMiddleware } from "./middleware/metricsMiddleware";

import { healthRoutes } from "./routes/health.routes";
import { webhookRoutes } from "./routes/webhook.routes";
import { authRoutes } from "./routes/auth.routes";
import { taskRoutes } from "./routes/task.routes";
import { projectRoutes } from "./routes/project.routes";
import { assistantRoutes, captureRoutes, digestRoutes, priorityRoutes } from "./routes/ai.routes";
import { meRoutes } from "./routes/me.routes";
import { adminRoutes } from "./routes/admin.routes";

// Register event listeners (side effects: audit logs, cache busting, security)
import "./events/auth.events";
import "./events/admin.events";
import "./events/task.events";
import "./events/ai.events";
import "./events/cache.events";
import "./events/security.events";

const app = express();

// Trust the first proxy hop so req.ip is the real client (rate limits, logs)
app.set("trust proxy", 1);

// === SECURITY HEADERS ===
// API responses are JSON only, so lock the CSP down completely
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        connectSrc: ["'self'"],
      },
    },
  }),
);

// === CORS ===
const allowedOrigins = [config.FRONTEND_URL];

const isDevToolOrigin = (origin: string) =>
  config.NODE_ENV !== "production" && /^(chrome|moz)-extension:\/\//.test(origin);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, server-to-server)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin) || isDevToolOrigin(origin)) {
      callback(null, true);
    } else {
      // Deny without throwing: the response just lacks CORS headers (browser
      // blocks it) instead of turning into a 500 through the error handler
      callback(null, false);
    }
  },
  credentials: true,  // Allow cookies/auth headers
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'PUT'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-Id'],
  maxAge: 86400, // Cache preflight requests for 24 hours
}));

// === OBSERVABILITY (before everything else so all requests are counted) ===
app.use(requestLogger);
app.use(metricsMiddleware);

// === WEBHOOKS ===
// Need the raw body for signature checks, so mount BEFORE express.json()
app.use(
  "/webhooks",
  express.raw({
    type: "application/json",
    verify: (req, res, buf) => {
      (req as express.Request).rawBody = buf;
    },
  }),
  webhookRoutes,
);

// === BODY PARSING + SANITIZATION ===
app.use(express.json({ limit: "1mb" }));
app.use(sanitizeInput);

// === DOCS ===
app.use(
  "/api-docs",
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
      },
    },
  }),
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec),
);

// Raw JSON spec (useful for code generators)
app.get("/api-docs.json", (req, res) => {
  res.json(swaggerSpec);
});

// === OPS ENDPOINTS ===
// Metrics endpoint (no auth — Prometheus needs to scrape it; restrict at the network layer)
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', metricsRegistry.contentType);
  res.send(await metricsRegistry.metrics());
});

app.use(healthRoutes);

// Queue dashboard has no auth of its own, so keep it out of production
if (config.NODE_ENV !== "production") {
  app.use("/admin/queues", bullBoardAdapter.getRouter());
}

// === API ROUTES ===
app.use("/api/v1", apiLimiter);
app.use("/api/v1/auth", authLimiter, authRoutes);
app.use("/api/v1/tasks", taskRoutes);
app.use("/api/v1/projects", projectRoutes);
app.use("/api/v1/capture", captureRoutes);
app.use("/api/v1/priorities", priorityRoutes);
app.use("/api/v1/digests", digestRoutes);
app.use("/api/v1/assistant", assistantRoutes);
app.use("/api/v1/me", meRoutes);
app.use("/api/v1/admin", adminRoutes);

// === 404 + ERROR HANDLER (must be last) ===
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: { code: "NOT_FOUND", message: `Route ${req.path} not found` },
  });
});

app.use(errorHandler);

export { app };
