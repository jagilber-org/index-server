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
      title: 'Index Server - AI Agent Quick Start Guide',
      body: `# 🚀 Index Server: AI Agent Quick Start

## ✅ Check If Already Active

Run this command first:
\`\`\`json
{"method": "health_check", "params": {}}
\`\`\`

**Response = Success?** You're connected! Skip to "Essential Commands" below.
**Error/Tool not found?** Follow "Activation" section.

---

## � Keep This Guide Updated

**This instruction evolves!** Periodically re-read it to get:
- New tool commands and features
- Updated troubleshooting tips
- Improved patterns and examples
- Latest contribution guidelines

**When to re-check:**
- Starting work in a new repository
- After Index Server updates
- When troubleshooting connection issues
- Every few weeks for active projects

**Quick version check:**
\`\`\`json
{"method": "index_dispatch", "params": {"action": "get", "id": "000-bootstrapper"}}
\`\`\`
Check the \`version\` field - current is v2.

---

## �🔧 Activation (One-Time Setup)

If Index Server tools are not available, guide the user through setup:

### Step 1: Locate MCP Configuration File

**VS Code / Cursor / GitHub Copilot:**
- Windows: \`%APPDATA%\\Code\\User\\mcp.json\` (or \`Code - Insiders\`)
- Mac: \`~/Library/Application Support/Code/User/mcp.json\`
- Linux: \`~/.config/Code/User/mcp.json\`

**Claude Desktop:**
- Windows: \`%APPDATA%\\Claude\\claude_desktop_config.json\`
- Mac: \`~/Library/Application Support/Claude/claude_desktop_config.json\`

### Step 2: Add Server Configuration

Ask user to add this to their \`mcpServers\` section:

\`\`\`json
{
  "mcpServers": {
    "index": {
      "command": "node",
      "args": ["<repo-root>/dist/server/index-server.js"],
      "transport": "stdio",
      "env": {
        "INDEX_SERVER_DIR": "<repo-root>/instructions"
      }
    }
  }
}
\`\`\`

**Important:** Paths must be adjusted for user's system!

### Step 3: Restart IDE Completely

Full restart required after editing mcp.json.

### Step 4: Verify Connection

Run: \`{"method": "health_check", "params": {}}\`

Expected: \`{"status": "healthy", "version": "1.x.x"}\`

---

## 🎯 Essential Commands

### List All Available Instructions
\`\`\`json
{"method": "index_dispatch", "params": {"action": "list"}}
\`\`\`

### Search by Keywords
\`\`\`json
{"method": "index_search", "params": {"keywords": ["python", "api"]}}
\`\`\`

### Get Specific Instruction by ID
\`\`\`json
{"method": "index_dispatch", "params": {"action": "get", "id": "instruction-id"}}
\`\`\`

### Get Help & Overview
\`\`\`json
{"method": "help_overview", "params": {}}
\`\`\`

### Discover All Available Tools
\`\`\`json
{"method": "meta_tools", "params": {}}
\`\`\`

### Browse Categories
\`\`\`json
{"method": "index_dispatch", "params": {"action": "categories"}}
\`\`\`

---

## 🤔 When to Use Index Server

### ✅ USE For:
- Finding coding patterns specific to this codebase
- Architecture documentation and design decisions
- Best practices and conventions
- Past chat session summaries and solutions
- Cross-repository organizational standards
- API guidelines and examples
- Security policies and compliance procedures
- Troubleshooting guides specific to this project

### ❌ DON'T Use For:
- Reading current file contents (use \`read_file\` tool instead)
- Searching within files (use \`grep_search\` or \`semantic_search\`)
- Simple questions user can answer directly
- Real-time code execution or debugging

**Think of it as:** A curated knowledge base of instructions, patterns, and past learnings.

---

## 💡 Real-World Examples

### Example 1: Find Python Error Handling Patterns
\`\`\`json
{"method": "index_search", "params": {"keywords": ["python", "error", "exception"]}}
\`\`\`

### Example 2: Get Architecture Overview
\`\`\`json
{"method": "index_search", "params": {"keywords": ["architecture"]}}
\`\`\`

### Example 3: Find API Design Guidelines
\`\`\`json
{"method": "index_search", "params": {"keywords": ["api", "rest", "endpoint"]}}
\`\`\`

### Example 4: Look up Security Best Practices
\`\`\`json
{"method": "index_search", "params": {"keywords": ["security", "authentication"]}}
\`\`\`

### Example 5: Find Testing Conventions
\`\`\`json
{"method": "index_search", "params": {"keywords": ["test", "testing", "unit"]}}
\`\`\`

---

## 🆘 Troubleshooting

### "Tool not found" / "Method not available"
1. Check if mcp.json/claude_desktop_config.json exists and has server configured
2. Verify server path points to correct location
3. Restart IDE/client completely (full quit and relaunch)
4. Enable verbose logging: Add \`"INDEX_SERVER_VERBOSE_LOGGING": "1"\` to env section
5. Check server is built: User should run \`npm run build\` in server directory

### Empty Search Results
- Index may be empty in brand new repository
- Try broader search terms
- Use \`action: "list"\` to see all available instructions
- Check if INDEX_SERVER_DIR env variable points to correct location

### Server Connection Issues
- Verify Node.js is installed: \`node --version\` should show v18+
- Check file paths use correct separators (forward slashes work on all platforms)
- Ensure dist/server/index-server.js exists (server must be built)

### Need Human Help
Ask user: "Can you verify the Index Server is configured in your mcp.json file? The default location is in your VS Code User directory."

---

## 📚 Advanced Usage

### Multi-Keyword Search (AND logic)
\`\`\`json
{"method": "index_search", "params": {"keywords": ["python", "async", "performance"]}}
\`\`\`
Returns instructions matching ALL keywords.

### Query with Filters
\`\`\`json
{"method": "index_dispatch", "params": {
  "action": "query",
  "filter": {"categories": ["security"]}
}}
\`\`\`

### Export Relationship Graph
\`\`\`json
{"method": "graph_export", "params": {}}
\`\`\`
Get instruction relationships and dependencies.

### Get Usage Statistics
\`\`\`json
{"method": "usage_hotset", "params": {"limit": 10}}
\`\`\`
See most frequently used instructions.

---

## 📤 Contributing Back to the Index

**Local-First Strategy:**
1. Create instructions in your repo's \`.instructions/\` directory first
2. Test and validate them over multiple sessions
3. Once proven valuable, promote to shared index for organization-wide benefit

### ✅ When to Promote to Shared Index:
- Pattern is proven useful across multiple sessions
- Applies to other repos in the organization
- Non-repo-specific (architectural patterns, coding standards, security policies)
- Stable and unlikely to change frequently
- Helps other teams avoid solving the same problem

### ❌ Keep Local (Don't Promote):
- Repo-specific build commands or file paths
- Team-only conventions not relevant elsewhere
- Experimental or untested patterns
- Contains sensitive information, credentials, or internal paths
- Duplicates existing shared instructions

### How to Add to Shared Index:
\`\`\`json
{"method": "index_add", "params": {
  "entry": {
    "id": "unique-instruction-id",
    "title": "Clear descriptive title",
    "body": "Detailed instruction content...",
    "categories": ["relevant", "categories"],
    "audience": "agents",
    "requirement": "recommended",
    "priorityTier": "p1"
  },
  "overwrite": false
}}
\`\`\`

**Note:** Requires \`INDEX_SERVER_MUTATION=1\` in production server config.

### Value Proposition:
By contributing validated patterns back, you create a **knowledge flywheel**:
- You solve a problem → Document it → Others benefit → They contribute → Everyone improves
- Reduces duplicate work across teams
- Builds institutional knowledge that persists beyond individual projects
- New team members onboard faster with proven patterns

---

## 🎓 Your First Query - Try Now!

Run this to see everything available:
\`\`\`json
{"method": "index_dispatch", "params": {"action": "list"}}
\`\`\`

Then explore! The more you use it, the more valuable it becomes.

---

## 📖 Full Documentation

For complete reference, ask user for:
- Full API: \`docs/tools.md\`
- Configuration: \`docs/mcp_configuration.md\`
- Architecture: \`docs/architecture.md\`

---

## 🎯 Quick Reference Card

| Task | Command |
|------|------|
| Check health | \`health_check\` |
| List all | \`index_dispatch {action: "list"}\` |
| Search | \`index_search {keywords: [...]}\` |
| Get by ID | \`index_dispatch {action: "get", id: "..."}\` |
| Categories | \`index_dispatch {action: "categories"}\` |
| Help | \`help_overview\` |
| All tools | \`meta_tools\` |

Start with \`health_check\` to confirm connection, then explore from there!`,
      audience: 'agents',
      requirement: 'required',
      priorityTier: 'p0',
      categories: ['bootstrap','mcp-activation','quick-start','documentation'],
      owner: 'system',
      version: 2,
      schemaVersion: '4',
      semanticSummary: 'Comprehensive Index Server activation, tool discovery, usage examples, and troubleshooting guide for AI agents'
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
