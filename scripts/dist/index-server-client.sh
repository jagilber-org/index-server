#!/usr/bin/env bash
# index-server-client.sh -- Index Server REST client for subagents without MCP tool access
# Provides CRUD operations via the dashboard REST bridge (POST /api/tools/:name)
# Works with both HTTP and HTTPS. Returns structured JSON to stdout.
#
# Usage:
#   ./index-server-client.sh health
#   ./index-server-client.sh search "deploy release" [keyword|regex|semantic] [limit]
#   ./index-server-client.sh get <id>
#   ./index-server-client.sh list [limit]
#   ./index-server-client.sh add <id> <title> <body> [priority] [--overwrite]
#   ./index-server-client.sh remove <id>
#   ./index-server-client.sh track <id> [helpful|not-relevant|outdated|applied]
#   ./index-server-client.sh hotset [limit]
#   ./index-server-client.sh groom [--dry-run]
#
# Env: INDEX_SERVER_URL (default: http://localhost:8787)
#      INDEX_SERVER_SKIP_CERT=1 to skip TLS cert validation (self-signed)

set -euo pipefail

BASE_URL="${INDEX_SERVER_URL:-http://localhost:8787}"
BASE_URL="${BASE_URL%/}"

CURL_OPTS=(-s -S --fail-with-body -H "Content-Type: application/json")
if [ "${INDEX_SERVER_SKIP_CERT:-}" = "1" ]; then
    CURL_OPTS+=(-k)
fi

call_tool() {
    local tool="$1"
    local body="$2"
    local url="${BASE_URL}/api/tools/${tool}"
    local http_code resp
    resp=$(curl "${CURL_OPTS[@]}" -w "\n%{http_code}" -X POST -d "$body" "$url" 2>&1) || true
    http_code=$(echo "$resp" | tail -1)
    local json_body
    json_body=$(echo "$resp" | sed '$d')
    if [ "$http_code" -ge 200 ] && [ "$http_code" -lt 300 ] 2>/dev/null; then
        echo "{\"success\":true,\"status\":${http_code},\"result\":${json_body:-null}}"
    else
        echo "{\"success\":false,\"status\":${http_code:-0},\"error\":${json_body:-\"request failed\"}}"
    fi
}

ACTION="${1:-}"
shift || true

case "$ACTION" in
    health)
        call_tool "health_check" "{}"
        ;;
    search)
        terms="${1:-}"
        mode="${2:-keyword}"
        limit="${3:-50}"
        if [ -z "$terms" ]; then
            echo '{"success":false,"error":"keywords required for search"}'
            exit 1
        fi
        # Convert space-separated terms to JSON array
        kw_json=$(echo "$terms" | tr ' ' '\n' | sed 's/.*/"&"/' | paste -sd, | sed 's/^/[/;s/$/]/')
        call_tool "index_search" "{\"keywords\":${kw_json},\"mode\":\"${mode}\",\"limit\":${limit}}"
        ;;
    get)
        id="${1:-}"
        if [ -z "$id" ]; then
            echo '{"success":false,"error":"id required for get"}'
            exit 1
        fi
        call_tool "index_dispatch" "{\"action\":\"get\",\"id\":\"${id}\"}"
        ;;
    list)
        limit="${1:-50}"
        call_tool "index_dispatch" "{\"action\":\"list\",\"limit\":${limit}}"
        ;;
    add)
        id="${1:-}"
        title="${2:-}"
        body="${3:-}"
        priority="${4:-50}"
        overwrite="false"
        for arg in "$@"; do [ "$arg" = "--overwrite" ] && overwrite="true"; done
        if [ -z "$id" ] || [ -z "$body" ]; then
            echo '{"success":false,"error":"id and body required for add"}'
            exit 1
        fi
        [ -z "$title" ] && title="$id"
        # Escape body for JSON (newlines, quotes, backslashes)
        esc_body=$(printf '%s' "$body" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))' 2>/dev/null || printf '%s' "$body" | sed 's/\\/\\\\/g;s/"/\\"/g' | tr '\n' ' ')
        esc_title=$(printf '%s' "$title" | sed 's/\\/\\\\/g;s/"/\\"/g')
        call_tool "index_add" "{\"id\":\"${id}\",\"title\":\"${esc_title}\",\"body\":${esc_body},\"priority\":${priority},\"audience\":\"all\",\"requirement\":\"optional\",\"categories\":[\"general\"],\"contentType\":\"instruction\",\"overwrite\":${overwrite}}"
        ;;
    remove)
        id="${1:-}"
        if [ -z "$id" ]; then
            echo '{"success":false,"error":"id required for remove"}'
            exit 1
        fi
        call_tool "index_remove" "{\"ids\":[\"${id}\"]}"
        ;;
    track)
        id="${1:-}"
        signal="${2:-}"
        if [ -z "$id" ]; then
            echo '{"success":false,"error":"id required for track"}'
            exit 1
        fi
        if [ -n "$signal" ]; then
            call_tool "usage_track" "{\"id\":\"${id}\",\"signal\":\"${signal}\"}"
        else
            call_tool "usage_track" "{\"id\":\"${id}\"}"
        fi
        ;;
    hotset)
        limit="${1:-10}"
        call_tool "usage_hotset" "{\"limit\":${limit}}"
        ;;
    groom)
        dry="false"
        for arg in "$@"; do [ "$arg" = "--dry-run" ] && dry="true"; done
        call_tool "index_groom" "{\"mode\":{\"dryRun\":${dry}}}"
        ;;
    *)
        cat <<'EOF'
{"success":false,"error":"unknown action","usage":{
  "actions":["health","search","get","list","add","remove","track","hotset","groom"],
  "examples":[
    "index-server-client.sh health",
    "index-server-client.sh search 'deploy release' semantic 10",
    "index-server-client.sh get my-instruction-id",
    "index-server-client.sh list 20",
    "index-server-client.sh add my-id 'My Title' 'Body content' 50",
    "index-server-client.sh remove my-id",
    "index-server-client.sh track my-id helpful",
    "index-server-client.sh hotset 10",
    "index-server-client.sh groom --dry-run"
  ],
  "env":["INDEX_SERVER_URL=http://localhost:8787","INDEX_SERVER_SKIP_CERT=1"]
}}
EOF
        exit 1
        ;;
esac
