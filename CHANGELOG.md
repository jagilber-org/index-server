# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog and this project adheres to Semantic Versioning.

## [Unreleased]

## [1.42.2] - 2026-09-15

### Fixed

- **The public mirror's CI had been red on every workflow since v1.42.0.** Two symptoms, one cause: `.publish-exclude` strips files that published tooling still depends on.
  - `npm run build` died with `ENOENT` on `scripts/mappings/server-env-tools.json`, taking CI, Coverage, Manifest Verify, Governance Hash, Instruction Governance and Bootstrap Guard down on the same step. `generate-server-env-tools.mjs` now skips regeneration when the mapping is absent rather than crashing.
  - `guard:constitution` reported ~50 violations and demoted 8 rules to "prose only", because `enforcedBy` paths under `.instructions/`, `.specify/`, `.squad/` and `.github/` cannot resolve in a clean-room copy. The guard now no-ops in a published mirror, detected via `.publish-manifest.json`, and still runs in full in the source repo.

## [1.42.0] - 2026-09-14

### Migration

**Where a running install writes its activity DB, logs and metrics has changed** ([#571](https://github.com/jagilber-dev/index-server/issues/571), then [#577](https://github.com/jagilber-dev/index-server/issues/577)).

Read this if you have an existing install with activity history you care about.

| | before | after |
|---|---|---|
| activity DB | `<cwd>/metrics/activity.db` — i.e. per spawning client | `<STATE_ROOT>/metrics/activity.db` |
| logs, metrics, backups | siblings of `<cwd>` | under `STATE_ROOT` |

`STATE_ROOT` is the OS user-data directory. Resolution order for the activity DB is now explicit: `INDEX_SERVER_ACTIVITY_DB` → `<INDEX_SERVER_METRICS_DIR>/activity.db` → `<STATE_ROOT>/metrics/activity.db`.

This landed in two steps and the intermediate state was published in neither. #571 moved these files from `cwd` to the **install root**; #577 then moved all mutable state again, from the install root to `STATE_ROOT`, because an npm-installed package's own directory is not a writable location on every platform. If you are upgrading from 1.41.2 you will only observe the net effect, `cwd` → `STATE_ROOT`.

**To keep existing history**, merge the scattered databases before first run:

```bash
node scripts/deploy/merge-activity-dbs.mjs
```

Because the old location was `cwd`-relative, expect **several** partial databases rather than one — on a measured box, 694 events sharded across five files, four of which the dashboard never read. Nothing needs to be done if you are content to start the chart from zero; the new store is created on demand.

**On semver:** `docs/versioning.md:14` states PATCH never introduces breaking changes. This changes where a running install reads and writes operational data, so it is **not** a patch-level change. Release it as a **minor**.

### Added

- **`guard:docs` — a documentation reachability gate, and a generated `docs/docs_index.md`** ([#586](https://github.com/jagilber-dev/index-server/issues/586)). The hand-maintained index had rotted to **28 dead references out of 45 rows** while **41 documents under `docs/` were reachable from neither README nor the index** — including `docs/messaging.md`, the only documentation of the 11 messaging tools. 24 of the 28 were SCREAMING-KEBAB names (`TOOLS.md`, `SECURITY-GUARDS.md`, `GRAPH.md`) for files that are lowercase_underscore per constitution G-6, and the remaining four pointed at paths that exist nowhere (`../memory/constitution.md` — the file is `constitution.md` at the repo root; `../ACTIVE-PLAN.md`; `../scripts/diagram-viewer.html`; a `docs/archive/` tree that does not exist).

  `npm run docs:index` now generates the file from `git ls-files`, taking each document's title and summary from its own first heading and first prose paragraph, so no second copy of a description exists to go stale. 88 documents across 14 sections, up from 45 rows.

  The gate resolves every reference against the exact-case `git ls-files` set, never the filesystem. That is the load-bearing detail: on the maintainer's Windows box every one of those 24 wrong-case references satisfies `fs.existsSync`, so a check written the obvious way would have reported a clean index for months. Falsified by `git mv docs/tracing.md docs/TRACING.md` — a case-only rename, invisible to the filesystem — which turned it red with one dead reference and one orphan, and green again on restore.

- **`guard:changelog` — a changelog freshness gate** ([#575](https://github.com/jagilber-dev/index-server/issues/575), the mechanism [#561](https://github.com/jagilber-dev/index-server/issues/561) asked for): fails when a `feat:` or `fix:` commit has landed since the last `v*` tag and neither its issue nor its PR number appears in `[Unreleased]`. Wired into the `guards` CI job and into `release-preflight.ps1`. `docs/release-checklist.md` already *required* this; nothing enforced it, so 1.41.2 shipped with an empty section above six commits and +3,840 lines — and `[1.41.2]` itself was empty until backfilled below.

  Deliberately narrow, so it is satisfied rather than bypassed: only `feat` and `fix` must appear (`chore`, `docs`, `ci`, `deps` are exempt — a changelog is for consumers); a commit passes on **either** its scope number (`fix(571):`) or a trailing PR reference (`(#615)`), because a squash merge carries the PR number while the changelog usually cites the issue; and commits carrying no number at all are a warning, not a failure, since failing on them would force a fabricated reference.

  It matches `#123` / `issues/123` / `pull/123` rather than bare digits. Bare-digit matching would have let the phrase "684 files scanned" satisfy a requirement to document issue #684 — this section alone contains twelve incidental numbers in that range. Falsified in both directions: red on the tree before these entries were written (9 commits named), green after, and red again when every `#571` reference is removed.

- **A generated-artifact freshness gate** ([#558](https://github.com/jagilber-dev/index-server/issues/558)): the self-hosted `build-test` lane regenerates `schemas/` and `docs/TOOLS-GENERATED.md` and diffs them against the committed copies. Nothing looked at these before, at any layer — #558 tabulates seven plausible candidates and why each is out of scope, and three PRs (#549 a tool-shape change, #601 a deleted source file, #616 a new script under a scanned path) merged with a stale artifact on a fully green board. Measured on `main` @ `b068789`, `schemas/index-server.code-schema.json` was 119 lines stale (`fileCount` 300 → 301).

  The gate prints the tracked-file count on success and **fails if that count is 0**, so a future `schemas/` rename turns it red rather than quietly vacuous. It must stay after any version-stamping step: both artifacts embed `package.json#version`, so a release bump changes them legitimately.

- **`guard:constitution` — the constitution now has to be true, not just consistent** ([#585](https://github.com/jagilber-dev/index-server/issues/585)). `scripts/governance/check-constitution-enforcement.mjs` fails when a `severity: error` rule has an empty `enforcedBy`, names a path that does not exist, or is enforced only by prose. The strongest guard that existed before it — VA-2 (`sync-constitution -Check`) — verified that `constitution.md` matches `constitution.json`, and nothing verified that anything in either was true.

  Measured on the tree before the fix: **84 rules, 56 at `severity: error`, 32 with an empty `enforcedBy`**, and six `enforcedBy` paths pointing at scripts that had moved months earlier (`scripts/crawl-logs.mjs` → `scripts/diagnostics/crawl-logs.mjs`, and five more) — which violates TG-2 by the constitution's own text.

  Thirteen rules turned out to *have* a mechanical enforcer that was simply never declared: S-3 (`bootstrapGating.spec.ts`), S-4 (`enforce-config-usage.ts`), A-1 (`serverEntrypointImportOwnership.spec.ts`), A-2 (`toolRegistryConformance.spec.ts`), A-6 (`bodySizeEnforcement.spec.ts`), PB-2/PB-3/PB-6 (`pre-push-public-guard.cjs`, `publishScripts.spec.ts`), DI-4 (`di4WritePathSymmetry.spec.ts`) among them. Twenty-three genuinely have none; they now carry `"enforcement": "review"` and say so in their own rule text, and their ids are enumerated in the guard as a **shrink-only** list — a rule that gains a real enforcer must leave it, and adding a new review-only `error` rule requires editing the guard. Without that ratchet the check is satisfied by pasting "Code review" into all 32 empty fields.

  Also fixed: `constitution.json`'s `description` restated the version and had drifted a minor behind (`constitution v2.9.0` against `version: 2.10.0`). The restatement is removed rather than corrected — a second copy of a number is a second thing to forget — and the guard fails if one reappears and disagrees. Constitution version → **2.11.0**.

- **CQ-1 is enforced** ([#585](https://github.com/jagilber-dev/index-server/issues/585)): `eslint.config.mjs` gains `max-lines` at 1000 for `src/`, `scripts/` and the dashboard client JS (tests excluded). CQ-1 says files "MUST NOT exceed 1000" but sat at `severity: warning` with no lint rule, and four files had drifted past it. Those four plus one client module are pinned at their **exact** current length, so an oversized file cannot grow by a single line; `guard:constitution` fails if one of them shrinks and the cap is left behind, so the ratchet cannot rust into headroom. CQ-1 is now `severity: error`.

### Removed

- **The baseline machinery is gone** ([#582](https://github.com/jagilber-dev/index-server/issues/582)): `scripts/governance/guard-baseline.mjs`, `scripts/governance/baseline-sentinel.mjs`, `scripts/hooks/commit-msg-baseline.{mjs,ps1}`, the `guard:baseline` / `baseline:sentinel:*` npm scripts, and the `.baseline.sentinel` ignore entry. All of it hung off `INTERNAL-BASELINE.md`, a file that does not exist and has no commits — so `guard:baseline` could only ever fail (it had been exit 1 on `main` for months) and the `commit-msg` hook could only ever no-op. Deleted rather than restored, because restoring means inventing the document the sentinel would then hash. The guard was stale by construction anyway: its `BASELINE_ENFORCE=1` arm enumerates ~93 allowed spec filenames against a suite of 182, and `BASELINE_ENFORCE` is set nowhere.

  `scripts/hooks/README.md` claimed the deleted hook validated "commit message against Conventional Commits". It never did. There is now no `commit-msg` hook at all, and the README says so — conventional-commit format is **unenforced** at commit time. `setup-hooks.cjs` removes the stale hook from existing clones rather than reinstalling it.

### Changed

- **The repo code schema no longer records declaration line numbers** ([#558](https://github.com/jagilber-dev/index-server/issues/558), the durable half of [#555](https://github.com/jagilber-dev/index-server/issues/555) P2.4). `scripts/build/generate-schemas.mjs` now treats line numbers as opt-in (`--line-numbers`); `schemas/manifest.json` self-reports `"lineNumbers": false`. They were 221 of the 226 changed rows in a typical diff — merge-conflict fuel that also camouflaged the real shape changes the new gate exists to surface. `schemas/index-server.code-schema.json` drops from 12,477 to 4,092 lines. Nothing consumes the field. Output remains byte-identical across consecutive runs.

- **Every baselined direct `process.env` read outside the config layer is now routed through it; `config-usage-baseline.json` has no pending entries left** ([#611](https://github.com/jagilber-dev/index-server/issues/611), completing the sweep [#579](https://github.com/jagilber-dev/index-server/issues/579) deferred): 16 keys across 10 files moved behind named accessors in the new `src/config/serviceEnv.ts`, plus `featureConfig.rawIndexFeaturesSetting()`. `guard:env` reports `0 pending`.

  **Accessors, not `RuntimeConfig` fields.** `getRuntimeConfig()` memoizes, and every one of these settings is read *per call* on purpose — `EventRing.resolveCapacity()` re-reads so a capacity change lands without a restart; `activityLog` is consulted on every logged mutation and ~36 specs repoint `INDEX_SERVER_ACTIVITY_DB` / `INDEX_SERVER_MANIFEST_PATH` / `INDEX_SERVER_USAGE_SNAPSHOT_PATH` at temp paths *after* boot so parallel forks stop sharing a file. Moving them onto the snapshot compiles and stays green, and just sends the writes back to wherever the first read resolved — the same class of defect that once put 902 test-fixture rows into a real catalog's activity DB. `mcpLogBridge` is stronger still: it is the first import in `index-server.ts`, deliberately above `applyOverlay()`, so materializing the config there would invert the overlay precedence documented at `index-server.ts:34-45`.

  **One fixed bug fell out of it.** `thin-client.ts` built `<cwd>/data/state` itself while the leader writes its lock to `dashboard.stateDir`, which #577 moved under `STATE_ROOT`. With `INDEX_SERVER_STATE_DIR` unset the two had silently stopped agreeing — no error on either side, just a thin client that never discovers a leader. Both now call one `resolveStateDir()`, pinned by three cases in `serviceEnvLiveReads.spec.ts`. The registry's advertised default for that flag was also still the pre-#577 `./data/state`.

  **Six settings became operator-visible.** Relocating a read into `src/config/` trips `dashboardConfigCoverage.spec.ts`, which requires every `INDEX_SERVER_*` var referenced there to be registered in `FLAG_REGISTRY` or excluded with a rationale. That interlock was honoured rather than bypassed: `INDEX_SERVER_MANIFEST_PATH`, `INDEX_SERVER_USAGE_SNAPSHOT_PATH`, `INDEX_SERVER_MCP_CONFIG_ROOT`, `INDEX_SERVER_MCP_BACKUP_RETAIN`, `INDEX_SERVER_LEADER_URL` and `INDEX_SERVER_ENABLE_STDERR_BRIDGE` are now documented in the Configuration panel, the first four as `dynamic` (their accessors really do re-read, so `restart-required` would have been a lie).

- **`VITEST` is allowlisted by name in `guard:env`, and the runner sniff is consolidated as `isTestEnvironment()`** ([#611](https://github.com/jagilber-dev/index-server/issues/611)): it is a fact about the process, not a setting, and it must never become a runtime-config key — a config key is writable through the overrides overlay, so an admin-config write could tell a production server it is a test run, and `activityLog.isEnabled()` uses exactly that predicate to switch telemetry off.

- **`config-usage-baseline.json` gained an `exempt` list, separate from `entries`** ([#611](https://github.com/jagilber-dev/index-server/issues/611)): `entries` is a work queue that must reach zero; `exempt` holds decisions. Each exemption requires a written reason (≥20 chars, enforced), a key cannot appear in both, and exemptions are staleness-checked exactly like baselined entries so one cannot outlive the code it describes. `src/utils/envUtils.ts` holds the only two: it is *below* the config layer — `runtimeConfig.ts` imports its parsers — so routing those reads through `runtimeConfig` is a self-referential import cycle.

  Falsified in four directions: a new read outside `src/config/` goes red; an exemption with a short reason goes red; an exemption for a read that does not exist goes red as stale; and prose in a doc comment no longer counts as a read — which is where the "19 vs 16" confusion came from. 19 was occurrences, 16 was unique `path::VAR` keys, and 2 of the 19 were a JSDoc block in `envUtils.ts` naming the variables it documents. Nothing was unbaselined. The guard now prints both numbers.
- **`guard:all` now runs in CI, and is composed of guards that can actually fail** ([#582](https://github.com/jagilber-dev/index-server/issues/582)). It ran in no workflow at all, so its exit-1 status was invisible. It is now `guard:env && guard:skips && guard:decl && guard:changelog && guard:docs`, invoked as a **single step** in `ci-self-hosted.yml`'s `guards` job and in a new owner-gated `guards` job in `ci.yml`. One step rather than one per guard is deliberate: the composition lives in `package.json`, so a developer's `npm run guard:all` and the PR gate cannot drift — which is exactly how this went dark.

  Two former members were dropped and are documented in `.instructions/local/ci-required-checks.md`: `verify:manifest` (exit 2 or 5 — it compares against a catalog that is not in the repo, #594/#595) and `lint:instructions`, whose verdict depends on whether the gitignored, generated `instructions/` directory happens to exist — exit 0 with `Passed with 0 errors` when absent, exit 1 on `sourceHash` mismatches once seeded. `lint:instructions` now prints what it scanned so the vacuous case is visible.

- **The `SKIP_OK` waiver must appear in a comment** ([#582](https://github.com/jagilber-dev/index-server/issues/582)). `check-no-skips.mjs` tested `line.includes('SKIP_OK')` against the whole line, so a test whose *title* mentioned the marker waived itself: `it.skip('a skip with no SKIP_OK waiver', …)` was scanned and passed. Found while falsifying the change above. All 68 existing waivers are already comments, so nothing previously waived changed.

- **The Bash client escapes JSON with `node` instead of `python3`** ([#617](https://github.com/jagilber-dev/index-server/pull/617)): `index-server-client.sh` shelled out to `python3 -c 'json.dumps(...)'` with a `sed`/`tr` fallback when python3 was missing. The fallback was **silently lossy** rather than failing — measured on a payload containing a newline, it emitted `{"body":"line1 line2 …"}`: valid JSON that parses cleanly with the newline replaced by a space. A corrupted body that round-trips without error is worse than a rejected one, because nothing anywhere reports it.

  This is the root cause behind the `curl: (22)` failure seen in `clientScriptsE2e` on the older CI image, which had no python3. The current image does, which is why the failure stopped reproducing — the dependency is now removed outright rather than relying on the image continuing to supply it. `node` is always present; this is an npm project.

  Verified in the Linux runner image against a payload carrying newlines, quotes, backslashes and tabs: both `json_quote` (emits a complete JSON value) and `json_escape_inner` (emits an escaped fragment for interpolation inside an existing `"…"`) round-trip exactly.

- **`dockerSecurity.spec.ts` is classified slow**: 200 s+ runtime and it requires a Docker daemon, so it does not belong in the fast lane.

### Security

- **`STATE_ROOT` can no longer be relocated by the runtime-overrides overlay, by construction rather than by luck** ([#607](https://github.com/jagilber-dev/index-server/issues/607)): the overlay applies dashboard-persisted config by mutating `process.env`, while `STATE_ROOT` is an `export const` in `src/config/configUtils.ts` that reads `INDEX_SERVER_STATE_ROOT` exactly once, at module evaluation. Which of the two happens first decides whether an authenticated admin-config write can move the audit log, activity DB, trace logs and server log — i.e. whether it is an **audit-log redirection primitive**.

  Until now that ordering held only incidentally, via whichever modules an entry point happened to import above its `applyOverlay()` call. `src/server/index-server.ts` documents *an* import-ordering rule there, but about a different property (stderr interception), so an unrelated import reshuffle could have silently inverted this one with nothing to catch it. `runtimeOverrides.ts` now carries an explicit load-order anchor (`import './configUtils'`), which module evaluation semantics guarantee runs before any of its body — so the freeze happens before `applyOverlay()` can exist to be called, whatever the entry point does.

  Pinned by `src/tests/unit/stateRootImportOrder.spec.ts`, which imports the overlay first and applies an overlay file that *does* contain `INDEX_SERVER_STATE_ROOT` — modelling a hand-edited or restored overlay, since `writeOverride()` refuses the key at write time and cannot retroactively refuse one already on disk. Falsified by deleting the anchor: 3 of 4 cases go red, including `toStateAbsolute('logs/audit.log')` resolving into the attacker-controlled directory. The 4th is a control that sets the env var *before* load and asserts `STATE_ROOT` does follow it, so "unchanged" cannot pass by the variable having become dead.
- **`docs/knowledge_api_spec.md` documented `POST /api/knowledge` with no auth, and no test noticed** ([#590](https://github.com/jagilber-dev/index-server/issues/590)): the route is registered behind `dashboardAdminAuth` (`src/dashboard/server/routes/knowledge.routes.ts:18`), which fails closed — loopback passes with no key, 403 otherwise, `Authorization: Bearer` required (constant-time, header-only) once `INDEX_SERVER_ADMIN_API_KEY` is set. The spec showed the handler with no middleware and never mentioned authentication at all, and `src/tests/knowledgeStore.spec.ts` asserted nothing about 401/403, so the divergence was invisible from inside this repo.

  It was not invisible downstream. agent-manager's `IndexClient` was written against that text, posts without a header, swallows the response as "endpoint not yet added", and has never delivered an insight ([agent-manager#157](https://github.com/jagilber-dev/agent-manager/issues/157)).

  The spec is rewritten as an as-built document: the auth matrix with the 401-vs-403 distinction and what each means for a client, the real file layout (`knowledge.routes.ts`, mounted at `ApiRoutes.ts:197` — it no longer tells implementers to edit `ApiRoutes.ts` directly), the real `KnowledgeStore` surface, and the note that the middleware's error body has no `success` field, so clients must branch on status rather than on `success`.

  New: `src/tests/unit/knowledgeRoutesAdminAuth.spec.ts`, six cases driven through the real route. Every case asserts the store contents as well as the status, so a refusal cannot be confused with a silently-successful write. Falsified in both directions: removing `dashboardAdminAuth` from `:18` turns the 401/401/403 cases red while the three permissive cases stay green, and adding it to `GET /knowledge/search` turns the read-route case red.
- **`POST /mcp/rpc` invoked tool handlers with no schema validation, no declared-tool gate and no authentication** ([#605](https://github.com/jagilber-dev/index-server/issues/605)): the leader's HTTP transport (`src/dashboard/server/HttpTransport.ts`) dispatched to the same handler registry as the stdio `tools/call` path while applying none of its three controls — `validateParams` ([#581](https://github.com/jagilber-dev/index-server/issues/581)), the `isDeclaredTool` gate ([#592](https://github.com/jagilber-dev/index-server/issues/592)), and auth. The router is mounted on its own bare `express()` app (`src/server/multiInstanceStartup.ts:38,90`), so it never saw the dashboard's `dashboardAdminAuth`. Not reachable in a default install (`INDEX_SERVER_MODE` defaults to `standalone`), but `INDEX_SERVER_MODE=leader` with `INDEX_SERVER_DASHBOARD_HOST=0.0.0.0` — both documented settings — put unauthenticated tool invocation on every interface.

  The three checks now live in `src/server/toolInvocationGuard.ts` and are **called** by both transports rather than copied into each, because the recurring bug shape is "a second entry point grew without the first one's checks". stdio behaviour is unchanged on the wire: the undeclared and unregistered refusals stay byte-identical (#592's enumeration oracle), and `index_dispatch` still opts out of generic validation.

  Auth mirrors `routes/adminAuth.ts` exactly — loopback passes with no key set, 403 otherwise, and a constant-time `Authorization: Bearer` match is required once `INDEX_SERVER_ADMIN_API_KEY` is set (401 otherwise). `ThinClient` now sends that header, so keyed leader/follower deployments keep working. The handler stack trace no longer goes into the append-only audit log.

  Two behaviours changed as a side effect, both previously broken: a `method: "tools/call"` frame — what the thin client relays verbatim — used to 404 on this route and now dispatches, returning the MCP content-array shape stdio produces; and a follower calling a handler that is registered but declared nowhere is now refused by the leader.

  Falsified three ways against `src/tests/unit/issue605HttpRpcGuards.spec.ts` (11 cases): removing the guard call turns 6 cases red, removing the auth middleware turns the 401 case red, and short-circuiting the loopback check turns the 403 case red — with the green-both-sides cases (valid call, valid `tools/call`, correct Bearer) staying green throughout, so a guard that simply refuses everything would not pass. Every refusal case registers a working handler under the name it calls and asserts the invocation counter stayed 0.

- **`npm publish` was blocked by a transitive `sharp` advisory, and two existing overrides had quietly stopped working** ([#574](https://github.com/jagilber-dev/index-server/issues/574)): `prepublishOnly` runs `npm run audit` (`npm audit --omit=dev --audit-level=high`), which exited 1 on 12 vulnerabilities — 5 of them high — so publishing could not start. `sharp` reported *"no fix available"*, an artifact of the pin: `@huggingface/transformers@3.8.1` depends on `sharp ^0.34.5`, which excludes the patched line. This server never imports `sharp` itself; transformers pulls it for image pipelines this project does not use.

  Resolved with `overrides.sharp: ^0.35.4`. Note the advisory range has since moved to `<=0.35.4-rc.0`, so the released `0.35.4` sits just outside it.

  **The more durable finding:** `fast-uri` and `ip-address` already had overrides — `^3.1.2` and `^10.1.1` — and both still resolved **inside** their advisory ranges (`3.0.0 - 3.1.5` and `<=10.3.0`). They were pinned against an older advisory and never moved when it widened, so they looked like fixes while fixing nothing. An override is a claim about a version range, and it silently expires when that range changes. Both are now `^3.1.6` and `^10.7.0`; `fast-uri` deliberately stays on 3.x rather than jumping to 4.x, since `ajv` is the consumer.

  `npm audit` now reports **0 vulnerabilities** and `npm publish --dry-run` exits 0 (524 files, 3.3 MB). The embedding path still works on the newer sharp — `semantic-search`, `embeddingsCompute`, `embeddingModelReadiness` and `embeddingDeviceProbe`: 45/45 passed.

  Falsified rather than assumed, because a registry change could have produced the same green: removing **only** the `sharp` override and reinstalling drops it back to `0.34.5` and returns `2 high severity vulnerabilities`, exit 1. The override is the fix.

  Not fixed here, but worth knowing: CI's own copy of this check is not a gate. `security-tier1.yml:52` runs `npm audit --audit-level=high` with `|| { echo "::warning::..." }`, so it reports and passes — and that workflow is one of the 16 carrying an owner condition, so on this remote it does not run at all. The enforcing copy is `prepublishOnly`, i.e. release time only.

### Fixed

- **The Catalog Activity chart was buried under a 1,068-row table** ([#636](https://github.com/jagilber-dev/index-server/pull/636)). The "By instance" list renders one row per instance, and instances are ephemeral — one per server process — so its length tracks process churn rather than catalog size. The live catalog's activity database held **1,068 distinct instances over seven days** (307-442 per day), rendered in full directly beneath the chart. It is now a `<details>` closed by default, with the instance count in the summary: a collapsed panel that hides its own magnitude is worse than no panel, because that count is the signal that something is spawning servers.

  Asserted against the rendered DOM rather than the source text — a grep for `createElement('details')` passes just as happily on an element created with `open` set. Falsified: `details.open = true` turns exactly one test red on the `hasAttribute('open')` assertion.

- **The Configuration panel and `docs/configuration.md` described a different server, including two authentication controls that do not exist** ([#588](https://github.com/jagilber-dev/index-server/issues/588)).

  **`INDEX_SERVER_REQUIRE_AUTH_ALL` and `INDEX_SERVER_AUTH_KEY` are documented authentication settings that no code path reads.** Verified by searching the whole tree: the only occurrences outside documentation are two rows of catalog metadata and two entries in a name allow-list. The single enforced control is `INDEX_SERVER_ADMIN_API_KEY` (`src/dashboard/server/routes/adminAuth.ts:22`, `WebSocketManager.ts:148`). An operator following the configuration table could set both, observe no error, and believe the surface was locked down. `SECURITY.md` already called `AUTH_KEY` an "experimental placeholder"; the configuration table contradicted it and won, because that is where people look. Both are now in an explicit **"Removed / not implemented"** table rather than deleted, so an operator who already has one in an `mcp.json` learns it is inert.

  **Seven Configuration-panel defaults were wrong.** Worst is `INDEX_SERVER_MAX_BULK_DELETE`, advertised as **1000** against a real default of **5** — it is the `force`-required guardrail on destructive bulk delete and purge, so the panel understated a safety limit by 200x in the permissive direction. Also corrected: `FEEDBACK_MAX_ENTRIES` 10000→1000, `MESSAGING_MAX` 5000→10000, `BOOTSTRAP_TOKEN_TTL_SEC` 600→900, `READ_RETRIES` 5→3, `READ_BACKOFF_MS` 10→8, `ADMIN_MAX_SESSION_HISTORY` 500→200.

  **Eight more claimed `(unset)` while the server was running with a concrete default** — 720 resource samples, 250-item tool-call chunks, a 0.95 memory threshold, and five others. "(unset)" told an operator the feature was unconfigured while it ran on values they could not see. `HEALTH_MEMORY_THRESHOLD` was additionally typed in `bytes`; it is a 0–1 heap fraction, so the panel's validation would have accepted any number. Three path defaults pointed at superseded locations (`MESSAGING_DIR` at a catalog sibling, `ACTIVITY_DB` at "install root", `TRACE_BUFFER_FILE` at a file that is not written unless configured), and `LOG_FILE` and `AUDIT_LOG` showed `(unset)` when both are **on by default**.

  **`INDEX_SERVER_BODY_MAX_LENGTH` was offered as a `stable`, `editable` setting** long after `runtimeConfig.ts:343-345` began warning it is "no longer recognized" — a control whose only effect is a startup warning. It and `METRICS_MAX_FILES` (never implemented; metrics file rotation does not exist) are now `stability:'deprecated'` and non-editable, using a new `deprecated` value the catalog previously had no way to express.

  **`docs/configuration.md` five wrong defaults, and 24 live settings documented nowhere.** `LEADER_PORT` 9100→9090, `HTTP_METRICS` off→on, `SEMANTIC_LOCAL_ONLY` off→on, `TRACE_BUFFER_SIZE` "1048576 bytes"→"0 frames" (wrong value *and* wrong unit), `schemaVersion` 6→**9**. The undocumented 24 include the entire messaging subsystem and the entire activity-log subsystem — the data behind the dashboard's usage charts.

  **`guard:config` (new) fails in both directions**: a variable read by `src/` or `scripts/` with no row in the doc, and a documented variable nothing reads. Its per-variable allowlist carries a reason each and itself fails when an entry stops applying. Falsified three ways — delete a documented row (red, names the variable), add a phantom setting (red), stale an allowlist entry (red) — plus `dashboardConfigDefaults.spec.ts`, which was falsified by reintroducing `default:'1000'` on `MAX_BULK_DELETE` and watching it go red.
- **`docs/tools.md` and `docs/TOOLS-GENERATED.md` described a different server** ([#587](https://github.com/jagilber-dev/index-server/issues/587)). The "Tool Inventory (Authoritative Reference)" table said it was "generated from the live tool registry" while being maintained by hand, and had drifted to **45 rows against 65 registered tools** — every one of the 11 `messaging_*` tools, all five archive-lifecycle tools, `index_patch`, `trace_dump`, `dashboard_config` and `diagnostics_handshake` were absent. Five more rows carried the wrong tier or classification: `usage_track` documented extended (is core), `feedback_manage` documented core and `stable, mutation` (is extended and `mutation` only), and all three `diagnostics_*` tools documented `stable` (all three are `mutation`, and additionally gated on `INDEX_SERVER_STRESS_DIAG=1` or `INDEX_SERVER_DEBUG=1`, which no doc mentioned).

  `docs/TOOLS-GENERATED.md` was generated at the **extended** tier, so the one file titled "Generated Tool Registry" silently omitted all 31 admin tools and carried no note saying it was partial. It now generates at admin, with a tier column and that note. `docs/diagrams/tool-tier-architecture.mmd` still named `feedback_dispatch`, `feedback_list`, `feedback_get`, `feedback_update`, `feedback_stats` and `feedback_health`, none of them registered since the feedback rip-down (#111); it is generated from the same source now.

  **`priority` was documented as a "1-10 priority scale". It is an integer 1–100, lower = more important** (`schemas/instruction.schema.json:93-96`, enforced at `src/services/instructionRecordValidation.ts:245`). An agent following the doc wrote every entry it created into the bottom decile of the real scale. One occurrence repo-wide; it now also states the direction, which the old text omitted.

  The inventory table, the diagram and `TOOLS-GENERATED.md` are generated and gated by `npm run contract:tools`. Falsified by registering a throwaway tool, rebuilding, and watching all three artifacts go red; restored, green.
- **The activity database kept all of its data in the WAL, and a moved `STATE_ROOT` silently started an empty one** ([#632](https://github.com/jagilber-dev/index-server/pull/632)). `SqliteActivityStore` never checkpointed, so rows lived exclusively in `activity.db-wal` — invisible to any external reader opening the `.db` and dependent on a clean shutdown to survive. `checkpoint()` (PASSIVE, so it never blocks a writer) now runs on store open and alongside the 6-hour prune cycle.

  Separately, when `STATE_ROOT` moved to `%LOCALAPPDATA%`, a fresh `activity.db` was created at the new path and the existing history was left behind at `INSTALL_ROOT` — the chart simply restarted from empty. `importFrom()` now performs a one-shot cross-database import on first open when a legacy database exists and `STATE_ROOT` differs from `INSTALL_ROOT`.

  Covered by 4 new tests asserting checkpoint visibility (rows readable from a second connection opening only the `.db`) and import semantics.

- **Leader/follower documentation described a system that was never built, and contradicted itself on four values for one port** ([#589](https://github.com/jagilber-dev/index-server/issues/589)). `INDEX_SERVER_LEADER_PORT` was documented as `8399`, `9191`, `9090` and `9100` in four different files. It is **9090** (`src/config/defaultValues.ts:63`), confirmed at runtime: a leader logs `MCP HTTP transport listening on 127.0.0.1:9090/mcp`.

  `docs/mcp-index-leader-follower-spec.md` is a pre-implementation spec that shipped as documentation and was never reconciled with what was built. It now carries a banner marking it historical, with a table of every superseded identifier: routes `/leader/tools/call` etc. (really `/mcp/rpc`, `/mcp/health`, `/mcp/leader`), `INDEX_SERVER_MODE` default `auto` (really `standalone`), `INDEX_SERVER_FOLLOWER_HEARTBEAT_MS` 2000 (really `INDEX_SERVER_HEARTBEAT_MS` 5000), four module names that do not exist, **five environment variables that do not exist**, and "all 51 tools" against 65. It is retained rather than deleted because its problem statement is the reason the feature exists and no other document states it.

  **Two behaviours were documented as the opposite of what they do**, and both are now corrected and measured rather than asserted:

  - **`INDEX_SERVER_MODE=follower` is not implemented on the main entry point.** `multiInstanceStartup.ts:12-18` returns early and the process continues as an ordinary standalone server — loading the full index, which is the cost the follower role exists to avoid. Verified by running it: the only output is `[startup] Instance mode=follower (follower mode requires thin-client entry point)`. The thin client (`src/server/thin-client.ts`) is the real follower entry point.
  - **Every instance opens a dashboard, including followers.** The docs claimed "dashboard only on leader". `startDashboard()` runs at `index-server.ts:803`; election does not run until `:840`. Verified by starting two `MODE=auto` instances against one `STATE_ROOT`: the first took 8787 and was elected leader, the second logged `Port 8787 in use, trying 8788`, started a dashboard on **8788**, and was then elected **follower**.

  Also documented for the first time: the **`POST /mcp/rpc` contract** introduced by #605 — loopback-only without an admin key and 403 otherwise, constant-time `Authorization: Bearer` once `INDEX_SERVER_ADMIN_API_KEY` is set, the shared declared-tool and input-schema guards, and the two accepted request shapes with their different result shapes.
- **Documentation drift sweep — fourteen doc-vs-code mismatches, each re-verified against the code at HEAD** ([#591](https://github.com/jagilber-dev/index-server/issues/591)). Roughly in order of how badly each could mislead:

  - **`ON_CHANGE` is not a catch-all.** `docs/lifecycle-hooks.md` and `docs/architecture.md` both described `INDEX_SERVER_HOOK_ON_CHANGE` as firing "for every committed mutation". `deriveLifecycleOperation` (`src/services/lifecycleHooks.ts:52-73`) maps exactly four audit actions; `archive`, `restore`, `archive_edit`, `purge`, `groom`, `governanceUpdate`, `patch`, `normalize`, `enrich` and `repair` all fall to `default: return undefined` and dispatch nothing. An operator using `ON_CHANGE` as a mutation audit trail was silently missing ten kinds of change. Both docs now carry the full table, and the source comment that made the same claim is corrected.
  - **`docs/metrics_file_storage.md` had its central claim backwards.** It said memory-only mode is "limited to ~60 snapshots"; memory-only keeps **720**, and the 60-snapshot cap applies *only when file storage is on* (`MetricsCollector.ts:129` selected by `useFileStorage ? 60 : maxSnapshots` at `:748-751`). Enabling file storage *shrinks* the in-memory window rather than growing it. The same file documented `INDEX_SERVER_METRICS_MAX_FILES` and `_RETENTION_MINUTES` as configuration; neither is read anywhere, they are constructor defaults. The metrics directory is `<STATE_ROOT>/metrics`, not cwd-relative `./metrics`, and three BufferRing files land in it that the doc never mentioned.
  - **`docs/architecture.md` presents a proposal as architecture.** The "Manifest Manager & Historical Snapshot Flows" section documents five `BUFFER_RING_*` configuration flags, none of which exists anywhere in `src/` — setting them does nothing. Now banner-marked. Also in that file: the dashboard is called "read-only visualization" while carrying **56** `POST`/`PUT`/`PATCH`/`DELETE` handlers across 12 route modules; `usage_hotset` was listed as "(Future) Optimizer — Not yet implemented" while being a registered tool; and `archive_edit` was missing from the audit-actions table.
  - **The write-path read-back is now documented, including what it does not do.** Post-write read-back exists (`indexContext.ts:663-674,705-716`) but **only logs a warning** — the call still returns success — and is **skipped entirely when a storage backend is active** (`if (!store)`), so the SQLite path has none. The check that throws is the *pre*-write one. Getting these two the wrong way round means trusting a guarantee that is an alarm.
  - **`docs/security_guards.md` named five scripts at paths that do not exist** — `scripts/pre-commit.ps1`, `scripts/security-scan.mjs`, `scripts/pre-push.ps1`, `scripts/run-semgrep-pre-push.ps1`, `scripts/pre-push-public-guard.cjs`, all of which live under `scripts/hooks/` or `scripts/governance/` — plus a sixth pointing at a `.github/workflows/ggshield-secret-scans.yml` that does not exist (GGShield runs in `security-tier1.yml`). The runbook's copy-pasteable command could not run; the corrected one is verified to.
  - **`docs/messaging.md` documented a storage default that two migrations have superseded.** It is `<STATE_ROOT>/data/messaging` (#577), not a catalog sibling — and the doc's own Diagnostics section called `data/messaging` a dead legacy path while it is the current one. It also listed 8 of 11 MCP tools, 9 of 11 REST endpoints, and gave `ttlSeconds` a lower bound of 0 when the send schema requires 1.
  - Smaller, each verified: `docs/index_quality_gates.md` quoted a body-length ceiling of 100000 against a schema maximum of 1000000, and had a "Future Improvements" heading whose three bullets had drifted into the section below it; `docs/client_scripts.md` said `index_search` defaults to `keyword` when the server defaults to `semantic` under `INDEX_SERVER_SEMANTIC_ENABLED=1`; `CODE_SECURITY_REVIEW.md` advertised Node `>=20 <23` against `engines: >=22`, i.e. a range excluding the only supported major; `docs/project_prd.md` declared itself both the canonical PRD and "stubs only" two lines apart, cited a `PRD.md` that does not exist, and carried two conflicting review dates, both in the past.
  - **`docs/versioning.md` and `docs/publishing.md` both asked readers to track issue #109, which closed on 2026-04-26.** The issue that filed this row asserted the reference was still live; it is not.

  Not treated as a doc bug: `usageCount`'s deprecation note. "Kept one minor version per #418" is many minors stale, but whether to remove it is a product decision — it is now described as deprecated and indefinitely retained, so nobody plans a removal on the strength of an expired note.

- **`test:fast` could report a verdict without running the suite, and its verdict depended on how verbosely you invoked it** ([#576](https://github.com/jagilber-dev/index-server/issues/576)):

  **The lane hid the suite it exists to run.** `scripts/testing/test-fast.mjs` ran the stateful specs one per process and called `process.exit(isolatedCode)` on the first failure, so the ~363-spec main batch never started. The visible result was "1 failed, 23 passed" with **zero evidence about the other ~3,400 tests**. Stages now all run, failures are collected across them, and the exit code is decided at the end. Verified with a planted isolated-spec failure: the run reported `FAILED — 2 stage(s)` listing both the isolated spec *and* a main-batch failure that the old lane would have concealed entirely.

  **Verbosity changed the verdict.** `npm run -s` exports `npm_config_loglevel=silent` to child processes, so the nested `npm pack` in `npmPackReadiness.spec.ts` printed no `npm notice` lines and 8 assertions failed on text that was never emitted — a red gate on any machine or CI lane with a silent loglevel, with no code change. The spec now reads `npm pack --json` as data and pins the loglevel explicitly. `npm run -s test:fast` and `npm run test:fast` agree: 34/34 either way.

  **A capability gate that probed the wrong capability.** `certInit.spec.ts` gated on `openssl version` exiting 0, then ran `openssl req -x509`. Where the binary is on PATH but `openssl.cnf` is absent — the default state of several Windows openssl distributions — `version` succeeds and `req` fails, producing 5 spurious failures. The breadcrumb printed its own contradiction and went unread for months: `opensslAvailable=true reason="openssl not detected"`. The probe now generates an actual certificate into a temp dir, and confirms it still **runs** where openssl works (verified in the Linux CI image) rather than skipping everywhere.

  The intermittent `[vitest-worker]: Timeout calling "onTaskUpdate"` harness error is **deliberately left failing** rather than downgraded to a warning; the reasoning and the root cause (a ~560 s serial main batch under `--fileParallelism=false`) are recorded in `docs/testing_strategy.md`.

- **The coverage gate enforced nothing, and five different numbers claimed to be the floor** ([#584](https://github.com/jagilber-dev/index-server/issues/584)): `coverage:ci` passed `COVERAGE_HARD_MIN=50 COVERAGE_TARGET=60` while `check-coverage.mjs` read `INDEX_SERVER_COVERAGE_HARD_MIN` / `_TARGET`. The names never matched — but fixing the names alone would not have worked either, because the script was invoked as `cross-env VARS npm run coverage:core && … && node check-coverage.mjs`, and `cross-env` scopes its variables to the command it wraps. The third command in the chain never received them under **any** naming. The script's own header claimed "CI always sets explicit env values"; it never did.

  Measured at 2026-09-11: actual coverage is **81.89 %** (15925/19448 statements). The floors in play were 50 (`package.json`, ignored), 46 (`ci-enhanced.yml`, correct name but `workflow_dispatch` only, and pinned "just below current baseline (46.83)" — a baseline that had since moved 35 points), **0** (`coverage-ratchet.mjs`'s default when the env var is unset, which was every invocation outside that one workflow), 80 (constitution) and 95 (PRD). The constitution turned out to be right and the gate far too low, so `hardMin` is now **80**, which the tree already clears.

  Thresholds live in `scripts/governance/coverage-thresholds.json` — one file, read by both `check-coverage.mjs` and `coverage-ratchet.mjs`, with the env vars retained as overrides. Two further silent-pass holes are closed: a **missing** `coverage-final.json` was `exit 0` with "skipping gate", so a broken coverage run produced a green gate (now fails unless `INDEX_SERVER_COVERAGE_ALLOW_MISSING=1`), and a report containing zero statements now fails rather than computing 0 % against a 0 floor.

  Falsified in both directions, which was impossible before because the overrides never arrived: `hardMin=99` → `FAIL lines=81.89 < hardMin=99`, exit 1; `hardMin=1` → `PASS`, exit 0; report removed → exit 1.

- **`guard:env` scanned zero files and reported success** ([#579](https://github.com/jagilber-dev/index-server/issues/579)): `enforce-config-usage.ts` resolved `repoRoot` as `path.resolve(__dirname, '..')`, but the script lives in `scripts/governance/`, so that landed on `scripts/` and the scan target became the nonexistent `scripts/src`. `main()` guarded the directory with `fs.existsSync(d)` and skipped it **without a word**, then printed `Configuration usage enforcement passed`. The guard enforcing constitution S-4 had never inspected a single file; it now scans **684**.

  Three further defects surfaced once it could see code. The write filter `/process\.env\.[A-Z0-9_]+\s*=/` also matched `==` and `===`, so every *comparison* against an env var was misclassified as a write — and because the check ran per line and `return`ed, `process.env.A = process.env.B` suppressed the read of `B` along with it; classification is now per occurrence, with `=(?!=)`. The file allowlist was written with escaped backslashes (`src\\config\\runtimeConfig\.ts`) and so only ever matched on Windows: on the Linux runner this guard now runs on, the configuration loader itself would have been reported as a violation. Paths are normalised before matching.

  The 19 pre-existing violations are held in `config-usage-baseline.json`, keyed `path::VAR` rather than by file so a *new* read cannot hide inside a file that already had one, and rather than by line so unrelated edits do not churn it. The ratchet only shrinks: an unbaselined violation fails, and so does a **stale** entry whose violation was fixed — a baseline that outlives its violations is a waiver with extra steps. `src/config/**` is allowlisted as the configuration layer (reading env is its job) and `src/tests/**` under the grace the policy header already granted.

  A scan of zero files, or a missing scan directory, is now itself a failure, and the success line reports the file count. Falsified in five directions, including re-introducing the original `repoRoot` bug: it now fails with `scan directory not found ... this is a bug in the guard, not in the code under test` instead of passing.

- **The `gitleaks-pre-push` hook now uses the `gitleaks` already on `PATH` instead of compiling its own copy at job time** ([#608](https://github.com/jagilber-dev/index-server/pull/608)): the hook was declared `language: golang` with `additional_dependencies: github.com/zricethezav/gitleaks/v8@v8.30.1`, so pre-commit built an isolated Go environment on every run — even though `hooks/run-gitleaks-pre-push.ps1` resolves the binary from `PATH` itself and never used what pre-commit built. That put `sum.golang.org`'s HTTP/2 checksum path on the critical path of a *secret-scanning gate*, and it failed three consecutive CI runs with `INTERNAL_ERROR; received from peer` on module tile reads (a different module each time). The scan could not run, so the gate was dark for reasons unrelated to secrets.

  Switching to `language: system` removes the Go module download entirely; the CI image bakes gitleaks 8.30.1 from its checksum-verified release archive, so resolution there is both version-pinned and offline-capable. **Tradeoff worth stating:** dropping `additional_dependencies` also drops pre-commit's version pin for *local* runs, where whatever `gitleaks` is on `PATH` is used. The image pins CI; contributors are told the expected version in the not-found message.

  Falsified rather than merely run: with `PATH` stripped of gitleaks the hook exits 1 with the install message, and a planted GitHub-PAT-shaped credential under this repo's `.gitleaks.toml` reports `leaks found: 1` and exit 1 — a scanner that only ever returns zero is indistinguishable from a broken one.
- **Activity DB, logs and metrics are anchored to install-owned state, not the client's working directory** ([#571](https://github.com/jagilber-dev/index-server/issues/571)): index-server runs as an MCP **stdio** server, so it inherits the working directory of whichever client spawned it. Anchoring install-owned files to `process.cwd()` therefore gave every spawning project its own private copy. Measured on a live box: 12 concurrent instances had sharded **694 catalog activity events across five databases** — 478 in the server checkout, 216 under `%TEMP%`, 1 in an unrelated project (the one the dashboard happened to read), 0 in two others.

  The dashboard's Catalog Activity chart had therefore rendered as all-zero bars **for its entire existence**. Nothing errored: the store opened fine and created an empty database on demand, so health reported `enabled/available` through every one of those failures — a data-loss bug wearing a green status light.

- **Embedding regeneration goes through the configured store** ([#572](https://github.com/jagilber-dev/index-server/issues/572)): with `INDEX_SERVER_STORAGE_BACKEND=sqlite`, embeddings were never regenerated into the sqlite-vec store. Measured in production: 284 entries in `data/embeddings.json`, 78 in `data/embeddings.db`, frozen for two weeks. `getInstructionEmbeddings()` took an **optional** `store` and fell back to the JSON file when omitted; of three production call sites only the manual Compute button passed one, while `embeddingTrigger.ts` — the only *automatic* path — did not. Meanwhile `ApiRoutes.ts` resolved its own store by hardcoding `'sqlite'`. Writes went to JSON and dashboard reads came from SQLite.

  Nothing errored, because both stores work correctly in isolation — they were simply different stores. Search also read JSON, so search kept working and no alarm could fire; the only symptom was a stale count on one dashboard panel. **Both components were unit-tested; the seam between them was not.**

- **The messaging store no longer siloes itself per client** ([#599](https://github.com/jagilber-dev/index-server/pull/599)): the derived messaging directory resolved relative to the working directory, so with `INDEX_SERVER_DIR` unset it fell back to `<cwd>/index-messaging` — one private store per spawning project, the same shape of defect as #571. It now resolves under `STATE_ROOT`, which has no cwd fallback, while keeping the containment guard that prevents a configured path escaping its root.

- **`tools/call` validates against `INPUT_SCHEMAS` on the live path** ([#581](https://github.com/jagilber-dev/index-server/issues/581), [#601](https://github.com/jagilber-dev/index-server/pull/601)): schema validation was wired on a transport that requests did not actually traverse, so malformed arguments reached handlers unchecked. Carrying `ajvFn` on the Ajv-only validator also made `-32602` responses name the offending field instead of returning contentless errors — **17 → 0** contentless rejections in default mode, **61 → 0** under Ajv mode. The dead `transport.ts` it had been attached to is deleted.

- **Flat-view instruction preview has a Copy button** ([#552](https://github.com/jagilber-dev/index-server/issues/552)): copies the exact markdown string that pane rendered, so the clipboard cannot disagree with what the operator is looking at. The copy-label reset timer moved from a module-level slot onto the button element, so two preview panes open at once no longer strand each other's label on the transient "Copied" text.

- **`revertOverlay()` and `clearOverride()` no longer delete environment variables the overlay never owned**: `applyOverlay()` recorded a pre-overlay value only when it DIFFERED from the overlay value (`if (prior !== undefined && prior !== v)`), so when the operator already had the variable set to the same value the overlay carried, the key was absent from the snapshot and both restore paths took their `delete process.env[key]` branch. The equal-value case is the likely one in practice, since an overlay is usually written from the value already in the environment — and it sits on the boot-recovery path.

  The snapshot was serving two different questions at once: "what do I restore?" and "is the overlay masking a different ENV value?" (the `overlayShadowsEnv` badge). They are now two maps, so recording an equal prior value for restore does not make the dashboard claim a shadow that does not exist. Restore also tests `key in map` rather than the value alone, which distinguishes "recorded as unset" from "never recorded" — a plain value check collapses the two and deletes in both cases.
- **Auto-backup no longer writes a rotating copy of the catalog into the client working directory** ([#577](https://github.com/jagilber-dev/index-server/issues/577)): `backupsDir` derived from a sibling of the resolved instruction directory. That rule is deliberate and is kept — a backup should sit next to what it backs up, which is what `getAutoBackupSourceMismatch()` polices. But it applied unconditionally, and with `INDEX_SERVER_DIR` unset the "source" is itself only a cwd fallback (`<cwd>/instructions`), so the sibling resolved to `<cwd>/backups`: an hourly, ten-deep copy of the whole catalog in whatever folder the MCP client was launched from, one private copy per project, none of them the one the dashboard reads.

  Precedence is now explicit — `INDEX_SERVER_BACKUPS_DIR`, then `<INDEX_SERVER_DIR>/../backups`, then `<STATE_ROOT>/backups`. Only the no-catalog case moved; every operator who named a catalog keeps the existing layout. A relative `INDEX_SERVER_BACKUPS_DIR` now resolves against `STATE_ROOT` rather than cwd. A one-time WARN points at stranded backups in the old location, keyed on cwd because that is where they actually are.
- **`signalHistory` is now durable (schema v9)** ([#600](https://github.com/jagilber-dev/index-server/pull/600)): the field was added to `InstructionEntry` and written by `usage_track`, but had no persistence path. `incrementUsage()` performs no catalog write — `usageSnapshotFile.ts` says so in its own header — and the only durability route, `UsagePersistRecord`, gained `lastSignaledAt` and not `signalHistory`. So after a restart an entry read `lastSignaledAt: "<ts>"` with an empty history: an asymmetric round-trip (DI-4), and a *new* split between the timestamp and the record it timestamps, which is the split the feature exists to close.

  `signalHistory` now flows through `UsagePersistRecord` / `UsageSnapshotRecord`, is written by `flushUsageSnapshot()`, and is merged by `mergeUsageRecord()` as a **union** rather than an overwrite — under multi-client operation each side legitimately holds events the other has not seen, so picking one silently loses signals. Ordering, de-duplication and the cap live in one shared `mergeSignalHistory()` used by both the write path and the restore path, so they cannot drift; the cap itself is now `SIGNAL_HISTORY_CAP` rather than a literal duplicated across three files. The merge tolerates a non-array `signalHistory` on either side, which a bare spread would have thrown on — taking down the merge for every other entry in the same pass.

- **`GET /api/system/resources?since=` no longer answers a malformed query with a plausible empty chart**: `since` was parsed with a bare `parseInt`, and because the downstream predicate is `ts >= ?`, `ts >= NaN` is false for every row — so `?since=garbage` returned `{ success: true, catalogHistory: [] }`, indistinguishable from "no data in this window". It now returns `400` naming the parameter. Validation runs before any work.

- **Catalog chart "All" time window no longer re-lights the 30d button**: `(… .days) || 30` treated `days: 0` as falsy, so the selected window and the highlighted button disagreed.
- **Network-privacy documentation now matches the code, in every file that makes the claim** ([#578](https://github.com/jagilber-dev/index-server/issues/578)): `docs/network-privacy.md`, `PRIVACY.md` and `THIRD-PARTY-LICENSES.md` all asserted that the three outbound network paths are "disabled by default" and that a default install opens "no network listeners". Measured against `applyProfileDefaults` (`src/config/runtimeConfig.ts:449-475`), neither holds: `INDEX_SERVER_DASHBOARD=1` for **every** profile, and `enhanced`/`experimental` set `SEMANTIC_ENABLED=1` with `SEMANTIC_LOCAL_ONLY=0`, permitting a ~90 MB one-time download from `huggingface.co`.

  The listener is real but loopback-bound (`INDEX_SERVER_DASHBOARD_HOST` defaults to `127.0.0.1`), so constitution SH-5 was never violated and the defaults themselves are fine — the documentation was wrong, not the code. Defaults are now stated per profile rather than absolutely, and the two PowerShell verification recipes no longer tell a reader that the correct output is an empty listener list. Note the profile the setup wizard actually hands most users is `enhanced`, not `default`.

  Regression coverage asserts on the **absence** of each false claim across all three documents, so they may be reworded but cannot drift back.

- **Closes the two documented holes in `INDEX_SERVER_MUTATION=0`** ([#580](https://github.com/jagilber-dev/index-server/issues/580)): the flag did not stop writes. Measured over stdio against a seeded catalog, two paths wrote to disk while the server was nominally read-only — a violation of constitution S-3, which states operators MUST use this flag when they need an explicit read-only runtime. It does **not** make the runtime comprehensively read-only; see the residual list below.

  The first hole was a forged origin flag. `guard()` skipped its mutation check whenever the params object carried `_viaDispatcher: true`. That key was stamped by the dispatcher, but `sdkServer.ts` passes `req.params.arguments` verbatim and no layer strips unknown keys, so **any MCP client could set it** and get a real write. Worse, the response came back as a clean success envelope with no marker, indistinguishable from a mutation-enabled server. The second hole was the dispatcher itself: `index_dispatch {action:'add'}` annotated its response `mutationEnabled:false` and then performed the write anyway, and `{action:'remove', mode:'purge'}` deleted files outright.

  Fixed by deleting the origin signal rather than re-implementing it. Once the dispatcher refuses mutation targets before reaching a handler, no legitimate caller needs an exemption, so `guard()` now checks only the runtime flag and the `_viaDispatcher` stamp is gone. The refusal is audited with an explicit `mutation_blocked` row, because `index_dispatch` lives in `STABLE` rather than `MUTATION` and would otherwise have been filed as a read (A-5).

  **Migration note.** This reverses part of [#358](https://github.com/jagilber-dev/index-server/issues/358), which deliberately let the dispatcher proceed under this flag and merely annotate the response. Callers that relied on `index_dispatch` as a write path while `INDEX_SERVER_MUTATION=0` now receive `{error:'mutation_blocked', reason:'mutation_disabled'}` and **nothing is written**. The #358 response contract is otherwise unchanged — `mutationEnabled:false` and an actionable `mutationHint` are still present, now carried by the refusal itself. Unset `INDEX_SERVER_MUTATION` (it defaults to enabled) to restore writes. Note `index_dispatch {action:'reload'}` is also refused now, matching the direct `index_reload` tool, which `guard()` already blocked.

  **Residual gaps, named explicitly.** Enforcement is per-registration rather than a storage chokepoint — `writeEntry` itself has no mutation check — so three surfaces still write under this flag. (1) `promote_from_repo` calls `writeEntry` directly and upserts instruction entries over plain MCP with no auth; it is the sharpest of the 15 of 29 `MUTATION` tools registered without `guard()`. (2) Read actions still write *telemetry*: `index_dispatch {action:'get'|'query'|'export'}` reaches `incrementUsage` → `flushUsageSnapshot()` when `autoUsageTrack` is on. Not entry mutation, but not nothing. (3) The dashboard's HTTP write API calls `indexContext` directly — note this is behind `dashboardAdminAuth`, so it is "an authenticated admin can write under the read-only flag", not an anonymous write path. All three are tracked separately.

- **`tools/call` refuses handlers that are declared nowhere** ([#592](https://github.com/jagilber-dev/index-server/issues/592)): measured over stdio, `tools/list` advertised 8 tools while 62 handlers were registered against 60 registry entries. The delta — `test_primitive`, `diagnostics_handshake`, `dashboard_config` — was callable while invisible at *every* tier, absent from `meta_tools` and the generated artifacts, and unvalidated, because `validateParams` fails open when no schema is registered. That is constitution A-2, previously enforced only by a test-time allowlist in `toolRegistryConformance.spec.ts` which had quietly absorbed all three names.

  `tools/call` now checks membership in the tool registry and returns `-32601` otherwise, with an error byte-identical to the unknown-tool response so the endpoint cannot be used to enumerate hidden handlers. The distinction is recorded in the log instead.

  **Tiers are unchanged and remain visibility-only.** Membership is checked against the *full* registry, never the flag-resolved tier, so `index_add`, `index_patch`, `index_remove` and every other extended/admin tool stay callable with `INDEX_SERVER_FLAG_TOOLS_*` unset. `docs/tools.md` § Tier Visibility now states this explicitly, because reading the tier system as access control is the tempting wrong fix.

  Post-review: the refusal logs at INFO and records an audit row rather than logging at ERROR. It is the expected outcome of untrusted input and is client-triggerable at unbounded rate, and `logError` feeds the 500-entry ring behind the admin Monitoring panel, so volume alone could have evicted every genuine error from an operator's view. The durable record moves to the audit log, where it cannot be flushed (A-5). Also adds `messaging_manage` to `MESSAGING_TOOLS`: `handlers.messaging.ts` registers eleven `messaging_*` handlers but the set listed ten, so with messaging disabled the registry still advertised a tool whose handler is never registered. That is a `tools/list` consistency defect, not a kill-switch bypass — the registration gate covers all eleven, and `messagingKillSwitchRegistration.spec.ts` now pins both halves so the question is settled in CI rather than in review.

  **Migration.** Three surfaces change. `test_primitive` (a handler returning `42`) is deleted; it had no consumers and was shipped in the npm tarball. `diagnostics_handshake` now requires `INDEX_SERVER_DEBUG=1` or `INDEX_SERVER_STRESS_DIAG=1`, matching the three other `diagnostics_*` tools — it exposes the internal handshake event ring (SH-9). `dashboard_config` is unchanged in behaviour but is now properly declared as an `admin`-tier tool, so it appears in `tools/list` with `INDEX_SERVER_FLAG_TOOLS_ADMIN=1`. Packaging: `handlers.testPrimitive` and `scripts/client/tests/` no longer ship (524 → 521 files).

## [1.41.2] - 2026-09-06

Backfilled 2026-09-11 ([#575](https://github.com/jagilber-dev/index-server/issues/575)). This section shipped empty; the entries below are reconstructed from `git log v1.41.1..v1.41.2`.

### Fixed

- **Six CI gates could not fail on bad input** ([#564](https://github.com/jagilber-dev/index-server/pull/564)): gates that reported success regardless of what they were given. This is the release that made them able to go red, and is why several subsequent issues — notably the `npm audit` blocker in [#574](https://github.com/jagilber-dev/index-server/issues/574) — only became visible afterwards.
- **`guard:skips` detects `skipIf` and `runIf`** ([#565](https://github.com/jagilber-dev/index-server/pull/565)): the skip guard matched only `.skip` and `.only`, so conditionally-disabled tests passed it untouched.
- **Version resolution: candidate order corrected, version string validated, three copies consolidated** ([#566](https://github.com/jagilber-dev/index-server/pull/566)).

### Documentation

- **Changelog entry added for the #549 messaging filters** ([#563](https://github.com/jagilber-dev/index-server/pull/563)) — the omission that [#561](https://github.com/jagilber-dev/index-server/issues/561) fixed by hand and asked to have gated. The gate did not land then; it does now, as `guard:changelog` (see [#575](https://github.com/jagilber-dev/index-server/issues/575) under [Unreleased]). This section being empty is the same defect recurring one release later.

### Chores

- Dependency bumps: npm minor/patch group, 3 updates ([#568](https://github.com/jagilber-dev/index-server/pull/568)); github-actions group, 2 updates ([#569](https://github.com/jagilber-dev/index-server/pull/569)).
- Schema version stamps regenerated for 1.41.2.

## [1.41.1] - 2026-09-06

### Fixed

- **Dashboard instruction writes are audited, so Catalog Activity records them** ([#525](https://github.com/jagilber-dev/index-server/issues/525)): the new Catalog Activity panel stayed empty for the most visible mutation path there is — a create through the dashboard returned `verified: true`, wrote the file, and recorded **zero** activity rows.

  The activity bridge added in 1.41.0 was built on the premise that `logAudit` is the single choke point every committed mutation passes through. That holds for the MCP handlers (`index_add`, `index_patch`, archive/restore/purge) and for the archive-lifecycle routes, but **not** for the dashboard's `POST`/`PUT`/`DELETE /api/instructions`, which write straight through `writeEntryAsync()` / `removeEntry()`. Those routes were never audited at all — so dashboard edits were missing from the audit trail independently of the charts, a pre-existing gap that hooking activity to `logAudit` merely made visible. The archive routes *in the same file* were audited, which is what made the omission easy to miss.

  Fixed by adding the missing `logAudit` calls rather than special-casing activity, so the audit trail is repaired alongside the chart. The create audits only after read-back verification, so a write that failed verification is not reported as a committed change. `dashboardInstructionsAudit.spec.ts` pins each write path to an audit call and pins the audit *action names* against `activityTypeFromAudit` — an action outside the allowlist records nothing and fails silently, which is precisely the shape of this defect.

- **A lone catalog sample renders as a bar instead of nothing** ([#525](https://github.com/jagilber-dev/index-server/issues/525)): with one sample the stacked-area path collapses to `moveTo` followed by `lineTo` at the same x and fills nothing, so the composition panels drew bare axes while the legend beneath them showed real numbers — reading as "no data" when the data was in fact known. Every fresh deploy and every restart hits this for the first sampling interval.

  This also exposed that the chart specs could not observe drawing at all: jsdom ships no canvas backend, so `getContext('2d')` returns `null` and the renderer's guard turns every draw into a no-op — "renders without throwing on single entry" passed against a chart that painted nothing. The specs now install a recording 2D context so drawing is exercised, and the new assertion keys on the band's own series colour (an earlier version checked only that "something was painted", which the full-canvas background wash satisfies, and passed with the fix reverted).

## [1.41.0] - 2026-09-05

### Added

- **`index_patch` — partial instruction body patching** ([#486](https://github.com/jagilber-dev/index-server/issues/486)): a new mutation tool (and `index_dispatch` action `patch`) that edits an instruction body in place instead of requiring the whole body to be resent. Previously the only way to change a body was `index_add` with `overwrite: true`, which paid the token cost twice (a full `get` plus a full write), risked silent truncation whenever a model regenerated a large body, and offered no lost-update protection. Four operations are supported: `splice` (replace a character window), `append`, `prepend`, and `replace` (**literal** substring — deliberately not a regex, to avoid a ReDoS surface). `splice` uses the same units and the same surrogate-safe boundary snapping as the windowed `get` read, so a window that was read out can be written straight back without ever splitting a surrogate pair. An optional `expectedSourceHash` precondition gives real optimistic concurrency: a mismatch is refused with `precondition_failed` plus the actual hash and **nothing is written**. Also supports optional `bump`/`summary` for a semver bump with changelog entry, and `dryRun` to preview a result without writing. Body-size limits are enforced on this path too, so patch cannot be used to append past the `index_add`/`index_import` cap.

- **Self-hosted CI gate** ([#503](https://github.com/jagilber-dev/index-server/pull/503)): a new `.github/workflows/ci-self-hosted.yml` runs build, typecheck, test, contract tests and the skip guard on a self-hosted runner, restoring an executing validation lane. Every GitHub-hosted lane on this repo currently reports `failure` with `steps: []` (no runner obtained) or `skipped` off the `needs:` cascade, so this is the only gate that actually executes. Opt-in by design: the job is gated on `vars.SELF_HOSTED_RUNNER == 'true'`, so without a running supervisor the job does not queue indefinitely. Carries `timeout-minutes: 20` because it executes on maintainer hardware, where the 360-minute default would hold the machine, the supervisor slot and the concurrency group; `cancel-in-progress` does not cover the hung-job case as it only fires when a new run arrives.
- **Dashboard navigation bubbles**: a new `admin.nav-bubbles.js` adds unread/attention counts to the admin nav, covered by `dashboardNavBubbles.spec.ts`.
- **Dashboard messaging auto-refresh**: the messaging panel refreshes without a manual reload, with stale-response and ordering guards covered by `dashboardMessagingAutoRefresh.spec.ts`.
- **Inline preview button in the flat instruction list**: preview an instruction without switching to the tree view.
- **Build metadata on the dashboard status route**: `status.routes.ts` now reports build provenance, covered by `dashboardStatusBuildMetadata.spec.ts`.
- **Catalog History chart on the dashboard Performance panel** ([#525](https://github.com/jagilber-dev/index-server/issues/525)): the Performance card was a flat list of point-in-time scalars, so nothing showed how the catalog itself moves over time — you could not answer "did that reload drop entries?" or "is usage flat since the last promote?" without watching the panel by hand. A new server-side `CatalogSampler` (`src/dashboard/server/CatalogSampler.ts`) samples index count, usage total and signal count every **5 minutes** into its own `BufferRing` (default 72 samples ≈ 6 hours, `OverflowStrategy.DROP_OLDEST`), and a hand-rolled DPR-aware canvas renderer (`admin.performance.chart.js`) plots the three series beneath the existing stat rows.

  **Adoption note (AR-2) — `GET /api/system/resources` gained a `catalogHistory` field.** The change is **purely additive**: the existing `data`, `limit`, `sampleCount` and `timestamp` fields are unchanged, so existing consumers need no action. `catalogHistory` is an array of `CatalogSample` (`{ timestamp, indexCount, usageTotal, signalCount }`) and is `[]` when the sampler has not yet produced a sample or is unavailable — consumers must treat empty as normal, not as an error. The catalog cadence is deliberately **5 minutes, not the 5-second resource cadence**, because sampling signal counts requires `loadUsageSnapshot()`, which performs disk I/O. The two sampling windows on the card are therefore independent, and the existing "Window Ns (M samples)" row continues to describe the CPU/heap sparkline only.

  The chart shipped in this release is a **composition** view rather than the three normalized lines the feature was first built with (see *Fixed* below for what changed and why). `themeVar()` was added to `admin.utils.js` so chart colors resolve from the `--admin-*` CSS custom properties rather than hardcoded hex. `MetricsCollector.ts` was deliberately **not** extended — it is already at 1086 lines, over the CQ-1 hard limit — which is why the sampler is a separate module.

- **Catalog Activity panel — a flow view over catalog changes**: where Catalog History answers "what does the index look like", the new Catalog Activity card answers "what happened". Stacked bars per time bucket (`added` / `modified` / `signalled` / `archived` / `removed`) with selectable bucket width (hourly → weekly) and range, plus a **per-instance** table breaking the same window down by server process (`<pid>@<cwd>`) with a per-signal breakdown — so "which instance wrote this" is answerable when several run against one catalog. Bars rather than lines because these are counts of discrete events: a line between two buckets draws values that were never observed and renders an idle day as a smooth slope. Backed by three new endpoints (`GET /api/usage/activity`, `/activity/instances`, `/activity/events`); the bucketed series is returned **dense**, since the store omits empty groups and a sparse series read as a bar chart compresses quiet periods out of existence.

- **Persistent activity and signal telemetry** (`SqliteActivityStore`): an append-only `activity` table (semantic catalog events, each carrying `prevSignal` so signal *transitions* stay recoverable) plus a `catalog_samples` table for periodic stock snapshots. It lives in its own database (`INDEX_SERVER_ACTIVITY_DB`, default `<cwd>/metrics/activity.db` **at the time of this release — see the Migration note under [Unreleased]; the default is now `<STATE_ROOT>/metrics/activity.db`**) deliberately **independent of `INDEX_SERVER_STORAGE_BACKEND`**, so chart history exists on the default `json` backend and not only under `sqlite`. Signals are recorded at `usage_track`; catalog lifecycle events are recorded from `logAudit`, the single choke point every committed mutation already passes through, using an explicit action allowlist that consults the audit metadata — an `add` with `created:false` is a modification, a `patch` with `changed:false` is not a change at all. Retention is time-based (`INDEX_SERVER_ACTIVITY_RETENTION_DAYS`, default 90) so the chart's x-range stays predictable regardless of event volume. Recording defaults **off** under the test runner unless `INDEX_SERVER_ACTIVITY_DB` is set explicitly — otherwise every mutation-touching spec writes the repository's real telemetry database (one full suite run left a 4 MB WAL behind).


- **Messaging filters: `requiresAck` and `unacked`** ([#523](https://github.com/jagilber-dev/index-server/issues/523), [#549](https://github.com/jagilber-dev/index-server/pull/549)): `messaging_list` / `messaging_read` now support filtering by `requiresAck: true` (messages that request acknowledgment) and `unacked: true` (messages not yet acknowledged by the caller). Enables targeted monitoring of the message bus for unacknowledged blockers.

### Fixed

- **Catalog History plotted fabricated history, and its signal share was unreadable** ([#525](https://github.com/jagilber-dev/index-server/issues/525)): reported as "the signal percentage looks wrong". The percentage was arithmetically correct (30/278 = 10.8%); three defects underneath it were not.

  **The curve was not history.** `indexTimeline` sorted entries by `createdAt` and cumulatively summed each entry's *current* usage and signal state. That plots today's state against entry birth dates — a signal recorded last week appeared months earlier, at the creation date of the entry it belongs to — so the x-axis was entry *rank*, not time, and every slope was an artifact of when entries happened to be created. The leading edge was worse: cumulative ratios over denominators of 1, 2, 3 are always 0% or 100%, and that noise set the autoscale for the rest of the series. It is now built from real `CatalogSampler` observations at real wall-clock times, and `indexTimeline` is removed from `/api/system/resources`.

  **No signal history existed to plot.** `UsagePersistRecord` keeps a last-write-wins `lastSignal` with no timestamp, so `helpful` later changed to `applied` erases the `helpful`, the current breakdown undercounts, and no series is reconstructible from it. Fixed by the activity event log above.

  **Each series was scaled to its own maximum.** A 10.8% series and a 289.6% series both touched the top of the plot, with no y-ticks to reveal it — a dual-axis chart with the axes hidden. Compounding it, `usage %` was not a percentage but a *rate* (usages per entry, unbounded above 100), sitting beside a genuine bounded percentage. Both panels now carry numeric ticks, every band in a panel shares one scale, and the coverage bands sum to the entry count — so signals and instruction count share a single axis with no ratio to misread.

  Also: `signalCount` was computed over the usage snapshot while the total came from the live index. The snapshot outlives removed entries, so the signal share could exceed 100% with nothing clamping it. Both are now counted by walking the index, and a spec asserts the buckets partition it (`signalled + retrievedOnly + neverUsed === indexCount`). Signal buckets are derived from `USAGE_SIGNALS` rather than a hand-written switch, so a new signal value is counted instead of silently falling through to "unsignalled".

- **Catalog history persistence grew without bound and never compacted** ([#525](https://github.com/jagilber-dev/index-server/issues/525)): `CatalogSampler` persisted its `BufferRing` in append mode, which rewrote ring state on every add. The on-disk file had reached **17,094 records carrying 312 distinct samples — 2.0 MB for three days** of 5-minute sampling. Sample history now goes to SQLite; the ring is in-memory only and serves as a fallback when the store is unavailable, so an outage degrades the chart to "since this restart" rather than to empty. `getHistory()` stays ring-scoped and `getDurableHistory()` reads the store — deliberately separate, since silently widening the former would make ring capacity untestable.

- **`health_check` no longer reports `version: "0.0.0"`** ([#524](https://github.com/jagilber-dev/index-server/issues/524)): `handlers.metrics.ts` resolved the package version from `process.cwd()` alone, but under an MCP stdio launch `cwd` is the *client's* directory — so on a normal deployment the lookup missed and `health_check` answered `0.0.0`, which reads as a real version rather than as a failed resolution. Version resolution now routes through the shared `findPackageVersion()` helper, which keeps the cwd candidate first and falls back to a `__dirname`-relative `package.json`, and emits a `WARN` line naming every candidate it tried when none resolve instead of silently degrading (OB-5). This is the **second site of the same defect class** as [#506](https://github.com/jagilber-dev/index-server/issues/506) — that fix taught `createSdkServer` the `__dirname` fallback in 1.8.3, but the metrics handler kept its own cwd-only copy of the lookup, so the same symptom survived unnoticed in `health_check`. The candidate list now lives in one place (`src/utils/version.ts`) that both call, and the spec pins candidate *order* as well as the fallback, so swapping the two entries turns a test red.

- **Heading markers and title-restating lines stripped from derived semantic summaries** ([#537](https://github.com/jagilber-dev/index-server/issues/537)): `deriveSummary` took the first line of body verbatim, so entries starting with a markdown heading (e.g. `# Azure Kusto Methods`) embedded the `#` markers into the vector, and entries whose first line restated the title contributed zero additional semantic signal. Both patterns are now detected and skipped: `deriveSummary` strips heading markers, skips title-matching lines, and takes the first real prose line. Stored degenerate summaries are re-derived during normalization. The dead `|| inst.body` fallback in `embeddingService.ts` has been removed (CQ-5). First load after upgrade triggers a full re-embed (~2-5 min for ~1300 entries) due to `DERIVATION_VERSION` bump from 1 to 2.

- **Array `audience` no longer crashes the SQLite backend or persists an out-of-enum value** ([#503](https://github.com/jagilber-dev/index-server/pull/503)): a legacy entry whose `audience` was an array (e.g. `["individual","group"]`) reached a SQLite bind parameter as an array and threw `TypeError`, taking down the write path. `migrateAudience()` in `schemaMigrationService.ts` also returned without normalizing it. Both are fixed. Note the second half of the defect, which is the data-integrity one: the crash fix alone coerced the array by taking its **first element unchecked**, so `["bogus","group"]` persisted `"bogus"` — a value not in the audience enum at all — and, because the coercion never throws, an invalid audience silently became `all`, the **broadest** scope. A crash is loud; a silently widened audience is not. Both coercions now derive from the `AUDIENCES` tuple in `src/models/instruction.ts` and resolve to the first **enum-valid** member (falling back to `all`), so the storage layer and the migration layer agree on every input shape. The spec pins that agreement directly — reverting either coercion turns two tests red — where the original suite passed with either array arm deleted, i.e. it was honest about the crash and silent about the semantics.

- **Governance-denylisted ids are refused at write time and reported when skipped** ([#494](https://github.com/jagilber-dev/index-server/issues/494)): the loader denies any file whose basename starts with `000-bootstrapper` or `001-lifecycle-bootstrap` to prevent knowledge recursion, but the denial left no trace. `_skipped.json` was built only from parse/validation errors, so it reported `{ "count": 0, "items": [] }` while files were being dropped on every load, and `index_add`/`index_import` would happily persist a file under a denied id, answer `success: true`, and let the entry vanish on the next load with nothing to explain it. Denied files are now listed in `_skipped.json` with `reason: "ignored:governance-denylist"`, and both write paths reject denied ids with an explicit `denylisted_id` error. The loader and the write paths now share one predicate so they cannot diverge. `docs/content_guidance.md` no longer tells new agents to fetch `000-bootstrapper` — an id the loader permanently denies — and points at `help_overview` instead.
- **`index_add` overwrite no longer discards `riskScore` and `reviewIntervalDays`** ([#492](https://github.com/jagilber-dev/index-server/issues/492)): [#350](https://github.com/jagilber-dev/index-server/issues/350) made author-supplied `riskScore` authoritative on the create path only. On the update path two separate hand-maintained field lists omitted `riskScore` and `reviewIntervalDays`: `ADD_GOVERNANCE_KEYS` never merged them from the input, and the noop-overwrite detector did not treat them as a change — so an overwrite that supplied only one of them was classified as "nothing to do", returned `success: true` with `verified`/`strictVerified` set, and wrote nothing at all. Both fields are now merged, and the change detector is derived from the merge list so a mergeable field can always defeat the noop short circuit. `index_import` carried the same gap in `IMPORT_GOVERNANCE_KEYS` and is fixed alongside.
- **`index_governanceUpdate` implements the fields its schema advertises** ([#493](https://github.com/jagilber-dev/index-server/issues/493)): `riskScore`, `priority`, `priorityTier` and `requirement` were accepted by the dispatcher schema, dropped by the handler, and reported back as `changed: true`. Combined with [#492](https://github.com/jagilber-dev/index-server/issues/492) this left `riskScore` unsettable on an existing entry through any MCP path. All four are now applied and echoed in the response, invalid values are rejected with an explicit error instead of being silently ignored, and the direct `index_governanceUpdate` tool schema no longer rejects parameters the dispatcher advertises.
- **Tool artifact generation is deterministic across all ambient feature gates** ([#488](https://github.com/jagilber-dev/index-server/issues/488), [#489](https://github.com/jagilber-dev/index-server/issues/489)): both generator scripts (`generate-tools-doc.mjs`, `generate-server-env-tools.mjs`) now pin tier, diagnostics (`INDEX_SERVER_STRESS_DIAG`), and messaging (`INDEX_SERVER_MESSAGING_ENABLED`) before calling `getToolRegistry()`, so the committed artifacts are environment-independent. `generate-tools-doc.mjs` produces the 34-tool extended surface; `generate-server-env-tools.mjs` produces the complete 63-tool admin registry. The drift test mirrors the same gate configuration, so a dimension mismatch between the generators and the test expectation is detected.
- **Messaging storage is shared across clients instead of siloed per working directory**: the messaging directory defaulted to `path.join(process.cwd(), 'data/messaging')`. Every MCP client launches the server from a different working directory, so VS Code, Claude Code and Copilot CLI each resolved a *different* absolute store and silently stopped sharing messages — a broadcast sent from one client was invisible to the others, `messaging_list_channels` reported zero channels from a client that had just sent a message, and no error surfaced anywhere because each process was reading a store only it wrote to. Compounding it, `INDEX_SERVER_MESSAGING_DIR` was marked `active: false` in the MCP env catalog, and only `active` entries are emitted by `activeEnvFromCatalog`, so no generated client config ever pinned the path that would have made the clients agree. The default now derives from `INDEX_SERVER_DIR` — the one path every client already shares — as the sibling `index-messaging`, following the same catalog-relative derivation as `backups` (`<dirname(INDEX_SERVER_DIR)>/backups`); the catalog entry is emitted as active so every generated config carries the same absolute path; and `resolveInstructionsDir()` now has a single definition in the new `src/config/pathResolution.ts`, shared by `runtimeConfig` and `featureConfig`, so the catalog and the stores derived from it cannot drift apart. An explicit `INDEX_SERVER_MESSAGING_DIR` remains the highest-priority override. The store is additionally refused at startup when it resolves inside the instruction catalog: the loader scans that directory for instruction JSON, so message files written there are read back as malformed instructions and pollute the index — previously nothing prevented that configuration. The messaging store additionally moves off the shared `index-data` Docker volume onto its own `index-messaging` volume, declared for both compose services. Three silent-failure modes around this path now have signals: the resolver WARNs when `INDEX_SERVER_DIR` is unset (the store is then still cwd-anchored and still per-client) and when a non-empty legacy `<cwd>/data/messaging` is left orphaned; and `isPathInside` compares canonical paths via `realpathSync.native()` rather than lexical ones, closing measured fail-open cases for 8.3 short names, `\\?\` device paths and directory junctions. A persisted dashboard override can no longer brick the server: `POST /api/admin/config` probes a value through `loadRuntimeConfig()` before writing it to the overlay and now reports a rejection instead of HTTP 200, and if an overlay that already contains a fatal value is present at boot, the server ignores the overlay for that boot, reports which keys it dropped, and starts — so the dashboard that set the value remains reachable to clear it. A fatal value supplied directly in the environment still fails closed. **Upgrade note:** nothing is migrated automatically and the old `<cwd>/data/messaging` directory is left in place but is no longer read. Most messages are TTL-bounded and expire on their own, but messages sent with `persistent: true` are exempt from the TTL sweep by design, so they will neither age out of the old store nor appear in the new one — copy the old contents across, or point `INDEX_SERVER_MESSAGING_DIR` at the old path, before assuming the queue is empty.
- **Instructions Copy button could copy the wrong instruction**: `instructionPreviewBody` was a single unkeyed global written whenever a detail-pane fetch resolved, and `selectInstructionPreview()` had no stale-response guard. Selecting one instruction and then another — or the 30s auto-refresh re-selecting while the user clicked a different node — could leave the cache holding the first entry's body while the second was selected and rendered; `📋 Copy` then silently emitted the wrong content and still reported `✓ Copied`. Detail-pane loads now carry a monotonic request token so a superseded response updates neither the cache nor the DOM, the cached body is tagged with the instruction it belongs to, and Copy refuses to use it unless it matches the current selection. A selection that disappears from the list (deleted or filtered out) now clears both the selection and the cached body.
- **Instructions Copy button label could stick permanently**: the reset timer captured `btn.textContent` as the label to restore, so a second click while `✓ Copied` was displayed captured that as the "original" and the button never returned to `📋 Copy`. The canonical label is now a constant and any pending reset is cancelled before a new one is scheduled.
- **Clipboard fallback leaked a hidden textarea**: the legacy `execCommand` path removed its temporary textarea only on the success path, so a throw from `select()`/`execCommand` left the node in the document. Removal now happens in `finally`.
- **Copy reported "No instruction body to copy" when the fetch failed**: a network or auth error was swallowed and fell through to the empty-body branch, misdirecting the operator. Load failures now surface as `Failed to load instruction body`, distinct from a genuinely empty body.
- **Auto-backup no longer needs backup-specific configuration to find the right directory**: `INDEX_SERVER_BACKUPS_DIR` defaulted to `<cwd>/backups`, which is unrelated to the index being served. Under an MCP stdio launch, `cwd` is the server install directory, so a deployment that set only `INDEX_SERVER_DIR` (the normal case) silently wrote — or refused to write — backups somewhere other than alongside its index, and operators had to discover and set `INDEX_SERVER_BACKUPS_DIR` to get working backups. The backup target is now derived from the *resolved* instruction directory (`<INDEX_SERVER_DIR>/../backups`), so the target always follows the source. Setting `INDEX_SERVER_DIR` alone is sufficient; auto-backup remains on by default whenever mutation is enabled. When `INDEX_SERVER_DIR` is unset the derived value is `<cwd>/instructions/../backups` = `<cwd>/backups`, preserving the previous default exactly. The implicit-source guard now only applies to the one genuinely un-inferable case (explicit `INDEX_SERVER_BACKUPS_DIR` with no `INDEX_SERVER_DIR`), and `[auto-backup] started ...` now logs the resolved source and target.
- **Auto-backup reported as started when the guard refused**: `startAutoBackup()` returns `null` when auto-backup is disabled or the implicit-source guard declines, but startup diagnostics pushed `autoBackup` onto the started list unconditionally, making a refusal indistinguishable from a healthy start. It is now recorded only when a timer was actually created.
- **Auto-backup no longer silently archives the wrong directory**: `INDEX_SERVER_DIR` falls back to `<cwd>/instructions` when unset. If `INDEX_SERVER_BACKUPS_DIR` was explicitly pointed at the real backup store while `INDEX_SERVER_DIR` was omitted, auto-backup wrote hourly `auto-backup-*.zip` snapshots of whatever instruction files shipped next to the server binary — indistinguishable from genuine backups by filename, and destructive if restored. `startAutoBackup()` and `runAutoBackupOnce()` now refuse to run in that configuration and log an actionable reason; the new `INDEX_SERVER_AUTO_BACKUP_ALLOW_IMPLICIT_DIR=1` flag opts back in. The `[auto-backup] created ...` log line now records the source directory.

### Changed

- **Usage tracking is enabled by default on every profile** ([#495](https://github.com/jagilber-dev/index-server/issues/495)): `INDEX_SERVER_FEATURES` only received `usage` on the `enhanced` and `experimental` profiles, while `INDEX_SERVER_AUTO_USAGE_TRACK` was documented as defaulting on — so a default install had the auto-track switch on and the feature it feeds off, and recorded nothing. The gate diagnostic never surfaced either: auto-track call sites discard `incrementUsage`'s return value, and `usage_track` (the one tool that returns the hint) was `extended` tier and therefore unreachable on the default profile. `usage` is now enabled during feature-flag parsing so it applies regardless of profile, with `INDEX_SERVER_USAGE_ENABLED=0` as a dedicated opt-out that takes precedence over the CSV list. `usage_track` moves to the `core` tier so agents can act on the `_meta.afterRetrieval` hint the server already sends them. This data never leaves the machine (see `PRIVACY.md`) and usage history cannot be backfilled, so the cost of defaulting off was permanent data loss. `docs/configuration.md` and `docs/mcp_configuration.md` now state the effective defaults.
- **Dashboard client JS is now covered by behavioral tests**: added `jsdom` as a dev dependency and `src/tests/dashboardInstructionsCopy.spec.ts`, which loads the real `admin.instructions.js` into a DOM and drives the exported entry points. Previous dashboard specs asserted on source text only, which cannot observe ordering, timer, or cleanup defects — none of the copy-path bugs above were detectable by them.

## [1.40.0] - 2026-07-29

### Added

- **Copy button in the dashboard instructions detail pane**: the Preview/Raw/Edit toolbar gains a `📋 Copy` action that copies the selected instruction's markdown body (not the JSON envelope) to the clipboard, with a legacy `execCommand` fallback for non-secure contexts and transient success/failure feedback on the button.
- **Optional lifecycle hooks on instruction CRUD**: operator-configured commands that run after a committed mutation (create/update/remove/change), off by default. Configured via `INDEX_SERVER_HOOK_ON_CREATE`/`ON_UPDATE`/`ON_REMOVE`/`ON_CHANGE` (plus `INDEX_SERVER_HOOK_BLOCKING`, `_TIMEOUT_MS`, `_MAX_CONCURRENT`). Dispatched from the single audit hook point so every mutation tool (`index_add`/`index_import`/`index_remove`/`promote_from_repo`) is covered exactly once, after the durable write. Fire-and-forget by default with an opt-in blocking mode, timeout + concurrency bounds, and full failure isolation. Security boundary: the command comes from trusted operator env only — mutation context is passed via env vars + stdin JSON, never interpolated into the command. ([#447](https://github.com/jagilber-dev/index-server/issues/447))
- **Lifecycle-hook dashboard management and operations guide**: the existing Configuration tab now shows an enabled/disabled summary plus a prominent management card for write-only create/update/remove/change commands, blocking mode, timeout, and concurrency. Existing command text remains server-redacted and is never returned or pre-populated; operators can replace or clear commands through the protected runtime overlay. Added a dedicated architecture/operations guide plus Windows, POSIX, and MCP-launcher configuration examples.
- **Dashboard instructions tree view + markdown preview**: the admin instructions panel gains a category-grouped, collapsible tree with a master–detail preview pane. Selecting a node renders the instruction body as sanitized markdown by default (raw JSON toggle available); the flat list remains via a Tree/Flat toggle. Search/filter works in both views, and view mode / expanded categories persist in `localStorage`. ([#449](https://github.com/jagilber-dev/index-server/issues/449))
- **`INDEX_SERVER_DEFAULT_PAGE_SIZE` flag** (default `50`, clamped `1`–`100`): configurable default result count for the read actions `index_dispatch` `list`/`search`/`query` (and `index_search`) when the caller omits `limit`. Mirrors the search tool's historical default of 50 and is now the single source of truth shared by both `list` and `search`, so a large category no longer dumps every entry by default. `list` responses now include `truncated: true` and `nextOffset` when more items remain, and `limit: 0` on `list` is an explicit opt-out that returns the full set.

### Changed

- **`indexContext.ts` split for maintainability (CQ-1)**: the usage-tracking subsystem (counters, split-counter authority maps, firstSeen/usageCount/lastUsedAt invariant repair, snapshot persistence, per-id rate limiting) was extracted to a new `src/services/indexUsage.ts`, bringing `indexContext.ts` from 1436 to 938 lines (under the 1000-line ceiling). Behavior-preserving: a `getRawIndexState()` seam plus a runtime-only import cycle; the public usage API is re-exported from `indexContext` so importers are unaffected. ([#461](https://github.com/jagilber-dev/index-server/issues/461))
- **Runtime env reads routed through `runtimeConfig` (S-4)**: `INDEX_SERVER_ADD_TIMING` (dispatcher timing), `INDEX_SERVER_RATE_LIMIT` (usage limiter), and `INDEX_SERVER_AUTO_EMBED_ON_IMPORT` (new `semantic.autoEmbedOnImport`) now flow through the central config instead of direct `process.env` reads. ([#461](https://github.com/jagilber-dev/index-server/issues/461))
- **`index_dispatch` `list` now applies a default `limit`**: previously `list` (e.g. `list category=architecture`) returned *all* matching entries with no cap, producing oversized responses (a 166-entry category serialized to ~259 KB even body-light). `list` now defaults to `INDEX_SERVER_DEFAULT_PAGE_SIZE` (50) results, matching `search`/`query`. Callers that relied on full enumeration must pass `limit: 0`. The response still reports the full `count`; pagination is discoverable via `truncated`/`nextOffset`.

### Security

- **WebSocket auth no longer accepts a URL query token (SH-7)**: the dashboard WebSocket `verifyClient` previously accepted the admin key via `?token=`, which leaks credentials into logs, proxies, and browser history. The admin key is now accepted only through the `Authorization: Bearer` header. ([#461](https://github.com/jagilber-dev/index-server/issues/461))
- **All GitHub Actions SHA-pinned**: every external action across the live workflows and the Squad workflow templates is pinned to an immutable commit SHA (with a `# vX` comment), and a 7-day Dependabot `cooldown` was added for the npm and github-actions ecosystems, eliminating mutable-tag supply-chain risk. ([#446](https://github.com/jagilber-dev/index-server/issues/446))
- **CodeQL alert remediation (workflow permissions + ReDoS)**: added least-privilege top-level `permissions:` blocks to all 15 GitHub Actions workflows that lacked one (`actions/missing-workflow-permissions`) — 13× `contents: read`, `instruction-snapshot` `contents: write` (commits snapshots), `stress-nightly` `contents: read` + `issues: write` (opens failure issues). Hardened `normalizeLegacyId` (`schemaMigrationService`) against `js/polynomial-redos` by bounding input to 200 chars before the chained `+`-quantified regex replaces run (final id still capped at 120; behavior preserved for all valid ids), with boundary/adversarial regression coverage. ([#444](https://github.com/jagilber-dev/index-server/issues/444))

### Fixed

- **Instructions detail pane could open in Raw JSON instead of Preview**: the Preview/Raw choice was persisted in `localStorage` (`instr.previewRaw`), so once Raw had been selected the panel kept opening in JSON view on every later visit. Rendered markdown is now always the default when the panel opens; Raw is an in-session toggle only, and the stale persisted preference is cleared on load.
- **Instructions tab auto-refresh resetting tree scroll/state**: the dashboard's 30s background refresh (`startAutoRefresh` → `refreshInstructionsIfVisible`) always fully re-rendered the instructions tree (`host.innerHTML` replace), resetting scroll position and interrupting in-progress browsing every ~30s even when the underlying data hadn't changed. `loadInstructions` now fingerprints the fetched list and skips the render on a silent/preserve-page refresh when nothing changed; when a re-render is needed, the tree pane's scroll position is preserved across the DOM replace. ([#481](https://github.com/jagilber-dev/index-server/issues/481))
- **Messaging split-brain across standalone processes**: `AgentMailbox` previously loaded `messages.jsonl` into memory exactly once per process (`ensureLoaded()` guarded by a one-shot `loaded` flag) and never re-synced, so a message written by one standalone process (e.g. one VS Code window) was invisible to `messaging_list_channels`/`messaging_read`/`messaging_stats` in any other already-running process, even though the Inter-Agent Messaging UI showed it. Added a `.messages-version` token file (mirroring the existing `.index-version` pattern in `indexContext.ts`), touched on every write; `ensureLoaded()` now does a cheap version check per call and merges disk-only messages into the in-memory store by ID rather than blind-overwriting it, so a process's own in-flight writes are never clobbered by a concurrent reload. Known limitation: the merge is additive only — deletions/purges/TTL sweeps in one process don't yet propagate to another already-loaded process. ([#479](https://github.com/jagilber-dev/index-server/issues/479))
- **Lifecycle hook blocking mode now blocks the mutation response**: the central audit dispatch is synchronous when `INDEX_SERVER_HOOK_BLOCKING` is enabled. Previously the dispatcher returned a Promise that the synchronous audit call discarded, so the setting behaved like fire-and-forget through real mutation paths. Blocking commands now complete (or time out) before the audit call returns while failures remain isolated from the committed mutation.
- **Dependency advisories remediated**: `esbuild` overridden to `^0.28.1` (clears the dev-server file-read advisory in the transitive `vitest → vite` chain), and `js-yaml` (4.3.0), `protobufjs` (7.6.5), and `tar` (7.5.19) bumped within existing ranges. `npm audit` on `main` reports 0 vulnerabilities. ([#451](https://github.com/jagilber-dev/index-server/issues/451))
- **CSP + hook-doc reconciliation**: documented the narrow `style-src 'unsafe-inline'` CSP exception (script-src remains nonce-based) with its migration path, and aligned the shared security-hooks doc to the actual `gitleaks` pre-push placement. ([#461](https://github.com/jagilber-dev/index-server/issues/461))
- **`semantic-search` test mocks**: the four `getRuntimeConfig` mocks omitted the `instructions` section, causing `defaultSearchLimit()` to throw `Cannot read properties of undefined (reading 'defaultPageSize')`; added `instructions.defaultPageSize` so the suite passes.
- **Tolerant parameter aliases for `index_search` and `usage_track`**: agents frequently called these tools with intuitive-but-unrecognized parameter names and got hard `-32602` rejections. `index_search` now accepts `q` and `query` as aliases for `searchString` (a bare `{ "q": "..." }` previously failed with `Invalid keywords: expected array`). `usage_track` now accepts `instructionId` — the exact identifier field name that `search`/`query`/`get` responses emit — as an alias for `id` (previously rejected by `additionalProperties:false` + `required:['id']`). The `keywords` string form is also now honored on the strict Zod validation path for parity with the JSON-schema path. Aliases are wired through the handler, the Ajv `INPUT_SCHEMAS`, and the Zod registry so both the SDK and stdio transport validation paths accept them, with boundary-acceptance regression coverage.

## [1.32.0] - 2026-06-08

### Added

- **Split usage counters (`retrievedCount` / `appliedCount`)**: usage is now tracked as two monotonic sub-counters — `retrievedCount` (entry surfaced via search/get/query/export) and `appliedCount` (entry actually applied/cited via `action:'applied'` or `signal:'applied'`). Each has its own timestamp (`lastRetrievedAt` / `lastAppliedAt`). `usage_hotset` ranks by `appliedCount`, then `retrievedCount`, then recency, and surfaces all four fields. `graph_export` nodes expose `retrievedCount`/`appliedCount` when `includeUsage:true`. Legacy snapshots migrate automatically: existing `usageCount` becomes `retrievedCount` with `appliedCount = 0`, preserving `firstSeenTs`/`lastUsedAt` with no count regression. ([#418](https://github.com/jagilber-dev/index-server/issues/418))
- **Publish-ToMirror polls the tag-triggered Release workflow**: new opt-in flags `-WaitForRelease`, `-ReleaseWorkflowTimeoutMinutes` (default 30), `-ReleaseWorkflowName` (default `Release`) on `scripts/Publish-ToMirror.ps1`. After the mirror tag is created, the script polls the resulting workflow run and exits non-zero if its conclusion is anything other than `success`. ([#269](https://github.com/jagilber-dev/index-server/issues/269))
  - Discovery (Phase 1) and completion (Phase 2) now have **separate time budgets** so a slow runner-registration cannot starve completion polling; the discovery cap defaults to `min(3, TimeoutMinutes/2)` minutes.
  - Transient `gh` failures (non-zero exit or JSON parse error) are logged on the first occurrence and again on sustained-N to make timeouts debuggable instead of silent.
  - `Wait-ReleaseWorkflowRun` accepts an injectable `-GhInvoker` scriptblock (test-only seam) plus internal `-TimeoutSeconds` / `-DiscoveryTimeoutSeconds` overrides so unit tests can drive discovery-timeout / completion-timeout / `failure` / `cancelled` / transient-recovery branches without sleeping for minutes.
- **Phase 0 release preflight script** (`scripts/release-preflight.ps1`, npm alias `npm run release:preflight`): standalone, fail-aggregating validator that runs every release gate (clean tree, version parity, npm pack inventory, whitespace, typecheck, lint, full test suite, instruction schema, pre-commit) in a single pass without publishing or tagging. Surfaces all release blockers at once so a multi-PR release fix-chain collapses to 1–2 PRs. Supports `-FailFast`, `-SkipTests`, `-SkipPreCommit`. Each gate resets `$LASTEXITCODE` per call and parses `npm pack --dry-run --json` defensively against npm warning leakage. ([#250](https://github.com/jagilber-dev/index-server/issues/250))
- **`INDEX_SERVER_MESSAGING_ENABLED` kill-switch** (default `1`): opt-in disable for the entire messaging subsystem. When set to `0` / `false`, all 10 `messaging_*` MCP tools are filtered from `tools/list`, their handlers no-op registration, the dashboard Messaging tab is hidden, and `/api/messaging/*` REST routes return 404. Surfaced as `features.messaging` on `/api/status`. ([#353](https://github.com/jagilber-dev/index-server/issues/353))

### Changed

- **BREAKING (usage tracking)**: a *signal-only* `usage_track` call — e.g. `signal:'helpful'` with no `action` — now records the signal/comment **without** incrementing any usage counter. Previously it incremented `usageCount`. To count an application, pass `action:'applied'` (or `signal:'applied'`). Auto-tracking scope is also tightened: `index_search`/`query` auto-record only the **top-3** results (was top-10), explicit-id `export` is auto-tracked, and `list`/`listScoped` are no longer auto-tracked. The derived `usageCount` field is **deprecated** (kept one minor version) in favor of `retrievedCount` + `appliedCount`. ([#418](https://github.com/jagilber-dev/index-server/issues/418))

### Removed

- **BREAKING (dashboard HTTP surface)**: removed the v1 `/legacy` dashboard route and its supporting modules (`legacyDashboardHtml.ts`, `legacyDashboardStyles.ts`). The v2 admin panel at `/admin` is the canonical UI; the root path `/` already redirects there. The still-used `stripGraphTab` helper was relocated to `src/dashboard/server/adminHtmlTransforms.ts`. ([#230](https://github.com/jagilber-dev/index-server/issues/230))

### Fixed

- **MCP config absolute node binary**: `buildServerEntry` now pins the `command` (the node binary) to an **absolute path** (`process.execPath`) for the user-machine-local client formats (`vscode-global`, `copilot-cli`, `claude`) instead of a bare `node`. A bare `node` is resolved by the launching client (VS Code, Copilot CLI, Claude Desktop) against the PATH of its own process — inherited at launch time, not the user's current shell — so a client started before Node was on PATH (or from a launcher with a stripped environment) failed with "The command 'node' needed to run index-server was not found" even though `node` worked in a fresh terminal. The repo-scoped `vscode` (workspace) format deliberately keeps bare `node` so a committed workspace config stays portable across machines/contributors. Adds regression coverage pinning the absolute-command-per-format contract.
- **MCP config generation for Copilot CLI and Claude Desktop**: `buildServerEntry` now emits an **absolute** node entry path for the `copilot-cli` and `claude` formats (previously only `vscode-global` was absolutized). Those clients launch from the user's home directory and do not reliably honor a `cwd` field, so the generated config carried a relative `dist/server/index-server.js` with no `cwd` and was unlaunchable ("Cannot find module"). Hardened the test helpers to spawn from a foreign cwd and require absolute paths, plus a new regression test pinning the absolute-per-format contract.
- **Instruction governance linter** (`scripts/governance/lint-instructions.mjs`): skip non-instruction meta/state files (`_manifest.json`, `_skipped.json`, `bootstrap.confirmed.json`) that have no instruction body, and demote `priorityTier` mismatch from ERROR to WARN (it is not a schema-required field and catalog priority semantics are not uniformly applied). Seeded canonical bootstrap entries now carry explicit `status: 'approved'` and `classification: 'public'`.

## [1.28.26] - 2026-05-20

### Fixed

- **Release workflow**: install `npm@latest` into a sibling prefix (`$RUNNER_TEMP/npm-latest`) and prepend to `PATH` instead of `npm install -g npm@latest`. The global self-upgrade crashed with `MODULE_NOT_FOUND: promise-retry` mid-install on npm 10 → 11, blocking the Trusted Publishing (OIDC) publish of v1.28.25.

## [1.28.25] - 2026-05-19

### Changed

- **CI: npmjs publish via Trusted Publishing (OIDC)**. Removed `secrets.NPM_TOKEN` from the npmjs publish step in `.github/workflows/release.yml`; auth now flows via the workflow's `id-token` (Publisher=GitHub Actions, Repo=jagilber-org/index-server, Workflow=`release.yml`). Dropped the `Require NPM_TOKEN` preflight gate and added an `npm install -g npm@latest` step (Trusted Publishing requires `npm >= 11.5.1`; Node 22 ships `npm@10.x`). Motivation: npm bulk-rotated all granular write+bypass-2FA tokens on 2026-05-19 as a *Mini Shai-Hulud* supply-chain precaution, breaking the v1.28.24 publish with `E404`. OIDC removes the long-lived token entirely.

## [1.28.23] - 2026-05-17

### Changed

- **Setup wizard replaces profile prompt with 9 flat questions**: storage backend (json/sqlite), dashboard transport (http/https), semantic search (default yes), base directory, backup directory, port, host, target MCP clients, and config scope. Profile is now an internal-only concept derived from the answers (`sqlite → experimental`, `json + semantic → enhanced`, `json + no semantic → default`) and continues to drive ancillary catalog defaults (file logging, metrics file storage, `FEATURES=usage`). The non-interactive CLI retains `--profile` as a legacy flag.

### Added

- **Wizard-driven uninstall**: new `index-server --uninstall` (aliases: `--remove`, `--clean`) launches an interactive checkbox-based wizard for selectively or fully removing Index Server. Covers data paths (instructions, feedback, state, messaging, audit log, logs, metrics, model cache, embeddings, SQLite DB, certs, `.env`, backups, entire base dir), MCP client config entries (VS Code global, Copilot CLI, Claude Desktop), and package installs (global npm package, stale `$HOME/node_modules/@jagilber-org/index-server`). Each existing target is previewed before any destructive action. Non-interactive mode: `--non-interactive [--root <dir>] [--all | --remove <comma-list>]`.
- **Off-disk backup warning in setup wizard**: the backup directory prompt now strongly recommends placing backups on a different drive or path than the base directory, since same-disk backups do not protect against drive failure, encryption, or volume loss.
- **`buildEnvCatalog` honors explicit overrides** for `storageBackend`, `semanticEnabled`, and `backupsDir` on `McpProfileConfig` / `McpOperationOptions`. When provided, these take precedence over profile-derived defaults so the wizard's flat answers reach the generated `mcp.json` directly. `INDEX_SERVER_BACKUPS_DIR` is only emitted as active when the user customizes the backup directory.
- **Non-interactive wizard flags**: `--storage <json|sqlite>`, `--semantic`, `--no-semantic`, `--backup-dir <path>`.

## [1.28.22] - 2026-05-14

### Added

- **Archive lifecycle for instructions** (spec 006-archive-lifecycle, issue [#313](https://github.com/jagilber-dev/index-server/issues/313)): first-class archive state with a reversible `restore` path that decouples *"retire from the active index"* from *"permanently delete"*. Archived entries preserve payload, provenance, and audit context.
- **Five new `index_dispatch` actions**: `archive` (move active entries to the archive surface), `restore` (return archived entries to active; `restoreMode`: `reject` (default) | `overwrite`), `purgeArchive` (terminal destructive deletion of archived entries — bulk-gated by `INDEX_SERVER_MAX_BULK_DELETE` with auto pre-mutation zip backup), `listArchived` (enumerate archived entries with archive-metadata filtering + paging), `getArchived` (fetch single archived entry by id).
- **Archive metadata fields** on `InstructionEntry`: `archivedBy`, `archiveReason` (`deprecated` | `superseded` | `duplicate-merge` | `manual` | `legacy-scope`), `archiveSource` (`groom` | `remove` | `archive` | `import-migration`), `restoreEligible` (boolean, default `true`). `archivedAt` is reused.
- **Segregated archive storage**: JSON backend uses `<instructionsDir>/.archive/<id>.json` (skipped by the loader's dot-directory convention); SQLite backend uses a new `instructions_archive` table with **no FTS5 projection** by contract (semantic and full-text search remain active-only).
- **`includeArchived` / `onlyArchived` filters** on read dispatcher actions (`list`, `query`, `search`, `categories`, `get`, `export`, `diff`). Default behavior is unchanged — archived entries are excluded unless an explicit flag is set.
- **Centralized audit action constants** at `src/services/auditActions.ts` (`AUDIT_ACTIONS`, `ARCHIVE_AUDIT_ACTIONS`, `ArchiveAuditAction` union) covering the new actions: `archive`, `restore`, `purge`, `purge_blocked`, `purge_backup`, `purge_backup_failed`, `remove_default_change_warning`.
- **Shared `backupInstructionsDir` helper** at `src/services/instructionsBackup.ts` — consolidates the pre-mutation zip-backup logic previously duplicated across `instructions.remove.ts`, `instructions.archive.ts`, and `instructions.groom.ts`.

### Changed

- **Instruction schema version bumped 6 → 7** for the new archive metadata fields. The loader is **lax-accept** on v6/v7 (older records load unchanged); the writer **promotes records to v7 on next write** (opportunistic — no big-bang migration).
- **`index_groom` retirement paths now archive by default** instead of unlinking. `mode.removeDeprecated`, `mode.mergeDuplicates`, and `mode.purgeLegacyScopes` move targeted entries to the archive surface (audit action `archive`). A new `mode.purgeArchive` flag handles permanent deletion of archived entries and cannot be combined with the retirement flags.
- **`index_remove` gains a `mode` parameter** (`"archive"` | `"purge"`). **Default behavior is preserved this release**: omitting `mode` continues to destructively purge, but the response now includes a `defaultBehaviorChangeWarning` field and a `remove_default_change_warning` audit entry is written. The default flip to `mode:"archive"` is scheduled for the next major release per spec 006 release-coordination tasks R1/R2 — pass `mode` explicitly today (or `purge: true` as an alias) to insulate callers from the flip.

### Changed (BREAKING)

- **Dashboard `/api/admin/config` envelope** ([#359], PR #362): `GET` no longer
  returns `serverSettings` / `indexSettings` / `securitySettings` envelopes.
  The new response shape is `{ success, allFlags: FlagSnapshot[], timestamp }`
  where every flag is a registry-driven entry with `name`, `value`, `parsed`,
  `meta` (label, reloadBehavior, editability, validation, surfaces),
  `overlayShadowsEnv`, and — for `editable:false` + `readonlyReason:'sensitive'`
  flags — `present: boolean` *in place of* the value/parsed fields (security
  redaction). Consumers using the old envelope MUST migrate.
- **Dashboard `POST /api/admin/config` payload** ([#359], PR #362): legacy
  `{ serverSettings:{…} }` / `indexSettings` / `securitySettings` payloads are
  rejected with `400 { code: 'USE_FLAG_KEYS' }`. New canonical shape:
  `{ updates: { FLAG_NAME: value, ... } }`. The response now reflects the true
  outcome — HTTP `200` when every update applied, `207 Multi-Status` when at
  least one applied and at least one failed, `400` when every update failed;
  `success` mirrors `anyApplied`.

### Added (PR #362)

- **Per-flag reset endpoint** `POST /api/admin/config/reset/:flag` ([#359]):
  removes an entry from the overlay and restores the boot-time shadowed
  `process.env` value (or unsets it when none was shadowed). Returns
  `409 { code:'READONLY', readonlyReason }` for `editable:false` flags.
- **Runtime overrides overlay** at `data/runtime-overrides.json` ([#359]):
  read once at boot via `applyOverlay()` and merged into `process.env`
  BEFORE the first `getRuntimeConfig()` call. Precedence: `overlay > env >
  defaults`. Gated by `INDEX_SERVER_DISABLE_OVERRIDES=1`; path overridable
  via `INDEX_SERVER_OVERRIDES_FILE`. Atomic temp+rename writes;
  single-writer-by-convention.
- **Registry-driven dashboard Configuration tab** ([#359]): every row is
  rendered from `FLAG_REGISTRY`. Per-row reload-behavior badges
  (🟢 Dynamic / 🟡 Next-request / 🔴 Restart), a persistent "Pending restart"
  banner driven by overlay entries whose flag is `restart-required` and
  whose value differs from the active runtime value, and an `overlayShadowsEnv`
  pill (with tooltip exposing the shadowed env value to the operator) when an
  overlay entry masks a different `process.env` value present at boot.
- **Migration guide** at `docs/migration/dashboard-config-v2.md` ([#359]):
  before/after request and response examples plus consumer remediation steps.
- **Local adoption note** at `.instructions/local/dashboard-config-v2.md`
  ([#359]): `FLAG_REGISTRY` as single source of truth for the dashboard
  config surface, plus the `readonlyReason` taxonomy (`derived`,
  `deprecated`, `reserved`, `sensitive`, `legacy`) and the validation
  `code` taxonomy (`READONLY|TYPE|RANGE|ENUM|PATTERN|FORMAT`). Marked
  *stable as of #359*.

### Removed

- `AdminConfig.indexSettings` and `AdminConfig.securitySettings` ([#359]):
  legacy admin-panel config types whose runtime semantics are subsumed by
  `FLAG_REGISTRY`. `sessionTimeout` retained under a focused
  `SessionTimingConfig` type. The legacy `serverSettings` branch in
  `AdminPanelConfig.updateAdminConfig()` is gone.
- Inline HTML fallback rendering in `admin.html` (lines ~1165–1224 pre-PR)
  ([#359]): replaced with a hard error when the external dashboard script
  fails to load, so silent stale UIs are no longer possible.

[#359]: https://github.com/jagilber-dev/index-server/issues/359

## [1.28.21] - 2026-05-12

### Features

- **`graph_export` enriched node `contentType`**: enriched schema v2 instruction
  nodes now include the `contentType` field from instruction metadata. This lets
  graph consumers distinguish instruction metadata types without a follow-up
  fetch. Non-enriched schema v1 nodes still omit `contentType` by design.
- **`index_search` phrase and structural query inputs**: `index_search` and
  `index_dispatch action="search"` now support `searchString` for ergonomic
  phrase input and `fields` for structural predicates on canonical instruction
  fields plus virtual operators. Supported predicates include scalar exact
  values, OneOrMany enum/scalar values, array membership, `idPrefix`, safe
  `idRegex`, numeric ranges, date ranges, and structural-only queries.

### Changed

- **Quieter startup logs**: `[index:skip]` schema/classification rejections now
  emit at WARN instead of ERROR (they are operational file-skip signals already
  surfaced via the dashboard Monitoring tab + `indexEvents`, not server errors).
  The `usageCount defaulted to 0` invariant-repair WARN is silenced — `0` is the
  correct authoritative value for freshly seeded entries with no usage history;
  the repair counter and trace log still record the event for health visibility.

## [1.28.19] - 2026-05-11

### Added

- ci: windows-smoke timeout bump

## [1.28.18] - 2026-05-11

### Added

- fix(test): npmPackReadiness allowlist for setup-wizard-paths.mjs

## [1.28.17] - 2026-05-10

### Added

- fix(ci): skip integrity-pre-push hook in CI to avoid 'files modified by hook' false-positive

## [1.28.16] - 2026-05-10

### Added

- fix(ci): correct precommit.yml YAML indentation breaking workflow file

## [1.28.15] - 2026-05-10

### Added

- fix: ship setup-wizard-paths.mjs in npm pack; fix governance-hash workflow checkout collision; remove unused buildZIndexEntry/RECORD_SCHEMA

## [1.28.14] - 2026-05-10

### Fixed

- **SQLite restore leak: orphaned JSON files after backup restore**: `AdminPanel.restoreBackup`
  now deletes per-instruction `.json` files from `instructionsDir` after a zero-error
  SQLite ingest, preventing stale file accumulation and `ensureLoaded()` auto-migration
  latch retriggering. Loader-generated metadata (`_manifest.json`, `_skipped.json`) is
  preserved. JSON backend behavior is unchanged.
- **SQLite embedding leak: `embeddings.json` written in sqlite mode**: `sqliteVecEnabled`
  now auto-derives `true` when `INDEX_SERVER_STORAGE_BACKEND=sqlite` and the flag is
  unset. Explicit `INDEX_SERVER_SQLITE_VEC_ENABLED=0` opts out. `ApiRoutes` wires
  `SqliteEmbeddingStore` for sqlite backends with `logWarn` fallback to JSON if the
  native extension fails to load.
- **Embedding compute split-brain**: the dashboard compute endpoint now threads the
  derived `SqliteEmbeddingStore` through to `getInstructionEmbeddings`, so reads and
  writes use the same store in sqlite mode.
- **Embeddings tab false error banner**: the "not configured" banner is now hidden when
  the embedding state is `ready`, preventing a misleading error when the LLM is working.

### Added

- **`feedback_manage` MCP dispatcher**: adds a single feedback management tool
  with `submit`, `list`, `get`, `update`, `delete`, and `stats` actions while
  keeping `feedback_submit` as the standalone submit alias. Legacy standalone
  feedback management tool names remain removed.
- **PPID watchdog opt-out** (`INDEX_SERVER_DISABLE_PPID_WATCHDOG`): disables the
  parent-process watchdog for dev sandbox launchers that spawn through a transient shell.
- **Dashboard path reveal**: clickable paths in the build metadata panel open the
  instructions, SQLite, or backups directory in the OS file manager (allowlist-gated).
- **`/api/status/sqlite-reset`**: exposes sqlite backend flag, vec store status, and
  embedding file presence for dashboard diagnostics.

### Changed

- **`dev-server.ps1`**: removed 4 env vars that duplicated compile-time defaults
  (`SQLITE_WAL`, `SQLITE_MIGRATE_ON_START`, `DASHBOARD_HOST`, `SEMANTIC_DEVICE`);
  added `INDEX_SERVER_DISABLE_PPID_WATCHDOG=1` for transient-shell spawning.

### Added

- **Canonical seed `002-content-model`**: a third bootstrap-tier seed derived
  at module-load time from `schemas/instruction.schema.json`. Surfaces the
  required-field set, the `contentType` decision matrix
  (`agent|skill|instruction|prompt|workflow|knowledge|template|integration`), and a pointer to
  the live `index_schema` MCP tool — so search-first agents that hit the index
  before reading the schema get the same conceptual model the schema enforces.
  Generated by a pure function (`buildContentModelSeed`) with `instruction.schema.json`
  as the single source of truth; a drift trip-wire spec
  (`src/tests/contentModelSeed.spec.ts`) asserts every required field and every
  `contentType` enum member appears in the rendered body.
- **Canonical seed `003-content-types`**: a schema-derived bootstrap seed that
  lists the canonical eight-value `contentType` taxonomy.

### Changed

- **Instruction content taxonomy**: bumped instruction schema version to v6 and
  adopted the canonical `agent|skill|instruction|prompt|workflow|knowledge|template|integration`
  enum across schema, registry, validation, search, bootstrap seeds, generated
  schemas, and docs. Removed write/load normalization for removed values; invalid
  submitted or persisted values now follow existing validation rejection paths.

## [1.28.13] - 2026-05-08

### Fixed

- **Release workflow: transient git-clone failures in `Publish-ToMirror.ps1`**: the public-mirror clone step now retries (3 attempts, exponential backoff: 5s, 10s) on transient Windows networking errors (`getaddrinfo() thread failed to start`, `Could not resolve host`, connection resets, RPC failures, 5xx responses, etc.) before giving up. The PR-branch push retries the same way. Previously a single transient DNS hiccup would abort `Invoke-ReleaseWorkflow.ps1 -CreatePR` mid-flight and force manual recovery.

## [1.28.12] - 2026-05-07

### Fixed

- **Dashboard `/api/scripts/:name` 404**: client wrapper scripts (`index-server-client.ps1`, `index-server-client.sh`) are now packaged in the npm tarball and the route resolves them from the installed package directory instead of `process.cwd()`. Previously every install returned `Script file not found on disk`.

### Added

- **Embeddings panel — Clear Cache button + smarter Compute**: new `POST /api/embeddings/reset` endpoint clears the cached embeddings (works for both JSON and SQLite stores). The Compute button now pre-checks status and: warns when the model will download (~25MB), short-circuits when embeddings are already up to date with a confirm prompt, and surfaces an honest `cacheHit` / `computed` / `reused` summary instead of always reporting "Computed N embeddings". The old `Reset` button was renamed to `Reset View` to clarify that it only resets pan/zoom.

## [1.28.2] - 2026-05-06

### Added

- Clean install setup coverage and release workflow safety fixes.

## [1.28.1] - 2026-05-05

### Fixed

- **Setup wizard package entrypoint**: fixed `npx -y @jagilber-org/index-server@latest --setup` by pointing the packed CLI launcher at `scripts/build/setup-wizard.mjs`.
- **Release validation**: ensured PR and release unit-test paths emit `test-results/junit.xml`, restored public governance utilities in publish branches, and made duplicate MCP Registry publishes idempotent.
- **Public CI gates**: stabilized merge-only log hygiene and GGShield quota handling so public `main` remains green after release PR merges.

### Added

- **Release workflow**: added `scripts/Invoke-ReleaseWorkflow.ps1` as the canonical release/publish front door. It loads `.env`, resolves tag/remote/clean-room defaults, runs release preflight checks, optionally pushes and verifies the internal branch/tags, waits for internal GitHub Actions checks, prepares the clean-room mirror copy, and either prints or explicitly invokes the human-only public mirror delivery path.

### Changed

- **Publish scripts**: restored root-level entrypoints for `New-CleanRoomCopy.ps1`, `Publish-ToMirror.ps1`, and `publish-direct-to-remote.cjs` after the scripts reorganization so documented/template paths continue to work without introducing alternate release workflow names.
- **Public publish/security gates**: clean-room publish now keeps ambient exact env-value leak detection active, GitHub Action scanner uploads fail visibly instead of being hidden, ggshield quota exhaustion fails closed, and internal release branch/tag verification compares exact local/remote SHAs.
- **Tool classification docs**: clarified that registry `stable` vs `mutation` is a visibility/gating contract, so `feedback_submit` remains stable/core while still persisting feedback and audit entries.
- **Instruction content type migration**: bumped instruction schema version to v5 and mapped the former conversation-oriented content type to `workflow`, preserving workflow/runbook semantics instead of falling back to `instruction`.

### Fixed

- **Public release handoff**: `Publish-ToMirror.ps1 -CreatePR -WaitForMerge` now resumes from an already-merged publish PR when a previous wait timed out, treats an existing tag at the expected merge commit as success, and prints Release workflow watch commands instead of instructing operators to run a competing `gh release create`.

## [1.28.0] - 2026-05-04

### Added

- **Integrity probes**: pre-push hook runs 12-probe mutation integrity test and 4-client concurrent SQLite write test before every push (`scripts/hooks/pre-push-integrity.ps1`). Skip with `SKIP_INTEGRITY_PREPUSH=1`.
- **Adhoc diagnostics**: disk-state monitor (`scripts/diagnostics/adhoc-disk-state-monitor.mjs`), mutation integrity probe (`scripts/diagnostics/adhoc-mutation-integrity.mjs`), and concurrent write test (`scripts/perf/adhoc-concurrent-integrity.mjs`) for ad-hoc and CI use.
- **SQLite validation endpoint**: `/sqlite/validate` dashboard route and client script (`scripts/diagnostics/sqlite-validate.ps1`) for on-demand WAL integrity checks.
- **Enum validation in migration**: `migrateInstructionRecord()` now validates all 6 enum fields (audience, requirement, contentType, status, priorityTier, classification) with legacy coercion maps aligned with the loader, falling back to safe defaults for truly unknown values.
- **Negative enum tests**: 19 unit tests covering input-surface rejection and migration correction of invalid enum values.

### Fixed

- **Lax mode defaults** (`instructions.add`): `contentType` now defaults to `"instruction"` in lax mode so agents omitting it no longer fail silently (#312).
- **Enum coercion ordering**: legacy enum values (e.g., `audience:"developers"`, `requirement:"SHOULD"`) are now coerced before validation instead of being rejected at the input surface (#312).
- **Scripts reorg paths**: fixed `$PSScriptRoot` references across 10+ PowerShell scripts after `scripts/` subdirectory reorganization (#311). Fixed Dockerfile, `.dockerignore`, `sync-constitution.ps1`, and `setup-wizard-config-validate.mjs` paths.
- **PII scanner self-detection**: added pre-commit hook files to `PII_FILE_ALLOWLIST` so SAS-token regex definitions aren't flagged as leaks.
- **Constitution sync**: regenerated `constitution.md` and `.specify/memory/constitution.md` from `constitution.json`.

### Changed

- **Scripts reorganization**: all scripts moved from `scripts/` root into purpose-based subdirectories (`build/`, `client/`, `deploy/`, `diagnostics/`, `governance/`, `hooks/`, `migration/`, `perf/`, `testing/`, `ci/`) (#311).
- **Security hardening**: input validation hardening for `index_add` (#307), security triage blockers (#309), CodeQL and Trivy dependency bumps (#298, #299).

## [1.27.2] - 2026-05-01

### Fixed

- **Release workflow** (`.github/workflows/release.yml`): trim `description` in `package.json` and `server.json` from 146 to 98 chars to satisfy the MCP Registry validator (`expected length <= 100` on `body.description`). The MCP Registry publish step had been failing on every release since v1.26.3 with HTTP 422.
- **Release workflow** (`scripts/Invoke-ReleaseWorkflow.ps1`): add a fail-fast parity guard that aborts before tagging when `package.json.version` does not match the `-Tag` argument (sans `v` prefix). The v1.27.1 release shipped a tag whose `package.json` still said `1.27.0`, which caused the `Check npmjs version status` step to skip publish (it found `1.27.0` already on npmjs and set `already_published=true`). This guard prevents the same class of mismatch from reaching the public mirror again.

### Added

- **Release workflow** (`.github/workflows/release.yml`): publish to the GitHub Packages npm registry (`https://npm.pkg.github.com`) in addition to npmjs, so `https://github.com/jagilber-org/index-server/pkgs/npm/index-server` populates on each release. Auth uses the workflow-scoped `GITHUB_TOKEN` (no extra secret needed).

### Notes

- v1.27.1 was tagged on the public mirror but is **incomplete**: the npmjs publish step was skipped (stale version in tag), the GitHub Packages registry was never wired (now fixed), and the MCP Registry rejected the description (now fixed). v1.27.2 is the corrected release. v1.27.1 will not be retroactively republished.

## [1.27.1] - 2026-05-01

### Changed

- **Security**: pin `mermaid` and `@mermaid-js/layout-elk` transitive `uuid` to `^14.0.0` via npm overrides to clear GHSA-w5hq-g745-h8pq. Server-side bundle has no mermaid imports; dashboard remains lazy-loaded.
- **Build**: pin `@types/express-serve-static-core` to `5.0.7` to keep dashboard route handler signatures stable after lockfile regen pulled `5.1.1` (which changed `req.params` typing).

### Fixed

- **Deploy** (`scripts/deploy-local.ps1`): runtime `package.json` written to the deploy target now preserves the `overrides` block from the source manifest. Without it, `npm ci --omit=dev` failed with `EUSAGE Missing: uuid@11.1.1 from lock file` because the override-resolved lockfile didn't match the unstripped manifest.
- **CodeQL pre-push gate** (`scripts/run-codeql-pre-push.ps1`): now sources `scripts/Load-RepoEnv.ps1` and honors absolute paths from `.env` (`CODEQL_DB_PATH`, `CODEQL_LOG_DIR`, `CODEQL_OUTPUT_PATH`, `CODEQL_LANGUAGE`, `CODEQL_THREADS`, `CODEQL_RAM`). Reuses pre-built databases instead of always rebuilding in-repo.
- **Publish workflow** (`scripts/Publish-ToMirror.ps1`): after opening a publish PR via `-CreatePR`, now prints a copy-pasteable next-steps block (`gh api …/git/refs` + `gh release create --generate-notes`) so the operator can tag the merge commit and kick off the GitHub release in one shot. The `-WaitForMerge` success path also surfaces the `gh release create` command.

## [1.27.0] - 2026-04-30

### Changed (BREAKING)

- **Rate limiting is now opt-in** and consolidated behind a single environment variable, `INDEX_SERVER_RATE_LIMIT` (#270).
  - `INDEX_SERVER_RATE_LIMIT=0` (default, or unset) — rate limiting is **disabled**.
  - `INDEX_SERVER_RATE_LIMIT=N` (positive integer) — enforces **N requests per minute** with a fixed 60-second window.
  - Bulk import/export/backup/restore routes (`/api/admin/maintenance/normalize`, `/api/admin/maintenance/backup`, `/api/admin/maintenance/backups`, `/api/admin/maintenance/restore`, `/api/charts/export`, `/api/sqlite/backup`, `/api/sqlite/restore`, `/api/sqlite/export`) are **unconditionally exempt**, so dashboard bulk operations no longer trigger 429 responses.
  - The 429 response body shape simplifies to `{ error, message, retryAfterSeconds, timestamp }`. The previous `tier` field (global vs. mutation) has been removed; there is now a single tier.

### Removed (BREAKING)

The following environment variables have been **removed with no back-compat aliases**. Replace them with `INDEX_SERVER_RATE_LIMIT`:

| Removed variable | Replacement |
|------------------|-------------|
| `INDEX_SERVER_DISABLE_RATE_LIMIT` | unset / `INDEX_SERVER_RATE_LIMIT=0` (default) |
| `INDEX_SERVER_DISABLE_USAGE_RATE_LIMIT` | unset / `INDEX_SERVER_RATE_LIMIT=0` (default) |
| `INDEX_SERVER_RATE_LIMIT_MAX` | `INDEX_SERVER_RATE_LIMIT=<N>` |
| `INDEX_SERVER_RATE_LIMIT_WINDOW_MS` | _removed; window is fixed at 60 seconds_ |
| `INDEX_SERVER_RATE_LIMIT_MUTATION_MAX` | _removed; single tier only_ |

Also removed: `DashboardHttpConfig.rateLimitEnabled / rateLimitWindowMs / rateLimitMax / rateLimitMutationMax` (replaced by `rateLimitPerMinute: number`); `ApiRoutesOptions.rateLimit` (replaced by `rateLimitPerMinute?: number`); `AdminConfig.serverSettings.rateLimit` reduced to `{ perMinute: number }`.



### Fixed

- **Release**: `server.json` now ends with exactly one trailing LF. The v1.26.10 release was published with two trailing LFs (artefact of an earlier `Set-Content -NoNewline` pipeline), which caused the mirror PR to fail CI on the `end-of-file-fixer` framework hook.
- **Pre-commit (prevention)**: `scripts/pre-commit.mjs` now invokes the `pre-commit` framework on staged files for an explicit fast-hook allowlist (`end-of-file-fixer`, `trailing-whitespace`, `check-json`, `check-yaml`, `check-merge-conflict`, `detect-private-key`). Previously these framework hooks only ran in CI, so auto-fixable formatting issues silently passed local commits and broke PR builds. Slow security hooks (`gitleaks`, `semgrep`, `ggshield`, `detect-secrets`) deliberately remain in their own CI workflows / pre-push stage. Honours `SKIP_PRE_COMMIT_FRAMEWORK=1` and skips gracefully when `pre-commit` is not on PATH (#266).

## [1.26.10] - 2026-04-30

### Fixed

- **CI**: `.github/workflows/precommit.yml` checkout now uses `fetch-depth: 0` so `pre-commit run --from-ref BASE --to-ref HEAD` (diff-only mode introduced in v1.26.9) can resolve the PR base SHA. Previous default `fetch-depth: 1` caused `git diff BASE..HEAD` to exit 3 with `CalledProcessError` on every PR (#264).
- **Tests**: `skippedTestsAudit.spec.ts` env-check allowlist now recognizes platform identifiers (`isWindows`, `isLinux`, `isMac`, `isDarwin`, `process.platform`) so the new `ggshieldWithRetry.spec.ts` Windows-skip from v1.26.9 passes the audit (#264).

## [1.26.6] - 2026-04-28

### Fixed

- **Setup Wizard**: Resolve server entry point for `npx` installs so the wizard can locate and launch the server correctly.

## [1.26.1] - 2026-04-27

### Fixed

- **CI**: Pinned `gitleaks` to v8.30.1 with SHA256 verification across all 3 jobs (PR, manual, scheduled). The previous `releases/latest` API lookup was racy and broke the workflow when GitHub returned an empty/malformed payload.
- **Tests**: `certInit.spec.ts` now accepts both `CN=localhost` and `CN = localhost` formats from `openssl x509 -text` (modern openssl emits the spaced form).
- **Tests**: `bugfixBatch1.spec.ts #135` no longer asserts that `instructions.groom.ts` directly references `isJunkCategory`; it is correctly used transitively via `normalizeCategories`.

## [1.26.0] - 2026-04-26

### Added

- **`--init-cert` CLI switch on `index-server`** to bootstrap a self-signed
  TLS certificate + key for the admin dashboard via OpenSSL. Exits after
  generation by default; pair with `--start` to continue normal startup using
  the generated material (auto-wires `--dashboard-tls`). Supports `--cert-dir`,
  `--cert-file`, `--key-file`, `--cn`, `--san`, `--days`, `--key-bits`,
  `--force`, and `--print-env[=posix|powershell|both|auto]`. Path-traversal
  guarded (SH-4); private key permissions set to `0600` on POSIX. See
  `docs/cert_init.md`.

### Changed

- `health_check` now reports audit-log health counters while exposing only sanitized audit persistence error messages.

### Removed (breaking — MCP feedback surface)

- **MCP feedback tools collapsed to `feedback_submit` only (#111)**. The following MCP tools have been removed with no deprecation alias and no compatibility shim: `feedback_list`, `feedback_get`, `feedback_update`, `feedback_delete`, `feedback_stats`, `feedback_health`, `feedback_dispatch`. Agents must use the stable, core-visible `feedback_submit` tool to file entries. Human-operator CRUD now lives behind dashboard authentication at `GET/POST /admin/feedback`, `GET/PATCH/DELETE /admin/feedback/:id`, sharing the same `feedback/feedback-entries.json` store as the MCP submit path. GitHub issue handoff from the dashboard is browser-side, human-triggered, token-free, and targets `jagilber-org/index-server`. Spec: `specs/111-feedback-mcp-rip-down.md`.

## [1.24.0] - 2026-04-24

### Added

- `IEmbeddingStore` interface with pluggable embedding storage backends.
- `SqliteEmbeddingStore` — sqlite-vec backed embedding storage with native KNN search via `vec0` virtual table.
- `JsonEmbeddingStore` — file-based embedding storage adapter with brute-force cosine similarity search.
- `INDEX_SERVER_SQLITE_VEC_ENABLED` env var — opt-in toggle for sqlite-vec embedding storage (default: off).
- `INDEX_SERVER_SQLITE_VEC_PATH` env var — custom sqlite-vec native binary path override.
- `createEmbeddingStore()` factory function with automatic JSON fallback when sqlite-vec is unavailable.
- `resolveDevice()` — ONNX Runtime backend probe with injectable fallback chain (cuda → dml → cpu).
- `checkModelReadiness()` — startup check that warns when embedding model is missing with LOCAL_ONLY enabled.
- `checkNodeVersion()` — runtime version gate with clear error messages for feature-specific Node.js requirements.
- Embedding migration support: `migrateJsonEmbeddingsToStore()` for JSON → SQLite migration.
- 62 new embedding-related tests across 8 test files (contract, unit, integration, scenario).
- Documentation for all new env vars in configuration.md, mcp_configuration.md, vscode_mcp.md, deployment.md, docker_deployment.md, docker-compose.yml, runtime_config_mapping.md.
- Architecture docs updated with embedding store abstraction diagram and IEmbeddingStore interface reference.

### Fixed

- Fixed dual-write stderr that caused duplicate log entries in VS Code Output panel.
- Fixed `.Count` on `$null` in `New-CleanRoomCopy.ps1` by wrapping collections in `@()`.
- Fixed tag-wiping in `Publish-ToMirror.ps1` and `publish-direct-to-remote.cjs` — publish scripts no longer delete existing remote tags (template-repo#47).

### Changed

- Replaced 137 `console.*` calls with structured logger (`logError`/`logWarn`/`logInfo`/`logDebug`) across 27 server-side TypeScript files.
- Fixed severity misassignment in `promptReviewService.ts` — `logError` → `logWarn`/`logInfo` for non-error messages.
- Added embedding stress tests and `/api/embeddings/compute` route tests.
- Fixed `logInfo('')` empty-string calls in `performanceBaseline.ts` — replaced with `logInfo('---')` separators.
- Fixed `factory.ts` formatting defect (multi-statement single line in sqlite case block).
- Docker deployment docs now note Alpine/musl limitation for sqlite-vec native binary.

## [1.23.1] - 2026-04-23

### Changed

- Added MCP Registry metadata and aligned the package manifest for MCP-native distribution surfaces.
- Reworked install and configuration guidance so the MCP-native `npx --setup` flow is primary.
- Updated release automation for the migration handoff and tightened the private-repo release path so `jagilber-dev` releases do not attempt public npm or MCP Registry publication.
- Added minimal read-only MCP prompts and resources for setup, configuration, and verification guidance.

### Removed

- Removed the legacy VS Code extension source tree, VSIX workflow, packaged VSIX artifacts, and extension-only release docs.

### Migration Notes

- Existing deployments that previously relied on the unset mutation flag as an implicit read-only default must audit their runtime configuration before upgrading. If a deployment should remain read-only after upgrade, set `INDEX_SERVER_MUTATION=0` explicitly.

## [1.21.0] - 2026-04-17

### Added

- Dashboard authentication via `INDEX_SERVER_ADMIN_API_KEY` with Bearer token, login modal, and sessionStorage-based session management.
- CRUD stress test scripts (`scripts/stress-test.ps1`) for load testing instruction operations.
- `dashboardAdminAuth` middleware now protects dashboard mutation routes (POST/PUT/DELETE instructions).
- Integration tests for dashboard auth middleware (`dashboardAuth.spec.ts` — 33 tests).
- Playwright E2E tests for dashboard auth flow (`dashboard-auth.spec.ts` — 10 tests).
- `npm audit` step in build pipeline and `prepack` script.
- `ensureLoadedMiddleware` to reduce redundant `ensureLoaded()` calls in dashboard routes.
- Comprehensive stress testing documentation (`docs/stress-testing.md`).
- Integration templates for global and per-repo copilot instructions.
- Semantic search section in README with minimal configuration example.

### Changed

- Rate limiting is now enabled by default. Use `INDEX_SERVER_DISABLE_RATE_LIMIT=1` to opt out.
- All instruction handlers now use `IInstructionStore` interface instead of direct disk I/O, enabling pluggable storage backends.
- Auto-migration from JSON to SQLite on startup when `INDEX_SERVER_STORAGE_BACKEND=sqlite`.
- Dashboard CRUD routes now properly invalidate cache after mutations, matching MCP handler patterns.
- README replaced with streamlined v2 (216 lines vs 449 original) focused on install → quickstart → copilot integration.
- Bootstrapper instruction (000-bootstrapper) rewritten to v3 with search-first workflow and copilot instructions setup.
- Stress test parallel mode refactored from `Start-Job` to `ForEach-Object -Parallel` (PS 7+).
- `.github/copilot-instructions.md` updated with search-before-add gate and fixed stale tool names.

### Security

- `dashboardAdminAuth` middleware added to alerts and embeddings POST routes.
- Defense-in-depth path-traversal guard added to `safeName` in dashboard routes.
- All 21 dashboard mutation endpoints now require authentication.

### Deprecated

- `INDEX_SERVER_DISABLE_USAGE_RATE_LIMIT` — replaced by `INDEX_SERVER_DISABLE_RATE_LIMIT` which covers all rate limiting.

### Removed

- Dead imports and unused variables cleaned up after `IInstructionStore` migration.

### Fixed

- `Retry-After` header in dashboard SQLite tab now parsed safely with `parseInt` to avoid `NaN` from date-string values.
- Rate limiting no longer causes intermittent test failures in groom signal feedback tests.

## [1.20.1] - 2026-04-16

### Changed

- Documented the canonical private/public release workflow around `origin`, `public`, and `scripts/publish-direct-to-remote.cjs`.
- Updated release guard and lifecycle references to use the current cross-platform version bump and public publish scripts.

### Removed

- Removed the obsolete legacy dual-repo PowerShell publish script.

## [1.20.0] - 2026-04-15

### Added

- Exported `renderPanelMarkdownHtml` for safe reuse when rendering dashboard panel documentation.
- `INDEX_SERVER_ALLOW_INSECURE_TLS` to opt into local-only TLS bypass when validating security headers.

### Changed

- Manual security scanning now runs `npm audit` cross-platform and excludes generated runtime/internal artifact surfaces plus generated instruction manifests from the source review surface.
- Publish, certificate, and CI helper scripts now use argument-based process execution instead of shell-string command invocation.

### Fixed

- Dashboard panel docs now preserve safe `data:image` sources without double-escaping image alt text.
- Gitleaks allowlist handling now accepts the repo configuration format and generated certificate paths used by this project.
- Manual security scan phone detection again matches contiguous US phone numbers while retaining the narrower false-positive suppressions added for generated artifacts.

## [1.19.0] - 2026-04-10

### Changed

- **Environment variable consolidation** — All direct `process.env` reads in runtime source files have been migrated to the centralized `getRuntimeConfig()` config layer. 12 files consolidated: `handlers.feedback.ts`, `autoBackup.ts`, `instructions.dispatcher.ts`, `sqlite.routes.ts`, `admin.routes.ts`, `seedBootstrap.ts`, `sdkServer.ts`, `BufferRing.ts`, `SessionPersistenceManager.ts`, `manifestManager.ts`, `registry.ts`, `transportFactory.ts`.
- **Standardized env var prefixes** — Unprefixed environment variables have been replaced with `INDEX_SERVER_*` equivalents. Old unprefixed names are no longer supported.

### Environment Variables

- `INDEX_SERVER_BUFFER_RING_APPEND` — replaces `BUFFER_RING_APPEND` (default: `1`)
- `INDEX_SERVER_BUFFER_RING_PRELOAD` — replaces `BUFFER_RING_APPEND_PRELOAD` (default: `0`)
- `INDEX_SERVER_GRAPH_INCLUDE_PRIMARY_EDGES` — replaces `GRAPH_INCLUDE_PRIMARY_EDGES` (default: `1`)
- `INDEX_SERVER_GRAPH_LARGE_CATEGORY_CAP` — replaces `GRAPH_LARGE_CATEGORY_CAP` (default: `150`)
- `INDEX_SERVER_AUDIT_LOG` — replaces `INSTRUCTIONS_AUDIT_LOG` (default: enabled, `logs/audit/`)
- `INDEX_SERVER_COVERAGE_FAST` — replaces `FAST_COVERAGE` (default: `0`)
- `INDEX_SERVER_COVERAGE_HARD_MIN` — replaces `COVERAGE_HARD_MIN`
- `INDEX_SERVER_COVERAGE_TARGET` — replaces `COVERAGE_TARGET`
- `INDEX_SERVER_COVERAGE_STRICT` — replaces `COVERAGE_STRICT` (default: `0`)

### Fixed

- Pre-commit hooks and publish scripts hardened against env-var leaks (SHA-256 token validation)
- `.gitignore` negation pattern (`!instructions/*.json`) removed to prevent instruction file leakage

## [1.18.5] - 2026-04-15 (retroactively documented)

### Added

- Shared dashboard API rate limiting middleware with per-IP sliding window and `429 Retry-After` responses.
- Template conformance review backlog documentation.
- Windows-compatible Docker test harness.

### Changed

- Adopted template v1.16 governance and workflow surfaces.
- Aligned Semgrep pre-push wrapper with template policy.
- Bumped VS Code extension package to 1.20.0.

### Fixed

- Hardened dashboard client DOM insertion paths against XSS.
- Avoided shell interpolation in the public push guard script.
- Restored publish-time PII scanning.
- Tightened CSP headers and defaulted Docker publish to localhost.
- Public-release cleanup and synthetic admin hardening.

## [1.18.4] - 2026-04-15 (retroactively documented)

### Fixed

- Accepted stringified JSON arrays in `index_import` (previously only parsed arrays were handled).
- Reconciled tree-scan findings from security audit.
- Narrowed manual security scan false positives for generated artifacts.
- Addressed PR review feedback on scan remediation changes.

## [1.18.3] - 2026-04-14 (retroactively documented)

### Changed

- Aligned codebase to template-repo v1.15.0 structure and conventions.
- Adopted template v1.16.0 governance surfaces and addressed scan findings.

### Fixed

- Addressed P1 scan findings — path-injection and regex-injection hardening.

## [1.18.2] - 2026-04-14 (retroactively documented)

### Fixed

- **Path traversal** in instruction routes — validated and sanitized file path parameters.
- **XSS** in admin dashboard — escaped user-supplied content in DOM insertion paths.
- Added scan reconciliation report documenting resolved findings.

## [1.18.1] - 2026-04-14 (retroactively documented)

### Added

- Dual MCP config format support and OpenSSL path detection.
- Replaced default project icon with stacked index cards design.

### Fixed

- Isolated dev server ports from production defaults to prevent port conflicts.
- Handled legacy `catalogHash` key in embedding cache loader for backward compatibility.

## [1.18.0] - 2026-04-06

### Added

- **SQLite storage backend** (⚠️ EXPERIMENTAL — limited testing performed): `INDEX_SERVER_STORAGE_BACKEND=sqlite` enables SQLite-backed instruction storage using Node.js built-in `node:sqlite` (zero third-party dependencies). Not recommended for production use.
  - `IInstructionStore` interface — storage abstraction layer for backend-agnostic instruction persistence
  - `JsonFileStore` — existing JSON-file-per-instruction behavior wrapped in the interface
  - `SqliteStore` — full SQLite implementation with WAL mode, indexes, and FTS5 full-text search
  - `SqliteMessageStore` — message persistence in SQLite with channel/sender/thread queries
  - `SqliteUsageStore` — usage tracking in SQLite with atomic increment
  - Migration engine — bidirectional JSON ↔ SQLite migration (lossless round-trip)
  - FTS5 search with BM25 ranking (title 10x, body 5x weight)
  - SQLite backup support in autoBackup (copies .db + WAL/SHM files)
  - Factory pattern with feature flag: `createStore()` selects backend from config
  - 115+ storage-specific tests (contract, migration, FTS5, messaging, usage)
  - Governance hash identical across both backends
- **NDJSON structured logging**: All server log output now uses strict NDJSON (newline-delimited JSON) format. Each log line is a JSON object with `ts`, `level`, `msg`, and optional `detail`, `tool`, `ms`, `pid`, `port`, `correlationId` fields. V8 `Error.captureStackTrace` auto-populates stack traces on WARN/ERROR. Module-prefixed messages (`[module]`) support source-file heatmap matching.
- **Markdown preview in instruction editor**: Dashboard instruction editor includes a 📖 Preview button that renders the instruction `body` as GitHub Flavored Markdown (via `marked`). Preview auto-updates as you type.
- **Zip-based backups**: All backup operations (auto-backup, bulk-delete, admin panel) now produce `.zip` archives via `adm-zip`. SQLite backend backups include WAL/SHM files for full state preservation. Retention pruning removes oldest snapshots beyond `INDEX_SERVER_AUTO_BACKUP_MAX_COUNT`.
- **Offset/limit pagination** for `index_dispatch` list action.

### Changed

- **Pre-push slow test gate removed** — slow tests now run exclusively in CI workflows.
- Security headers added to dashboard script routes.
- Large modules split into focused single-responsibility files (CQ-1 compliance).
- 66 ESLint unused-variable warnings resolved.

### Environment Variables (⚠️ SQLite options are experimental)

- `INDEX_SERVER_STORAGE_BACKEND` — `json` (default) or `sqlite` (experimental — not recommended for production)
- `INDEX_SERVER_SQLITE_PATH` — SQLite database path (default: `data/index.db`)
- `INDEX_SERVER_SQLITE_WAL` — Enable WAL mode (default: `true`)
- `INDEX_SERVER_SQLITE_MIGRATE_ON_START` — Auto-migrate JSON → SQLite on first start (default: `true`)

## [1.16.1] - 2026-04-01

### Fixed


### Added


## [1.16.0] - 2026-04-01

### Added

- **Signal feedback loop**: `index_groom` reads usage signals from `usage_track` and mutates instructions: `outdated` -> deprecated, `not-relevant` -> priority -10, `helpful` -> priority +5, `applied` -> priority +2.
- **Dashboard signal visibility**: Instructions panel shows USES/SIGNAL chips per instruction with sort options. Overview panel shows usage signal summary card. Maintenance panel has signal groom controls.
- **REST client scripts**: `scripts/index-server-client.ps1` (PowerShell) and `scripts/index-server-client.sh` (bash) for subagents without MCP tool access. Full CRUD via dashboard REST bridge.
- **Incremental embedding cache**: Semantic search recomputes only changed entries instead of full catalog on any modification.
- **Embedding concurrency lock**: Concurrent cache-miss searches share one in-flight computation instead of tripling work.
- **HSTS header**: `Strict-Transport-Security` added when TLS is enabled.
- **Usage snapshot API**: `GET /api/usage/snapshot` dashboard route for per-instruction signal data.
- **`usage_hotset` signals**: Items now include `lastSignal` and `lastComment` from usage snapshot.

### Changed

- **BREAKING: `index_groom` output schema**: `usagePruned` replaced by `signalApplied`. Added `migrated` and `remappedCategories` fields.
- **`loadUsageSnapshot` exported**: Now available for import from `catalogContext.ts`.
- **Usage snapshot path configurable**: `INDEX_SERVER_USAGE_SNAPSHOT_PATH` env var for test isolation.

## [1.15.2] - 2026-04-01

### Fixed

- **Codecov workflow**: Corrected CI workflow configuration for Codecov coverage uploads.
- **Dashboard inline scripts**: `safeExecInlineCode` now passes original arguments instead of Event object.

### Changed

- **README**: Replaced with trimmed, focused version.

## [1.14.0] - 2026-03-29

### Changed

- **BREAKING: Tool names renamed** from `instructions_*` to `index_*` across the entire codebase. Affected tools: `index_dispatch`, `index_search`, `index_add`, `index_import`, `index_remove`, `index_reload`, `index_repair`, `index_groom`, `index_enrich`, `index_normalize`, `index_governanceHash`, `index_governanceUpdate`, `index_schema`, `index_health`, `index_inspect`, `index_diagnostics`, `index_debugCatalog`.
- **BREAKING: Environment variables renamed** from `MCP_*` prefix to `INDEX_SERVER_*`. Key renames: `MCP_INSTRUCTIONS_DIR` -> `INDEX_SERVER_DIR`, `MCP_ENABLE_MUTATION` -> `INDEX_SERVER_MUTATION`, `MCP_LOG_VERBOSE` -> `INDEX_SERVER_VERBOSE_LOGGING`, `MCP_LOG_LEVEL` -> `INDEX_SERVER_LOG_LEVEL`, `MCP_DATA_DIR` -> `INDEX_SERVER_DATA_DIR`, `MCP_DASHBOARD_PORT` -> `INDEX_SERVER_DASHBOARD_PORT`, `MCP_DASHBOARD_TLS` -> `INDEX_SERVER_DASHBOARD_TLS`, `MCP_SECRET_KEY` -> `INDEX_SERVER_SECRET_KEY`, `MCP_AUTH_KEY` -> `INDEX_SERVER_AUTH_KEY`, plus 8 more.
- **Removed all legacy/fallback env var support**: No backward-compatible dual-read aliases. `warnOnce()` deprecation helper and `deprecationNotices` set removed from runtimeConfig.ts.
- **100% Zod coverage**: All 45+ tools have complete Zod schemas in `toolRegistry.zod.ts` with strict validation.
- **Instruction catalog content updated**: Renamed `mcp-index-server` -> `index-server` and all tool/env var references across 585+ production instruction files and 22 local instruction files via reusable `scripts/rename-server-in-instructions.ps1`.

### Added

- **Reusable rename script**: `scripts/rename-server-in-instructions.ps1` with mapping file support, WhatIf, backup/DR zip, JSON validation, manifest updates, and verification scan.
- **Mapping files**: `scripts/mappings/index-server-rename.json` (35 replacement pairs), `scripts/mappings/server-env-tools.json` (auto-generated env var + tool name inventory).

## [1.13.2] - 2026-03-29

### Changed

- **Renamed server entry point**: `dist/server/index.js` -> `dist/server/index-server.js` for clarity. Source file renamed from `src/server/index.ts` to `src/server/index-server.ts`. All scripts, CI workflows, configs, tests, and documentation updated (92+ files).
- **Deploy script**: `scripts/deploy-local.ps1` updated -- generated `start.ps1`, `start.cmd`, and runtime `package.json` all reference the new entry point name.
- **Shim scripts**: `ci-build.js`, `ci-build.mjs`, `pretest-build-or-skip.mjs/.ps1`, and `distReady.ts` updated to create/locate `index-server.js` instead of `index.js`.

## [1.12.0] - 2026-03-16

### Added

- **Embeddings visualization panel**: New dashboard tab displaying embedding vectors, cosine similarity heatmaps, and cluster analysis for instruction catalog entries.
- **Graph tab toggle** (`INDEX_SERVER_DASHBOARD_GRAPH`): Opt-in env var to enable the Graph visualization tab. When disabled (default), the server strips the graph nav button, section HTML, and `admin.graph.js` script tag from the dashboard -- avoiding ~4.5MB of mermaid + elkjs JS downloads.
- **PPID watchdog**: Belt-and-suspenders orphan detection that checks every 30s if the parent process is still alive via `process.kill(ppid, 0)`. Exits gracefully if parent is gone, covering Windows edge cases where stdin EOF is unreliable.
- **Bundled dashboard assets**: Chart.js 4.4.0, mermaid 11.11.0, and elkjs 0.9.3 are now served locally from `/js/` -- no external CDN calls in production.
- **System font stack**: Replaced Google Fonts (Inter) with `system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`.

### Changed

- **Semantic search defaults**: `INDEX_SERVER_SEMANTIC_LOCAL_ONLY` now defaults to `true` (blocks remote HuggingFace downloads). `INDEX_SERVER_SEMANTIC_ENABLED` defaults to `false`.
- **CSP tightened**: Content-Security-Policy is now `'self'` only -- removed cdn.jsdelivr.net, unpkg.com, fonts.googleapis.com, fonts.gstatic.com.
- **CDN versions pinned**: mermaid pinned to 11.11.0, ELK ESM to 0.2.0, elkjs to 0.9.3, diagram-viewer mermaid to 10.9.3.

### Fixed

- **Orphaned server processes**: Added stdin `end`/`close` handler that calls `shutdownGuard.initiateShutdown('stdin-closed')` + `process.exit()` when the parent (VS Code) disconnects. Prevents the Express dashboard HTTP server from keeping orphaned processes alive indefinitely.
- **Embeddings panel Load button**: Fixed boot.js CSP sanitizer blocking `window.fn && window.fn()` inline onclick patterns.
- **Mermaid graph CSP**: Relaxed then eliminated CSP CDN allowances by bundling all graph assets locally.
- **ELK ESM chunks**: `copy-dashboard-assets.mjs` now copies the `chunks/` subdirectory required by the ELK ESM entry point.

## [1.11.2] - 2026-03-12

### Security

- **CORS hardening**: Replaced permissive `Access-Control-Allow-Origin: *` with localhost-only origin validation in DashboardServer, ApiRoutes, and SSE log streaming.
- **Security headers**: Added CSP, X-Frame-Options (DENY), X-Content-Type-Options, X-XSS-Protection, and Referrer-Policy to all dashboard HTTP responses.
- **Admin authentication**: Added API key middleware (`INDEX_SERVER_ADMIN_API_KEY` env var) to all `/api/admin/*` routes with localhost-fallback for backward compatibility.
- **Code injection fix**: Replaced `new Function()` usage in APIIntegration.ts with safe dot-path transform methods and type coercion allowlist.
- **Inline handler fix**: Replaced `new Function()` in admin.boot.js with safe named-function dispatch via window object traversal.
- **TOCTOU fix**: Replaced `existsSync()` + `readFileSync()` pattern in index_inspect with direct read + ENOENT error code check.

### Fixed

- **Shutdown race condition**: Consolidated multiple competing `process.exit()` calls (SIGINT, SIGTERM, uncaughtException across index.ts, transport.ts, catalogContext.ts) into single `ShutdownGuard` with re-entrance protection.
- **Silent error swallowing**: Added structured error logging to critical catch blocks in autoBackup.ts (interval, initial run, pruning).

### Added

- **ShutdownGuard module** (`src/server/shutdownGuard.ts`): Singleton factory with named cleanup handler registry, re-entrance guard, and exit code mapping. 7 unit tests.
- **Coverage thresholds**: Added branch (70%), function (70%), line (75%), statement (75%) thresholds to vitest.config.ts.
- **Dependabot config**: Created `.github/dependabot.yml` for weekly npm and GitHub Actions dependency updates.
- **CodeQL weekly scans**: Enabled Monday 3am UTC scheduled scan in `.github/workflows/codeql.yml`.
- **CODEOWNERS expansion**: Added dashboard, server, workflows, and config paths to `.github/CODEOWNERS`.

## [1.11.1] - 2026-03-04

### Added

- **Usage test coverage**: Replaced 4 placeholder usage test files with 11 real functional tests covering feature gating (`hasFeature`/`INDEX_SERVER_FEATURES`), usage tracking (`incrementUsage`), `firstSeenTs`/`lastUsedAt` timestamps, and rate-limit clearing.
- **Dev MCP config**: Added `INDEX_SERVER_FLAG_TOOLS_EXTENDED=1` to workspace dev server config.

### Changed

- **Documentation**: Updated `INDEX_SERVER_FEATURES` env var description in `docs/tools.md` to list all valid feature flags (`usage,window,hotness,drift,risk`).

## [1.11.0] - 2026-03-03

### Added

- **Dashboard configuration panel redesign**: Category-grouped flags with collapsible sections, live search/filter, documentation links (📖 icons), 15-second auto-refresh, stability color coding, and full-height layout replacing the constrained 480px scroll area.
- **Constitution rule A-7**: Canonical seeds in `seedBootstrap.ts` must contain only generalized, public-safe content — no environment-specific or org-specific data.

### Changed

- **Auto-backup default**: `autoBackupEnabled` now defaults to `false` (was `true`). Set `INDEX_SERVER_AUTO_BACKUP=1` to re-enable.
- **Flag registry sorting**: `/api/admin/config` flags are now sorted by category → name for consistent ordering.
- **Flag metadata**: Each flag now includes a `docAnchor` slug and the response includes `lastRefreshed` timestamp.

## [1.10.0] - 2026-03-02

### Added

- **Auto usage tracking**: Get and search operations now automatically track usage for retrieved instructions via fire-and-forget `incrementUsage` calls. Controlled by `INDEX_SERVER_AUTO_USAGE_TRACK` env var (default: `true`). Search tracks top 10 results; get tracks each successful retrieval.
- **Embedding cache model awareness**: Embedding cache now stores `modelName` alongside `catalogHash`, automatically invalidating cached embeddings when the semantic model is changed (e.g., switching from `all-MiniLM-L6-v2` to `bge-base-en-v1.5`). Prevents dimension mismatch errors.
- **Zod schema for `index_search`**: Added `zInstructionsSearch` to `toolRegistry.zod.ts` with all parameters (`keywords`, `mode`, `limit`, `includeCategories`, `caseSensitive`, `contentType`) matching the JSON Schema definition.
- **Documentation**: Added docs index, MCP configuration guide, project PRD, prompt optimization guide, search benchmark results, credential centralization runbook.
- **Benchmark script**: `scripts/benchmark-search.ps1` — stress-tests keyword/regex/semantic search modes and generates markdown + Mermaid report.
- **Tools REST routes**: `src/dashboard/server/routes/tools.routes.ts` — REST bridge for MCP tool handlers.

### Fixed

- **Semantic test crash**: `autoTrackSearchResults()` and dispatcher auto-tracking now use optional chaining (`catalog?.autoUsageTrack`) to avoid `TypeError` when `catalog` config is undefined in test context.

### Changed

- **Upgraded recommended model**: Documentation and prod config updated for `Xenova/bge-base-en-v1.5` (768-dim, ~90MB) over default `Xenova/all-MiniLM-L6-v2` (384-dim), providing ~30% quality improvement for semantic search.

## [1.9.0] - 2026-03-01

### Added

- **Search modes**: `index_search` now supports `mode` parameter with three values:
  - `keyword` (default) — substring matching with auto-tokenization
  - `regex` — pattern matching (e.g., `"deploy|release"`, `"Type[Ss]cript"`) with ReDoS protection (200-char limit)
  - `semantic` — embedding-based cosine similarity search with lazy-loaded HuggingFace model, disk-cached embeddings, and graceful degradation to keyword mode on failure. Requires `INDEX_SERVER_SEMANTIC_ENABLED=1`.
- **Embedding service**: New `embeddingService.ts` with cosine similarity, disk cache, staleness detection, and lazy model loading (zero startup impact).
- **Semantic configuration**: New env vars `INDEX_SERVER_SEMANTIC_ENABLED`, `INDEX_SERVER_SEMANTIC_MODEL`, `INDEX_SERVER_SEMANTIC_CACHE_DIR`, `INDEX_SERVER_EMBEDDING_PATH`, `INDEX_SERVER_SEMANTIC_DEVICE`, `INDEX_SERVER_SEMANTIC_LOCAL_ONLY` via `SemanticConfig` in `runtimeConfig.ts`.
  - `INDEX_SERVER_SEMANTIC_DEVICE` — Run embeddings on GPU: `cuda` (NVIDIA) or `dml` (DirectML/Windows). Default: `cpu`.
  - `INDEX_SERVER_SEMANTIC_LOCAL_ONLY` — Block remote model downloads when set to `1`. Model must already be cached.
- **Search highlighting**: Match highlighting in both global search results and local instruction list filter using `<mark>` tags with gold background.
- **Backup file export/import**: "Backup to File" and "Restore from File" buttons in Maintenance tab with file dialog support.
- **Server export/import endpoints**: `GET /api/admin/maintenance/backup/:id/export` and `POST /api/admin/maintenance/backup/import` for backup bundle transfer.
- **Regex search toggle**: Checkbox to enable regex mode for instruction name filter and global search.

### Fixed

- **Global search URL mismatch**: Client was calling `/api/instructions/search` but server route is `/api/index_search` — global search always returned "Not found".
- **Cache-busting**: Now hashes all JS + CSS + HTML files (was CSS-only), ensuring JS changes are picked up by browsers.
- **Instance badge**: Shows green when count > 0 (was > 1).
- **Instance dropdown positioning**: Aligned left instead of centered.
- **Create instruction template**: Now populates with full v4 schema template instead of minimal stub.

## [1.8.4] - 2026-02-27

### Changed

- **Dashboard Grafana-dark theme**: Complete CSS redesign with enterprise dark theme, vertical edge alignment, and graph loading skeleton fix.
- **Dashboard documentation**: Added panel screenshots gallery to DASHBOARD.md and README.md covering all 7 tabs (Overview, Configuration, Sessions, Maintenance, Monitoring, Instructions, Graph).
- **Default route**: Root `/` now redirects to `/admin` dashboard; legacy v1 available at `/legacy`.

### Added

- **Screenshot capture script**: `scripts/capture-screenshots.mjs` using Playwright for repeatable dashboard screenshot generation.

## [1.8.3] - 2026-02-26

### Added

- **Automatic periodic backup**: New `autoBackup` service backs up the instruction catalog on a configurable interval (default 1 hour). Enabled by default (`INDEX_SERVER_AUTO_BACKUP=1`). Old snapshots are pruned to `INDEX_SERVER_AUTO_BACKUP_MAX_COUNT` (default 10). Startup is async and non-blocking via `setImmediate` with a 5-second first-run delay.

### Fixed

- **Version 0.0.0 in `createSdkServer`**: Server now resolves `package.json` from multiple candidate paths (`__dirname` fallbacks) instead of relying solely on `process.cwd()`, which VS Code sets to an unrelated directory.
- **7 tools instead of 50**: Extended and admin tool tiers now activate correctly when `INDEX_SERVER_FLAG_TOOLS_EXTENDED=1` and `INDEX_SERVER_FLAG_TOOLS_ADMIN=1` are set in the MCP client configuration.

## [1.8.2] - 2026-02-26

### Added

- **Bulk deletion safeguards**: `index_remove` now enforces a configurable threshold (`INDEX_SERVER_MAX_BULK_DELETE`, default 5). Requests exceeding the threshold are blocked unless `force: true` is passed.
- **Pre-mutation auto-backup**: When a forced bulk delete exceeds the threshold and `INDEX_SERVER_BACKUP_BEFORE_BULK_DELETE` is enabled (default), all instruction files are snapshotted to `backups/instructions-{timestamp}/` before deletion proceeds. Backup failure aborts the entire operation.
- **Dry-run mode**: `index_remove` accepts `dryRun: true` to preview which IDs would be deleted without modifying disk.
- **New env vars**: `INDEX_SERVER_MAX_BULK_DELETE` (number, default 5), `INDEX_SERVER_BACKUP_BEFORE_BULK_DELETE` (boolean, default true).
- **Tests**: `bulkDeleteGuard.spec.ts` — 6 unit tests covering threshold enforcement, force override, dry-run, and auto-backup behavior.

### Security

- Mitigates accidental or automated mass instruction deletion — the incident that wiped production catalog is no longer possible without explicit `force` acknowledgement and automatic backup.

## [1.8.1] - 2026-02-24

### Fixed

- **Dispatcher flat-param assembly**: `index_dispatch` action=add now accepts flat params (`id`, `body`, `title` as top-level) in addition to the nested `entry` wrapper. Agents no longer need to pre-wrap instruction fields. Resolves feedback #0d4d73a6.
- **Schema completeness**: Dispatch `INPUT_SCHEMA` now exposes all mutation-action params: `entry`, `overwrite`, `lax` (add), `entries`, `mode` (import/groom), `owner`, `status`, `bump`, `lastReviewedAt`, `nextReviewDue` (governanceUpdate), `missingOk` (remove).
- **Build fix**: TS18046 in `feedbackDispatch.red.spec.ts` resolved (release v1.8.0 build failure).

### Added

- **Constitution Q-7**: Schema-contract tests required for dispatcher action additions.
- **Constitution Q-8**: Agent-perspective tests required for mutation dispatch actions.
- **Test file**: `dispatcherAddFlatParams.spec.ts` — 11 contract + agent-perspective tests covering all dispatch mutation actions.

## [1.8.0] - 2026-02-24

### Changed

- **BREAKING: Tool surface reduced from 44 to 7 core tools**. Extended/admin tools available via `INDEX_SERVER_FLAG_TOOLS_EXTENDED` / `INDEX_SERVER_FLAG_TOOLS_ADMIN` feature flags.
- **ToolTier system**: `core` / `extended` / `admin` tiers with `getToolRegistry(filter?)` tier-based filtering.
- **Action-based dispatchers**:
  - `feedback_dispatch`: consolidates 6 feedback tools into `submit`/`list`/`get`/`update`/`stats`/`health` actions
  - `bootstrap`: consolidates 3 bootstrap tools into `request`/`status`/`confirm` actions
  - `index_dispatch`: added `manifestStatus`/`manifestRefresh`/`manifestRepair` actions

## [1.7.0] - 2026-02-17

### Removed

- **Portable MCP test client removed**: Deleted `portable/` and `portable-mcp-client/` directories, `portableClientShim.ts`, all portable type declarations, and 13 portable-specific test files. The vendored client was back-ported to its origin repo (`jagilber/mcp-client`) before removal.
- **Portable environment variables**: Removed `PORTABLE_HANDSHAKE_TRACE`, `PORTABLE_CONNECT_TRACE`, `PORTABLE_WAIT_ID_TIMEOUT_MS` legacy env vars from runtime config and test utilities.
- **Parked tests**: Removed `src/tests._park/` directory containing obsoleted portable comparison/baseline specs.

### Added

- **SDK-based test client** (`src/tests/helpers/mcpTestClient.ts`): Lightweight replacement using `@modelcontextprotocol/sdk` directly. Provides `spawnServer()` (low-level MCP connect) and `createTestClient()` (high-level CRUD + `importBulk` + `governanceUpdate`).
- **Copilot CLI E2E script** (`scripts/copilot-e2e.ps1`): E2E smoke test using GitHub Copilot CLI programmatic mode as the recommended interactive MCP client.

### Changed

- **Integration tests refactored**: All integration tests now use `mcpTestClient` instead of `portable-mcp-client`. Affected: `instructionsCreateAtomicVisibility`, `instructionsRemoveAtomicVisibility`, `instructionsPersistenceDivergence`, `instructionsPersistenceIsolated`, `instructionsExternalReload`, `instructionSchema`, `feedbackReproduction.crudConsistency`, `feedbackReproduction.multiClient`, `contractSchemas`, `governanceHashIntegrity`, `governanceHashHardening`, `importDuplicateAddVisibility`.
- **Performance baseline** (`scripts/perf-baseline.mjs`): Rewritten to connect via `@modelcontextprotocol/sdk` instead of portable client.
- **Guard declarations** (`scripts/guard-declarations.mjs`): Simplified allow-list to only `sdk-shim.d.ts`.
- **Config cleanup**: Removed portable references from `.eslintignore`, `.eslintrc.json`, `tsconfig.eslint.json`, `tsconfig.eslint.vendored.json`, `vitest.config.ts`, `.secrets.baseline`.

## [1.6.8] - 2026-02-16

### Changed

- **Schema version bumped to v4**: Instruction schema now accepts `sourceWorkspace` and `createdByAgent` as optional root-level properties. These fields are set by `promote_from_repo` to track provenance of promoted entries. Previously, entries with these fields were rejected by `additionalProperties: false` validation (caused 10 skipped entries in production catalogs).
- **Migration v3→v4**: Automatic no-op migration — fields are optional so no data transforms needed; schemaVersion stamp is updated on load.

## [1.6.7] - 2026-02-16

### Added

- **SpecKit bootstrap**: Full spec-driven development scaffolding for the repo.
  - `constitution.json` — Machine-checkable quality gates (quality, security, architecture, governance articles)
  - `.specify/` folder — `memory/constitution.md`, `templates/` (spec, plan, tasks), `config/promotion-map.json`, `commands/`
  - `.github/copilot-instructions.md` — Canonical repo instructions with MCP integration section
  - `.github/agents/` — 5 SpecKit agent slash commands (constitution, specify, plan, tasks, implement)
  - `.github/prompts/` — 5 matching reusable prompt files
  - `sync-constitution.cjs` — Generates derived constitution.md from constitution.json (supports `--check` mode)
  - `promotion-map.json` — Maps existing docs (ARCHITECTURE, PRD, TOOLS, CONTRIBUTING, specs) for catalog promotion

## [1.6.6] - 2026-02-16

### Added

- **`promote_from_repo` tool**: New mutation tool that scans a local Git repository and promotes its knowledge content (constitutions, docs, instructions, specs) into the instruction catalog. Supports `.specify/config/promotion-map.json` for explicit source→instruction mappings and automatic `instructions/*.json` discovery. Features SHA-256 content hash dedup, scope filtering, dry-run mode, force re-promote, and custom repoId override. Replaces per-repo promotion logic with a centralized server-side tool.
- **15 unit tests** for `promote_from_repo` covering promotion-map, instruction file scanning, scope filtering, content hash dedup, force flag, dry-run, repoId override, error handling, and malformed file resilience.
- **TOOLS.md** documentation for `promote_from_repo` tool.

## [1.6.5] - 2026-02-13

### Changed

- **Tool name separator**: Renamed all 44 MCP tool names from slash (`/`) to underscore (`_`) format (e.g., `health/check` → `health_check`, `instructions/dispatch` → `index_dispatch`). Underscore naming improves compatibility across MCP clients and avoids path-separator ambiguity.
- **Dispatch schema**: Added `listScoped` and `getEnhanced` to the `index_dispatch` action enum so these actions are no longer blocked by schema validation.

### Fixed

- **`feedback_get` / `feedback_update` not-found handling**: Changed from throwing MCP error -32603 to returning a graceful `{ notFound: true, id, hint }` response, consistent with `index_dispatch get` behavior.

### Documentation

- Updated README.md, TOOLS.md, and MIGRATION.md to reflect underscore tool naming convention.

## [Unreleased]

### Changed (Catalog Configuration)

- **Configurable body max length**: Added `INDEX_SERVER_BODY_MAX_LENGTH` environment variable (default: 20000, range: 1000–1000000) to control the maximum body character length for instruction entries. The JSON schema ceiling is 1MB; the runtime config controls effective enforcement.
- **Enhanced salvage for missing fields**: Missing `audience` now defaults to `all` (salvage counter: `audienceMissing`), missing `requirement` defaults to `recommended` (counter: `requirementMissing`). Previously, entries without these fields were hard-rejected.
- **Body truncation always applies**: Removed the 24K ceiling on body truncation salvage. Bodies exceeding the configured limit are always truncated, regardless of how far over they are.
- **Near-limit warning is relative**: The `body:near-limit` soft warning now triggers at 90% of the configured body max length instead of a hardcoded 18K threshold.
- **Rejection logging**: Schema and classification rejections are now logged to stderr at info level (`[catalog:skip] filename: reason`) for operational visibility without requiring trace mode.
- **Schema body maxLength bumped to 1MB**: The JSON schema `instruction.schema.json` body `maxLength` raised from 20000 to 1000000 to serve as a permissive ceiling; the runtime `INDEX_SERVER_BODY_MAX_LENGTH` config controls the effective limit.

### Changed (Schema & Migration)

- **contentType now required**: Added `contentType` to required properties in instruction.schema.json (Schema v3)
  - Updated `migrateInstructionRecord()` to add `contentType='instruction'` default for backward compatibility
  - Enhanced groom handler to apply migration logic during catalog operations
  - Updated normalize handler to ensure contentType is added to all instructions
  - Production migration: All 138 production instructions updated with contentType field
  - Migration scripts: Added `scripts/add-contenttype-prod.ps1` for bulk updates
  - Reference: Schema version 3, commit 598f90d

### Fixed (MCP Protocol Compliance)

- **CRITICAL:** Eliminated stdout contamination violating MCP stdio transport specification. Server was writing diagnostic messages to stdout, contaminating the JSON-RPC message stream and causing PowerShell MCP client connection failures.
  - Changed `MetricsCollector.ts`: 4 instances of `console.log()` → `console.error()` (storage mode, clear messages)
  - Changed `memoryMonitor.ts`: 9 instances of `console.log()` → `console.error()` (monitoring lifecycle, snapshots, utilities)
  - Fixed `sdkServer.ts`: Corrected literal `\n` escape sequences that broke TypeScript compilation
  - Impact: stdout now contains ONLY JSON-RPC messages (MCP spec compliant), stderr contains all diagnostic/debug logging
  - Fixes: PowerShell MCP client timeout issue caused by non-JSON lines in stdout stream
  - Reference: https://modelcontextprotocol.io/docs/concepts/transports

### Enhanced (Handshake Diagnostics)

- Added comprehensive handshake diagnostic logging when `INDEX_SERVER_LOG_DIAG=1`:
  - Early stdin buffer: Shows captured chunk preview, Content-Length detection, hasInitialize detection
  - Replay diagnostics: Detailed chunk replay with preview of first chunk content
  - Transport initialization: stdin listener count tracking, readable state monitoring
  - Enhanced visibility for debugging client connection issues
- Improved error handling for handshake buffer replay with structured error messages

### Added (Testing Infrastructure)

- Created `test-stdin-race.js`: Node.js test client simulating PowerShell behavior (immediate initialize)
- Created `test-powershell-client.ps1`: PowerShell test harness for real client connection testing
- Created `STDOUT-CONTAMINATION-FIX.md`: Comprehensive documentation of stdout contamination issue and fix
- Created `POWERSHELL-CLIENT-ANALYSIS.txt`: Detailed analysis of PowerShell client timeout issue (13968 lines)

### Changed (Previous)

- Dashboard: Added performance (CPU + Memory) card visual baseline snapshot (`performance-card-*`).
- UI: Refactored drilldown controls into horizontal grouped layout with standardized checkbox styling.
- Tests: Promoted performance card snapshot to mandatory Playwright baseline; removed legacy optional skips via deterministic seeding.
- Logging: Introduced dual-format (structured JSON vs concise plain) logging for WebSocket connect/disconnect/error and memory deltas using existing `INDEX_SERVER_DEBUG` / `INDEX_SERVER_VERBOSE_LOGGING` flags (no new env vars added). Multi-line memory change logs replaced with single-line structured or concise output to eliminate downstream JSON parse warnings.

## [1.6.2] - 2025-09-20

### Changed (configuration & mutation gating)

- Unified mutation enable flag under consolidated `INDEX_SERVER_MUTATION`; legacy `INDEX_SERVER_ENABLE_MUTATION` still accepted with one-time deprecation warning via `runtimeConfig.parseMutation()`.
- Server transport, instruction handlers, and dashboard admin panel now all query `getRuntimeConfig().mutationEnabled` ensuring consistent behavior in tests and production.
- Updated gating error message to reference `INDEX_SERVER_MUTATION=1` (retains legacy mention for transition).

### Added (test infrastructure)

- Introduced shared dashboard readiness helper `waitForDashboard.ts` eliminating ad‑hoc polling loops across graph-related tests.

### Fixed (flaky tests)

- Stabilized `graphFiltering.spec.ts`, `graphFilteringStyles.spec.ts`, and `graphThemeVariables.spec.ts` by awaiting deterministic dashboard startup (previous 15s timeouts reduced to reliable ~15s execution within extended 20s cap).

### Internal (refactor / hygiene)

- Removed direct `process.env.INDEX_SERVER_ENABLE_MUTATION` hot path checks in favor of runtime configuration accessor (dynamic reload when only legacy flag present preserves prior semantics).
- Minor import cleanup after consolidation (removed unused `getBooleanEnv` references where replaced by runtime config).

### Upgrade Guidance (1.6.2)

- Prefer setting `INDEX_SERVER_MUTATION=1` going forward. Existing automation using `INDEX_SERVER_ENABLE_MUTATION=1` continues to work (deprecation window). Plan future release to drop legacy flag once downstream usage metrics indicate adoption.
- No schema or tool contract changes; safe patch update.

### Future (1.6.2 follow-up)

- Schedule removal of legacy mutation flag references in help text and admin dashboard after confirming negligible usage (target ≥90% replacement) and possibly introduce `INDEX_SERVER_CONFIG_STRICT` to enforce consolidated variable set.

### Configuration Consolidation (Phases 1–4)

- Added unified runtime configuration loader `src/config/runtimeConfig.ts` centralizing parsing & normalization of environment variables.
- Introduced consolidated variables: `INDEX_SERVER_TIMING_JSON`, `INDEX_SERVER_TEST_MODE`, `INDEX_SERVER_LOG_LEVEL`, `INDEX_SERVER_MUTATION`, `INDEX_SERVER_TRACE` (token set), with future placeholders (`INDEX_SERVER_BUFFER_RING`).
- Backward compatibility: legacy flags (`FAST_COVERAGE`, `MANIFEST_TEST_WAIT_DISABLED_MS`, `MANIFEST_TEST_WAIT_REPAIR_MS`, `INDEX_SERVER_ENABLE_MUTATION`, verbose/diag log flags) auto-mapped with one-time deprecation warnings.
- Pilot migration: `manifestEdgeCases.spec.ts` refactored to consume timing via `cfg.timing()` accessor; remaining high-churn tests scheduled for follow-up phases.
- Documentation updates: README consolidation section, deployment matrix extended with migration notes, contributing guidelines prohibit new ad-hoc env vars, configuration guide cross-referenced.
- Coverage gating integrated with loader (`runtimeConfig.coverage`) maintaining dual-threshold (`COVERAGE_HARD_MIN`, `COVERAGE_TARGET`).
- Established future Phase 5 plan: optional strict mode (`INDEX_SERVER_CONFIG_STRICT=1`) to reject unmapped legacy flags once adoption threshold met (target ≥70% migrated usages).


### Added (dispatcher capabilities & batch)

### Documentation (overhaul 1.4.2)

- Added `docs/MANIFEST.md` detailing catalog manifest lifecycle, invariants, drift categories, opportunistic materialization, and fastload roadmap.
- Updated `README.md` with Manifest & Opportunistic Materialization section; added MANIFEST doc links in primary doc suite lists.
- Updated `PROJECT_PRD.md` to version 1.4.2 including formal Manifest & Materialization requirements (MF1–MF7) and ratified schema‑aided failure contract.
- Updated `ARCHITECTURE.md` (version banner 1.4.1 → context now aligned with opportunistic materialization & manifest helper) – cross-linked manifest semantics.
- Updated `DOCS-INDEX.md` adding Manifest category; refreshed recent updates section for 1.4.x runtime changes.
- Removed deprecated PRD stub files (`docs/PRD.md`, `docs/PROJECT-PRD.md`) to eliminate duplication; canonical remains `docs/PROJECT_PRD.md`.
- Ensured CHANGELOG references preserved and future fastload placeholder documented (no runtime effect yet).

### Changed (readability & consistency)

- Standardized terminology: "Opportunistic Materialization" (replaces ambiguous "late materialization" phrasing) across updated docs.
- Clarified disable flag guidance for `INDEX_SERVER_MANIFEST_WRITE=0` (diagnostic/read-only only).


### Fixed (persistence phantom write false positive)

- Reclassified `instructionsPersistenceDivergence.red.spec.ts` to GREEN (`instructionsPersistenceDivergence.spec.ts`).
- Root cause: baseline drift (IDs under test already existed) causing stable count/hash and perceived phantom writes.
- Added adaptive assertions: if IDs are new, count/hash must change; pure overwrite path allows stable hash but guarantees visibility.
- Removed heavy multi-flag RED gating for this scenario (now validated by normal suite).

### Governance (baseline noise suppression)

- Updated `scripts/guard-baseline.mjs` allow-list (noise suppression only) to include:
  - `httpMetrics.spec.ts` (HTTP instrumentation coverage)
  - `instructionsPersistenceDivergence.spec.ts` (adaptive GREEN replacement test)
  - `dashboardPhase1.spec.ts` (dashboard infra wiring)
  - `dashboardRpmStability.spec.ts` (RPM metrics stability)
  (No minimal invariant expansion; internal baseline policy unchanged.)

  ## [1.4.0] - 2025-09-13

  ### Added (manifest observability & helper)

  - Centralized manifest update helper `attemptManifestUpdate()` consolidates all post‑mutation catalog manifest writes (future hook point for batching/debounce without changing call sites).
  - Structured manifest write log lines: `[manifest] wrote catalog-manifest.json count=<entryCount> ms=<duration>` emitted only on successful writes.
  - New counters:
    - `manifest:write` – incremented on each successful manifest write
    - `manifest:writeFailed` – incremented when an exception occurs during write
    - `manifest:hookError` – incremented when update hook invocation throws
  - Environment flag `INDEX_SERVER_MANIFEST_WRITE=0` disables manifest persistence (read-only / diagnostic mode) while allowing normal runtime behavior.

  ### Fixed (visibility flake)

  - Stabilized intermittent add → immediate list/get visibility timing by refining late materialization path and adding targeted retry logic in `addVisibilityInvariant.spec.ts` (single bounded retry, preserves genuine failure signal).

  ### Tests (edge coverage)

  - New `manifestEdgeCases.spec.ts` validating:
    - Disabled write mode respects `INDEX_SERVER_MANIFEST_WRITE=0` (no file created/modified)
    - Corrupted on-disk manifest auto‑repair after subsequent catalog mutation
  - Visibility invariant test enhanced with diagnostic trace & retry instrumentation (now consistently green).

  ### Documentation

  - README: Added Manifest Observability section, documented new counters & `INDEX_SERVER_MANIFEST_WRITE` flag plus reserved `INDEX_SERVER_MANIFEST_FASTLOAD` (planned fast load optimization – inactive placeholder).
  - CONFIGURATION guide: Added Manifest Configuration section & environment variable table entries.
  - CHANGELOG: This entry formalizes helper + observability release.

  ### Internal (refactor & safety)

  - Removed scattered try/catch blocks around manifest writes in instruction mutation handlers; all now route through helper ensuring unified error handling & metrics.
  - Preserved existing manifest drift detection & repair logic (no behavioral change when flag unset).

  ### Compatibility (1.4.0)

  - No instruction schema or tool interface changes.
  - Purely additive logging & metrics; safe transparent upgrade for all clients.
  - When `INDEX_SERVER_MANIFEST_WRITE=0`, runtime skips writes silently (counter increments suppressed) – intended only for diagnostics / perf profiling.

  ### Upgrade Guidance (1.4.0)

  - Pull & rebuild – no client changes required.
  - To disable manifest file writes for diagnostics: set `INDEX_SERVER_MANIFEST_WRITE=0` (do not use in production if you rely on external manifest consumers).
  - Monitoring systems may now scrape manifest counters alongside existing metrics buckets.

  ### Future (not included – 1.4.0 roadmap)

  - Planned `INDEX_SERVER_MANIFEST_FASTLOAD` optimization mode (hash/mtime short‑circuit) reserved; currently no effect (documented as placeholder only).

## [1.4.1] - 2025-09-14

### Fixed (dashboard health accuracy)

- Resolved persistent false positive "Statistics unavailable" issue: local `statsAvailable` shadowed global flag so health card always injected the warning despite successful stats fetches. Now uses `window.statsAvailable` consistently.
- Restored memory utilization health check (`mem: ok` / fail at ≥90% heap usage) alongside CPU derived check when backend omits explicit entries.

### Changed (UI consistency)

- Unified overview card styling with Real‑time Monitoring card via new shared `.stat-row` styles (consistent spacing, typography, separators).
- Added stronger label/value contrast and tabular numeric alignment across System Statistics, System Health, and Performance cards.

### Internal (refactor / cleanup)

- Removed accidentally injected diagnostic block from `applyInstructionTemplate` (caused earlier syntax noise during patch).
- Hardened health rendering defensive normalization & comments clarifying derived check thresholds (CPU <85% ok, Memory <90% ok).

### Notes (1.4.1)

- Pure UI + client-side logic update; no API or schema changes.
- Safe patch upgrade; no restart flags required beyond standard rebuild/deploy.

### Upgrade Guidance (1.4.1)

- Pull, rebuild, redeploy. Dashboard automatically reflects new styling; no configuration changes.


## [1.2.1] - 2025-09-05

## [1.3.0] - 2025-09-10

## [1.3.1] - 2025-09-11

### Fixed (governance overwrite semantics)

- Added safe metadata-only overwrite hydration: when `overwrite:true` and body omitted, handler now hydrates existing body/title before validation allowing pure governance updates (e.g., priority + version bump) without resending full content.
- Corrected `overwritten` flag reporting for metadata-only higher version updates (previously returned `overwritten:false`).
- Enforced strict semantic version validation on create path (previously only validated updates) returning `invalid_semver` for malformed versions.

### Internal (test reliability)

- Targeted governance versioning tests now all green: auto bump, non-semver rejection, body change bump requirements, metadata-only version increment.
- Added hydration logic with type-safe mutation (no `any` casts) to satisfy linting.

### Notes (1.3.1 governance follow-up)

- No changes to on-disk schema; patch release focused on correctness & ergonomics.
- Recommended for users performing frequent governance-only edits to reduce payload size and maintain accurate overwrite telemetry.

### Added (schema v3 & governance)

- Introduced on-disk instruction schemaVersion `3` with new `primaryCategory` field enforcing a single canonical category reference.
- Automatic migration path (v1→v2→v3) updates existing instruction JSON files in-place; adds `primaryCategory` from first existing category and normalizes category list to include it.
- Added governance justification file `governance/ALLOW_HASH_CHANGE` documenting approved hash shift from structural canonicalization.

### Changed (migration & normalization)

- `migrateInstructionRecord` now injects `primaryCategory` for v2 records and ensures `schemaVersion` bump with descriptive notes.
- Runtime handlers enforce invariant: `primaryCategory ∈ categories[]`; fallback category `uncategorized` only when INDEX_SERVER_REQUIRE_CATEGORY unset.
- All committed instructions canonicalized (hash drift resolved) to provide stable CI governance baseline.

### Integrity & Tooling

- Full test suites (fast + slow) green post-migration; quarantined flaky tests unchanged.
- Governance hash workflow unblocked via explicit justification artifact.
- Production deployment updated to version `1.3.0` (no behavior regressions detected).

### Compatibility

- Migration is additive; older clients reading instructions ignore unknown `primaryCategory`.
- Direct downgrade not supported; rollback requires restoring pre-migration backups.

### Documentation (navigation & migration)

- Updated MIGRATION guidance (v2→v3 path) and added docs index + instruction usage plan for navigation.


### Changed (test stability)

- Deprecated legacy RED test `instructionsPersistenceDivergence.red.spec.ts` -> converted to inert placeholder (historical context only).
- Added adaptive GREEN test `instructionsPersistenceDivergence.spec.ts` (creation vs overwrite aware, synthetic hash conditional logic).
- Eliminated 60s timeout risk from mis-gated RED reproduction path.

### Added (diagnostics)

- New `docs/RUNTIME-DIAGNOSTICS.md` detailing runtime triage (handshake timing, persistence verification, metrics inspection).

### Integrity

- Suite now green without special gating; persistence divergence scenario validated deterministically (no false positives from baseline drift).

### Governance

- Formal change control required (see baseline plan section 14) for any test expansion.

### Handshake Hardening

- Implemented early stdin buffering to prevent loss of initial `initialize` frame when clients send immediately on spawn.
- Removed temporary extended readiness polling loops from CRUD smoke & batch/parameterized tests (now redundant).
- Added regression test `handshakeTimingRegression.spec.ts` asserting timely initialize response (<15s hard cap, soft warn >5s).
- Locked handshake path (short-circuit mode removed, version negotiation via spec date retained).


## [0.1.0] - 2025-08-24

### Added (initial)

- Initial project skeleton (models, classification, transport, instruction tools, prompt governance, documentation scaffolding).

## [0.2.0] - 2025-08-25

### Added (metrics & governance)

- metrics, gates, usage tracking, incremental diff, integrity tools

## [0.3.0] - 2025-08-25

### Added (dashboard & persistence)

- Add response schemas, contract tests, docs update

## [0.4.0] - 2025-08-25

### Added (SDK migration & enhancements)

- dashboard + CLI flags; import/export/repair/reload; meta_tools; usage persistence; schema extensions

## [0.5.0] - 2025-08-25

### Changed (supporting artifacts)

- Migrated to official @modelcontextprotocol/sdk (removed legacy custom transport)
- Standardized initialize handshake requiring clientInfo + capabilities.tools
- Structured JSON-RPC error codes/data (-32602 params, -32601 method, -32603 internal)

### Added (tests & tooling)

- server/ready notification via SDK oninitialized hook
- initialize result now includes human-readable instructions field
- ping request handler for lightweight health/latency
- Enhanced unknown tool & mutation gating error data (message, method/tool)

## [0.5.1] - 2025-08-25

### Added (removal capability)

- New mutation tool `index_remove` to delete one or more instruction entries by id (requires INDEX_SERVER_ENABLE_MUTATION=1)

### Changed (registry)

- Tool registry & schemas updated to expose remove capability

## [0.5.2] - 2025-08-25

### Added (single add capability)

- New mutation tool `index_add` (single entry, lax mode default filling, optional overwrite)

### Changed (result shape & docs)

- Aligned result shape for skip path (always includes created/overwritten booleans)
- Updated docs and schemas to reflect new tool

## [0.5.3] - 2025-08-25

### Added (catalog grooming)

- New mutation tool `index_groom` for normalization, duplicate merging, hash repair, deprecated cleanup (supports dryRun mode)

### Changed (registry & docs)

- Added schema, registry entry, tests, and documentation for grooming

## [0.6.0] - 2025-08-25

### Added (structured scoping)

- Introduced structured scope fields on instructions: workspaceId, userId, teamIds
- Classification now derives these from legacy category prefixes (scope:workspace:*, scope:user:*, scope:team:*) and strips them from categories
- New read-only tool `instructions/listScoped` selects best matching scope (user > workspace > team > all)
- JSON Schemas, registry version, and package version bumped

### Changed (groom enhancement)

- Groom tool now supports `purgeLegacyScopes` mode flag removing legacy scope:* category tokens and reports `purgedScopes` metric

### Notes (1.0.3)

- Backward compatibility: existing category-based scope prefixes still recognized; groom tool can later remove them

## [0.7.0] - 2025-08-25

### Changed (Tier 1 schema simplification)

- Relaxed instruction JSON schema: only authoring essentials now required (`id,title,body,priority,audience,requirement,categories`)
- `additionalProperties` enabled to allow forward-compatible governance extensions without breaking authors
- Loader & enrichment narrowed: removed automatic placeholder injection for most governance fields (now derived in-memory)

### Added (dispatcher)

- Minimal author path test (`minimalAuthor.spec.ts`) ensuring derivation of version, priorityTier, semanticSummary, review cycle
- Multi-add persistence test clarifying intentional ignoring of user-supplied governance overrides in `index_add`

### Removed / Simplified

- Excess placeholder governance fields from test fixtures and baseline instruction JSON files
- Enrichment tool now only persists missing `sourceHash`, `owner` (if auto-resolved), `priorityTier`, `semanticSummary`

## [0.8.0] - 2025-08-25

### Added (governance patching)

- New mutation tool `index_governanceUpdate` enabling controlled patch of `owner`, `status`, review timestamps, and optional semantic version bump (`patch|minor|major`)
- README documentation for simplified schema + governance patch workflow

### Changed (schemas & docs)

- Tool registry updated (schema + mutation set) and description added
- Registry version implicitly advanced; package version bumped

### Rationale (consolidation)

- Decouples routine content edits from governance curation; reduces author friction while maintaining an auditable lifecycle

## [0.9.0] - 2025-08-27

### Breaking (dispatcher consolidation)

- Removed legacy read-only instruction tools: `instructions/list`, `instructions/listScoped`, `instructions/get`, `index_search`, `instructions/diff`, `instructions/export`
- Added unified dispatcher tool `index_dispatch` supporting actions: `list`, `listScoped`, `get`, `search`, `diff`, `export`, `query`, `categories`, `dir`, plus mutation/governance actions: `add`, `import`, `remove`, `reload`, `groom`, `repair`, `enrich`, `governanceHash`, `governanceUpdate`, `health`, `inspect`, `dir`, `capabilities`, `batch`
- Tests and internal registry updated to only surface `index_dispatch` (reduces tool surface for clients, simplifies capability negotiation)

### Added

- Dispatcher batch execution (`action: "batch"`) to perform multiple sub-actions in one round trip
- Capabilities action returning: `{ version, supportedActions, mutationEnabled }`
- Negative schema drift test migrated to dispatcher schema
- Regenerated `docs/TOOLS-GENERATED.md` to reflect dispatcher (single tool surface + flexible schema)
- Added dispatcher capabilities & batch test suites (`dispatcherCapabilities.spec.ts`, `dispatcherBatch.spec.ts`)

### Changed

- Schemas: removed per-method instruction response schemas; introduced flexible dispatcher response schema (loose anyOf) for rapid iteration
- Documentation (TOOLS, PRD) pending full rewrite to reflect dispatcher (will land immediately post-merge)

### Migration Guide (1.0.0)

| Old | New (dispatcher) |
|-----|------------------|
| instructions/list | index_dispatch { action:"list", ... } |
| instructions/listScoped | index_dispatch { action:"listScoped", ... } |
| instructions/get | index_dispatch { action:"get", id } |
| index_search | index_dispatch { action:"search", q } |
| instructions/diff | index_dispatch { action:"diff", clientHash?, known? } |
| instructions/export | index_dispatch { action:"export", ids?, metaOnly? } |

### Rationale (1.0.0)

Unifying read-only catalog operations behind a single tool reduces handshake/tool enumeration overhead, enables richer batching, and provides a single stability / gating surface. Future specialized actions (advanced query planner) can ship without expanding the top-level tool set.

## [0.9.1] - 2025-08-27

### Changed (test suite & reliability)

- Eliminated all skipped tests; expanded suite to 125 assertions across 69 files (dispatcher, governance hash stability, enrichment, error paths, property-based grooming, usage gating).
- Strengthened dispatcher, transport core, governance update, and error-path coverage (malformed JSON-RPC, unknown methods) with deterministic waits & diagnostics.
- Seeded property-based groom idempotence test for reproducibility.
- Added explicit feature flag enable/disable coverage (usage gating & feature_status reporting).

### Added (documentation)

- Updated README test section (current counts, no skips) and clarified dispatcher-only surface & mutation gating.
- Clarified architecture doc to reflect 0.9.x dispatcher consolidation (previous note referenced 0.8.x only).
- Refreshed tools registry generated notes for stabilization pass.

### Internal (1.0.0)

- No API surface changes vs 0.9.0 (patch release). Dispatcher contract & tool schemas unchanged.
- Pure documentation + test reliability improvements; safe for consumers.

### Upgrade Guidance

No action required for clients already on 0.9.0. Optional: pull to benefit from fuller test coverage and clarified documentation.

## [1.0.0] - 2025-08-27

### Breaking Changes

- Removed all legacy direct JSON-RPC per-tool method handlers (e.g. calling `health_check` directly). Clients MUST use `tools/call` with `{ name:"<tool>" }`.
- Removed underscore alias methods (e.g. `health_check`, `metrics_snapshot`, `usage_track`, etc.). Canonical slash-form tool names only.
- Removed fallback minimal stdio transport path (SDK transport now required; process exits fast if unavailable).
- Removed Ajv validation layer for direct handlers (tool argument validation remains schema-based internally where needed or enforced by tool logic).

### Added / Changed

- Simplified handshake: deterministic ordering `initialize` response -> single `server/ready` -> optional `tools/list_changed` (idempotent ready emitter with trace logging via `INDEX_SERVER_HANDSHAKE_TRACE=1`).

## [1.0.3] - 2025-08-28

### Fixed (handshake determinism & flake elimination)

- Resolved intermittent minimal handshake test flake where `initialize` result line was occasionally not captured before `server/ready` notification. Root cause: race between stdout write callback scheduling and line buffering in tight spawn harness.
- Emit minimal server initialize response synchronously via `fs.writeSync(1, ...)` ensuring flush ordering; schedule `server/ready` via `setImmediate` for strict sequencing.
- Hardened `minimalHandshake.spec.ts` with diagnostic dump and stricter pattern.

### Added (minimal reference server)

- Introduced `src/minimal/` lightweight reference implementation exercising only `initialize`, `server/ready`, `tools/list_changed`, `ping/health` pathways for rapid protocol regression detection.

### Deployment

- Deployment script now succeeds with added minimal server artifacts; production bundle verified post-change. Addressed earlier invalid script key by using dash form `start-minimal` (avoid colon which is invalid in npm script names on some environments).

### Notes (feedback introduction)

- All core handshake, latency, governance, and dispatcher suites pass consistently post-fix (multiple consecutive full runs, zero handshake ordering failures after synchronous emission patch).
- Added structured handshake trace events (`initialize_received`, `ready_emitted`, watchdog diagnostics) for observability.
- Hardened tool list change ordering: prevents premature `tools/list_changed` before `server/ready`.
- Updated tests to exclusively exercise `tools/call` path (`transport.spec.ts`, `responseEnvelope.spec.ts`, latency & coverage suites).

### Migration Guide

| Legacy Pattern | 1.0+ Replacement |
|----------------|------------------|
| `{ method:"health_check" }` | `{ method:"tools/call", params:{ name:"health_check", arguments:{} } }` |
| `{ method:"health_check" }` | (unsupported) use canonical above |
| `{ method:"metrics_snapshot" }` | `{ method:"tools/call", params:{ name:"metrics_snapshot" } }` |
| Direct instruction tool names (dispatcher unaffected) | Use dispatcher or existing canonical tool via tools/call |

### Rationale

Removing back-compat surfaces reduces ambiguity in clients, eliminates duplicate execution pathways, and tightens protocol compliance (single ready emission, no early notifications). Observability via trace events aids debugging without impacting normal stderr noise (opt-in flag).

### Upgrade Notes

- Update any bespoke clients or scripts invoking legacy underscore methods to the canonical names via `tools/call`.
- Ensure environment expects a single `server/ready` notification; multi-ready tolerant clients remain unaffected.
- If you previously relied on the fallback transport, adopt the standard MCP SDK JSON-RPC stdio framing; no additional configuration needed for normal usage.

### Internal (refinement)

- Removed ~300 lines of legacy compatibility code; reduced handshake race conditions and watchdog complexity.
- Test suite adjusted; alias test removed.

### Future

- Potential addition: explicit protocolVersion negotiation matrix & structured `capabilities.handshake` section once MCP spec advances.

## [1.0.1] - 2025-08-27

### Changed (semantic error guarantees)

- Hardened JSON-RPC semantic error preservation: dispatcher validation/gating codes (-32601 / -32602) are now deterministically retained end-to-end (previous rare fallbacks to -32603 eliminated).
- Added deep semantic recovery & diagnostic logging (`[rpc] deep_recover_semantic`) in `sdkServer` request override for visibility when nested wrappers obscure codes.
- Tightened tests: removed transitional allowances for -32603 in dispatcher validation & mutation gating specs; assertions now require exact expected semantic codes.

### Added (stress coverage)

- New `dispatcherStress.spec.ts` high-churn test exercising rapid invalid + valid dispatcher calls to detect any semantic code downgrades.
- Supplementary logging gated by `INDEX_SERVER_LOG_VERBOSE=1` to trace pass-through vs wrapped error paths.

### Internal (maintenance)

- Updated `.gitignore` to exclude transient fuzz/concurrency instruction artifacts, build locks, and temp minimal-author scratch directories.
- Incremented package version to 1.0.1 (patch: reliability & test hardening only; no API changes).

### Upgrade Guidance (1.0.1)

No action required. Clients benefit from stricter and more predictable error codes; behavior of successful tool results unchanged.

## [1.0.2] - 2025-08-27

### Changed (test gating & stability)

- Segregated nondeterministic / adversarial fuzz & stress specs behind `INDEX_SERVER_STRESS_DIAG=1` (handshake flake, mixed workload health starvation repro, multi‑process health stress, dispatcher stress/flake, concurrency fuzz).
- Baseline test run (without flag) now deterministic: all core + compliance + governance suites green; stress specs appear as skipped (documented) eliminating prior intermittent CI noise.
- Added skip pattern helper (`maybeIt`) in gated specs for clear opt‑in semantics.

### Added (tooling & scripts)

- New npm scripts: `test:stress` (full suite with stress enabled) and `test:stress:focus` (runs only gated stress specs) for quicker iterative diagnosis.
- Added README section "Stress / Adversarial Test Suite" enumerating gated spec files and usage examples.

### Diagnostics / Observability

- Retained synthetic initialize fallback path but fully gated by `INDEX_SERVER_INIT_FALLBACK_ALLOW` (off by default) with compliance test (`healthMixedNoFallback.spec.ts`) ensuring no synthetic initialize in normal operation.
- Expanded handshake trace logging clarifying fallback gating decisions (`init_unconditional_fallback_skip gating_off`).

### CI / Reliability

- Prepared nightly stress workflow (scheduled) to exercise stress suite with `INDEX_SERVER_STRESS_DIAG=1` without impacting mainline CI signal (separate job, non-blocking).

### Internal (catalog & runtime)

- Version bumped to `1.0.2` (patch: reliability & test ergonomics only; no API surface changes).

### Upgrade Guidance (1.0.2)

No client changes required. Consumers may optionally run the stress suite locally when diagnosing latency / starvation conditions:

```bash
INDEX_SERVER_STRESS_DIAG=1 npm test            # run full suite including stress
INDEX_SERVER_STRESS_DIAG=1 npm run test:stress # equivalent convenience script
```

For routine CI or local verification omit the flag for deterministic results.

## [1.0.4] - 2025-08-28

### Added (feedback / emit system)

- New MCP-compliant feedback tool suite:
  - `feedback_submit`
  - `feedback_list`
  - `feedback_get`
  - `feedback_update`
  - `feedback_stats`
  - `feedback_health`
- Persistent JSON storage (`feedback/feedback-entries.json`) with max entry cap (`INDEX_SERVER_FEEDBACK_MAX_ENTRIES`, default 1000) and trimming.
- Structured feedback model (type, severity, status workflow, tags, metadata, context) with audit logging.
- Security & critical feedback entries mirrored to stderr for immediate visibility.
- Health endpoint reporting storage accessibility, writability, configured directory.
- Statistics endpoint aggregating totals by type/severity/status plus recent activity windows (24h/7d/30d).
- Environment configurables: `INDEX_SERVER_FEEDBACK_DIR`, `INDEX_SERVER_FEEDBACK_MAX_ENTRIES`.
- Documentation: README & TOOLS.md sections describing usage, schemas, and examples.

### Changed (infrastructure)

- `.gitignore` updated to exclude persisted feedback storage artifacts.
- Tool registry extended with feedback tools (stable read-only vs mutation semantics maintained where applicable).

### Notes (cleanup hygiene)

- Feature addition only; no breaking changes to existing instruction dispatcher or governance tools.
- Version bump to 1.0.4 reflects new externally visible tool surface.

## [1.0.5] - 2025-08-28

### Changed (test stability & isolation)

- Refactored feedback test suite:
  - Introduced `feedbackCore.spec.ts` (comprehensive) & `feedbackSimple.spec.ts` (smoke) with per‑test isolated `INDEX_SERVER_FEEDBACK_DIR` directories.
  - Converted brittle absolute "empty list" assertions to delta-based assertions; legacy expectations gated with `it.skip(... // SKIP_OK)` for documentation without flakiness.
  - Added deterministic persistence wait loop for filesystem write visibility.
  - Replaced dynamic requires with explicit static imports (avoids MODULE_NOT_FOUND under variant names).
  - Added legacy placeholder `feedback.spec.ts` (kept minimal) to preserve historical references.

### Fixed (rate limiting correctness)

- Reordered rate limiting logic in catalog usage tracking so entry creation/load occurs before limit evaluation preventing cross-id phantom rate limits.
- Added invariants ensuring usageCount reflected accurately in rate-limited responses.

### Added (governance & content guidance)

- New `CONTENT-GUIDANCE.md` clarifying instruction classification, promotion workflow, and MCP protocol separation of concerns.
- Explicit MCP compliance guidance: do NOT embed tool catalogs/schemas inside instruction content (dynamic discovery via protocol only).

### Documentation (1.1.1)

- Expanded TOOLS.md & README with Feedback System Features section.
- Clarified short-circuit / minimal handshake modes and environment flags (previous sections consolidated).

### Internal / Quality

- Guarded optional `since` parameter access in feedback list & stats handlers (eliminates TS18048 risk under strict mode).
- Added commit helper tasks for structured documentation and feature commits.
- All core + contract tests passing (168 passed / 14 skipped – skips limited to explicitly gated stress & legacy expectations).

### Notes (stabilization)

- Patch release (1.0.5) focuses on stabilization & correctness refinements immediately following new feedback feature introduction.
- No further tool surface changes beyond feedback system introduced in 1.0.4.

### Upgrade Guidance (1.0.5)

- Consumers upgrading from 1.0.4 gain improved determinism in feedback operations & safer usage rate limiting without client changes.

## [1.2.0] - 2025-09-05

### Added (observability & admin UX)

- Unified runtime diagnostics guard (`[diag] [ISO] [category]`) capturing uncaught exceptions, unhandled rejections, process warnings, and termination signals with optional exit delay (`INDEX_SERVER_FATAL_EXIT_DELAY_MS`).
- Real backup system with millisecond precision IDs (`backup_YYYYMMDDTHHMMSS_mmm`), manifest generation (instructionCount, schemaVersion) and safety pre-restore snapshot.
- Admin dashboard backup listing & one‑click restore UI (auto refresh + schemaVersion display).
- WebSocket enhancements: client UUID assignment, connect/disconnect broadcast events, immediate metrics snapshot push, active connection metrics integration.
- Live synthetic activity per-call trace streaming over WebSocket (`synthetic_trace` messages) with runId, sequence, duration, error, and skipped markers.
- Synthetic harness expansion to exercise instruction dispatcher CRUD pathways (`add/get/list/query/update/remove`) plus usage tracking; active in‑flight request counter + status endpoint.
- Instruction editor enrichment: diff view, formatting button, diagnostics panel (validity, size, hash, missing fields), template injection, change detection.
- HTTP metrics instrumentation aggregating all REST requests into pseudo tool bucket `http/request` (opt-out with `INDEX_SERVER_HTTP_METRICS=0`).
- Performance detailed endpoint `/api/performance/detailed` (requestThroughput, avg, p95 approximation, errorRate, concurrentConnections, activeSyntheticRequests).

### Changed (tests & reliability)

- Added `httpMetrics.spec.ts` validating HTTP aggregation bucket increments.
- Hardened PowerShell isolation handshake test with BOM stripping, retry initialize, soft-pass degraded mode and extended deadlines to eliminate flakes.
- Adaptive sampling + concurrency & duration guard in multi-client feedback reproduction test (dynamic ~0.8% sample, clamped 5–8, 7s hard wallclock) reducing runtime while preserving coverage rotation.
- Fast test script (`scripts/test-fast.mjs`) leak guard ensuring slow specs never bleed into fast subset.
- Pre-push hook (`scripts/pre-push.ps1`) running slow test suite gating pushes.

### Internal

- Catalog stats now cache aggregated schemaVersion (scans bounded sample) for dashboard display & backup manifest inclusion.
- Synthetic run summary & active request counter cached for UI polling; safety resets protect against leaked counters on errors.
- Added cache-control headers to `/api/status` to prevent stale build/version metadata.

### Notes (release rationale)

- Minor version bump due to additive public capabilities (diagnostics semantics, backup/restore endpoints/UI, streaming synthetic traces, HTTP metrics exposure, instruction editor UX). No breaking tool schema changes.
- Future roadmap items (not yet implemented): diagnostics metrics counters, JSONL sink with rotation, dashboard diagnostics endpoint, health degradation heuristics.

### Upgrade Guidance (1.2.0)

- No client changes required; new diagnostics lines appear only on stderr.
- To enable HTTP metrics aggregation ensure dashboard mode is active (set `INDEX_SERVER_DASHBOARD=1`).
- For live synthetic traces pass `?trace=1&stream=1` when invoking synthetic activity via dashboard UI (already wired in client script).

## [1.0.6] - 2025-08-28

### Changed (cleanup)

- Removed obsolete legacy feedback test variant files (`feedback.spec.ts.new/.minimal/.disabled/.clean`) to avoid accidental resurrection and duplicate coverage.
- Consolidated around `feedbackCore.spec.ts` (comprehensive), `feedbackSimple.spec.ts` (smoke), and minimal legacy placeholder `feedback.spec.ts` file.
- Version bump reflects repository hygiene update post-stabilization (no functional surface changes).

### Notes

- Patch solely for test/developer experience cleanliness; no runtime code modifications.

## [1.1.0] - 2025-08-30

### Added (documented add response contract)

- Finalized and documented enriched `index_add` response fields (`verified`, `feedbackHint`, `reproEntry`) in README.
- Treats previously experimental creation verification semantics as stable API (minor bump per VERSIONING policy: additive response fields after 1.0).
- No schema version change (response shape additive only; instruction JSON schema unchanged at `schemaVersion: 2`).

### Upgrade Guidance (1.1.0)

- No client changes required if ignoring unknown fields; clients wanting richer UX can surface `feedbackHint` and attach `reproEntry` when auto-filing feedback.
- Optional: update any strict type definitions to include the new optional keys.

## [1.1.1] - 2025-08-31

### Changed (handshake & test harness reliability)

- Removed legacy short-circuit handshake mode (`INDEX_SERVER_SHORTCIRCUIT`); only canonical SDK-driven initialize path is supported.
- Added shared handshake helper (`src/tests/util/handshakeHelper.ts`) consolidating spawn + sentinel wait + initialize send + one-time resend fallback (idempotent initialize id=1).
- Added timing regression guard (`handshakeTimingRegression.spec.ts`) enforcing initialize response under 15s hard cap (warn >5s) post early stdin buffering.
- Standardized resend logic (single resend after 4s inactivity) eliminating ad-hoc polling loops that caused sporadic timeouts under suite contention.
- Clarified diagnostic flag usage: production must keep `INDEX_SERVER_INIT_FALLBACK_ALLOW`, `INDEX_SERVER_DISABLE_INIT_SNIFF`, `INDEX_SERVER_HANDSHAKE_TRACE` unset unless actively debugging.

### Fixed (intermittent test timeouts)

- Resolved sporadic initialize wait timeouts in `createReadSmoke` & portable CRUD specs when run amidst heavy reproduction suites; root cause was duplicated bespoke timing logic racing process startup.
- Direct protocol compliance test (`handshakeDirect.spec.ts`) remained stable confirming server-side sequencing correctness.

### Documentation (migration & governance)

- Changelog now records deprecation & removal of short-circuit path; README environment flag table implicitly authoritative (no short-circuit flag documented).
- Next minor (1.2.0) PRD addendum will ratify handshake helper as mandatory pattern for new spawn-based specs.

### Internal (1.1.1)

- Patch bump only; no schema or tool surface modifications.

### Upgrade Guidance (1.1.1)

No action required. Remove any legacy use of `INDEX_SERVER_SHORTCIRCUIT`; standard initialize sequence already compatible.

## [1.1.2] - 2025-08-31

### Changed (catalog performance & visibility race elimination)

- Implemented late materialization on add/get paths eliminating rare duplicate add -> immediate get notFound race under high concurrency.
- Added per-file lifecycle tracing (`begin`, `progress`, `end`) at normal trace level for catalog loads.
- Introduced memoized catalog caching (mtime/size heuristic + optional SHA-256 hash path) gated by `INDEX_SERVER_MEMOIZE` / `INDEX_SERVER_MEMOIZE_HASH` while preserving `INDEX_SERVER_ALWAYS_RELOAD` semantics.
- Emitted cache summary trace (`catalog:cache-summary`) for observability (hit/miss, strategy, counts).

### Fixed (multi-client visibility anomalies)

- Resolved cross-client immediate visibility lag after duplicate add with overwrite=false by deferring reconstruction until atomic write + canonical readback complete.
- Eliminated list/get sampling phantom mismatches (analyzer now reports 0 anomalies across large trace corpus).

### Added (tracing & analysis tooling)

- Standardized trace persistence format to bracketed label + JSON for analyzer compatibility.
- Added trace analysis scripts (`scripts/analyze-traces.*`) and reproduction harness (`scripts/run-feedback-repro-with-trace.ps1`).
- Minimal instruction assembly script (`scripts/prepare-minimal-instructions.mjs`) for performance-focused runs without altering tests.

### Notes (release scope)

- Patch release (1.1.2) is internal reliability + performance; no external tool / schema surface change.
- All previously RED reproduction tests now GREEN; two legacy RED specs still intentionally failing due to unsupported bulk import pathway (guarded by test expectations).

### Upgrade Guidance (1.1.2)

No client changes required. Enable `INDEX_SERVER_MEMOIZE=1` (and optionally `INDEX_SERVER_MEMOIZE_HASH=1`) to reduce reload overhead in high-churn scenarios without sacrificing correctness.

## [1.0.7] - 2025-08-30

### Added (creation verification & failure contract)

- Hardened `index_add` success semantics: `created:true` now only emitted after atomic write, catalog visibility, and final readability (title/body non-empty) verification; response includes `verified:true` when these checks pass.
- Unified failure response contract via internal `fail()` helper returning `{ created:false, error, feedbackHint, reproEntry }` across all add failure paths (missing entry/id/required fields, governance violations, write errors, atomic readback failure, invalid shape).
- Added enriched guidance encouraging clients to submit structured feedback with embedded `reproEntry` for rapid defect triage.
- New tests: `instructionsAddCreatedFlag.spec.ts` verifying created/verified gating and feedback guidance on failure conditions (governance + required field omissions).
- Portable client CRUD harness stabilized (dynamic ESM import shim) with deterministic atomic visibility assertions.

### Documentation (lifecycle)

- Added `FEEDBACK-DEFECT-LIFECYCLE.md` formalizing feedback → red test → fix → coverage workflow.
- Pending README & TOOLS doc updates for enriched add response (will be completed in 1.1.0 minor bump).

### Internal (stability)

- Introduced ambient module declaration for portable client to resolve TS7016 without expanding `tsconfig` include surface.
- Eliminated intermittent “No test suite found” flake in portable CRUD atomic spec via stabilization of file export timing.

### Versioning Notes (next minor)

- Patch release retained (1.0.7) while evaluating whether enriched add response should be treated as a documented stable contract.
- Next release should bump MINOR to 1.1.0 once documentation references are finalized (optional field additions per policy).


## [1.5.0] - 2025-09-14

### Added (bootstrap gating & safety)

- Bootstrap confirmation gating flow (`requestBootstrapToken` → `finalizeBootstrapToken`) requiring explicit human confirmation artifact before enabling broad mutation operations.
- Minimal allow‑listed seed instruction IDs (000 / 001) excluded from recursion and leakage risk metrics to guarantee a safe tool discovery baseline.
- Human confirmation persistence (`bootstrap.confirmed.json`) with token TTL enforcement and rejection reasons (`mutation_blocked`, `token_invalid`, `token_expired`).

### Added (governance & risk instrumentation)

- Recursion/leakage risk metrics capturing self‑referential or cyclic instruction body/category link detection; aggregated risk summary surfaced via governance hash pathways.
- Performance baseline tooling (`perf-baseline.mjs`, compare, trend, summary scripts) now integrated with release workflow enabling drift detection on CPU time & RSS.
- Baseline auto-confirm test helper (`forceBootstrapConfirmForTests`) gated by `INDEX_SERVER_BOOTSTRAP_AUTOCONFIRM` for legacy suite compatibility without weakening production gating semantics.

### Changed (test infrastructure)

- Global test setup (`setupDistReady.ts`) defaults `INDEX_SERVER_BOOTSTRAP_AUTOCONFIRM=1` unless explicitly disabled, restoring green for historical mutation suites while preserving a dedicated authentic gating spec.
- `bootstrapGating.spec.ts` isolated via per‑test temporary `INDEX_SERVER_DIR` ensuring real token lifecycle coverage (block → issue token → finalize → unblocked).
- Dispatcher P1 unit test adapted to force confirmation post dynamic import keeping focus on catalog ordering semantics.

### Governance (baseline change control)

- Added §14.5 BASELINE-CR (noise‑suppression allow‑list) to `INTERNAL-BASELINE.md` covering bootstrap gating, manifest lifecycle & schema validation, governance recursion guard, search/versioning, graph export enriched/mermaid variants, onboarding helper, and visibility invariant spec (early warning only).
- Updated baseline sentinel and guard allow-list (noise suppression only; minimal invariant suite unchanged per §6 baseline plan).

### Notes (1.5.0)

- Minor release justified by additive safety gating mechanism and new performance & risk instrumentation surfaces; no breaking tool schema changes.
- Production deployments must perform a one‑time bootstrap confirmation; tests emulate confirmation automatically unless deliberately disabled.
- Future hardening roadmap: elevate selected noise‑suppression specs (manifest fastload, recursion guard) to minimal invariant status via separate BASELINE-CR once semantics fully stabilized.

### Upgrade Guidance (1.5.0)

1. Pull & rebuild (`npm ci && npm run build`).
2. Start server; obtain bootstrap token via governance tool / log prompt; finalize to enable general mutation.
3. For CI deterministic runs ensure `INDEX_SERVER_BOOTSTRAP_AUTOCONFIRM=1` (unless explicitly validating gating flow) and keep `BASELINE_ENFORCE=1` for guard execution.
4. Monitor performance baseline summaries for drift (`npm run perf:drift`).

## [1.13.0] - 2026-03-27

## [1.15.0] - 2026-03-31

### Added

- Rename catalog_* MCP tools to index_*, add dashboard panel help docs, fix restore script zip support

## [1.16.2] - 2026-04-02

## [1.26.0] - 2026-04-27

### Added

- Add --init-cert CLI switch for self-signed dashboard TLS bootstrap (PR #233, issue #232)

## [1.26.2] - 2026-04-27

## [1.26.4] - 2026-04-28

## [1.26.5] - 2026-04-28

## [1.26.7] - 2026-04-30

### Added

- fix(wizard): correct Build prompt logic

## [1.26.8] - 2026-04-30

### Added

- Test stability + version parity tooling (PR #261)
## [1.28.24] - 2026-05-18

### Added

- Drop wizard PNG screenshots in favor of terminal-text facsimiles in interactive_setup_walkthrough.md
