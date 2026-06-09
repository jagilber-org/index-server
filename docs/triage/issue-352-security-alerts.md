# Security alert triage — #352

**Status**: triage plan only. This document scopes each of the 15 open alerts in the mirror repo `jagilber-org/index-server` and proposes a fix-or-dismissal disposition. Implementation lands in follow-up PRs, not this one.

**Source of truth**: fixes land in `jagilber-dev/index-server`; the mirror clears on the next publish. Code links in this document refer to paths in `jagilber-dev/index-server` HEAD.

## Disposition summary

| # | Sev | Rule | Path | Disposition |
|---|---|---|---|---|
| #15 | high | `js/xss-through-dom` | `src/dashboard/client/js/admin.graph.js:127` | **Dismiss (false positive)** — flow already mitigated by allowlist reconstruction. |
| #31 | high | `js/regex-injection` | `src/services/handlers.search.ts:349` | **Dismiss (false positive)** — input passes through `compileSafeUserRegex` / `escapeRegex`. |
| #32 | high | `js/regex-injection` | `src/services/handlers.search.ts:443` | **Dismiss (false positive)** — same mitigation path as #31. |
| #44 | high | `js/regex-injection` | `src/services/handlers.search.ts:475` | **Dismiss (false positive)** — same mitigation path as #31. |
| #53 | high | `js/incomplete-sanitization` | `scripts/build/generate-tools-doc.mjs:26` | **Dismiss (won't fix)** — build-time markdown pipe escaping over trusted registry text, not user input. |
| #54 | high | `js/disabling-certificate-validation` | `scripts/governance/validate-security-headers.mjs:65` | **Dismiss (used in tests)** — explicit `-AllowInsecureTls` flag for validating self-signed cert servers during local governance runs; never invoked in CI defaults. |
| #46 | warning | `generic-api-key` (secret scanning) | `src/tests/integration/dashboardAuth.spec.ts:103` | **Dismiss (used in tests)** — synthetic test fixture (`['integration','test','admin','key','42'].join('-')`); add a `// gitleaks:allow` comment + verified false-positive dismissal in the GHAS UI. |
| #26 | medium | CVE-2026-33750 (brace-expansion) | container scan: `/usr/local/lib/node_modules/npm/...` | **Dismiss (upstream-only)** — alert is against the Node base image's bundled `npm`, not our `node_modules`. Track Dockerfile base bump separately; once a patched Node image ships, base image update auto-clears. |
| #27 | high | CVE-2026-33671 (picomatch) | container scan | **Dismiss (upstream-only)** — same rationale as #26. |
| #28 | medium | CVE-2026-33672 (picomatch) | container scan | **Dismiss (upstream-only)** — same rationale as #26. |
| #56 | medium | CVE-2026-42338 (ip-address) | container scan | **Dismiss (upstream-only)** — same rationale as #26. |
| #9  | medium | CVE-2026-41148 | npm/mermaid (Dependabot) | **Fix** — single `npm update mermaid` (transitive consumer in dashboard). |
| #10 | medium | CVE-2026-41159 | npm/mermaid (Dependabot) | **Fix** — bundled with #9. |
| #11 | medium | CVE-2026-41149 | npm/mermaid (Dependabot) | **Fix** — bundled with #9. |
| #12 | medium | CVE-2026-41150 | npm/mermaid (Dependabot) | **Fix** — bundled with #9. |

## Detailed rationale

### Code-scanning false positives (5 of 7 high-severity)

#### #15 `js/xss-through-dom` — `admin.graph.js:127`

The flagged call is `new DOMParser().parseFromString(svgMarkup, 'image/svg+xml')`. The function `sanitizeGraphSvg` is a defense-in-depth wrapper around mermaid-rendered SVG that uses three stages:

1. parse user-supplied markup into a detached `Document`;
2. walk the parsed tree and **rebuild it as fresh `createElementNS` nodes** using `SVG_ALLOWED_TAGS` / `SVG_ALLOWED_ATTRS` allowlists (zero node-identity shared with input);
3. serialize the reconstructed tree and re-parse — explicitly severing the data-flow link CodeQL is following.

CodeQL still sees the initial `parseFromString` and flags it; the allowlist reconstruction is a known-good mitigation pattern but the static analyzer can't model the rebuild. **Action**: dismiss as "won't fix — false positive" with the rationale above; pin the comment block in the source so the dismissal stays defensible on re-scan.

#### #31 / #32 / #44 `js/regex-injection` — `handlers.search.ts`

All three flow through one of two helpers:

- `escapeRegex(s)` — escapes `[.*+?^${}()|[\]\\]`, the canonical Mozilla pattern.
- `compileSafeUserRegex(s, flags)` — wraps the same escape + a ReDoS-resistant compile.

`sanitizeKeywords` additionally bounds inputs (`length > 0`, `.slice(0, 10)`). User regex never reaches `new RegExp` un-escaped. **Action**: dismiss as "won't fix — false positive" referencing `escapeRegex` / `compileSafeUserRegex`.

### Code-scanning won't-fix (annotated)

#### #53 `js/incomplete-sanitization` — `generate-tools-doc.mjs:26`

`description.replace(/\|/g, '\\|')` escapes markdown table pipes. The input is the tool registry's `description` field — internal repo source, written by maintainers, processed at build time only. There is no untrusted-input attack surface here. The line already carries a `// lgtm[js/incomplete-sanitization]` annotation. **Action**: dismiss as "won't fix — used in tests / build only"; keep the annotation.

#### #54 `js/disabling-certificate-validation` — `validate-security-headers.mjs:65`

`rejectUnauthorized: false` is gated by the `allowInsecureTls` parameter, which is itself only set when an operator passes `-AllowInsecureTls` on the CLI to validate a server presenting a self-signed cert during local governance runs. CI default is `false`. Line already has `nosemgrep` + `lgtm` annotations explaining the opt-in. **Action**: dismiss as "won't fix — used in tests" with the existing annotation as evidence.

### Secret scanning

#### #46 `generic-api-key` — `dashboardAuth.spec.ts:103`

The value is constructed in source as `['integration','test','admin','key','42'].join('-')` and only used as the value of `process.env.INDEX_SERVER_ADMIN_API_KEY` during the integration test's `beforeAll`. There is no real credential exposure. **Action**: add `// gitleaks:allow secret synthetic test fixture` to the line, then dismiss the GHAS alert as "used in tests".

### Container-image upstream CVEs (4)

#26, #27, #28, #56 are all base-image alerts: paths begin with `/usr/local/lib/node_modules/npm/node_modules/...`, i.e. the **Node base image's bundled `npm`**, not our application's `node_modules`. None are reachable at runtime from our app. **Action**: dismiss all four as "won't fix — upstream-only" and open a separate tracking ticket for "bump Dockerfile Node base tag when a patched image ships". Re-scans after the base bump will auto-clear all four.

### Dependabot fixable (4)

#9 / #10 / #11 / #12 are mermaid CVEs. mermaid is a direct dependency of the dashboard graph view (`src/dashboard/client/js/mermaid.min.js`). All four alerts share a single fix path: `npm update mermaid` (or, if a major bump is needed, a follow-up PR with a regression test of the graph render). **Action**: ship a follow-up `chore(deps): bump mermaid to <patched-version> (refs #352)` PR. Re-scan will auto-close all four alerts.

## Definition of done (carried from #352)

- [ ] 7 source-code CodeQL alerts resolved or dismissed per dispositions above
- [ ] Secret scanning alert #46 dismissed with annotation
- [ ] mermaid upgraded; 4 Dependabot alerts auto-close
- [ ] Base-image follow-up ticket filed (#26, #27, #28, #56)
- [ ] Mirror repo `jagilber-org/index-server` shows 0 open security alerts after the next publish

## Out of scope for this PR

This PR ships **only the triage plan** so dispositions can be reviewed before code lands. Implementation will be split across:

1. `chore(deps): bump mermaid` — fixes #9, #10, #11, #12.
2. `chore(security): annotate + dismiss code-scanning false positives` — handles #15, #31, #32, #44, #53, #54, #46.
3. `chore(docker): track base-image bump for upstream CVEs` — opens follow-up tracking issue for #26, #27, #28, #56.

Each will reference `Refs #352` and the final implementer will close the umbrella once the mirror shows 0 open alerts.
