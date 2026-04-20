#!/usr/bin/env bash
# audit-ci-artifacts.sh — Pull and audit CI artifacts from GitHub Actions
#
# Usage:
#   ./scripts/audit-ci-artifacts.sh                    # audit latest successful CI
#   ./scripts/audit-ci-artifacts.sh --workflow ci.yml  # specific workflow
#   ./scripts/audit-ci-artifacts.sh --run-id 12345     # specific run
#   ./scripts/audit-ci-artifacts.sh --last 3           # last 3 runs
#   ./scripts/audit-ci-artifacts.sh --include-failed   # include failed runs
#
# Requires: gh (GitHub CLI), jq

set -euo pipefail

WORKFLOW=""
RUN_ID=""
LAST=1
INCLUDE_FAILED=false
OUTPUT_DIR="tmp/audit"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --workflow)   WORKFLOW="$2"; shift 2 ;;
        --run-id)     RUN_ID="$2"; shift 2 ;;
        --last)       LAST="$2"; shift 2 ;;
        --include-failed) INCLUDE_FAILED=true; shift ;;
        --output)     OUTPUT_DIR="$2"; shift 2 ;;
        -h|--help)
            head -12 "$0" | tail -8
            exit 0 ;;
        *) echo "Unknown arg: $1"; exit 1 ;;
    esac
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

section() { printf '\n%s\n  %s\n%s\n' "$(printf '=%.0s' {1..70})" "$1" "$(printf '=%.0s' {1..70})"; }
finding() { printf '  [%s] %s\n' "$1" "$2"; }
fmt_bytes() { numfmt --to=iec-i --suffix=B "$1" 2>/dev/null || echo "${1} bytes"; }

# ── Discover runs ────────────────────────────────────────────────────

section "Discovering workflow runs"

GH_ARGS=(run list --limit $((LAST * 5)) --json databaseId,name,conclusion,status,event)
[ -n "$WORKFLOW" ] && GH_ARGS+=(--workflow "$WORKFLOW")

if [ -n "$RUN_ID" ]; then
    RUNS="$RUN_ID"
    echo "  Using specified run: $RUN_ID"
else
    ALL_RUNS=$(gh "${GH_ARGS[@]}" 2>&1)
    if $INCLUDE_FAILED; then
        RUNS=$(echo "$ALL_RUNS" | jq -r "[.[] | select(.status==\"completed\")] | sort_by(.databaseId) | reverse | .[0:$LAST] | .[].databaseId")
    else
        RUNS=$(echo "$ALL_RUNS" | jq -r "[.[] | select(.status==\"completed\" and .conclusion==\"success\")] | sort_by(.databaseId) | reverse | .[0:$LAST] | .[].databaseId")
    fi
fi

if [ -z "$RUNS" ]; then
    echo "  No matching runs found."
    exit 0
fi

RUN_COUNT=$(echo "$RUNS" | wc -l | tr -d ' ')
echo "  Found $RUN_COUNT run(s) to audit"

FINDINGS_CRITICAL=0
FINDINGS_WARN=0

# ── Process each run ─────────────────────────────────────────────────

for run_id in $RUNS; do
    run_dir="$OUTPUT_DIR/run-$run_id"
    section "Run $run_id"

    if [ -d "$run_dir" ]; then
        echo "  (cached — skipping download)"
    else
        echo "  Downloading artifacts..."
        mkdir -p "$run_dir"
        gh run download "$run_id" -D "$run_dir" 2>/dev/null || {
            finding "WARN" "Failed to download artifacts"
            continue
        }
    fi

    file_count=$(find "$run_dir" -type f | wc -l | tr -d ' ')
    total_size=$(find "$run_dir" -type f -exec stat -f%z {} + 2>/dev/null | awk '{s+=$1}END{print s}' || find "$run_dir" -type f -printf '%s\n' | awk '{s+=$1}END{print s}')
    echo "  $file_count files, $(fmt_bytes "${total_size:-0}") total"

    # ── Server Logs ──────────────────────────────────────────────────

    server_logs=$(find "$run_dir" -name 'server-*.log' -o -name 'mcp-server.log' 2>/dev/null)
    if [ -n "$server_logs" ]; then
        section "Server Logs"
        for log in $server_logs; do
            name=$(basename "$log")
            size=$(stat -f%z "$log" 2>/dev/null || stat -c%s "$log" 2>/dev/null || echo 0)
            echo "  $name ($(fmt_bytes "$size"))"

            if [ ! -s "$log" ]; then
                finding "INFO" "Empty log: $name"
                continue
            fi

            # Check for errors
            if grep -qiE 'Error:|FATAL|MODULE_NOT_FOUND|EADDRINUSE|UnhandledPromiseRejection' "$log"; then
                finding "HIGH" "Server errors in $name:"
                grep -iE 'Error:|FATAL|MODULE_NOT_FOUND|EADDRINUSE' "$log" | head -5 | sed 's/^/      /'
                FINDINGS_CRITICAL=$((FINDINGS_CRITICAL + 1))
            fi

            # Check startup
            if grep -q 'Server started\|server_started\|SDK server started' "$log"; then
                finding "OK" "Server started successfully"
            else
                finding "WARN" "No startup confirmation in $name"
                FINDINGS_WARN=$((FINDINGS_WARN + 1))
            fi

            # Check shutdown
            if grep -q 'ppid_orphan\|shutdown\|SIGTERM\|Server stopped' "$log"; then
                finding "OK" "Clean shutdown detected"
            fi
        done
    fi

    # ── Test Results ─────────────────────────────────────────────────

    junit=$(find "$run_dir" -name 'junit.xml' 2>/dev/null | head -1)
    if [ -n "$junit" ] && [ -f "$junit" ]; then
        section "Test Results"
        # Extract basic stats with grep (no XML parser needed)
        tests=$(grep -oP 'tests="\K[^"]+' "$junit" | head -1 || echo "?")
        failures=$(grep -oP 'failures="\K[^"]+' "$junit" | head -1 || echo "0")
        errors=$(grep -oP 'errors="\K[^"]+' "$junit" | head -1 || echo "0")
        time_s=$(grep -oP 'time="\K[^"]+' "$junit" | head -1 || echo "?")
        echo "  Tests: $tests | Failures: $failures | Errors: $errors | Time: ${time_s}s"

        if [ "$failures" != "0" ] || [ "$errors" != "0" ]; then
            finding "WARN" "$failures failure(s), $errors error(s)"
            grep -oP 'classname="\K[^"]+' "$junit" | sort | uniq -c | sort -rn | head -5 | while read cnt cls; do
                echo "      $cnt tests in $cls"
            done
            FINDINGS_WARN=$((FINDINGS_WARN + 1))
        else
            finding "OK" "All tests passed"
        fi
    fi

    # ── Coverage ─────────────────────────────────────────────────────

    lcov=$(find "$run_dir" -name 'lcov.info' 2>/dev/null | head -1)
    if [ -n "$lcov" ] && [ -f "$lcov" ]; then
        section "Coverage"
        lf=$(grep -oP '^LF:\K\d+' "$lcov" | awk '{s+=$1}END{print s}')
        lh=$(grep -oP '^LH:\K\d+' "$lcov" | awk '{s+=$1}END{print s}')
        if [ "${lf:-0}" -gt 0 ]; then
            pct=$(awk "BEGIN{printf \"%.1f\", ($lh/$lf)*100}")
            echo "  Line coverage: $pct% ($lh/$lf lines)"
            if [ "$(echo "$pct < 70" | bc 2>/dev/null || echo 0)" = "1" ]; then
                finding "WARN" "Coverage below 70%"
                FINDINGS_WARN=$((FINDINGS_WARN + 1))
            else
                finding "OK" "Coverage meets threshold"
            fi
        fi
    fi

    # ── Trace Logs ───────────────────────────────────────────────────

    traces=$(find "$run_dir" -name '*.jsonl' -not -name 'rotation-test*' 2>/dev/null)
    if [ -n "$traces" ]; then
        section "Trace Logs"
        total_entries=0
        for tf in $traces; do
            entries=$(wc -l < "$tf" | tr -d ' ')
            total_entries=$((total_entries + entries))
            size=$(stat -f%z "$tf" 2>/dev/null || stat -c%s "$tf" 2>/dev/null || echo 0)
            [ "$size" -gt 0 ] && echo "  $(basename "$tf") — $entries entries ($(fmt_bytes "$size"))"
        done
        finding "INFO" "Total trace entries: $total_entries"

        # Check for error traces
        error_count=$(echo "$traces" | xargs grep -c '"lvl":\s*[45]\|"level":\s*"error"\|tool_error' 2>/dev/null | awk -F: '{s+=$NF}END{print s+0}')
        if [ "$error_count" -gt 0 ]; then
            finding "WARN" "$error_count error-level trace entries"
            FINDINGS_WARN=$((FINDINGS_WARN + 1))
        fi
    fi

    # ── Security Artifacts ───────────────────────────────────────────

    zap=$(find "$run_dir" -name 'report_html.html' 2>/dev/null | head -1)
    trivy=$(find "$run_dir" -name '*.sarif' 2>/dev/null | head -1)
    if [ -n "$zap" ] || [ -n "$trivy" ]; then
        section "Security Artifacts"
        [ -n "$zap" ] && finding "INFO" "ZAP report: $(basename "$zap") ($(fmt_bytes "$(stat -f%z "$zap" 2>/dev/null || stat -c%s "$zap")"))"
        [ -n "$trivy" ] && finding "INFO" "Trivy SARIF: $(basename "$trivy") ($(fmt_bytes "$(stat -f%z "$trivy" 2>/dev/null || stat -c%s "$trivy")"))"
    fi

    # ── Transaction Logs ─────────────────────────────────────────────

    txlogs=$(find "$run_dir" -name 'instruction-transactions*' 2>/dev/null)
    if [ -n "$txlogs" ]; then
        section "Transaction Logs"
        for tx in $txlogs; do
            entries=$(wc -l < "$tx" | tr -d ' ')
            size=$(stat -f%z "$tx" 2>/dev/null || stat -c%s "$tx" 2>/dev/null || echo 0)
            echo "  $(basename "$tx") — $entries entries ($(fmt_bytes "$size"))"
        done
        finding "INFO" "Transaction audit trail captured"
    fi
done

# ── Summary ──────────────────────────────────────────────────────────

section "AUDIT SUMMARY"
echo "  Runs audited: $RUN_COUNT"
echo "  Output dir:   $OUTPUT_DIR"

if [ "$FINDINGS_CRITICAL" -gt 0 ]; then
    echo ""
    finding "HIGH" "$FINDINGS_CRITICAL critical/high finding(s) — review required"
fi
if [ "$FINDINGS_WARN" -gt 0 ]; then
    echo ""
    finding "WARN" "$FINDINGS_WARN warning(s)"
fi
if [ "$FINDINGS_CRITICAL" -eq 0 ] && [ "$FINDINGS_WARN" -eq 0 ]; then
    echo ""
    finding "OK" "No issues found"
fi

echo ""
