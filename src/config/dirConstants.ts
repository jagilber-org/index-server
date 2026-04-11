/**
 * Centralized directory / file path segments used across configuration modules.
 * All values are relative — combine with CWD via `path.join(CWD, DIR.X)`.
 */
import path from 'path';

export const DIR = {
  LOGS: 'logs',
  LOGS_TRACE: path.join('logs', 'trace'),
  LOGS_MCP_SERVER: path.join('logs', 'mcp-server.log'),
  LOGS_AUDIT: path.join('logs', 'instruction-transactions.log.jsonl'),
  LOGS_NORMALIZATION: path.join('logs', 'index-normalization.log'),

  DATA: 'data',
  DATA_MODELS: path.join('data', 'models'),
  DATA_STATE: path.join('data', 'state'),
  DATA_EMBEDDINGS: path.join('data', 'embeddings.json'),
  DATA_SQLITE: path.join('data', 'index.db'),

  BACKUPS: 'backups',
  INSTRUCTIONS: 'instructions',
  METRICS: 'metrics',
  FEEDBACK: 'feedback',
  FLAGS: 'flags.json',
} as const;
