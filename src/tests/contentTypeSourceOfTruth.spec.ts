/**
 * Source-of-truth drift scanner (every schema enum).
 *
 * Fails if any source file (outside an explicit allowlist) contains a hand-typed
 * concentration of canonical enum literals for ANY of the schema enums
 * (contentType, audience, requirement, status, priorityTier, classification).
 * The canonical enums live in schemas/instruction.schema.json — everything else
 * must derive from them via src/models/instruction.ts (parity-guarded at module
 * load).
 *
 * Detection heuristic: for each enum, look for a code block / array / enum that
 * contains at least ceil(N * 0.7) of the N canonical values on adjacent lines
 * or within a 12-line window, with a floor of 3 hits. This is tight enough to
 * catch realistic duplications while keeping false positives near zero (no
 * normal prose file concentrates this many specific identifiers).
 *
 * Allowlist contains the JSON schema itself and the TS module that exists
 * specifically to bridge JSON → typed literal tuples (and is guarded at module
 * load by a parity throw — see src/models/instruction.ts).
 */

import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import canonicalSchema from '../../schemas/instruction.schema.json';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

// Canonical enums read from JSON (single source of truth).
type SchemaProps = { properties: Record<string, { enum?: unknown }> };
function canonicalEnum(field: string): readonly string[] {
  const e = (canonicalSchema as SchemaProps).properties[field]?.enum;
  if (!Array.isArray(e)) throw new Error(`canonical schema lacks enum for ${field}`);
  return e as string[];
}

// Table-of-truth for the scan. Adding a new schema enum is a one-line change
// here AND in src/models/instruction.ts ENUM_GUARDS.
const SCHEMA_ENUMS = [
  'contentType',
  'audience',
  'requirement',
  'status',
  'priorityTier',
  'classification',
] as const;

// Files explicitly allowed to mention the full set of values per enum.
//   - The JSON schema (canonical source).
//   - src/models/instruction.ts (typed bridge; parity-guarded at module load).
//   - Tests that intentionally enumerate values to assert canonical behavior.
//   - Documentation that documents the taxonomy.
//   - Generated files (regenerated from canonical sources by `npm run build`).
//   - Migration / coercion / compat layers (legacy-input remapping; canonical
//     values must appear as RHS of coercion maps and as decision-branch
//     return values).
//   - Helper scripts (.mjs/.js) that enumerate canonical values for decision
//     logic. These import the canonical JSON or use values directly; they
//     are short and their drift risk is bounded by the matrix test on the
//     primary server surfaces.
const ALLOWLIST = new Set<string>([
  // Canonical
  'schemas/instruction.schema.json',
  // Typed bridge with module-load parity guard
  'src/models/instruction.ts',
  // Tests that exist to assert taxonomy / drift behavior
  'src/tests/contentTypesTaxonomy.spec.ts',
  'src/tests/contentTypeMatrix.spec.ts',
  'src/tests/contentTypeSourceOfTruth.spec.ts',
  'src/tests/contentTypePreservation.spec.ts',
  'src/tests/contentTypesSeed.spec.ts',
  'src/tests/instructionSchema.spec.ts',
  'src/tests/unit/enumValidation.spec.ts',
  // Documentation describing the taxonomy
  'docs/project_prd.md',
  'docs/architecture.md',
  'docs/tools.md',
  'docs/TOOLS-GENERATED.md',
  'docs/content_guidance.md',
  // Generated schemas (regenerated each build from the canonical sources)
  'schemas/json-schema/instruction-audience-scope.schema.json',
  'schemas/json-schema/instruction-classification.schema.json',
  'schemas/json-schema/instruction-content-type.schema.json',
  'schemas/json-schema/instruction-governance-status.schema.json',
  'schemas/json-schema/instruction-instruction-entry.schema.json',
  'schemas/json-schema/instruction-priority-tier.schema.json',
  'schemas/json-schema/instruction-requirement-level.schema.json',
  // Coercion / compatibility layers: enumerate canonical values as RHS of
  // legacy-input → canonical maps (e.g. 'system' → 'all', 'MUST' → 'mandatory').
  // These files DO import the typed tuples from src/models/instruction for
  // the canonical set; the additional literal occurrences are required for
  // legacy-input remapping logic.
  'src/services/indexLoader.ts',
  'src/services/instructionRecordValidation.ts',
  // Decision-branch logic: priority → tier mapping has to enumerate each
  // tier in a return / ternary expression. These files DO import PriorityTier
  // from src/models/instruction for the type.
  'src/services/classificationService.ts',
  'src/versioning/schemaVersion.ts',
  // Dashboard route declares request-validation messages that enumerate the
  // canonical values; values are still the canonical set.
  'src/dashboard/server/routes/instructions.routes.ts',
  // Governance-update tool intentionally advertises a 3-of-4 subset of
  // STATUSES (excludes 'review' per PROJECT_PRD Governance Hash Integrity
  // Policy). The subset is asserted to be ⊂ STATUSES by contentTypeMatrix.spec.ts.
  'src/services/toolRegistry.ts',
  'src/services/toolRegistry.zod.ts',
  // Scripts using canonical values for one-shot validation / migration logic.
  // Low drift risk: these scripts are tooling and don't define the contract.
  'scripts/dev/integrity/validation-probe.mjs',
  'scripts/governance/lint-instructions.mjs',
  'scripts/migration/normalize-instructions.js',
]);

// Directories never scanned (third-party / build output / data / VCS).
const SKIP_DIRS = new Set<string>([
  'node_modules',
  'dist',
  '.git',
  'coverage',
  'test-results',
  'test-artifacts',
  'logs',
  'tmp',
  'backups',
  'data',
  'snapshots',
  'metrics',
  '.specify',
  'feedback',
  'instructions', // promoted content; not source
  'archive',      // schemas/archive/** — historical generated snapshots
  '.devsandbox',  // local dev sandbox exports (not source)
]);

const FILE_EXTS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.yaml', '.yml']);

async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      yield* walk(path.join(dir, e.name));
    } else if (e.isFile()) {
      const ext = path.extname(e.name);
      if (FILE_EXTS.has(ext)) yield path.join(dir, e.name);
    }
  }
}

function toRel(abs: string): string {
  return path.relative(REPO_ROOT, abs).split(path.sep).join('/');
}

/**
 * For a given canonical enum, detect duplication: at least threshold values
 * appearing within a 12-line window in the same file.
 */
function findEnumDuplication(
  content: string,
  canonical: readonly string[],
  threshold: number,
): { hits: string[] } | null {
  const lines = content.split(/\r?\n/);
  const WINDOW = 12;
  const quotedRegexes = canonical.map(v => ({
    value: v,
    // Match each literal as a whole token, quoted (single, double, or backtick).
    // Avoids matching the word "agent" or "skill" inside arbitrary prose.
    re: new RegExp(`['"\`]${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`),
  }));
  for (let i = 0; i < lines.length; i++) {
    const slice = lines.slice(i, i + WINDOW).join('\n');
    const hits = quotedRegexes.filter(({ re }) => re.test(slice)).map(({ value }) => value);
    if (hits.length >= threshold) {
      return { hits };
    }
  }
  return null;
}

function thresholdFor(canonical: readonly string[]): number {
  // 70% of the enum, floor 3, cap N. Small enums (3 values) → 3-of-3.
  return Math.max(3, Math.ceil(canonical.length * 0.7));
}

describe('schema enum source of truth — no rogue enum copies', () => {
  it.each(SCHEMA_ENUMS.map(f => [f] as const))(
    'no non-allowlisted file declares a hand-typed copy of the "%s" enum',
    async (field) => {
      const canonical = canonicalEnum(field);
      const threshold = thresholdFor(canonical);
      // Coarse pre-filter threshold: must contain at least min(3, threshold)
      // canonical literals anywhere; otherwise skip the windowed scan.
      const coarseFloor = Math.min(3, threshold);
      const offenders: Array<{ file: string; hits: string[] }> = [];
      for await (const abs of walk(REPO_ROOT)) {
        const rel = toRel(abs);
        if (ALLOWLIST.has(rel)) continue;
        const content = await fs.readFile(abs, 'utf8');
        let coarseHits = 0;
        for (const v of canonical) {
          if (
            content.includes(`'${v}'`) ||
            content.includes(`"${v}"`) ||
            content.includes(`\`${v}\``)
          ) {
            coarseHits++;
            if (coarseHits >= coarseFloor) break;
          }
        }
        if (coarseHits < coarseFloor) continue;
        const hit = findEnumDuplication(content, canonical, threshold);
        if (hit) offenders.push({ file: rel, hits: hit.hits });
      }
      expect(
        offenders,
        offenders.length === 0
          ? ''
          : `Found ${offenders.length} file(s) containing a hand-typed copy of the "${field}" enum ` +
            `(threshold: ${threshold} of ${canonical.length} canonical values within a 12-line window). ` +
            `These must derive from schemas/instruction.schema.json instead:\n` +
            offenders.map(o => `  - ${o.file}  (matched: ${o.hits.join(', ')})`).join('\n') +
            `\n\nFix options:\n` +
            `  (a) Import the corresponding tuple (CONTENT_TYPES, AUDIENCES, REQUIREMENTS, STATUSES, PRIORITY_TIERS, CLASSIFICATIONS) from 'src/models/instruction' (parity-guarded at module load).\n` +
            `  (b) Read schemas/instruction.schema.json directly at runtime.\n` +
            `  (c) If the file legitimately documents the taxonomy, add its path to ALLOWLIST in ${toRel(__filename)}.`,
      ).toEqual([]);
    },
  );

  it('every schema enum field has at least one canonical value', () => {
    for (const f of SCHEMA_ENUMS) {
      expect(canonicalEnum(f).length).toBeGreaterThan(0);
    }
  });
});

/**
 * Sibling drift scanner for non-schema MCP protocol enums.
 *
 * Source modules:
 *   - src/services/feedbackStorage.ts → FEEDBACK_TYPES, FEEDBACK_SEVERITIES, FEEDBACK_STATUSES
 *   - src/services/protocolEnums.ts   → USAGE_ACTIONS, USAGE_SIGNALS, SEARCH_MODES, TOOL_TIERS
 *   - src/dashboard/types/severity.ts → SEVERITY_LEVELS (dashboard 4-level scale)
 *
 * Heuristic and allowlist semantics match the schema-enum scanner above.
 */
import {
  FEEDBACK_TYPES,
  FEEDBACK_SEVERITIES,
  FEEDBACK_STATUSES,
} from '../services/feedbackStorage';
import {
  USAGE_ACTIONS,
  USAGE_SIGNALS,
  SEARCH_MODES,
  TOOL_TIERS,
} from '../services/protocolEnums';
import { SEVERITY_LEVELS } from '../dashboard/types/severity';
import { TREND_DIRECTIONS, EXTENDED_TREND_DIRECTIONS } from '../lib/trendDirection';
import { LOG_LEVELS_LOWER, LOG_LEVELS_UPPER } from '../lib/logLevels';
import { HEALTH_STATUSES, EXTENDED_HEALTH_STATUSES } from '../dashboard/types/healthStatus';
import {
  ANOMALY_TYPES,
  RECOMMENDATION_TYPES,
  ALERT_CATEGORIES,
  ALERT_SEVERITIES,
  EFFORT_LEVELS,
} from '../dashboard/types/analyticsEnums';
import { MCP_PROFILES } from '../services/mcpConfig/flagCatalog';
import { INSTANCE_MODES, INSTANCE_ROLES } from '../lib/instanceTopology';

const PROTOCOL_ENUMS: Array<{ name: string; values: readonly string[]; sotModule: string }> = [
  { name: 'feedbackType', values: FEEDBACK_TYPES, sotModule: 'src/services/feedbackStorage.ts (FEEDBACK_TYPES)' },
  { name: 'feedbackSeverity', values: FEEDBACK_SEVERITIES, sotModule: 'src/services/feedbackStorage.ts (FEEDBACK_SEVERITIES)' },
  { name: 'feedbackStatus', values: FEEDBACK_STATUSES, sotModule: 'src/services/feedbackStorage.ts (FEEDBACK_STATUSES)' },
  { name: 'usageAction', values: USAGE_ACTIONS, sotModule: 'src/services/protocolEnums.ts (USAGE_ACTIONS)' },
  { name: 'usageSignal', values: USAGE_SIGNALS, sotModule: 'src/services/protocolEnums.ts (USAGE_SIGNALS)' },
  { name: 'searchMode', values: SEARCH_MODES, sotModule: 'src/services/protocolEnums.ts (SEARCH_MODES)' },
  { name: 'toolTier', values: TOOL_TIERS, sotModule: 'src/services/protocolEnums.ts (TOOL_TIERS)' },
  { name: 'severityLevel', values: SEVERITY_LEVELS, sotModule: 'src/dashboard/types/severity.ts (SEVERITY_LEVELS)' },
  { name: 'trendDirection', values: TREND_DIRECTIONS, sotModule: 'src/lib/trendDirection.ts (TREND_DIRECTIONS)' },
  { name: 'extendedTrendDirection', values: EXTENDED_TREND_DIRECTIONS, sotModule: 'src/lib/trendDirection.ts (EXTENDED_TREND_DIRECTIONS)' },
  { name: 'logLevelLower', values: LOG_LEVELS_LOWER, sotModule: 'src/lib/logLevels.ts (LOG_LEVELS_LOWER)' },
  { name: 'logLevelUpper', values: LOG_LEVELS_UPPER, sotModule: 'src/lib/logLevels.ts (LOG_LEVELS_UPPER)' },
  { name: 'healthStatus', values: HEALTH_STATUSES, sotModule: 'src/dashboard/types/healthStatus.ts (HEALTH_STATUSES)' },
  { name: 'extendedHealthStatus', values: EXTENDED_HEALTH_STATUSES, sotModule: 'src/dashboard/types/healthStatus.ts (EXTENDED_HEALTH_STATUSES)' },
  { name: 'anomalyType', values: ANOMALY_TYPES, sotModule: 'src/dashboard/types/analyticsEnums.ts (ANOMALY_TYPES)' },
  { name: 'recommendationType', values: RECOMMENDATION_TYPES, sotModule: 'src/dashboard/types/analyticsEnums.ts (RECOMMENDATION_TYPES)' },
  { name: 'alertCategory', values: ALERT_CATEGORIES, sotModule: 'src/dashboard/types/analyticsEnums.ts (ALERT_CATEGORIES)' },
  { name: 'alertSeverity', values: ALERT_SEVERITIES, sotModule: 'src/dashboard/types/analyticsEnums.ts (ALERT_SEVERITIES)' },
  { name: 'effortLevel', values: EFFORT_LEVELS, sotModule: 'src/dashboard/types/analyticsEnums.ts (EFFORT_LEVELS)' },
  { name: 'mcpProfile', values: MCP_PROFILES, sotModule: 'src/services/mcpConfig/flagCatalog.ts (MCP_PROFILES)' },
  { name: 'instanceMode', values: INSTANCE_MODES, sotModule: 'src/lib/instanceTopology.ts (INSTANCE_MODES)' },
  { name: 'instanceRole', values: INSTANCE_ROLES, sotModule: 'src/lib/instanceTopology.ts (INSTANCE_ROLES)' },
];

// Allowlist for protocol enums: SOT modules, the registries that intentionally
// reference the tuples (and were verified to import them), and tests / docs
// that enumerate values to assert behavior.
const PROTOCOL_ALLOWLIST = new Set<string>([
  // SOT modules
  'src/services/feedbackStorage.ts',
  'src/services/protocolEnums.ts',
  'src/dashboard/types/severity.ts',
  'src/lib/trendDirection.ts',
  'src/lib/logLevels.ts',
  'src/dashboard/types/healthStatus.ts',
  'src/dashboard/types/analyticsEnums.ts',
  'src/services/mcpConfig/flagCatalog.ts',
  'src/lib/instanceTopology.ts',
  // Registries import the tuples; the duplicated literal forms have been
  // replaced with [...TUPLE] / z.enum(TUPLE). Still in the file as
  // governanceUpdate (status subset) and tier comments — allowlisted.
  'src/services/toolRegistry.ts',
  'src/services/toolRegistry.zod.ts',
  // Handlers that consume the tuples directly.
  'src/services/handlers.feedback.ts',
  'src/services/handlers.usage.ts',
  'src/services/handlers.search.ts',
  // Decision-branch handler enumerates usage signals in if/else chain
  // (no array literal; uses imported SearchMode/SignalEnum types).
  'src/services/handlers/instructions.groom.ts',
  // Dashboard route consumes FEEDBACK_* tuples; the Set<string>(...) wrappers
  // pull straight from the tuples.
  'src/dashboard/server/routes/admin.feedback.routes.ts',
  // Sample-data generator uses the tuples directly.
  'src/dashboard/export/DataExporter.ts',
  // Browser JS cannot import from TS modules; values are populated server-side
  // via REST endpoints or static dropdowns. Drift here would surface as a
  // server-side validation rejection (covered by handlers.feedback tests).
  'src/dashboard/client/js/admin.feedback.js',
  'src/dashboard/client/js/admin.instructions.js',
  'src/dashboard/client/js/admin.overview.js',
  // Canonical JSON schema for FeedbackEntry — generated/maintained as the
  // schema-of-record for the feedback payload shape.
  'schemas/feedback-entry.schema.json',
  // Generated repo code schema (regenerated each build).
  'schemas/index-server.code-schema.json',
  // Conceptually-distinct severity domains that happen to share the same
  // 'low'|'medium'|'high'|'critical' value names. These files import the
  // SeverityLevel TYPE from src/dashboard/types/severity.ts but retain
  // literal string values in decision branches and threshold comparisons
  // (forcing index lookups would harm readability). Drift in the canonical
  // tuple is what matters; these consumers are bound by the type.
  //
  // Same files also import TrendDirection / ExtendedTrendDirection from
  // src/lib/trendDirection.ts and retain literal values in branches.
  'src/dashboard/analytics/AnalyticsEngine.ts',
  'src/dashboard/security/SecurityMonitor.ts',
  'src/dashboard/server/metricsAggregation.ts',
  'src/dashboard/server/WebSocketManager.ts',
  'src/dashboard/server/AdminPanel.ts',
  'src/services/hotScore.ts',
  // BusinessIntelligence uses a distinct 'up'|'down'|'stable' taxonomy and
  // translates from TrendDirection via a switch on 'increasing'/'decreasing'
  // case labels — incidental co-location of canonical tokens, not a hand-typed copy.
  'src/dashboard/analytics/BusinessIntelligence.ts',
  // instructions.query.ts uses a distinct 'none'|'warning'|'critical' recursion
  // risk taxonomy — co-located literals overlap with ALERT_SEVERITIES values
  // but the domain is unrelated (governance-leakage risk band, not alert severity).
  'src/services/handlers/instructions.query.ts',
  // mcpLogBridge.ts maps log levels (DEBUG→'debug', INFO→'info', WARN→'warning',
  // ERROR→'error') to the MCP wire-format; the 'info'/'warning'/'error' tokens are
  // log-level RHS values, not alert-severity literals.
  'src/services/mcpLogBridge.ts',
  // Unicode scanner CLI categorizes scanner findings as 'info'/'warning'/'critical' —
  // separate operator-tooling severity scale, not the analytics alert severity.
  'scripts/governance/unicode-scanner.js',
  // McpProfile consumers: decision-branch logic comparing profile values
  // (e.g. `profile === 'enhanced'`) and tests/integration suites that pass
  // canonical profile names through environment fixtures. All bound by the
  // McpProfile type imported from src/services/mcpConfig/flagCatalog.ts.
  'src/services/mcpConfig/index.ts',
  'src/tests/integration/mcpConfigCrudRoundTrip.spec.ts',
  'src/tests/integration/setupWizardParity.spec.ts',
  'src/tests/mcpConfigIssue317.spec.ts',
  'src/tests/unit/postInstallUx.spec.ts',
  // Instance mode/role consumers: multiInstanceStartup decision branches
  // on `instanceMode` and tests exercise INDEX_SERVER_MODE values via the
  // env. All bound by InstanceMode / InstanceRole types from
  // src/lib/instanceTopology.ts.
  'src/server/multiInstanceStartup.ts',
  'src/tests/unit/multiInstanceConfig.spec.ts',
  'src/tests/unit/multiInstanceFailover.spec.ts',
  // messaging uses a different scale ('low','normal','high','critical') —
  // structurally distinct, owned by MESSAGE_PRIORITIES tuple.
  'src/services/messaging/messagingTypes.ts',
  'src/tests/unit/messaging/messagingProperty.spec.ts',
  'src/tests/unit/messaging/messagingTypes.spec.ts',
  'src/tests/unit/regexConfigSafety.spec.ts',
  // Log-level consumers: switch/case mapping branches over the canonical
  // tuple values (e.g. INDEX_SERVER_LOG_LEVEL parsing, NDJSON→MCP level
  // translation). These files import the `LogLevel` type from configUtils
  // or `LogLevelUpper` from src/lib/logLevels.ts and retain literal case
  // labels; drift in the canonical tuple surfaces as a type error.
  'src/config/serverConfig.ts',
  'src/services/tracing.ts',
  'src/lib/mcpStdioLogging.ts',
  'src/tests/mcpLogBridge.spec.ts',
  'src/tests/mcpStdioLogging.spec.ts',
  // Vendored third-party (Mermaid renderer) — minified bundle whose logger
  // happens to enumerate the same names. Not maintained in this repo.
  'src/dashboard/client/js/mermaid.min.js',
  // Setup wizard CLI prompts/help text enumerates supported INDEX_SERVER_LOG_LEVEL
  // values; it is a thin install-time tool, not the contract.
  'scripts/build/setup-wizard.mjs',
  // Tests for these enums.
  'src/tests/contentTypeSourceOfTruth.spec.ts',
  'src/tests/contentTypeMatrix.spec.ts',
  // Test mocks the feedbackStorage SOT module and must re-declare the
  // tuple values in vi.doMock factories (Vitest hoists the factory before
  // imports resolve, so it cannot reference the real exports).
  'src/tests/unit/feedbackManage.spec.ts',
  // Documentation
  'docs/tools.md',
  'docs/TOOLS-GENERATED.md',
  'docs/project_prd.md',
]);

describe('protocol enum source of truth — no rogue enum copies', () => {
  it.each(PROTOCOL_ENUMS.map(e => [e.name, e] as const))(
    'no non-allowlisted file declares a hand-typed copy of the "%s" enum',
    async (_name, spec) => {
      const canonical = spec.values;
      const threshold = thresholdFor(canonical);
      const coarseFloor = Math.min(3, threshold);
      const offenders: Array<{ file: string; hits: string[] }> = [];
      for await (const abs of walk(REPO_ROOT)) {
        const rel = toRel(abs);
        if (PROTOCOL_ALLOWLIST.has(rel)) continue;
        if (ALLOWLIST.has(rel)) continue;
        const content = await fs.readFile(abs, 'utf8');
        let coarseHits = 0;
        for (const v of canonical) {
          if (
            content.includes(`'${v}'`) ||
            content.includes(`"${v}"`) ||
            content.includes(`\`${v}\``)
          ) {
            coarseHits++;
            if (coarseHits >= coarseFloor) break;
          }
        }
        if (coarseHits < coarseFloor) continue;
        const hit = findEnumDuplication(content, canonical, threshold);
        if (hit) offenders.push({ file: rel, hits: hit.hits });
      }
      expect(
        offenders,
        offenders.length === 0
          ? ''
          : `Found ${offenders.length} file(s) containing a hand-typed copy of the "${spec.name}" enum ` +
            `(threshold: ${threshold} of ${canonical.length} canonical values within a 12-line window). ` +
            `These must derive from ${spec.sotModule} instead:\n` +
            offenders.map(o => `  - ${o.file}  (matched: ${o.hits.join(', ')})`).join('\n') +
            `\n\nFix options:\n` +
            `  (a) Import the canonical tuple from ${spec.sotModule}.\n` +
            `  (b) If the file legitimately documents the taxonomy, add its path to PROTOCOL_ALLOWLIST in ${toRel(__filename)}.`,
      ).toEqual([]);
    },
  );

  it('every protocol enum tuple has at least one value', () => {
    for (const e of PROTOCOL_ENUMS) {
      expect(e.values.length).toBeGreaterThan(0);
    }
  });
});
