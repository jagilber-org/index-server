# Design review and action plan — 2026-09-01

> Read-only design review of `main` at `5c674fb` (v1.40.0), checked in at the
> owner's explicit request (`.instructions/local/project-context.md` otherwise
> keeps triage reports out of `docs/`). Every number was measured in the
> review session with the command noted; citations are `file:line` at that
> commit. The two P0 items were re-verified by hand at source after the
> reviewers reported them.
>
> **Corrected 2026-09-03 after review.** A five-reviewer squad review found
> several citations in the first draft wrong. Every claim in the corrected
> items was independently re-measured against `5c674fb` — not taken from the
> review — and the wrong details fixed in place: P0.1's line range, P0.2's
> scope and `guard()` counts, P0.3's importer claim, P0.6's gating, and two
> span end-anchors. No finding was withdrawn; all of them survived. Where the
> corrected number differs from the reviewers' number it is flagged inline.
> The document stays pinned to `5c674fb`.

## Verdict

The core is sound: stdout is protocol-clean, config reads are concentrated in
`src/config`, search scoring is pure over an internal params type, the storage
abstraction is honest, and `registerHandler` gives every tool correlation,
timing and metrics in one place. The unit lane is a real inner loop (1,644
passing + 6 skipped in 12.6 s, no build). What has drifted is **the enforcement
layer around that core**: two governance guards cannot fail, the read-only
runtime flag is not read-only, declared input schemas are never applied on the live
path, and roughly 2,400 LOC of dashboard scaffolding plus ~40 scripts have no
callers. Docs and CI describe an older, `jagilber-org`-hosted shape of the repo.

Sizing: P0 = a gate that lies or a runtime guard that does not hold; P1 = a
seam every change pays for; P2 = hygiene and drift. One PR per item unless noted.

## P0 — guards that do not hold

**P0.1 `guard:env` scans zero files.** `scripts/governance/enforce-config-usage.ts:24`
`repoRoot = path.resolve(__dirname, '..')` resolves to `scripts/`; line 28 then
scans `scripts/src`, which does not exist (`ls scripts/src` → No such file);
line 107 `if(fs.existsSync(d))` skips it silently and the script prints
`Configuration usage enforcement passed`. It is wired into `build:verify` and
`guard:all` (`package.json`). It would fail if it ran: `src/config/featureConfig.ts:94-253`
has 23 `process.env.INDEX_SERVER_*` reads (23 distinct variables on 23 lines;
24 textual occurrences, since `:184` reads `INDEX_SERVER_AUTO_SEED` twice) and
only `runtimeConfig.ts` is allow-listed (`:33`). Second bug: the write filter at `:90`,
`/process\.env\.[A-Z0-9_]+\s*=/`, also matches `===`.
Fix: `path.resolve(__dirname, '..', '..')`; allow-list `featureConfig.ts` and
`serverConfig.ts`; write regex `\s*=(?!=)`; assert `files.length > 0` so an
empty scan is red.

**P0.2 `INDEX_SERVER_MUTATION=0` is not a read-only runtime.** Two independent
holes. The first draft of this item described only the first; the second is
larger, and closing only the first would leave an operator believing in a
read-only mode they do not have.

*Hole 1 — a client parameter.* `guard()`
(`src/services/handlers/instructions.shared.ts:155-163`) reads `p._viaDispatcher`
from the params object and skips the read-only check when it is truthy
(`:157-158`). The dispatcher sets that flag internally
(`instructions.dispatcher.ts:298`), but `src/server/sdkServer.ts:218-236` passes
`req.params.arguments` straight to `getHandler(name)(args)` (`:221`, `:233`); a
grep for `_viaDispatcher` outside the dispatcher and `shared.ts` returns
nothing, so no layer strips it. Any client can call `index_add` with
`{"_viaDispatcher": true, …}` under the read-only runtime.

*Hole 2 — the dispatcher is not gated on the flag at all.* Even with
`_viaDispatcher` stripped, `INDEX_SERVER_MUTATION=0` today means only "direct
mutation tools off, dispatcher-mediated mutation still on". When the flag is
off and the resolved target is a mutation method,
`instructions.dispatcher.ts:253-271` does not refuse: it sets a
`mutationEnabled:false` + `mutationHint` annotation on the outbound response
and **proceeds with the write** — the comment at `:254-265` states this is
deliberate ("we DO still proceed", issue #358). `guard()`'s own error text at
`:159` hands the caller the route: "Use index_dispatch with an action parameter
instead of direct … calls". And `index_dispatch` is in `STABLE`
(`toolRegistry.ts:527`), not `MUTATION` (`:528`). So
`index_dispatch {"action":"add", …}` writes under `INDEX_SERVER_MUTATION=0`,
no `_viaDispatcher` needed. Constitution S-3 (`constitution.md:50`, severity
`error`) says operators "MUST use INDEX_SERVER_MUTATION=0 when they need an
explicit read-only runtime". The runtime does not deliver that.

Also: 14 of 67 `registerHandler` calls use `guard()`, leaving 15 of the 29
`MUTATION` names registered bare — `feedback_manage`, `manifest_refresh`,
`manifest_repair`, `promote_from_repo`, `bootstrap_request`,
`bootstrap_confirmFinalize`, six `messaging_*`, three `diagnostics_*` — and
`handlers.messaging.ts:28-35` wraps registration in a local shim that checks
only `messaging.enabled`. `index_archive`, `index_restore` and
`index_purgeArchive` *are* guarded, contrary to the first draft: `guard(` sits
on the line after `registerHandler(`
(`instructions.archive.ts:41-43, 89-91, 125-127`), so a same-line grep misses
them. Counted with a match spanning three lines, not one.

**Decide before fixing.** The two holes share one root question, and the answer
changes the fix. State it explicitly:

- **(a) Make `INDEX_SERVER_MUTATION=0` genuinely read-only.** The dispatcher's
  `mutationMethods` branch at `:253` must `return { error:'mutation_blocked', … }`
  the way `:301-306` already does for bootstrap/reference gating, instead of
  annotating and proceeding; and `index_dispatch` must be gated on its
  **resolved target**, not on its own name. This reverses the stated #358
  design intent and will break existing dispatcher mutation tests — knowingly.
- **(b) Amend S-3** to say what is true, and name the control that actually
  enforces read-only: `isReferenceMode()` (`bootstrapGating.ts:49`). That one
  *is* enforced on the dispatcher path — `mutationGatedReason()`
  (`bootstrapGating.ts:85-89`) returns `reference_mode_read_only`, and
  `dispatcher.ts:301-306` returns `mutation_blocked` before the handler runs.

Either is defensible. Leaving it unstated is not.

Fix (after that decision): enforce mutation gating once inside
`registry.ts:registerHandler` using `MUTATION.has(name)`; carry "called via
dispatcher" in an internal call context (AsyncLocalStorage, as
`runWithCorrelation` already does), never in client-controlled params. Note
that `MUTATION.has('index_dispatch')` is **false**, so `registerHandler`
gating alone does not close hole 2 — the dispatcher needs its own
resolved-target check, or the bypass survives the fix.
Regression spec, both cases, over the wire under `INDEX_SERVER_MUTATION=0`:
(1) `index_add` with `_viaDispatcher:true` expects `-32601`; (2)
`index_dispatch {"action":"add", …}` asserts the entry is **not written to
disk** afterwards. Assertion (2) must check disk, not response shape — a
response-shape assertion goes green against today's annotate-and-write
behaviour and would certify a bypass as closed while it is open.

**P0.3 Declared input schemas are never validated on the live path.**
`INPUT_SCHEMAS` (`src/services/toolRegistry.ts:105`) are compiled by
`validationService.validateParams` (`validationService.ts:51,91`), whose only
caller is `src/server/transport.ts:280`. `transport.ts` (315 LOC, its own
`registerHandler`/`getHandler` at `:68/:85`) has zero importers outside two
coverage specs. `toolRegistry.zod.ts` (519 LOC) has **one** non-test importer —
`validationService.ts:5` imports `getZodEnhancedRegistry` and `:49` calls it
inside `buildValidator`, i.e. on the very path described above; only its
`getZodSchema`/`hasZodSchema` exports have no non-test callers. (The first
draft said "zero non-test importers", which would have handed a future author
a false premise for deleting the module this item's own fix depends on.) Live
`tools/call` does `getHandler(name)` → `handler(args)` with no schema check.
Fix: call `validateParams(name, args)` in `sdkServer` `tools/call` (or inside
`registerHandler`); delete `transport.ts` and its two coverage specs — and in
the same PR drop `'src/server/transport.ts'` from the coverage exclude list at
`src/vitest.config.ts:14`, or the config points at a file that no longer
exists; keep `toolRegistry.zod.ts` (it is live) and decide deliberately about
its two unused exports.

**P0.4 `check:dist` cannot fail.** `dist/` is gitignored (`.gitignore:42`),
`git ls-files dist` → 0, zero commits ever; `check:dist` is
`npm run build && git diff --quiet --exit-code dist`, which is always quiet on
an untracked directory. It runs as a gate in `coverage-dist.yml:33` and
`ci-enhanced.yml:229`, and `docs/configuration.md:395` documents it as a guard.
Fix: delete the script and both workflow steps, or compare a build hash
against a committed sentinel; fix `docs/configuration.md:395-407`.

**P0.5 `npm run guard:all` fails on `main`.** Exit 1 in 2.5 s:
`Missing INTERNAL-BASELINE.md` from `scripts/governance/guard-baseline.mjs:15-17`;
the file has no commits. `baseline-sentinel.mjs:12` and
`scripts/hooks/commit-msg-baseline.mjs:4` also reference it. `guard:all` is
invoked by no workflow, so nobody sees it.
Fix: delete `guard-baseline.mjs`, `baseline-sentinel.mjs`,
`commit-msg-baseline.{mjs,ps1}` and their four `package.json` scripts, or
restore the file; then put `guard:all` in `ci.yml` so it can go red where
someone looks.

**P0.6 Write down which checks actually gate on this remote.** 11 workflows
trigger on `pull_request` (the first draft said 12; it counted
`ci-enhanced.yml`, which references `github.event_name == 'pull_request'` in
job conditions but has no `pull_request:` trigger). Nine of the 11 are job-gated
on `github.repository_owner == 'jagilber-org'` (`ci.yml:21`,
`coverage-dist.yml:20`, `docker-build.yml:41,178`, `governance-hash.yml:16`,
`instruction-bootstrap-guard.yml:17`, `instruction-governance.yml:17`,
`manifest-verify.yml:16`, `security-tier1.yml:34`,
`setup-wizard-e2e.yml:33,54,76`) and are skipped on every `jagilber-dev` PR.
The other two, `ci-self-hosted.yml:22` and `precommit.yml:18`, run only when
`vars.SELF_HOSTED_RUNNER == 'true'` — which is set here, so `build-test` and
`pre-commit` are the only checks that actually execute; `precommit.yml:92`
additionally skips four pre-push hooks on this owner.

**There are zero unconditional PR gates on this remote.** The first draft named
`setup-wizard-e2e.yml` and `security-tier1.yml` as unconditional; both are
owner-gated exactly like the rest. `security-tier1.yml` is a single job behind
`:34` and concluded `skipping` on #553, #554 and #555 (`gh pr checks`).
`setup-wizard-e2e.yml` is the one partial exception and does not rescue the
picture: two of its five jobs (`clean-install-smoke:202`, `server-crud:227`)
carry no owner condition, but the workflow is `paths:`-filtered to six
`scripts/**` and `src/server/index-server.ts` paths (`:5-11`), so it did not
trigger on any PR in this round. Two runners are registered
(`gh api …/actions/runners` → 2).
Fix: a table in `.instructions/local/` of required checks per owner, and a
`ci.yml` fast job with no owner condition. This is *more* urgent than the first
draft implied, not less — with the two named "unconditional" gates removed,
nothing on this remote gates a PR except the two self-hosted jobs.

## P1 — seams every change pays for

**P1.1 One handler contract.** Two error channels across 31 handler files:
`throw new Error(` ×50, `return { error: … }` ×25 (a 200-OK result carrying an
error), `semanticError(` ×5, `throw { code }` ×1; `sdkServer.ts:241-251` wraps
non-coded throws as `-32603 "Tool execution failed"`, so callers cannot tell
not-found from crash without parsing text. Validation is per handler
(`handlers.messaging.ts:72,108` zod `safeParse`; `instructions.add.ts`
hand-rolls 194 branch tokens). Combine with P0.2/P0.3: `registerHandler` does
schema validation, mutation gating, and maps `semanticError` codes; lint
forbids `return { error }`.

**P1.2 Split the three monoliths.**
| Function | Span | Branch tokens |
|---|---|---|
| `IndexLoader.load()` `src/services/indexLoader.ts:100-779` | 680 lines (inner loop 446) | 114 |
| `index_add` closure `src/services/handlers/instructions.add.ts:25-641` | 617 | 194 |
| `handleInstructionsSearch` `src/services/handlers.search.ts:705-955` | 251 | 75 |
`index_add` is one unnamed arrow, testable only through the tool. Split
`load()` into read → validate → salvage → manifest; extract `index_add` into
normalize → validate → persist → verify → respond. `handlers.search.ts` is
1,008 lines, 8 over the CQ-1 hard limit.

**P1.3 Persistence has one truth and three write paths.**
`indexContext.writeEntry` (`indexContext.ts:574-580`) branches
`store ? store.write() : atomicWriteJson()`, but `createStore` always returns a
store (`factory.ts:54-75`, default `json`), so the file branch and the
post-write read-back (`:583`) look dead. One step in that argument is not shown
and must be established before anyone deletes the fallback: the branch tests
`getStoreForDir()`, not `createStore()`, and `getStoreForDir`
(`indexContext.ts:55-61`) returns `null` when `createStore` **throws**. Prove
that catch is unreachable first. `_manifest.json` is written only by
`IndexLoader.load()` (`indexLoader.ts:724`) and `indexContext`; `JsonFileStore`
never touches it and `materializeWrittenEntry` (`:193-210`) mutates memory in
place, so the manifest lags every write until the next full reload. In sqlite
mode each `getStoreForDir` call constructs `new SqliteStore` →
`new DatabaseSync` (`sqliteStore.ts:156-157`) with no `.close()` at any of 11
call sites. `writeEntry`/`writeEntryAsync` (`:545-637`) and
`ensureLoaded`/`ensureLoadedAsync` (`:211-373`) are sync/async twins (27 and
117 diff lines) so every consistency fix is made twice.
Fix: cache one store per directory in `indexContext`; delete the dead file
branch; let the store own manifest updates; collapse the twins to one path.

**P1.4 A composition root instead of module globals.** 81 top-level
`let`/`new Map`/`new Set`/`Record = {}` across `src/services`
(`indexUsage.ts` 12, `indexContext.ts` 10, `tracing.ts` 9) plus 8 `globalThis`
slots (`indexLoader.ts:132`); `index-server.ts` imports 27 modules for side
effects; `registry.ts:14-19` holds the handler table as globals; three exported
`_reset*ForTests` hooks exist only for tests. Wrap per-process state in one
`IndexRuntime` created in `main()` (`index-server.ts:582-742`, 161 lines) and
pass it in; side-effect registration can stay.

**P1.5 One compiled instruction validator.** Six `new Ajv` instances
(`schemas/instructionSchema.ts:124`, `indexLoader.ts:136,711`,
`loaderSchemaValidator.ts:15`, `mcpConfig/validate.ts:29`,
`validationService.ts:9`); `writeEntry` runs `assertValidInstructionRecord`
and `validateForDisk` back to back (`indexContext.ts:556,567`), each compiling
`instruction.schema.json` separately. Export one from `src/schemas`.

**P1.6 Hidden-but-callable tools.** Registered but absent from
`STABLE ∪ MUTATION`, so absent from `tools/list` yet callable via `tools/call`:
`dashboard_config` (`handlers.dashboardConfig.ts:361`), `diagnostics_handshake`
(`handlers.diagnostics.ts:84`), `test_primitive` (`handlers.testPrimitive.ts:4`,
test-only, shipped in the bundle). Gate `tools/call` on registry membership;
move `test_primitive` to tests.

## P2 — dead weight and drift

**P2.1 Dead dashboard modules (~2,400 LOC).** Zero importers, production or
test: `src/dashboard/analytics/BusinessIntelligence.ts` (764, "Executive
dashboards with KPI… format: 'currency'"), `security/SecurityMonitor.ts` (705,
"data_breach_attempt | injection_attack"), `export/DataExporter.ts` (839),
`integration/APIIntegration.ts` (127). Coverage already excludes
`src/dashboard/**` (`vitest.config.ts:56`). Delete. Also
`src/utils/BufferRingExamples.ts` (235 LOC, zero importers) and zero-importer
exports `indexContext.markindexDirty`, `stopIndexVersionPoller`,
`setEmbeddingEvictionHook`, `updateArchivedEntry`, `toolRegistry.resolveActiveTier`.

**P2.2 Scripts.** 168 files; 19 same-basename pairs across languages
(`security-scan.{mjs,ps1}`, `commit-msg-baseline.{mjs,ps1}`,
`pretest-build-or-skip.{mjs,ps1}`, `pre-commit`, `pre-push`, `bump-version`,
`setup-hooks`…), three `.mjs` files self-declare "replaces the .ps1" while the
`.ps1` stays tracked; root/`build/`/`deploy/` duplicates
(`Invoke-ReleaseWorkflow.ps1`, `Load-RepoEnv.ps1`, `New-CleanRoomCopy.ps1`,
`Publish-ToMirror.ps1`, `publish-direct-to-remote.cjs`) and a `scripts/dist/`
mirror; 44 unreferenced by basename, largest true orphan
`scripts/validate-configs.mjs` (247 LOC). `package.json` `test:diag`,
`test:stress:focus`, `test:property` name 7 spec files that do not exist;
`vitest.config.ts:29-33` excludes `_park/` and `_legacy/` dirs that do not
exist. `.instructions/local/project-context.md:12` points at
`scripts/pre-commit.ps1` (actual `scripts/hooks/pre-commit.ps1`).
Fix: delete each `.ps1` with a declared `.mjs` replacement; one path per
script; drop the three dead npm scripts and the phantom excludes.

**P2.3 Test tiers.** `src/tests` 413 files / 70,053 LOC vs 61,326 real
non-test LOC (1.14:1). 54 specs spawn processes, 40 need built `dist/`, so
`npm test` runs a full `tsc` build first (`pretest-build-or-skip.mjs:19`).
The fast/slow split is a hand list (`scripts/testing/slow-tests.mjs`, 31
paths; `test-fast.mjs:24-45` hard-codes 18 more) and
`docs/testing_strategy.md:57-63` lists 5. The "minimal invariant suite"
(`createReadSmoke.spec.ts`, `instructionsAddNegative.spec.ts`) is on the slow
list, so the smoke test is excluded from `npm test`.
`vitest.config.unit.ts:15-35` excludes 18 files under `src/tests/unit/` that
its own comments call server-spawning. Fix: tag slow specs in-file; move the
18 to `src/tests/integration/`; put the smoke pair in fast; reconcile the
strategy doc.

**P2.4 Generated schema churns on every build.** `schemas/index-server.code-schema.json`
was already dirty on `main` before the review (116+/110−, every hunk a
`"line": N` shift) and `npm run build` rewrites it. Strip `line` from the
emitted schema or untrack it.

**P2.5 Docs.** 36 of 62 markdown files under `docs/` are reachable from
neither README nor `docs/docs_index.md` (last changed 2026-07-17), including
`testing_strategy.md`, `messaging.md`, `security_guards.md`,
`release-checklist.md`, all five `docs/panels/*.md`, `docs/triage/*`, and
`docs/PR330-REMEDIATION.md` (2026-05-09, unchecked checklist at `:88-149`).
`docs/architecture.md:3` says "Updated for 1.24.0" (current 1.40.0), omits
`src/lib`, `src/minimal`, `src/perf`, `src/versioning`, and calls the
dashboard "read-only visualization" (`:99`) while
`src/dashboard/server/routes/*` has 662 LOC of mutation routes.
`docs/migration/dashboard-config-v2.md` duplicates
`.instructions/local/dashboard-config-v2.md`. Fix: regenerate `docs_index.md`
from `git ls-files docs` in CI and fail on orphans; move `triage/` and
`PR330-REMEDIATION.md` out per the local instruction; refresh architecture §
headings from `ls src`.

**P2.6 Stale baselines and stray files.** `tests/outputs/flake-baseline.json`
is still the template (`"generatedAt": "${ISO_TIMESTAMP}"`, `files: []`);
`coverage-baseline.json`, `.github/zap-baseline-rules.tsv`, and all 10
Playwright snapshots last committed 2026-04-11; `ui-drift.yml` is
`workflow_dispatch` only, so snapshots never run. Tracked ad-hoc files:
`tests/temp-dashboard.js`, `tests/debug-memory.js`, six `tests/test-*.js`,
`tests/portable-mcp-client.zip`, `test-artifacts/mcp-tool-sweep-*` (dir not
ignored). Delete or move to `scripts/dev/`.

**P2.7 CI boilerplate.** 27 workflows: `actions/checkout` ×41,
`setup-node` ×36, `npm ci` ×37, six identical `node-version: [22]` matrices,
no `workflow_call`. Factor one composite setup action.

**P2.8 Small layering items.** `src/config/runtimeConfig.ts:439-440` re-exports
from `src/services/mcpConfig/flagCatalog` (config → services; no cycle, but
against CQ-3) — move the catalog to `src/config`. 21 `handlers.*.ts` files
coexist with 10 `handlers/instructions.*.ts`; `handlers.instructions.ts` is a
13-line barrel of side-effect imports — pick one layout. `index_dispatch`
rewrites args (`remove` id→ids, `add` flattening) so the dispatcher and the
standalone tools accept different shapes for the same handler — document one
as canonical.

## What is done well

- stdout is protocol-clean: 7 `console.*` calls in `src/services`+`src/server`,
  all inside logger modules; 136 `process.stderr.write` sites; every
  `process.stdout.write` is a JSON-RPC frame, CLI JSON output, or the gated
  keepalive (`index-server.ts:631`).
- Config discipline is real despite the broken guard: 73 of 87 `process.env`
  reads are in `src/config`, composed by `runtimeConfig.ts:41`.
- Search scoring (`calculateRelevance`, `performSearch`,
  `performStructuralSearch`) is pure over `InternalSearchParams`; mode
  selection is one expression with semantic→keyword fallback.
- Storage abstraction is honest: `IInstructionStore`/`factory.ts`, sqlite
  behind an explicit EXPERIMENTAL warning with `BEGIN IMMEDIATE` transactions
  and no filesystem dual-writes.
- `registerHandler` (`src/server/registry.ts:33-126`) already centralizes
  correlation, timing, metrics and error classification — the right hook for
  P0.2/P0.3/P1.1.
- `npm run test:unit`: 1,644 passed + 6 skipped (1,650) across 177 passed +
  1 skipped (178) files, 12.6 s, no build; `guard:skips` clean;
  dashboard optional, loopback-bound, never imported by services; actions
  SHA-pinned; release has one front door with public-mirror delivery kept
  human-only.

## Order

1. P0.1, P0.2, P0.3 this week — they are small and each turns a lying or
   missing guard into a real one. P0.2 gets a wire-level regression spec, and
   its decision (a) or (b) is made before code is written. Sequencing caveat:
   P0.2's mutation gating, P0.3's `validateParams` call and P1.1's error
   mapping all land inside `registerHandler`/`tools/call`. Ship P0.2 and P0.3
   in one PR, or land P0.2 first and rebase P0.3 onto it — do not run them in
   parallel.
2. P0.4, P0.5, P0.6 together as a "CI tells the truth" PR.
3. P1.1 + P1.6 on the `registerHandler` hook, then P1.5.
4. P1.3 (store caching and manifest ownership) before P1.2 (`load()` split),
   since the split lands on the write path.
5. P1.4 last in P1; it touches every service.
6. P2.1–P2.2 immediately (deletions, low risk); P2.3–P2.8 as gaps open.
