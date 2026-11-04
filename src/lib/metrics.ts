import client from 'prom-client';

// Collect default Node.js metrics (event loop lag, memory, CPU)
client.collectDefaultMetrics({ prefix: 'tasklume_' });

// Counter: total number of HTTP requests
export const httpRequestsTotal = new client.Counter({
  name: 'tasklume_http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'path', 'status_code'],
});

// Histogram: request duration distribution
export const httpRequestDuration = new client.Histogram({
  name: 'tasklume_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'path'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

// Gauge: active queue jobs (goes up and down)
export const activeQueueJobs = new client.Gauge({
  name: 'tasklume_active_queue_jobs',
  help: 'Currently active queue jobs',
  labelNames: ['queue'],
});

// Counter: cache hits and misses
export const cacheOperations = new client.Counter({
  name: 'tasklume_cache_operations_total',
  help: 'Cache operations',
  labelNames: ['operation', 'result'], // get/set, hit/miss/ok
});

// Counter: task enrichment (embedding + auto-categorization) results
export const tasksEnriched = new client.Counter({
  name: 'tasklume_tasks_enriched_total',
  help: 'Tasks processed by the enrichment worker',
  labelNames: ['status'], // 'success' or 'failed'
});

export const taskEnrichmentDuration = new client.Histogram({
  name: 'tasklume_task_enrichment_duration_seconds',
  help: 'Task enrichment duration in seconds',
  buckets: [0.1, 0.5, 1, 5, 10, 30, 60],
});

// Counter: gateway calls by task type and outcome (success, fallback_model, error)
export const aiCalls = new client.Counter({
  name: 'tasklume_ai_calls_total',
  help: 'LLM calls through the AI gateway',
  labelNames: ['task_type', 'outcome'],
});

// Counter: a feature served its non-AI fallback (rules parser, heuristic ranking, ...)
export const aiFallbacks = new client.Counter({
  name: 'tasklume_ai_fallbacks_total',
  help: 'Times a feature fell back to its non-AI path',
  labelNames: ['feature'], // capture, categorize, prioritize, digest, search
});

// Counter: how capture drafts are resolved. corrected=false on a confirm is
// the "parsed right first time" signal behind the parse accuracy KPI.
export const draftResolutions = new client.Counter({
  name: 'tasklume_capture_drafts_resolved_total',
  help: 'Capture drafts confirmed or discarded',
  labelNames: ['status', 'corrected', 'source'], // confirmed/discarded, true/false, ai/rules
});

export const suggestionResolutions = new client.Counter({
  name: 'tasklume_priority_suggestions_resolved_total',
  help: 'Priority suggestions accepted, partially accepted or dismissed',
  labelNames: ['status'],
});

export const digestsGenerated = new client.Counter({
  name: 'tasklume_digests_generated_total',
  help: 'Digests generated',
  labelNames: ['period', 'trigger', 'fallback'], // daily/weekly, scheduled/manual, true/false
});

export const agentIterations = new client.Histogram({
  name: 'tasklume_agent_iterations',
  help: 'Number of iterations per agent run',
  buckets: [1, 2, 3, 5, 7, 10],
});

export const agentCost = new client.Histogram({
  name: 'tasklume_agent_cost_usd',
  help: 'Cost per agent run in USD',
  buckets: [0.01, 0.05, 0.10, 0.25, 0.50],
});

export const agentTerminations = new client.Counter({
  name: 'tasklume_agent_terminations_total',
  help: 'Agent termination reasons',
  labelNames: ['reason'],
});

// Counter: MCP tool calls we serve (inbound) and make (outbound)
export const mcpToolCalls = new client.Counter({
  name: 'tasklume_mcp_tool_calls_total',
  help: 'MCP tool calls',
  labelNames: ['tool', 'source', 'status'], // inbound/outbound, success/error
});

export const mcpToolDuration = new client.Histogram({
  name: 'tasklume_mcp_tool_duration_seconds',
  help: 'MCP tool call duration in seconds',
  labelNames: ['tool', 'source'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

// Export the registry for the /metrics endpoint
export const metricsRegistry = client.register;
