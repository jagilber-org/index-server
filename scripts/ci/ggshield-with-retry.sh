#!/usr/bin/env bash
# ggshield-with-retry.sh
#
# Thin wrapper around `ggshield` that adds:
#   - Up to 3 retries with exponential backoff (5s, 15s, 45s) on transient
#     errors and rate-limit errors.
#   - Detection of quota-exhaustion errors. Quota exhaustion fails closed unless
#     GGSHIELD_QUOTA_MODE=advisory is set for an explicitly documented advisory
#     context.
#   - Disable switch: GGSHIELD_DISABLED=1 short-circuits with an
#     informational message and exit 0 (use only for emergency landings;
#     cron full-repo scan still runs).
#
# Usage:
#   scripts/ggshield-with-retry.sh secret scan commit-range "$BASE_SHA...$HEAD_SHA"
#
# Env vars:
#   GGSHIELD_DISABLED=1            Skip the scan entirely (returns 0).
#   GGSHIELD_QUOTA_MODE=advisory   On API quota exhaustion, emit a GitHub
#                                  Actions warning/summary and return 0.
#   GGSHIELD_MAX_RETRIES=N         Override default retries (default 3).
#   GGSHIELD_INITIAL_BACKOFF=N     Override initial backoff seconds
#                                  (default 5).
#
# Exit codes mirror ggshield, except disabled and advisory quota mode return 0.

set -euo pipefail

if [ "${GGSHIELD_DISABLED:-0}" = "1" ]; then
  echo "[ggshield-with-retry] GGSHIELD_DISABLED=1; skipping scan." >&2
  exit 0
fi

MAX_RETRIES="${GGSHIELD_MAX_RETRIES:-3}"
BACKOFF="${GGSHIELD_INITIAL_BACKOFF:-5}"

attempt=0
last_exit=0
output_file="$(mktemp)"
trap 'rm -f "$output_file"' EXIT

while [ "$attempt" -lt "$MAX_RETRIES" ]; do
  attempt=$((attempt + 1))
  echo "[ggshield-with-retry] attempt ${attempt}/${MAX_RETRIES}: ggshield $*" >&2
  set +e
  ggshield "$@" 2>&1 | tee "$output_file"
  last_exit="${PIPESTATUS[0]}"
  set -e

  if [ "$last_exit" = "0" ]; then
    exit 0
  fi

  # Quota exhaustion detection: ggshield prints
  # "Could not perform the requested action: no more API calls available."
  if grep -Eq "no more API calls available|API.*quota|rate[- ]?limit" "$output_file"; then
    if [ "${GGSHIELD_QUOTA_MODE:-fail}" = "advisory" ]; then
      message="[ggshield-with-retry] Quota exhausted; marking advisory because GGSHIELD_QUOTA_MODE=advisory."
      echo "$message" >&2
      echo "::warning title=GGShield quota exhausted::Mandatory GGShield PR scan could not complete because the GitGuardian API quota is exhausted. Gitleaks, detect-secrets, and repo-local PII gates still run; scheduled/manual GGShield scans remain fail-closed."
      if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
        echo "### GGShield quota advisory" >> "$GITHUB_STEP_SUMMARY"
        echo "" >> "$GITHUB_STEP_SUMMARY"
        echo "GGShield did not complete because the GitGuardian API quota is exhausted." >> "$GITHUB_STEP_SUMMARY"
        echo "This PR job is advisory for quota exhaustion only; manual and scheduled GGShield scans remain fail-closed." >> "$GITHUB_STEP_SUMMARY"
      fi
      exit 0
    fi
    echo "[ggshield-with-retry] Quota exhausted; failing closed because scanner degradation must be visible." >&2
    exit "$last_exit"
  fi

  if [ "$attempt" -lt "$MAX_RETRIES" ]; then
    echo "[ggshield-with-retry] transient failure (exit ${last_exit}); sleeping ${BACKOFF}s before retry." >&2
    sleep "$BACKOFF"
    BACKOFF=$((BACKOFF * 3))
  fi
done

echo "[ggshield-with-retry] All ${MAX_RETRIES} attempts failed; final exit code ${last_exit}." >&2
exit "$last_exit"
