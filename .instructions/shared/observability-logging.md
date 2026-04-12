# Observability & Structured Logging

## Purpose

Standardize structured NDJSON logging across services so agents,
operators, and tooling can search, correlate, and diagnose runtime
behavior quickly.

## Baseline Defaults

| Field       | Required | Notes                                                      |
|-------------|----------|------------------------------------------------------------|
| `timestamp` | yes      | ISO 8601 UTC                                               |
| `severity`  | yes      | `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR`                  |
| `message`   | yes      | Human-readable summary                                     |
| `module`    | no       | Source file or logical component name                      |
| `requestId` | no       | Correlation identifier when applicable                     |
| `pid`       | no       | Process ID — useful for multi-process deployments          |
| `port`      | no       | Listening port — useful for multi-instance setups          |

## Recommended Fields

Additional context fields (e.g. `userId`, `action`, `durationMs`)
are encouraged when they aid diagnosis and do not leak secrets or PII.

## Function Tracing

Use consistent enter/exit markers for operationally meaningful
functions and request boundaries:

```
→ functionName(relevantArgs)
← functionName → result | error
```

Document modules where tracing is intentionally reduced for
performance or noise reasons.

## Error Logging

- Capture and log stack traces for exceptions when the runtime supports them.
- Include structured error details and correlation identifiers.
- Prefer native stack capture utilities over ad hoc string formatting.
- Never swallow exceptions without logging the failure context.
- Never reduce errors to message-only text when stack context is available.

## Safety Rules

- Do not emit real secrets, tokens, or PII in log fields.
- Use identifiers or redacted representations when values aid diagnosis.
- Keep severity levels stable across modules for consistent filtering.

## Context Propagation

When requests span multiple modules or async boundaries, propagate a
correlation identifier (e.g. `requestId`) so log lines can be grouped
for a single logical operation.

## Stack Examples

### Node.js / TypeScript

```typescript
const log = (severity: string, message: string, extra?: Record<string, unknown>) =>
  process.stderr.write(
    JSON.stringify({ timestamp: new Date().toISOString(), severity, message, ...extra }) + '\n'
  );
```

### PowerShell

```powershell
function Write-StructuredLog {
    param([string]$Severity, [string]$Message, [hashtable]$Extra = @{})
    $entry = @{ timestamp = (Get-Date -Format o); severity = $Severity; message = $Message } + $Extra
    $entry | ConvertTo-Json -Compress | Write-Host
}
```
