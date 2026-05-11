# scripts/build

Build, release, schema generation, and publishing tools. Scripts here produce
artifacts — compiled output, docs, schemas, manifests — and drive the release
pipeline. Most are wired to `npm run` tasks or called by `Invoke-ReleaseWorkflow.ps1`.

## Scripts

| Script | Purpose |
|--------|---------|
| `build.ps1` | Full build wrapper: `tsc` + asset copy |
| `ci-build.mjs` | CI-mode build with strict exit codes |
| `bump-version.mjs` | Bump `package.json` version; commits and tags |
| `bump-version.ps1` | PowerShell wrapper around `bump-version.mjs` |
| `copy-dashboard-assets.mjs` | Copy dashboard HTML/JS/CSS into `dist/` |
| `generate-certs.mjs` | Generate self-signed TLS certs for local HTTPS |
| `generate-drift-report.mjs` | Compare current schema vs last snapshot; report drift |
| `generate-manifest.mjs` | Regenerate `schemas/manifest.json` from source |
| `generate-schemas.mjs` | Regenerate all JSON schemas from TypeScript types |
| `generate-tools-doc.mjs` | Regenerate `docs/TOOLS-GENERATED.md` from tool registry |
| `generate-tools-snapshot.mjs` | Capture current tool-registry snapshot for drift checks |
| `Invoke-ReleaseWorkflow.ps1` | End-to-end release: bump → build → publish → tag |
| `publish-direct-to-remote.cjs` | Publish build artifacts directly to the remote mirror |
| `Publish-ToMirror.ps1` | Copy clean-room build to the production mirror path |
| `set-registry.mjs` | Switch npm registry for publish (scoped packages) |
| `setup-wizard.mjs` | Interactive first-run setup wizard |
| `setup-wizard-paths.mjs` | Path resolution helpers for the setup wizard |
| `sync-constitution.ps1` | Regenerate `constitution.md` from `constitution.json` |
| `sync-dist.ps1` | Sync `dist/` to production deployment path |
| `append-agent-provenance.ps1` | Append agent provenance metadata to release artifacts |
| `Compare-TemplateSpec.ps1` | Diff current template against canonical spec |

## Key entry point

```pwsh
# Full release (bump → build → publish → tag)
pwsh -File scripts/build/Invoke-ReleaseWorkflow.ps1

# CI-compatible build with artifact verification
npm run build:ci
```
