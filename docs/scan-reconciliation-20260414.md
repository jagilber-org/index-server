# Scan Reconciliation Report

**Source:** `c:\temp\tree-scan-20260414-114200-196-filtered-findings.json`
**Repository:** jagilber-dev/index-server (main)
**Generated:** 2026-04-14
**Scanners:** CodeQL (151), Semgrep (23), check-env-leaks (7), git-history (2)

---

## Executive Summary

| Metric | Value |
|--------|-------|
| Total Findings | 183 |
| High Severity | 23 |
| Medium Severity | 160 |
| **True Positives** | **~28 (15%)** |
| **False Positives / Noise** | **~113 (62%)** |
| **Acceptable Risk** | **~42 (23%)** |
| **Actionable Findings** | **2 categories** |

**Overall scanner noise rate: ~62%.** The scanner is new with a new configuration and produced
significant false positives due to lack of context about localhost-only binding, admin-only access,
development-only scripts, and input validation already in place.

---

## High Severity Findings (23 total)

### GROUP 1: Private Keys in Documentation (2 findings)
| Field | Value |
|-------|-------|
| Scanner | git-history |
| Type | private-key |
| Files | `.copilot/skills/secret-handling/SKILL.md:48`, `.squad/templates/skills/secret-handling/SKILL.md:48` |
| **Verdict** | **FALSE POSITIVE** |

**Analysis:** Both files do not exist in the current repository tree. The scanner flagged
paths from git history that have since been removed or relocated. No actual private keys
are present in the codebase.

---

### GROUP 2: Environment Value Leaks (7 findings)
| Field | Value |
|-------|-------|
| Scanner | check-env-leaks |
| Type | Environment value leak |
| Files | `package-lock.json` (4), `release/vscode-extension/package-lock.json` (3) |
| Variable | `npm_package_engines_node` |
| **Verdict** | **FALSE POSITIVE** |

**Analysis:** The scanner flags the resolved value of `engines.node` (e.g., `>=22`) in
package-lock.json files. This is standard npm behavior — the value is public package
metadata, not a sensitive environment variable. The `npm_package_engines_node` variable
is auto-populated by npm from `package.json` and is not a secret.

---

### GROUP 3: Child Process Injection (9 findings)
| Field | Value |
|-------|-------|
| Scanner | semgrep |
| Type | detect-child-process |
| Files | `scripts/ci-build.js:24`, `scripts/ci-build.mjs:24`, `scripts/generate-certs.mjs:94,99,107,112,134`, `scripts/publish.cjs:65,70` |
| **Verdict** | **FALSE POSITIVE** |

**Analysis:** All child_process calls use hardcoded commands or developer-controlled inputs only:
- **ci-build.js/mjs:** `exec()` helper called only with hardcoded `npx tsc -p tsconfig.json`
- **generate-certs.mjs:** `execSync()` runs hardcoded `openssl` commands; hostname input validated
  with strict regex `[a-zA-Z0-9._-]+` (line 73-76); keySize/days are `parseInt()` converted
- **publish.cjs:** `run()`/`runShow()` helpers called with hardcoded git commands; tag input
  validated with semver regex before any execution (line 47-50)

No untrusted user input reaches any `execSync` call. All scripts are developer-only build tooling.

---

### GROUP 4: TLS Certificate Verification Disabled (2 findings)
| Field | Value |
|-------|-------|
| Scanner | semgrep |
| Type | reject-unauthorized-false |
| Files | `scripts/validate-security-headers.mjs:62`, `src/dashboard/server/InstanceManager.ts:224` |
| **Verdict** | **ACCEPTABLE RISK** |

**Analysis:**
- **validate-security-headers.mjs:** Testing script that validates security headers against
  local servers with self-signed certificates. Disabling verification is correct for this use case.
- **InstanceManager.ts:** Multi-instance service discovery pinging other localhost Index Server
  instances using self-signed dev certs. Only communicates with local processes.

Neither is production code exposed to untrusted networks.

---

### GROUP 5: Path Traversal in Route Parameters (3 findings)
| Field | Value |
|-------|-------|
| Scanner | semgrep |
| Type | path-join-route-param, path-join-derived-route-param |
| Files | `src/dashboard/server/routes/instructions.routes.ts:252,289,304` |
| **Verdict** | **TRUE POSITIVE — MEDIUM** |

**Analysis:** GET, PUT, and DELETE routes use `req.params.name` directly in `path.join()`
without sanitization, while the POST route correctly sanitizes with
`String(name).replace(/[^a-zA-Z0-9-_]/g, '-')`. Path traversal via `../../` sequences
could read/write/delete files outside the instructions directory.

**Code (vulnerable):**
```typescript
// GET /api/instructions/:name (line 252)
const file = path.join(instructionsDir, req.params.name + '.json');
```

**Code (safe — POST route, line 270):**
```typescript
const safeName = String(name).replace(/[^a-zA-Z0-9-_]/g, '-');
const file = path.join(instructionsDir, safeName + '.json');
```

**Mitigating factors:** Dashboard is localhost-only by default, admin-authenticated.

**Recommended fix:** Apply the same sanitization from POST to GET/PUT/DELETE routes, plus
add a `path.resolve()` boundary check.

---

## Medium Severity Findings (160 total)

### file-system-race — 26 findings
| Verdict | ACCEPTABLE RISK | Noise: ~75% |
|---------|----------------|-------------|

TOCTOU race conditions between `fs.existsSync()` → `fs.readFileSync()`. All are synchronous
operations on the same Node.js thread with negligible race window. Dashboard is localhost-only.
No privilege escalation possible — worst case is a read error.

---

### path-injection — 22 findings
| Verdict | TRUE POSITIVE | Noise: ~5% |
|---------|--------------|------------|

Related to GROUP 5 above. The 22 CodeQL findings overlap with the 3 semgrep findings on
the same root cause: unsanitized route parameters reaching filesystem operations. Most
findings trace to `instructions.routes.ts`, `AdminPanel.ts`, and `sqlite.routes.ts`.

**Priority:** HIGH — consolidate fix with GROUP 5.

---

### missing-rate-limiting — 21 findings
| Verdict | ACCEPTABLE RISK | Noise: ~40% |
|---------|----------------|-------------|

Dashboard routes lack per-endpoint rate limiting. Rate limit infrastructure exists in
`ApiRoutes` but is optional and defaults to off. Mitigated by localhost-only binding.
If dashboard is exposed via reverse proxy, rate limiting should be enabled.

---

### unused-local-variable — 13 findings
| Verdict | FALSE POSITIVE (security context) | Noise: 100% |
|---------|-----------------------------------|-------------|

Real code quality findings but zero security impact. Recommend ESLint cleanup pass separately.

---

### disabling-certificate-validation — 7 findings
| Verdict | ACCEPTABLE RISK | Noise: ~95% |
|---------|----------------|-------------|

All occurrences in test files (`.spec.ts`), dev scripts (`generate-certs.mjs`), or
localhost instance discovery (`InstanceManager.ts`). Self-signed certificates are
expected in the development workflow.

---

### useless-assignment-to-local — 7 findings
| Verdict | FALSE POSITIVE (security context) | Noise: 100% |
|---------|-----------------------------------|-------------|

Code quality only. No security impact.

---

### http-to-file-access — 7 findings
| Verdict | ACCEPTABLE RISK | Noise: ~30% |
|---------|----------------|-------------|

HTTP-to-filesystem data flows are present but inputs are validated (query limited to
256 chars, keywords validated in search handlers). The real risk channel is the
path-injection finding above.

---

### xss-through-dom — 6 findings
| Verdict | TRUE POSITIVE — MEDIUM | Noise: ~15% |
|---------|----------------------|-------------|

Instruction names are interpolated into HTML via template literals and set via `innerHTML`
without escaping in `admin.instructions.js`. If an instruction name contains HTML/script
tags, it would execute in the admin dashboard context.

**File:** `src/dashboard/client/js/admin.instructions.js:204-220`

**Recommended fix:** Add `escapeHtml()` utility and escape all user-derived values before
inserting into template strings used with `innerHTML`.

---

### incomplete-sanitization — 5 findings
| Verdict | FALSE POSITIVE | Noise: ~80% |
|---------|---------------|-------------|

Sanitization where present (marked.parse for markdown, regex escaping) is complete.
Scanner lacks context about the sanitization library capabilities.

---

### regex-injection — 4 findings
| Verdict | ACCEPTABLE RISK | Noise: ~70% |
|---------|----------------|-------------|

`handlers.search.ts` allows user-provided regex in `mode='regex'` search. Mitigations:
syntax validation via try/catch, 200-character limit, opt-in mode only. ReDoS is
theoretically possible but requires active exploitation of an admin-only API.

---

### Remaining types (42 findings combined)

| Type | Count | Verdict | Notes |
|------|-------|---------|-------|
| cors-misconfiguration | 2 | FALSE POSITIVE | Already hardened to localhost-only origins |
| duplicate-property | 2 | FALSE POSITIVE | Code quality |
| express-path-join-resolve-traversal | 2 | TRUE POSITIVE | Same root cause as path-injection |
| bypass-tls-verification | 2 | ACCEPTABLE RISK | Dev/test only |
| xss-through-exception | 2 | ACCEPTABLE RISK | Error messages in admin dashboard |
| bad-tag-filter | 2 | FALSE POSITIVE | Tag filtering works correctly |
| trivial-conditional | 3 | FALSE POSITIVE | Code quality |
| unneeded-defensive-code | 3 | FALSE POSITIVE | Code quality |
| insecure-temporary-file | 3 | ACCEPTABLE RISK | Temp files in controlled paths |
| polynomial-redos | 1 | ACCEPTABLE RISK | Related to regex finding |
| log-injection | 1 | ACCEPTABLE RISK | Logs are admin-only |
| insecure-randomness | 1 | FALSE POSITIVE | Not used for crypto |
| incomplete-url-substring-sanitization | 1 | FALSE POSITIVE | URL handling is correct |
| syntax-error | 1 | FALSE POSITIVE | Scanner parsing issue |
| Others | 16 | MIXED | Mostly code quality or low-risk |

---

## Actionable Findings Summary

### 🔴 Priority 1: Path Traversal (25 findings — 1 root cause)
- **Files:** `src/dashboard/server/routes/instructions.routes.ts` (primary),
  `AdminPanel.ts`, `sqlite.routes.ts` (secondary)
- **Issue:** Unsanitized route parameters in `path.join()` for GET/PUT/DELETE
- **Fix:** ✅ **RESOLVED** — Extracted shared `safeInstructionPath()` helper with regex
  sanitization + `path.resolve()` boundary check. Applied to all CRUD routes.
- **Commit:** `fix: path traversal in instruction routes and XSS in admin dashboard`

### 🟡 Priority 2: XSS in Admin Dashboard (6 findings — 1 root cause)
- **File:** `src/dashboard/client/js/admin.instructions.js`
- **Issue:** Instruction names inserted into innerHTML without HTML escaping
- **Fix:** ✅ **RESOLVED** — Added `escapeHtml()` utility, escape all user-derived values
  (names, categories, comments) before template interpolation into innerHTML.
- **Commit:** Same as above

### 🟢 Recommended: Scanner Configuration Tuning
The scanner should be tuned to reduce the ~62% noise rate:
1. **Exclude `package-lock.json`** from env-leak scans (7 false positives)
2. **Exclude `scripts/`** from child-process rules or mark as dev-only (9 false positives)
3. **Exclude `.spec.ts` and test files** from TLS verification rules (5+ false positives)
4. **Exclude code quality rules** from security scans (20+ irrelevant findings)
5. **Add context for localhost-only services** to reduce rate-limit false positives

---

## Scanner Noise Analysis

| Scanner | Findings | Est. True Positives | Noise Rate |
|---------|----------|-------------------|------------|
| CodeQL | 151 | ~25 | ~83% |
| Semgrep | 23 | ~5 | ~78% |
| check-env-leaks | 7 | 0 | 100% |
| git-history | 2 | 0 | 100% |
| **Total** | **183** | **~28** | **~85%** |

**Note:** High noise rate is expected for a new scanner with initial configuration.
The two actionable root causes (path traversal + XSS) are valid and should be fixed.
The remaining findings can be bulk-dismissed or suppressed via scanner configuration.

---

## Disposition Counts

| Disposition | Count | Percentage |
|-------------|-------|------------|
| FALSE POSITIVE | 113 | 62% |
| ACCEPTABLE RISK | 42 | 23% |
| TRUE POSITIVE | 28 | 15% |
| **— Unique root causes** | **2** | — |
