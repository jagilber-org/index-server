# MCP Testing Knowledge Base

## Testing Tools

### SDK-based Test Client

**LOCATION**: `src/tests/helpers/mcpTestClient.ts`
**PURPOSE**: Programmatic MCP server testing using `@modelcontextprotocol/sdk`
**STATUS**: Stable, replaces the former portable-mcp-client

### Immediate Access

```bash
# Run test helper validation
npx vitest run src/tests/helpers/mcpTestClient.spec.ts

# Run integration tests
npx vitest run src/tests/
```

### GitHub Copilot CLI (Interactive/E2E)

```bash
# Interactive MCP testing via Copilot CLI
copilot -p "call index_search with q='build'" --allow-tool 'index'

# E2E smoke test script
pwsh scripts/copilot-e2e.ps1
```

## Troubleshooting Methodology

1. **Run `mcpTestClient.spec.ts`** to validate MCP protocol baseline
2. **Use `createTestClient()`** for programmatic CRUD validation
3. **Use Copilot CLI** for interactive ad-hoc testing
4. **Use JSON output** for programmatic analysis

## Success Criteria

Healthy MCP server should:

- 100% tool discovery success
- 100% tool invocation success
- Consistent response formatting
- No silent failures

## Full Documentation

- Test client: `src/tests/helpers/mcpTestClient.ts`
- Integration tests: `src/tests/*.spec.ts`
- E2E script: `scripts/copilot-e2e.ps1`

---
**UPDATED**: Portable client removed; replaced by SDK test client and Copilot CLI

