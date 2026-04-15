/**
 * handlers.promote.ts — promote_from_repo tool handler.
 *
 * Scans a local Git repository for promotable knowledge content (constitutions,
 * docs, instructions, specs) and upserts them into the instruction index.
 *
 * Content discovery order:
 *   1. .specify/config/promotion-map.json  (explicit source→instruction mappings)
 *   2. instructions/*.json                 (valid instruction JSON files)
 *
 * Dedup via SHA-256 content hashing against existing sourceHash in index.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { registerHandler } from '../server/registry';
import { ensureLoaded, writeEntry } from './indexContext';
import { ClassificationService } from './classificationService';
import { logAudit } from './auditLog';
import { SCHEMA_VERSION } from '../versioning/schemaVersion';
import type { InstructionEntry, RequirementLevel, ContentType } from '../models/instruction';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PromotionSource {
  path?: string;
  file?: string;
  id?: string;
  instructionId?: string;
  title: string;
  category?: string;
  scope?: string;
  categories?: string[];
  priority?: number;
  requirement?: string;
  contentType?: string;
  classification?: string;
}

interface PromotionMap {
  description?: string;
  sources: PromotionSource[];
}

interface PromoteParams {
  repoPath: string;
  scope?: 'all' | 'governance' | 'specs' | 'docs' | 'instructions';
  force?: boolean;
  dryRun?: boolean;
  repoId?: string;
}

interface FailedEntry { id: string; error: string }
interface DryRunEntry { id: string; title: string; action: 'add' | 'update' | 'skip' }

interface PromoteFromRepoResult {
  repoPath: string;
  repoId: string;
  promoted: string[];
  skipped: string[];
  failed: FailedEntry[];
  dryRunEntries?: DryRunEntry[];
  total: number;
  promotedAt: string;
}

// ---------------------------------------------------------------------------
// Scope → category mapping
// ---------------------------------------------------------------------------

const SCOPE_CATEGORIES: Record<string, Set<string>> = {
  governance: new Set(['governance', 'constitution', 'coding-standards']),
  docs: new Set(['architecture', 'onboarding']),
  specs: new Set(['spec']),
  instructions: new Set(['bootstrap', 'speckit', 'runbook', 'instruction']),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

const INSTRUCTION_ID_RE = /^[a-z0-9][a-z0-9\-_]{0,118}[a-z0-9]$/;

function isValidInstructionId(id: string): boolean {
  return INSTRUCTION_ID_RE.test(id);
}

function matchesScope(category: string, scope: string): boolean {
  if (scope === 'all') return true;
  const allowed = SCOPE_CATEGORIES[scope];
  return allowed ? allowed.has(category.toLowerCase()) : false;
}

function loadPromotionMap(repoPath: string): PromotionMap | null {
  const mapPath = path.join(repoPath, '.specify', 'config', 'promotion-map.json');
  if (!fs.existsSync(mapPath)) return null;
  try {
    const raw = fs.readFileSync(mapPath, 'utf8');
    const parsed = JSON.parse(raw) as PromotionMap;
    if (!parsed.sources || !Array.isArray(parsed.sources)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function buildEntryFromSource(
  source: PromotionSource,
  content: string,
  repoId: string,
): InstructionEntry {
  const now = new Date().toISOString();
  const sourceId = source.instructionId || source.id || 'unknown';
  const sourceCategory = source.category || source.scope || (Array.isArray(source.categories) ? source.categories[0] : undefined) || 'instruction';
  const extraCategories = Array.isArray(source.categories) ? source.categories : [];
  const allCategories = Array.from(new Set([sourceCategory, ...extraCategories, repoId]));
  return {
    id: sourceId,
    title: source.title,
    body: content,
    priority: source.priority ?? 50,
    audience: 'all',
    requirement: (source.requirement || 'recommended') as RequirementLevel,
    categories: allCategories,
    primaryCategory: sourceCategory,
    contentType: (source.contentType || 'instruction') as ContentType,
    sourceHash: sha256(content),
    schemaVersion: SCHEMA_VERSION,
    version: '1.0.0',
    status: 'approved',
    owner: 'promote_from_repo',
    classification: (source.classification || 'internal') as InstructionEntry['classification'],
    semanticSummary: `${source.title} — promoted from ${repoId} repository`,
    sourceWorkspace: repoId,
    createdByAgent: 'promote_from_repo',
    createdAt: now,
    updatedAt: now,
  };
}

// Scans .specify/config/promotion-map.json sources
function scanMappedSources(
  repoPath: string,
  map: PromotionMap,
  scope: string,
): Array<{ entry: InstructionEntry; hash: string; source: 'map' }> {
  const results: Array<{ entry: InstructionEntry; hash: string; source: 'map' }> = [];
  const repoId = path.basename(repoPath);

  for (const source of map.sources) {
    // Support both field naming conventions: path/file, instructionId/id, category/scope/categories
    const sourcePath = source.path || source.file;
    const sourceId = source.instructionId || source.id;
    const sourceCategory = source.category || source.scope || (Array.isArray(source.categories) ? source.categories[0] : undefined) || 'instruction';

    if (!sourcePath || !sourceId) continue; // skip entries missing required fields
    if (!matchesScope(sourceCategory, scope)) continue;

    const filePath = path.join(repoPath, sourcePath);
    const resolvedFile = path.resolve(filePath);
    const resolvedRepo = path.resolve(repoPath);
    if (!resolvedFile.startsWith(resolvedRepo + path.sep) && resolvedFile !== resolvedRepo) continue;
    if (!fs.existsSync(filePath)) continue;

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const hash = sha256(content);
      const entry = buildEntryFromSource(source, content, repoId);
      results.push({ entry, hash, source: 'map' });
    } catch {
      // skip unreadable files
    }
  }
  return results;
}

// Scans instructions/*.json in the repo
function scanInstructionFiles(
  repoPath: string,
): Array<{ entry: InstructionEntry; hash: string; source: 'file' }> {
  const results: Array<{ entry: InstructionEntry; hash: string; source: 'file' }> = [];
  const instrDir = path.join(repoPath, 'instructions');
  if (!fs.existsSync(instrDir) || !fs.statSync(instrDir).isDirectory()) return results;

  const files = fs.readdirSync(instrDir).filter(
    (f) => f.endsWith('.json') && !f.startsWith('_'),
  );

  for (const file of files) {
    const filePath = path.join(instrDir, file);
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;

      // Must have id, title, body to be a valid instruction
      if (!parsed.id || !parsed.title || !parsed.body) continue;
      if (typeof parsed.id !== 'string' || typeof parsed.title !== 'string' || typeof parsed.body !== 'string') continue;

      const hash = sha256(raw);
      const repoId = path.basename(repoPath);
      const now = new Date().toISOString();

      // Build entry from the file's own fields, filling gaps
      const entry: InstructionEntry = {
        id: parsed.id as string,
        title: parsed.title as string,
        body: parsed.body as string,
        rationale: (parsed.rationale as string) || undefined,
        priority: typeof parsed.priority === 'number' ? parsed.priority : 50,
        audience: (parsed.audience as InstructionEntry['audience']) || 'all',
        requirement: (parsed.requirement as RequirementLevel) || 'recommended',
        categories: Array.isArray(parsed.categories) ? parsed.categories as string[] : ['instruction'],
        primaryCategory: (parsed.primaryCategory as string) || (Array.isArray(parsed.categories) && parsed.categories.length ? parsed.categories[0] as string : 'instruction'),
        contentType: (parsed.contentType as ContentType) || 'instruction',
        sourceHash: hash,
        schemaVersion: SCHEMA_VERSION,
        version: (parsed.version as string) || '1.0.0',
        status: (parsed.status as InstructionEntry['status']) || 'approved',
        owner: (parsed.owner as string) || 'promote_from_repo',
        classification: (parsed.classification as InstructionEntry['classification']) || 'internal',
        semanticSummary: (parsed.semanticSummary as string) || `${parsed.title} — promoted from ${repoId}`,
        sourceWorkspace: repoId,
        createdByAgent: (parsed.createdByAgent as string) || 'promote_from_repo',
        createdAt: (parsed.createdAt as string) || now,
        updatedAt: now,
      };

      results.push({ entry, hash, source: 'file' });
    } catch {
      // skip malformed JSON
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Handler Registration
// ---------------------------------------------------------------------------

registerHandler('promote_from_repo', (params: PromoteParams) => {
  const { repoPath, scope = 'all', force = false, dryRun = false } = params;
  const repoId = params.repoId || path.basename(repoPath);

  // Validate repoPath
  if (!repoPath || typeof repoPath !== 'string') {
    return { error: 'repoPath is required and must be a string' };
  }
  if (!fs.existsSync(repoPath) || !fs.statSync(repoPath).isDirectory()) {
    return { error: `repoPath does not exist or is not a directory: ${repoPath}` };
  }

  const promoted: string[] = [];
  const skipped: string[] = [];
  const failed: FailedEntry[] = [];
  const dryRunEntries: DryRunEntry[] = [];

  // Collect candidates from promotion map + instruction files
  const candidates: Array<{ entry: InstructionEntry; hash: string; source: 'map' | 'file' }> = [];

  // 1. Promotion map
  const map = loadPromotionMap(repoPath);
  if (map) {
    candidates.push(...scanMappedSources(repoPath, map, scope));
  }

  // 2. Instruction files (when scope is 'all' or 'instructions')
  if (scope === 'all' || scope === 'instructions') {
    candidates.push(...scanInstructionFiles(repoPath));
  }

  // Dedup: if same ID appears from both map and file, prefer map
  const seen = new Set<string>();
  const deduped: typeof candidates = [];
  for (const c of candidates) {
    if (!seen.has(c.entry.id)) {
      seen.add(c.entry.id);
      deduped.push(c);
    }
  }

  // Load current index state
  let IndexState;
  try {
    IndexState = ensureLoaded();
  } catch (e) {
    return {
      repoPath,
      repoId,
      promoted: [],
      skipped: [],
      failed: [{ id: '*', error: `Failed to load index state: ${e instanceof Error ? e.message : String(e)}` }],
      total: deduped.length,
      promotedAt: new Date().toISOString(),
    };
  }
  const classifier = new ClassificationService();

  // Process each candidate
  for (const candidate of deduped) {
    const { entry, hash } = candidate;

    // Validate instruction ID format
    if (!isValidInstructionId(entry.id)) {
      failed.push({ id: entry.id, error: `Invalid instruction ID format: ${entry.id}` });
      continue;
    }

    // Validate entry has minimum required fields
    try {
      classifier.normalize(entry); // will throw if fundamentally invalid
    } catch (e) {
      failed.push({
        id: entry.id,
        error: `Schema validation failed: ${e instanceof Error ? e.message : String(e)}`,
      });
      continue;
    }

    // Ensure repoId is in categories
    if (!entry.categories.includes(repoId)) {
      entry.categories.push(repoId);
    }
    entry.sourceWorkspace = repoId;

    // Check existing entry for dedup
    const existing = IndexState.byId.get(entry.id);

    if (existing && existing.sourceHash === hash && !force) {
      // Hash unchanged — skip
      if (dryRun) {
        dryRunEntries.push({ id: entry.id, title: entry.title, action: 'skip' });
      }
      skipped.push(entry.id);
      continue;
    }

    const action: 'add' | 'update' = existing ? 'update' : 'add';

    if (dryRun) {
      dryRunEntries.push({ id: entry.id, title: entry.title, action });
      continue;
    }

    // Write entry to index
    try {
      writeEntry(entry);
      promoted.push(entry.id);

      logAudit('promote_from_repo', entry.id, {
        repoPath,
        repoId,
        action,
        sourceHash: hash,
      });
    } catch (e) {
      failed.push({
        id: entry.id,
        error: `Write failed: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  // writeEntry() already calls touchIndexVersion() for each entry,
  // so no explicit touch needed here.

  const result: PromoteFromRepoResult = {
    repoPath,
    repoId,
    promoted,
    skipped,
    failed,
    total: deduped.length,
    promotedAt: new Date().toISOString(),
  };

  if (dryRun) {
    result.dryRunEntries = dryRunEntries;
  }

  return result;
});
