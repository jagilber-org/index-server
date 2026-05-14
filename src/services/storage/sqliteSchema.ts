/**
 * SQLite schema DDL for instruction storage.
 *
 * Uses Node.js built-in node:sqlite (DatabaseSync). No third-party packages.
 * WAL mode enabled for concurrent read performance.
 */

export const SCHEMA_VERSION = '2';

export const INSTRUCTIONS_DDL = `
CREATE TABLE IF NOT EXISTS instructions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  rationale TEXT,
  priority INTEGER NOT NULL DEFAULT 50,
  audience TEXT NOT NULL DEFAULT 'all',
  requirement TEXT NOT NULL DEFAULT 'recommended',
  categories TEXT NOT NULL DEFAULT '[]',
  content_type TEXT NOT NULL DEFAULT 'instruction',
  primary_category TEXT,
  source_hash TEXT NOT NULL DEFAULT '',
  schema_version TEXT NOT NULL DEFAULT '4',
  deprecated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version TEXT DEFAULT '1.0.0',
  status TEXT DEFAULT 'approved',
  owner TEXT,
  priority_tier TEXT,
  classification TEXT DEFAULT 'public',
  last_reviewed_at TEXT,
  next_review_due TEXT,
  review_interval_days INTEGER,
  change_log TEXT DEFAULT '[]',
  supersedes TEXT,
  archived_at TEXT,
  workspace_id TEXT,
  user_id TEXT,
  team_ids TEXT DEFAULT '[]',
  semantic_summary TEXT,
  created_by_agent TEXT,
  source_workspace TEXT,
  extensions TEXT,
  risk_score REAL,
  usage_count INTEGER DEFAULT 0,
  first_seen_ts TEXT,
  last_used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_instructions_content_type ON instructions(content_type);
CREATE INDEX IF NOT EXISTS idx_instructions_status ON instructions(status);
CREATE INDEX IF NOT EXISTS idx_instructions_priority ON instructions(priority);
CREATE INDEX IF NOT EXISTS idx_instructions_priority_tier ON instructions(priority_tier);
CREATE INDEX IF NOT EXISTS idx_instructions_audience ON instructions(audience);

CREATE TABLE IF NOT EXISTS usage (
  instruction_id TEXT PRIMARY KEY,
  usage_count INTEGER DEFAULT 0,
  first_seen_ts TEXT,
  last_used_at TEXT,
  last_action TEXT,
  last_signal TEXT,
  last_comment TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  sender TEXT NOT NULL,
  recipients TEXT NOT NULL DEFAULT '[]',
  body TEXT NOT NULL,
  priority TEXT DEFAULT 'normal',
  tags TEXT DEFAULT '[]',
  parent_id TEXT,
  persistent INTEGER DEFAULT 0,
  ttl_seconds INTEGER,
  requires_ack INTEGER DEFAULT 0,
  ack_by_seconds INTEGER,
  read_by TEXT DEFAULT '[]',
  payload TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender);
CREATE INDEX IF NOT EXISTS idx_messages_parent_id ON messages(parent_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);

CREATE TABLE IF NOT EXISTS metadata (
  key TEXT PRIMARY KEY,
  value TEXT
);

/* ── Archive lifecycle (schema v7 / spec 006-archive-lifecycle) ─────────────
 * Segregated table mirroring instructions columns plus archive metadata.
 * No FTS5 triggers are attached: archived entries are excluded from active
 * full-text search by construction.
 */
CREATE TABLE IF NOT EXISTS instructions_archive (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  rationale TEXT,
  priority INTEGER NOT NULL DEFAULT 50,
  audience TEXT NOT NULL DEFAULT 'all',
  requirement TEXT NOT NULL DEFAULT 'recommended',
  categories TEXT NOT NULL DEFAULT '[]',
  content_type TEXT NOT NULL DEFAULT 'instruction',
  primary_category TEXT,
  source_hash TEXT NOT NULL DEFAULT '',
  schema_version TEXT NOT NULL DEFAULT '7',
  deprecated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version TEXT DEFAULT '1.0.0',
  status TEXT DEFAULT 'approved',
  owner TEXT,
  priority_tier TEXT,
  classification TEXT DEFAULT 'public',
  last_reviewed_at TEXT,
  next_review_due TEXT,
  review_interval_days INTEGER,
  change_log TEXT DEFAULT '[]',
  supersedes TEXT,
  archived_at TEXT,
  workspace_id TEXT,
  user_id TEXT,
  team_ids TEXT DEFAULT '[]',
  semantic_summary TEXT,
  created_by_agent TEXT,
  source_workspace TEXT,
  extensions TEXT,
  risk_score REAL,
  usage_count INTEGER DEFAULT 0,
  first_seen_ts TEXT,
  last_used_at TEXT,
  archived_by TEXT,
  archive_reason TEXT,
  archive_source TEXT,
  restore_eligible INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_instructions_archive_archived_at ON instructions_archive(archived_at);
CREATE INDEX IF NOT EXISTS idx_instructions_archive_reason ON instructions_archive(archive_reason);
CREATE INDEX IF NOT EXISTS idx_instructions_archive_source ON instructions_archive(archive_source);
`;

/** FTS5 virtual table for full-text search. Created separately since it needs content sync. */
export const FTS5_DDL = `
CREATE VIRTUAL TABLE IF NOT EXISTS instructions_fts USING fts5(
  id, title, body, categories,
  content='instructions',
  content_rowid='rowid'
);

-- Triggers to keep FTS5 in sync with instructions table
CREATE TRIGGER IF NOT EXISTS instructions_ai AFTER INSERT ON instructions BEGIN
  INSERT INTO instructions_fts(rowid, id, title, body, categories) VALUES (new.rowid, new.id, new.title, new.body, new.categories);
END;
CREATE TRIGGER IF NOT EXISTS instructions_ad AFTER DELETE ON instructions BEGIN
  INSERT INTO instructions_fts(instructions_fts, rowid, id, title, body, categories) VALUES('delete', old.rowid, old.id, old.title, old.body, old.categories);
END;
CREATE TRIGGER IF NOT EXISTS instructions_au AFTER UPDATE ON instructions BEGIN
  INSERT INTO instructions_fts(instructions_fts, rowid, id, title, body, categories) VALUES('delete', old.rowid, old.id, old.title, old.body, old.categories);
  INSERT INTO instructions_fts(rowid, id, title, body, categories) VALUES (new.rowid, new.id, new.title, new.body, new.categories);
END;
`;

/** Enable WAL mode and recommended pragmas. */
export const PRAGMAS = `
PRAGMA journal_mode=WAL;
PRAGMA busy_timeout=5000;
PRAGMA synchronous=NORMAL;
PRAGMA foreign_keys=ON;
`;
