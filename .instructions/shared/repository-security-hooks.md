# Repository Security Hooks

This repo follows the canonical layered hook model:

1. Block forbidden sensitive files.
2. Scan staged text for curated PII and infrastructure patterns.
3. Scan staged text for exact loaded sensitive env var values.
4. Run standard secret and private-key scanners through `pre-commit`.
5. Run mandatory `gitleaks` scan on every commit.
6. Run mandatory `ggshield` and `Semgrep` scans before push.
7. Block unsafe pushes to public remotes.
8. Re-run the same policy in CI.

Existing repositories should adopt this pattern as a versioned delta from the template repo, not as a wholesale file replacement.

This hook model is governed by the template constitution and should stay aligned with `.github/copilot-instructions.md`, `constitution.json`, and the index-server bootstrap guidance.

Update guidance:

1. Compare the target repo against the template with `pwsh -File <template-repo>/scripts/Compare-TemplateSpec.ps1 -TargetRepoPath <repo>`.
2. Keep exact-match files aligned with the template unless there is a deliberate, recorded deviation.
3. Merge workflow and bootstrap changes without removing repo-specific CI or operational behavior.
4. Record the adopted template version in `.template-adoption.json` in the target repo.
5. Validate focused file changes first, then run the full `pre-commit` policy.

Operational guidance:

1. Use `GITGUARDIAN_API_KEY` for ggshield in local shells and CI, and ensure the value is the actual PAT secret rather than a dashboard token record ID.
2. When curated scanners match their own intentional regex definitions or synthetic placeholder values, prefer exact inline markers such as `# pii-allowlist` on the affected lines over broader allowlists.
3. When env-value leak scanning matches documented public metadata, prefer exact `env-leak-allowlist` markers on the affected lines instead of removing a detector class or broad sensitive prefix.
4. Do not classify generic GitHub Actions metadata variables as sensitive by broad prefix alone; retain exact secret-name coverage such as `GITHUB_TOKEN` and other `TOKEN`/`SECRET`/`KEY` patterns.
5. Improve diagnostics before loosening coverage. If a hook finding is hard to interpret, make the report more specific so the next change can stay narrow.
6. When changing the canonical hook scripts in this template, run `pwsh -File scripts/test-hook-regressions.ps1` before the full `pre-commit` policy so hook-specific regressions fail in a narrow, readable way.
7. The template's local default now makes `gitleaks` a mandatory `pre-commit` hook, and `ggshield` and `Semgrep` mandatory `pre-push` hooks, with environments managed by `pre-commit` rather than separate tool bootstrap.
8a. Keep the repository-owned `.ggshield.yml` exclusions aligned with the template so ggshield skips binary, dependency, and build-output directories that produce noise.
8b. Keep the repository-owned `.gitleaks.toml` path allowlist aligned with `.ggshield.yml` so both scanners skip the same directories. Adopting repos should apply equivalent exclusions to semgrep (`--exclude`) and detect-secrets (`--exclude-files`) when scanning large trees.
8c. The canonical exclusion set covers: dependency dirs (`node_modules`, `.venv`, `venv`, `vendor`, `packages`, `bower_components`), build outputs (`dist`, `build`, `obj`, `bin`, `.next`, `.nuxt`, `out`, `publish`), caches (`.cache`, `.cache_ggshield`, `.mypy_cache`, `.pytest_cache`, `coverage`, `.nyc_output`), VCS dirs (`.git`, `.hg`, `.svn`), infrastructure state (`.terraform`), lock files, and binary formats.
9. Keep the repository-owned `.gitleaks.toml` aligned with the intended local policy so developer-specific `GITLEAKS_CONFIG` environment variables do not silently change hook behavior.
9. Use `Semgrep` rather than `CodeQL` for this template's supplemental static analysis because the main implementation surfaces are PowerShell, GitHub Actions, and configuration files.
10. Treat ggshield, gitleaks, and Semgrep as complementary controls. The local layered hook model still centers on the forbidden-file, PII, env-leak, secret-scanning, and protected-remote stack.

Tool selection guidance:

1. Prefer `ggshield` as the mandatory pre-push gate for GitGuardian-managed secret scanning. Exclusions in `.ggshield.yml` keep scans focused on source files.
2. Prefer `gitleaks` as the mandatory pre-commit gate for local secret scanning on every commit.
3. Keep the current split explicit in adopter docs: `ggshield` is the better fit for managed workflows, while `gitleaks` is the better fit for broad history scanning.
4. If long-running GitGuardian history scans are still needed for a target repo, document chunking, backoff, and resume strategy explicitly rather than pretending the tools behave the same at scale.

If this pattern proves stable across projects, promote the distilled guidance into the shared instruction catalog.
