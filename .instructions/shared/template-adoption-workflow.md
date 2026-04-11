# Template Adoption Workflow

Use this workflow when applying the template repo spec to an existing repository.

## Principles

1. Do not overwrite existing repos wholesale from the template.
2. Apply versioned deltas from the template instead.
3. Preserve repo-specific workflow, publish, and documentation behavior unless the template explicitly replaces it.
4. Record adoption state so later updates are `old-version -> new-version`, not a fresh audit.

## Required Metadata

Each adopted repository should commit a root-level `.template-adoption.json` file derived from `template-adoption.example.json`.

That file should record:

- template name
- adopted template version
- shared hook standard version
- adoption date
- intentional local deviations

## Validation Order

1. `pre-commit run --files ...` on changed files
2. repo-local tests for modified hooks or scripts
3. `pre-commit run --all-files`
4. CI run with required secrets, including `GITGUARDIAN_API_KEY` when ggshield is enabled
