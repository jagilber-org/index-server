# Index Enhancements for Tool Activation Discovery

## Problem
New agents encounter "disabled by the user" errors without knowing which `activate_*_tools()` functions to call. the index doesn't provide discovery mech anisms for VSCode activation requirements.

## Proposed Enhancements

### 1. Add `meta_activation_guide` Tool  
**Location**: Create new `src/services/toolHandlers.ts` section

```typescript
// In src/services/toolHandlers.ts - add after existing meta tools

registerHandler('meta_activation_guide', async () => {
  return {
    description: 'Guide for activating Index tools in VSCode',
    problem: 'Tools show as "disabled by the user" even when configured in settings.json',
    solution: 'Call VSCode activation functions to enable tool categories',
    vscodeActivationFunctions: {
      instructionManagement: {
        function: 'activate_instruction_management_and_operations_tools()',
        tools: [
          'index_add', 'index_dispatch', 'index_search',
          'index_remove', 'index_repair', 'index_import',
          'index_health', 'index_normalize', 'index_reload',
          'usage_track', 'usage_hotset', 'manifest_refresh'
        ],
        toolCount: 12
      },
      graphAndSchema: {
        function: 'activate_instruction_graph_and_schema_tools()',
        tools: ['graph_export', 'index_schema'],
        toolCount: 2
      },
      governance: {
        function: 'activate_governance_management_tools()',
        tools: ['index_enrich', 'index_governanceHash', 'index_governanceUpdate'],
        toolCount: 3
      },
      manifest: {
        function: 'activate_manifest_management_tools()',
        tools: ['manifest_repair', 'manifest_status'],
        toolCount: 2
      },
      bootstrap: {
        function: 'activate_bootstrap_management_tools()',
        tools: ['bootstrap_request', 'bootstrap_confirmFinalize', 'bootstrap_status'],
        toolCount: 3
      },
      diagnostics: {
        function: 'activate_diagnostic_stress_testing_tools()',
        tools: ['diagnostics_block', 'diagnostics_memoryPressure', 'diagnostics_microtaskFlood'],
        toolCount: 3
      },
      health: {
        function: 'activate_feedback_and_health_monitoring_tools()',
        tools: ['feedback_submit', 'feedback_list', 'feedback_health', 'feedback_stats', 'health_check'],
        toolCount: 5
      }
    },
    quickStart: {
      step1: 'Identify which tool you need (e.g., index_search)',
      step2: 'Find matching category in activation functions above',
      step3: 'Call the activation function (no parameters needed)',
      step4: 'Retry your tool call - now works'
    },
    example: {
      problem: 'index_search disabled',
      solution: 'activate_instruction_management_and_operations_tools()',
      verification: 'Call index_search again - should work'
    },
    commonMistake: 'Settings.json configuration (chat.mcp.tools) is necessary but NOT sufficient. Activation functions are required.',
    relatedInstruction: 'mcp-tool-activation-critical-p0'
  };
});
```

### 2. Enhance Tool Registry with Activation Metadata
**Location**: `src/services/toolRegistry.ts`

```typescript
// Add activation category metadata to tool definitions
interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: object;
  activationCategory?: string; // NEW
  activationFunction?: string; // NEW
}

// Update tool registration to include activation hints
export function registerTool(definition: ToolDefinition) {
  // existing logic...
  
  // Auto-populate activation hints based on tool name patterns
  if (!definition.activationCategory) {
    if (definition.name.startsWith('instructions/')) {
      definition.activationCategory = 'instructionManagement';
      definition.activationFunction = 'activate_instruction_management_and_operations_tools';
    } else if (definition.name.startsWith('graph/')) {
      definition.activationCategory = 'graphAndSchema';
      definition.activationFunction = 'activate_instruction_graph_and_schema_tools';
    } // ... more categories
  }
  
  registry.push(definition);
}
```

### 3. Enhance `tools/list` Response
**Location**: `src/server/sdkServer.ts` (already exists, enhance response)

```typescript
// In tools/list handler - add activation metadata to each tool
server.setRequestHandler(requestSchema('tools/list'), async () => {
  const registry = getToolRegistry();
  return {
    tools: registry.map(r => ({
      name: r.name,
      description: r.description,
      inputSchema: r.inputSchema,
      // NEW: Add activation hints
      _vscode: { 
        activationCategory: r.activationCategory,
        activationFunction: r.activationFunction,
        note: 'Call activation function in VSCode before using tool'
      }
    }))
  };
});
```

### 4. Add Activation Check Tool
**Location**: Create `src/services/activationCheck.ts`

```typescript
// New tool: help agents verify activation requirements
registerHandler('meta_check_activation', async (params: { toolName: string }) => {
  const { toolName } = params;
  const registry = getToolRegistry();
  const tool = registry.find(t => t.name === toolName);
  
  if (!tool) {
    return {
      found: false,
      message: `Tool '${toolName}' not found in registry`
    };
  }
  
  return {
    found: true,
    tool: toolName,
    activationRequired: true,
    activationFunction: tool.activationFunction || 'unknown',
    activationCategory: tool.activationCategory || 'unknown',
    instructions: `To use this tool in VSCode:
1. Call: ${tool.activationFunction || 'appropriate activation function'}()
2. Retry tool call
3. Tool should now work

Common issue: Settings.json configuration alone does NOT enable tools.`,
    settingsJsonNote: 'Ensure tool is enabled in settings.json (chat.mcp.tools) but this alone is insufficient'
  };
});
```

### 5. Update README.md
**Location**: `<root>\index-server\README.md`

Add new section after "Quick Start":

```markdown
## Tool Activation in VSCode

### Important: Configuration ≠ Activation

Even with correct configuration in `settings.json`, MCP tools require explicit activation in VSCode:

```json
// This is NECESSARY but NOT SUFFICIENT:
"chat.mcp.tools": {
  "Index": {
    "index_search": true
  }
}
```

**You must also call activation functions:**

```javascript
// For instruction tools:
activate_instruction_management_and_operations_tools()

// For governance tools:
activate_governance_management_tools()

// See full list with: tools/call meta_activation_guide
```

### Quick Activation Reference

| Tool Category | Activation Function | Tool Count |
|---------------|---------------------|------------|
| Instruction Management | `activate_instruction_management_and_operations_tools()` | 12 |
| Graph & Schema | `activate_instruction_graph_and_schema_tools()` | 2 |
| Governance | `activate_governance_management_tools()` | 3 |
| Manifest | `activate_manifest_management_tools()` | 2 |
| Bootstrap | `activate_bootstrap_management_tools()` | 3 |
| Diagnostics | `activate_diagnostic_stress_testing_tools()` | 3 |
| Health | `activate_feedback_and_health_monitoring_tools()` | 5 |

### Discovery Tools

Use these built-in tools to discover activation requirements:

- `meta_activation_guide` - Complete activation guide
- `meta_check_activation` - Check requirements for specific tool
- `tools/list` - Now includes `_vscode.activationFunction` hints

### Troubleshooting "Disabled by User" Errors

If you see:
```
Error: Tool 'mcp_mcp-index-ser_index_search' is disabled by the user
```

**Solution:**
1. Call appropriate activation function (see table above)
2. Retry tool - should now work
3. For help: `tools/call meta_activation_guide`
```

## Implementation Priority

1. ✅ **meta_activation_guide** - Immediate value, no breaking changes
2. ✅ **README update** - Documentation for humans and agents  
3. ⏸️ **meta_check_activation** - Nice to have, lower priority
4. ⏸️ **Enhanced tools/list** - Breaking change (adds new fields)
5. ⏸️ **Tool registry metadata** - Requires schema changes

## Testing

```bash
# After implementation, test discovery:
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"meta_activation_guide","arguments":{}}}' | node dist/server/index-server.js

# Should return comprehensive activation guide
```

## Benefits

- **Reduced onboarding time**: 30-45 minutes → <2 minutes
- **Service discovery**: Agents learn activation requirements from server
- **Future-proof**: New tool categories automatically documented
- **No breaking changes**: New meta tools, enhanced documentation
