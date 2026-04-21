import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getInstructionsDir } from './indexContext';
import { logInfo } from './logger';
import { getRuntimeConfig } from '../config/runtimeConfig';

/**
 * Automatic bootstrap seeding (Option B: create only if missing).
 *
 * Creates the two canonical baseline instruction files when BOTH of these are true:
 *  - INDEX_SERVER_AUTO_SEED !== '0' (default on)
 *  - Target instructions directory is empty OR any of the seed files are missing
 *
 * Never overwrites existing files. Idempotent and safe under concurrent multi-process
 * startup (best‑effort). Creation uses write-to-temp + rename for atomicity to avoid
 * partially written JSON on crashes.
 */

export interface SeedSummary {
  dir: string;
  created: string[];       // file basenames created this invocation
  existing: string[];      // seeds already present
  skipped: string[];       // seeds skipped (already existed)
  disabled: boolean;       // seeding disabled by env
  reason?: string;         // explanatory note
  hash: string;            // hash of canonical content (determinism aid)
}

interface CanonicalSeed { file: string; id: string; json: Record<string, unknown>; }

// Canonical seed instruction objects (kept intentionally minimal – DO NOT add environment specific data)
const CANONICAL_SEEDS: CanonicalSeed[] = [
  {
    file: '000-bootstrapper.json',
    id: '000-bootstrapper',
    json: {
      id: '000-bootstrapper',
      title: 'Index Server - AI Agent Quick Start',
      body: `# Index Server: AI Agent Quick Start

Index Server is a shared knowledge base for AI agents via MCP. Agents search, read, and contribute instructions that persist across sessions and repositories.

## Verify Connection

\`\`\`json
{"method": "health_check", "params": {}}
\`\`\`

Success → skip to "How to Use" below. Error → see "Setup" at the end.

---

## How to Use

### Search First (always)

**Before creating, promoting, or rewriting instructions, search for existing ones:**

\`\`\`json
{"method": "index_search", "params": {"keywords": ["deployment", "docker"]}}
\`\`\`

Then retrieve the full content of a match:

\`\`\`json
{"method": "index_dispatch", "params": {"action": "get", "id": "instruction-id-from-search"}}
\`\`\`

Search when the task involves patterns, standards, prior approaches, governance, shared guidance, or cross-repo learnings.

### Browse & Discover

| Task | Tool | Params |
|------|------|--------|
| List all instructions | \`index_dispatch\` | \`{"action": "list"}\` |
| Browse categories | \`index_dispatch\` | \`{"action": "categories"}\` |
| Search by keywords | \`index_search\` | \`{"keywords": ["term1", "term2"]}\` |
| Get by ID | \`index_dispatch\` | \`{"action": "get", "id": "..."}\` |
| Server health | \`health_check\` | \`{}\` |
| All available tools | \`meta_tools\` | \`{}\` |
| Help & overview | \`help_overview\` | \`{}\` |

### When to Use Index Server

**Use for:** Cross-repo patterns, architecture decisions, coding standards, troubleshooting runbooks, security policies, onboarding guides, and validated learnings from past sessions.

**Don't use for:** Reading current file contents (use repo files directly), ephemeral task notes, or repo-private secrets.

---

## Contributing Knowledge

### Search → Validate Locally → Promote

1. **Search first** — check if similar guidance already exists
2. **Start local** — create new instructions in your repo's \`.instructions/\` directory
3. **Validate** — use across multiple sessions to prove value
4. **Promote** — move proven patterns to the shared index:

\`\`\`json
{"method": "promote_from_repo", "params": {"repoPath": "/path/to/repo"}}
\`\`\`

Or add directly:

\`\`\`json
{"method": "index_add", "params": {"entry": {"id": "my-guide", "title": "My Guide", "body": "Content..."}, "lax": true}}
\`\`\`

### Maintenance

- \`index_groom\` — clean duplicates and stale entries
- \`index_governanceUpdate\` — deprecate outdated content (don't silently delete)
- \`feedback_dispatch\` with action="submit" — report issues or request features
- \`usage_track\` — signal when guidance was helpful or outdated

---

## Copilot Instructions Setup

Add these to your copilot instructions so agents always know about the knowledge base.

### Global (~/.github/copilot-instructions.md)

\`\`\`markdown
## Index Server
- If index-server MCP tools are available, use them as a shared knowledge base for validated cross-repo patterns and standards.
- Search before creating: use index_search with 2-5 keywords, then index_dispatch with action="get" for details.
- After learning something reusable, add it with index_add or promote from a repo with promote_from_repo.
- Index entries are promoted snapshots — always prefer current repo files over index content.
\`\`\`

### Per-Repo (.github/copilot-instructions.md)

\`\`\`markdown
## Index Server Integration
- Search order: repo files → .instructions/ → index-server → external docs
- Search before add/promote: always search for existing guidance before creating new instructions.
- To retrieve: index_search → index_dispatch with action="get" and the instruction ID
- To contribute: validate locally in .instructions/ first, then promote with promote_from_repo
- To maintain: use index_groom to clean duplicates, index_governanceUpdate to deprecate stale content
- Current repo state always wins over promoted index snapshots
\`\`\`

---

## Setup (if not yet configured)

### VS Code (.vscode/mcp.json)

\`\`\`json
{"servers": {"index-server": {"type": "stdio", "command": "npx", "args": ["@jagilber-org/index-server@latest", "--dashboard"]}}}
\`\`\`

### Copilot CLI (~/.copilot/mcp-config.json)

\`\`\`json
{"mcpServers": {"index-server": {"type": "stdio", "command": "npx", "args": ["@jagilber-org/index-server@latest", "--dashboard"], "tools": ["*"]}}}
\`\`\`

### Claude Desktop (claude_desktop_config.json)

\`\`\`json
{"mcpServers": {"index-server": {"type": "stdio", "command": "npx", "args": ["@jagilber-org/index-server@latest", "--dashboard"], "tools": ["*"]}}}
\`\`\`

### Docker

\`\`\`bash
docker compose up  # HTTP on :8787
\`\`\`

Restart your MCP client after configuration changes. Verify with \`health_check\`.

For full configuration options: see \`docs/mcp_configuration.md\` and \`docs/configuration.md\`.`,
      audience: 'agents',
      requirement: 'required',
      priority: 100,
      categories: ['bootstrap','mcp-activation','quick-start','documentation'],
      owner: 'system',
      version: 3,
      schemaVersion: '4',
      semanticSummary: 'Index Server quick start: search-first workflow, knowledge contribution, copilot instructions setup, and MCP client configuration for AI agents'
    }
  },
  {
    file: '001-lifecycle-bootstrap.json',
    id: '001-lifecycle-bootstrap',
    json: {
      id: '001-lifecycle-bootstrap',
      title: 'Lifecycle Bootstrap: Local-First Instruction Strategy',
      body: 'Purpose: Early lifecycle guidance after bootstrap confirmation. Keep index minimal; prefer local-first P0/P1 additions; promote only after stability.',
      audience: 'agents',
      requirement: 'recommended',
      priorityTier: 'p1',
      categories: ['bootstrap','lifecycle'],
      owner: 'system',
      version: 1,
      schemaVersion: '4',
      semanticSummary: 'Lifecycle and promotion guardrails after bootstrap confirmation',
      reviewIntervalDays: 120
    }
  }
];

function computeCanonicalHash(): string {
  const canonical = CANONICAL_SEEDS.map(s => ({ id: s.id, file: s.file, json: s.json })).sort((a,b)=>a.id.localeCompare(b.id));
  return crypto.createHash('sha256').update(JSON.stringify(canonical),'utf8').digest('hex');
}

/**
 * Run automatic bootstrap seeding if enabled. Creates canonical seed files only when they are
 * absent — never overwrites existing content. Safe under concurrent multi-process startup.
 * @returns A {@link SeedSummary} describing what was created, skipped, or already present
 */
export function autoSeedBootstrap(): SeedSummary {
  const cfg = getRuntimeConfig().bootstrapSeed;
  const disabled = !cfg.autoSeed;
  const dir = safeInstructionsDir();
  const summary: SeedSummary = { dir, created: [], existing: [], skipped: [], disabled, hash: computeCanonicalHash() };
  if(disabled){ summary.reason = 'disabled_by_env'; return summary; }

  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  // Probe directory existence (previously stored entries unused; keep check for side effects)
  try { fs.readdirSync(dir); } catch { /* ignore */ }

  for(const seed of CANONICAL_SEEDS){
    const target = path.join(dir, seed.file);
    const exists = fs.existsSync(target);
    if(exists){
      summary.existing.push(seed.file);
      summary.skipped.push(seed.file);
      continue; // do not overwrite
    }
    // Directory empty OR missing seed triggers creation.
    try {
      const tmp = path.join(dir, `.${seed.file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
      fs.writeFileSync(tmp, JSON.stringify(seed.json, null, 2), { encoding: 'utf8' });
      fs.renameSync(tmp, target);
      summary.created.push(seed.file);
    } catch (e){
      summary.reason = `partial_failure ${(e instanceof Error)? e.message: String(e)}`;
    }
  }

  if(getRuntimeConfig().bootstrapSeed.verbose){
    try { process.stderr.write(`[seed] dir="${dir}" created=${summary.created.length} existing=${summary.existing.length} disabled=${summary.disabled} hash=${summary.hash}\n`); } catch { /* ignore */ }
  }
  try { logInfo('[seedBootstrap] Seed summary', summary); } catch { /* ignore */ }
  return summary;
}

function safeInstructionsDir(): string {
  try {
    return getInstructionsDir();
  } catch {
    return path.join(process.cwd(), 'instructions');
  }
}

// Test helper re-export for direct validation
/**
 * Return the list of canonical seed file/id pairs (without JSON bodies) for test assertions.
 * @returns Array of `{ file, id }` objects for each canonical seed
 */
export function _getCanonicalSeeds(){ return CANONICAL_SEEDS.map(s => ({ file: s.file, id: s.id })); }
