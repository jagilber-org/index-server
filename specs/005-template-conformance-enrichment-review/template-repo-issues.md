# Draft Template-Repo Enrichment Issues

These are draft issues to create in `jagilber/template-repo` after the review is
approved. They are ordered by security and long-term maintenance leverage.

## 1. Compare-TemplateSpec Must Track The Actual Template Contract

- **Created**: `jagilber/template-repo#48`

- **Suggested title**: `fix: align Compare-TemplateSpec with template-manifest and current managed surfaces`
- **Priority**: P1
- **Recommended version bump**: Patch
- **Labels**: `template-change`, `tooling`, `adoption`

### Problem

`scripts/Compare-TemplateSpec.ps1` still uses a hardcoded comparison list that
lags behind the actual `v1.16.0` template contract. It misses newer surfaces
such as:

- `.instructions/shared/git-workflow.md`
- `.semgrep.yml`
- issue forms under `.github/ISSUE_TEMPLATE/`
- `promotion-freshness.yml`
- `auto-tag.yml`

It also assumes canonical `hooks/*` entrypoints and therefore reports richer
but equivalent adopter structures as raw drift without enough context.

### Why Index-Server Exposes The Gap

Index-server adopted several `v1.16.0` surfaces that were absent from the
helper's comparison list, while the helper still reports old structural drift as
if it were the entire story. That produces both false negatives and false
positives during adoption work.

### Proposed Canonical Change

1. Make the compare helper derive or validate against the manifest's current
   managed surface instead of maintaining a stale parallel file list.
2. Support conditional or profile-based surfaces where needed.
3. Distinguish missing canonical files from equivalent but intentional adopter
   implementations.
4. Update adoption docs so compare output is described as an aid, not a perfect
   source of truth.

### Likely Files

- `scripts/Compare-TemplateSpec.ps1`
- `template-manifest.json`
- `.instructions/shared/template-adoption-workflow.md`

### Adopter Impact

Low risk and high leverage. This improves conformance signal quality without
changing runtime behavior.

---

## 2. Harden The Canonical Public-Repo Push Guard And Publish Bypass Contract

- **Created**: `jagilber/template-repo#49`

- **Suggested title**: `feat: harden pre-push public-repo guard with signed publish bypass tokens`
- **Priority**: P1
- **Recommended version bump**: Minor
- **Labels**: `template-change`, `security`, `publish`

### Problem

The canonical `hooks/pre-push-public-guard.ps1` currently allows bypass with a
simple `PUBLISH_OVERRIDE=1`. That is easy to spoof and does not prove a push is
coming from an approved publish workflow. It also does not explicitly handle
known publication-mirror remotes that should be blocked except through the
publish scripts.

### Why Index-Server Is Better Here

Index-server's guard requires a SHA-256 token derived from
`publish-<tag>-<YYYY-MM-DD>`, expects `PUBLISH_TAG`, and blocks known
publication mirrors directly. The corresponding publish scripts generate and use
the token, so casual environment-variable bypass is not sufficient.

### Proposed Canonical Change

1. Replace the boolean bypass with a signed or derived token contract.
2. Update the canonical publish scripts to emit the matching token.
3. Support explicit publication-mirror blocking semantics where the template
   repo model includes a dev-to-public flow.
4. Document migration guidance for adopters already relying on `PUBLISH_OVERRIDE=1`.

### Likely Files

- `hooks/pre-push-public-guard.ps1`
- `scripts/Publish-ToPublicRepo.ps1`
- `.instructions/shared/repository-security-hooks.md`
- `.instructions/shared/template-adoption-workflow.md`

### Adopter Impact

Medium operational impact but high security value. This should ship with clear
migration guidance and probably a transition window if backward compatibility is
needed.

---

## 3. Define A Canonical Hook Convergence Strategy For Mature Adopters

- **Created**: `jagilber/template-repo#50`

- **Suggested title**: `feat: support hook-core convergence for adopters with richer local hook logic`
- **Priority**: P2
- **Recommended version bump**: Minor
- **Labels**: `template-change`, `hooks`, `adoption`

### Problem

The canonical template assumes separate `hooks/*` entrypoints for each control.
Mature repos like index-server may have already consolidated equivalent logic
into richer `scripts/*` surfaces with additional tuning, diagnostics, or extra
pre-push gates. Today, that creates persistent structural drift even when the
security intent is aligned.

### Why Index-Server Exposes The Gap

Index-server combines forbidden-file, PII, and env-leak logic in one
repo-owned `scripts/pre-commit.ps1`, has stronger false-positive tuning, and
adds an extra repo-specific slow pre-push suite. A naive migration to the
template layout would reduce parity noise but risks losing useful hardening.

### Proposed Canonical Change

1. Introduce a documented convergence strategy for adopters with richer local
   hook logic.
2. Consider a shared hook-core plus thin `hooks/*` wrappers pattern.
3. Document how optional extra pre-push suites can coexist with the canonical
   security pre-push stack.
4. Update compare-helper expectations so equivalent wrapper-based or sanctioned
   shared-core layouts are not misclassified as unmanaged drift.

### Likely Files

- `.pre-commit-config.yaml`
- `hooks/*`
- `scripts/test-hook-regressions.ps1`
- `scripts/Compare-TemplateSpec.ps1`
- `.instructions/shared/repository-security-hooks.md`

### Adopter Impact

Moderate. This reduces long-term maintenance cost for mature repos without
forcing weaker behavior back into the canonical baseline.

---

## 4. Make Auto-Tag Optional Or Template-Source-Only

- **Created**: `jagilber/template-repo#51`

- **Suggested title**: `docs: scope auto-tag workflow as optional profile instead of universal adopter baseline`
- **Priority**: P2
- **Recommended version bump**: Minor
- **Labels**: `template-change`, `workflow`, `adoption`

### Problem

`auto-tag.yml` tags `templateVersion` changes on `main`. That is a sensible
workflow for the template source repo, but it does not generalize cleanly to
product repos that already use Git tags for release artifacts and public publish
flows.

### Why Index-Server Exposes The Gap

Index-server intentionally does not adopt `auto-tag.yml` because Git tags in
this repo represent product releases, not template-version milestones. Treating
auto-tag as mandatory baseline behavior would create policy conflict rather than
improve conformance.

### Proposed Canonical Change

1. Move `auto-tag.yml` to an optional or template-source-only profile.
2. Reflect that distinction in `template-manifest.json` and adoption guidance.
3. Ensure compare-helper and adoption metadata do not treat non-adoption of
   `auto-tag.yml` as unexplained drift in product repos.

### Likely Files

- `.github/workflows/auto-tag.yml`
- `template-manifest.json`
- `scripts/Compare-TemplateSpec.ps1`
- `.instructions/shared/template-adoption-workflow.md`

### Adopter Impact

Low risk, high clarity. This reduces false deviations for product repositories
without weakening the template source repo's own release discipline.

---

## Direct Adoption Follow-Ups In Index-Server

These are not template-repo issues, but they should be tracked locally once the
upstream backlog is filed:

1. Align `scripts/run-semgrep-pre-push.ps1` with the template's current Semgrep
   policy (`p/security-audit` + `.semgrep.yml`).
   Status: completed on `chore/template-conformance-review`.
2. Revisit the remaining low-risk exact-match or merge-review surfaces after the
   upstream issue backlog is accepted.
