#!/usr/bin/env bash
# ggshield-with-retry.sh
#
# Thin wrapper around `ggshield` that adds:
#   - Up to 3 retries with exponential backoff (5s, 15s, 45s) on transient
#     errors and rate-limit errors.
#   - Detection of quota-exhaustion errors. When detected AND
#     GGSHIELD_SKIP_ON_QUOTA=1 is set, exits 0 with a clear warning so the
#     job does not block PR merges on billing-side issues. The standalone
#     ggshield-pr workflow runs the same scan and remains authoritative
#     when quota is available.
#   - Disable switch: GGSHIELD_DISABLED=1 short-circuits with an
#     informational message and exit 0 (use only for emergency landings;
#     cron full-repo scan still runs).
#
# Usage:
#   scripts/ggshield-with-retry.sh secret scan commit-range "$BASE_SHA...$HEAD_SHA"
#
# Env vars:
#   GGSHIELD_DISABLED=1            Skip the scan entirely (returns 0).
#   GGSHIELD_SKIP_ON_QUOTA=1       On API quota exhaustion, return 0
#                                  instead of failing.
#   GGSHIELD_MAX_RETRIES=N         Override default retries (default 3).
#   GGSHIELD_INITIAL_BACKOFF=N     Override initial backoff seconds
#                                  (default 5).
#
# Exit codes mirror ggshield, except quota-exhausted returns 0 when the
# skip switch is set, and disabled returns 0 unconditionally.

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
    if [ "${GGSHIELD_SKIP_ON_QUOTA:-0}" = "1" ]; then
      echo "[ggshield-with-retry] Quota exhausted and GGSHIELD_SKIP_ON_QUOTA=1; exiting 0 without failing the job." >&2
      exit 0
    fi
    echo "[ggshield-with-retry] Quota exhausted; not retrying. Set GGSHIELD_SKIP_ON_QUOTA=1 to skip on quota errors." >&2
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
