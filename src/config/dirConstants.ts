/**
 * Centralized directory / file path segments used across configuration modules.
 * All values are relative — combine with STATE_ROOT via `toStateAbsolute()` for
 * mutable server state, or with CWD via `toAbsolute()` for catalog paths.
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
  /**
   * Messaging store under STATE_ROOT (#577). Restored after a silent auto-merge
   * loss: this line sat exactly where the branch below inserted `MESSAGING`, so
   * git dropped it without reporting a conflict.
   */
  DATA_MESSAGING: path.join('data', 'messaging'),

  /**
   * Messaging store, resolved as a SIBLING of the instruction catalog — never
   * inside it. Combined with `path.dirname(instructionsDir)` rather than CWD so
   * that every client sharing an `INDEX_SERVER_DIR` shares one messaging store.
   *
   * The catalog-relative derivation follows `backups`, which resolves as
   * `<dirname(INDEX_SERVER_DIR)>/backups` (see dashboardConfig). The `index-`
   * prefix is specific to this entry — `feedback` and `data/state` are bare
   * names anchored to CWD, not siblings of the catalog.
   */
  MESSAGING: 'index-messaging',

  BACKUPS: 'backups',
  INSTRUCTIONS: 'instructions',
  METRICS: 'metrics',
  FEEDBACK: 'feedback',
  FLAGS: 'flags.json',
} as const;
