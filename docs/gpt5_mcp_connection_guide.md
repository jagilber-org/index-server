# GPT-5 MCP Server Connection Guide

## Quick Start for GPT-5

**Problem:** GPT-5 can't find or connect to the index  
**Solution:** Use the exact server name and proper MCP syntax

## 1. Server Identification

The MCP server name is: `Index`

**Correct GPT-5 syntax:**

```bash
@Index health_check
```

**NOT:**

- `@mcp_Index` (wrong format)
- `@Index/health_check` (wrong separator)
- Direct tool calls without @ prefix

## 2. Available Tools

### Core Tools

- `health_check` - Server health status
- `index_dispatch` - Main instruction index interface  
- `metrics_snapshot` - Performance metrics
- `meta_tools` - List all available tools

### Instruction Management (via dispatcher)

```bash
@Index index_dispatch action=list
@Index index_dispatch action=get id=some-instruction-id
@Index index_dispatch action=query query=search-terms
@Index index_dispatch action=categories
```

### Feedback System

```bash
@Index feedback_submit type=issue severity=medium title="Test" description="Test feedback"
```

**Note**: Feedback submission is only available via MCP. Dashboard feedback browsing/editing is operator-only via the Feedback tab.

## 3. Connection Verification

**Step 1:** Check server health

```bash
@Index health_check
```

Expected response: `{ "status": "ok", "version": "1.1.1", ... }`

**Step 2:** List available tools

```bash
@Index meta_tools
```

**Step 3:** Test instruction index

```bash
@Index index_dispatch action=list
```

## 4. Common Connection Issues

### Issue: "Server not found"

**Cause:** Wrong server name or server not running  
**Solution:**

1. Verify exact name: `Index` (no underscores)
2. Check VS Code MCP extension is active
3. Restart VS Code if needed

### Issue: "Method not found"

**Cause:** Using old direct method calls  
**Solution:** Use `tools/call` pattern via @ syntax

- ✅ `@Index health_check`  
- ❌ Direct JSON-RPC `{"method":"health_check"}`

### Issue: "No response"

**Cause:** Server process not running  
**Solution:** Check VS Code MCP server status in bottom bar

## 5. Sample Workflows

### Browse Instructions

```bash
# List all instructions
@Index index_dispatch action=list

# Search for specific content  
@Index index_dispatch action=query query=typescript

# Get specific instruction
@Index index_dispatch action=get id=found-instruction-id
```

### Submit Feedback

```bash
@Index feedback_submit type=feature-request severity=low title="New Feature" description="Detailed description here"
```

### Monitor Server

```bash
@Index health_check
@Index metrics_snapshot  
```

## 6. Environment Context

The server is configured with:

- Instructions directory: `<root>/index-server/devinstructions`
- Feedback directory: `<root>/index-server/feedback`  
- Mutations enabled: Yes (default runtime; `INDEX_SERVER_MUTATION` unset)
- Always reload: Yes (dev mode)

## 7. Troubleshooting Commands

If GPT-5 still can't connect:

1. **Verify server name:**

   ```bash
   @Index meta_tools
   ```

2. **Check if server responds:**

   ```bash
   @Index health_check  
   ```

3. **List what's available:**

   ```bash
   @Index index_dispatch action=list limit=5
   ```

4. **Submit feedback:**

   ```bash
   @Index feedback_submit type=issue severity=low title="Test" description="Test feedback"
   ```

## 8. Expected Server Responses

### Healthy Response Pattern

```json
{
  "status": "ok",
  "version": "1.1.1", 
  "pid": 12345,
  "uptimeSeconds": 123,
  "instructions": {
    "cachedCount": 25,
    "dir": "<root>/index-server/devinstructions"
  }
}
```

### Tool List Pattern

Array of objects with:

- `name`: Tool identifier (e.g., "health_check")
- `description`: Human readable summary
- `stable`: Boolean indicating stability
- `mutation`: Boolean indicating if it modifies state

---

**Key Point for GPT-5:** Always use `@Index` prefix, never direct method calls. The server only responds to MCP protocol `tools/call` requests through the @ syntax.
