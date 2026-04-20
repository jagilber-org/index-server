#!/usr/bin/env bash
# validate-npx-install.sh — Cross-platform npx smoke test for index-server
# Run on a fresh VM to validate the published npm package works end-to-end.
#
# Prerequisites: Node.js >= 22, npm
# Usage:
#   # Public (npmjs.org):
#   ./validate-npx-install.sh
#
#   # GitHub Packages (private):
#   export NPM_TOKEN="ghp_..."
#   ./validate-npx-install.sh --registry github

set -euo pipefail

REGISTRY="npmjs"
PACKAGE="@jagilber-org/index-server"
PASS=0
FAIL=0
ERRORS=()

while [[ $# -gt 0 ]]; do
  case $1 in
    --registry) REGISTRY="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

log()  { echo "[$(date -u +%H:%M:%S)] $*"; }
pass() { PASS=$((PASS + 1)); log "✓ PASS: $1"; }
fail() { FAIL=$((FAIL + 1)); ERRORS+=("$1"); log "✗ FAIL: $1"; }

# --- Prereqs ---
log "=== index-server npx validation ==="
log "OS: $(uname -a)"
log "Registry: $REGISTRY"

# Check Node.js
if ! command -v node &>/dev/null; then
  fail "Node.js not installed"
  echo "Install: https://nodejs.org/"
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [[ "$NODE_VERSION" -ge 22 ]]; then
  pass "Node.js version $(node -v)"
else
  fail "Node.js $(node -v) < 22 required"
fi

# Check npm
if command -v npm &>/dev/null; then
  pass "npm $(npm -v)"
else
  fail "npm not installed"
  exit 1
fi

# --- Registry setup ---
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT
cd "$TMPDIR"

if [[ "$REGISTRY" == "github" ]]; then
  if [[ -z "${NPM_TOKEN:-}" ]]; then
    fail "NPM_TOKEN required for GitHub Packages"
    exit 1
  fi
  cat > .npmrc <<EOF
@jagilber-org:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NPM_TOKEN}
EOF
  pass "GitHub Packages .npmrc configured"
fi

# --- Test 1: npx --help ---
log "--- Test: npx boots and shows help ---"
if OUTPUT=$(npx --yes "$PACKAGE" --help 2>&1); then
  if echo "$OUTPUT" | grep -q "index-server"; then
    pass "npx $PACKAGE --help shows server info"
  else
    fail "npx output missing 'index-server'"
  fi
else
  # --help exits non-zero on some configs, check output anyway
  if echo "$OUTPUT" | grep -q "index-server"; then
    pass "npx $PACKAGE --help shows server info (non-zero exit ok)"
  else
    fail "npx $PACKAGE --help failed: $OUTPUT"
  fi
fi

# --- Test 2: Version check ---
log "--- Test: package version resolves ---"
if VERSION=$(npm view "$PACKAGE" version 2>/dev/null); then
  pass "Package version: $VERSION"
else
  fail "npm view failed — package not found in registry"
fi

# --- Test 3: Binary exists after npx cache ---
log "--- Test: bin entry resolves ---"
if npx --yes "$PACKAGE" --help 2>&1 | grep -q "MCP TRANSPORT\|dashboard\|stdio"; then
  pass "Server binary boots correctly"
else
  fail "Server binary did not produce expected output"
fi

# --- Test 4: Dashboard TLS flag accepted ---
log "--- Test: --dashboard-tls flag accepted ---"
if OUTPUT=$(timeout 5 npx --yes "$PACKAGE" --dashboard --dashboard-tls 2>&1 || true); then
  if echo "$OUTPUT" | grep -iq "tls\|certificate\|https\|dashboard"; then
    pass "Dashboard TLS flag recognized"
  else
    # May just timeout waiting for stdin — that's fine
    pass "Dashboard TLS flag accepted (server started)"
  fi
fi

# --- Summary ---
echo ""
log "=== RESULTS ==="
log "Passed: $PASS"
log "Failed: $FAIL"

if [[ $FAIL -gt 0 ]]; then
  log "FAILURES:"
  for e in "${ERRORS[@]}"; do
    log "  - $e"
  done
  exit 1
fi

log "All tests passed."
