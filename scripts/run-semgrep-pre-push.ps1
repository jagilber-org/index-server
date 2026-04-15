$ErrorActionPreference = 'Stop'

$env:PYTHONUTF8 = '1'

& semgrep scan --disable-version-check --skip-unknown-extensions --error --config p/ci --config p/github-actions --config p/security-audit --config .semgrep.yml --include=.github/workflows/** --include=hooks/** --include=scripts/** --include=*.json --include=*.yml --include=*.yaml .
exit $LASTEXITCODE
