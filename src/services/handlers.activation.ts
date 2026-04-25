/**
 * VS Code Activation Guide Handler
 *
 * Provides a stable read-only tool 'meta_activation_guide' that returns comprehensive
 * guidance for activating Index Server tools in VSCode. Addresses the common pain
 * point where tools show as "disabled by the user" despite correct settings.json configuration.
 *
 * Key insight: settings.json configuration is necessary but NOT sufficient - activation
 * functions must be called to actually enable tools in VSCode.
 *
 * Created: 2026-02-01 (in response to repeated multi-session activation pain)
 */
import { registerHandler } from '../server/registry';

const ACTIVATION_GUIDE_VERSION = '1.0.0';

interface ActivationCategory {
  function: string;
  tools: string[];
  toolCount: number;
  description: string;
}

interface ActivationGuide {
  version: string;
  generatedAt: string;
  problem: string;
  rootCause: string;
  solution: string;
  categories: Record<string, ActivationCategory>;
  quickStart: {
    step1: string;
    step2: string;
    step3: string;
    step4: string;
  };
  example: {
    problem: string;
    solution: string;
    verification: string;
  };
  commonMistake: string;
  troubleshooting: {
    symptom: string;
    diagnosis: string;
    fix: string;
  }[];
  relatedResources: {
    instruction: string;
    documentation: string;
  };
}

registerHandler('meta_activation_guide', (): ActivationGuide => {
  return {
    version: ACTIVATION_GUIDE_VERSION,
    generatedAt: new Date().toISOString(),
    problem: 'Index Server tools show as "disabled by the user" in VSCode even when properly configured in settings.json (chat.mcp.tools)',
    rootCause: 'Settings.json configuration provides permission framework but does NOT trigger actual tool enablement. Activation functions must be called explicitly.',
    solution: 'Call VSCode activation functions to enable tool categories. These functions are VSCode client-side features that must be invoked before using MCP tools.',
    categories: {
      instructionManagement: {
        function: 'activate_instruction_management_and_operations_tools()',
        description: 'Core instruction index operations: add, search, dispatch, remove, repair, import, normalize, reload',
        tools: [
          'index_add',
          'index_dispatch',
          'index_search',
          'index_remove',
          'index_repair',
          'index_import',
          'index_health',
          'index_normalize',
          'index_reload',
          'usage_track',
          'usage_hotset',
          'manifest_refresh'
        ],
        toolCount: 12
      },
      graphAndSchema: {
        function: 'activate_instruction_graph_and_schema_tools()',
        description: 'Instruction graph export and JSON schema retrieval',
        tools: ['graph_export', 'index_schema'],
        toolCount: 2
      },
      governance: {
        function: 'activate_governance_management_tools()',
        description: 'Governance operations: enrich placeholder fields, compute/update governance hash',
        tools: [
          'index_enrich',
          'index_governanceHash',
          'index_governanceUpdate'
        ],
        toolCount: 3
      },
      manifest: {
        function: 'activate_manifest_management_tools()',
        description: 'index manifest repair and status checks',
        tools: ['manifest_repair', 'manifest_status'],
        toolCount: 2
      },
      bootstrap: {
        function: 'activate_bootstrap_management_tools()',
        description: 'Bootstrap confirmation and finalization for guarded mutations',
        tools: [
          'bootstrap_request',
          'bootstrap_confirmFinalize',
          'bootstrap_status'
        ],
        toolCount: 3
      },
      diagnostics: {
        function: 'activate_diagnostic_stress_testing_tools()',
        description: 'CPU/memory/microtask stress testing for performance analysis',
        tools: [
          'diagnostics_block',
          'diagnostics_memoryPressure',
          'diagnostics_microtaskFlood'
        ],
        toolCount: 3
      },
      health: {
        function: 'activate_feedback_and_health_monitoring_tools()',
        description: 'Feedback submission and system health monitoring',
        tools: [
          'feedback_submit',
          'health_check'
        ],
        toolCount: 2
      }
    },
    quickStart: {
      step1: 'Identify which tool you need (e.g., index_search)',
      step2: 'Find matching category in activation categories above (e.g., instructionManagement)',
      step3: 'Call the activation function with NO parameters: activate_instruction_management_and_operations_tools()',
      step4: 'Retry your tool call - it should now work'
    },
    example: {
      problem: 'Error: Tool "mcp_mcp-index-ser_index_search" is disabled by the user',
      solution: 'Call: activate_instruction_management_and_operations_tools()',
      verification: 'Retry index_search - should now execute successfully'
    },
    commonMistake: 'Assuming settings.json configuration (chat.mcp.tools) alone enables tools. Configuration provides permission framework but activation functions actually enable the tools.',
    troubleshooting: [
      {
        symptom: 'All tools show as disabled despite settings.json configuration',
        diagnosis: 'Activation functions not called',
        fix: 'Call all activation functions listed in categories section above'
      },
      {
        symptom: 'Some tool categories work, others disabled',
        diagnosis: 'Only some activation functions called',
        fix: 'Identify missing categories and call their activation functions'
      },
      {
        symptom: 'Tools were working, now disabled after VSCode restart',
        diagnosis: 'Activation state not persisted across sessions',
        fix: 'Re-call activation functions after VSCode restart'
      },
      {
        symptom: 'Cannot find activation function for a tool',
        diagnosis: 'Tool may not require activation OR wrong MCP server',
        fix: 'Verify tool belongs to index via meta_tools, check tool name mapping in categories above'
      }
    ],
    relatedResources: {
      instruction: 'mcp-tool-activation-critical-p0 (P0 instruction in Index Server index)',
      documentation: 'See INDEX_SERVER_TOOL_ACTIVATION_IMPROVEMENT_PLAN.md in repository for detailed analysis'
    }
  };
});

// Optional: Add tool-specific activation lookup
interface ActivationCheck {
  found: boolean;
  tool?: string;
  activationRequired?: boolean;
  activationFunction?: string;
  activationCategory?: string;
  instructions?: string;
  settingsJsonNote?: string;
  message?: string;
}

registerHandler('meta_check_activation', (params: { toolName?: string }): ActivationCheck => {
  const toolName = params?.toolName;

  if (!toolName) {
    return {
      found: false,
      message: 'Parameter "toolName" is required (e.g., {"toolName": "index_search"})'
    };
  }

  // Map tool names to activation categories
  const toolMapping: Record<string, { category: string; function: string }> = {
    'index_add': { category: 'instructionManagement', function: 'activate_instruction_management_and_operations_tools' },
    'index_dispatch': { category: 'instructionManagement', function: 'activate_instruction_management_and_operations_tools' },
    'index_search': { category: 'instructionManagement', function: 'activate_instruction_management_and_operations_tools' },
    'index_remove': { category: 'instructionManagement', function: 'activate_instruction_management_and_operations_tools' },
    'index_repair': { category: 'instructionManagement', function: 'activate_instruction_management_and_operations_tools' },
    'index_import': { category: 'instructionManagement', function: 'activate_instruction_management_and_operations_tools' },
    'index_health': { category: 'instructionManagement', function: 'activate_instruction_management_and_operations_tools' },
    'index_normalize': { category: 'instructionManagement', function: 'activate_instruction_management_and_operations_tools' },
    'index_reload': { category: 'instructionManagement', function: 'activate_instruction_management_and_operations_tools' },
    'usage_track': { category: 'instructionManagement', function: 'activate_instruction_management_and_operations_tools' },
    'usage_hotset': { category: 'instructionManagement', function: 'activate_instruction_management_and_operations_tools' },
    'manifest_refresh': { category: 'instructionManagement', function: 'activate_instruction_management_and_operations_tools' },
    'graph_export': { category: 'graphAndSchema', function: 'activate_instruction_graph_and_schema_tools' },
    'index_schema': { category: 'graphAndSchema', function: 'activate_instruction_graph_and_schema_tools' },
    'index_enrich': { category: 'governance', function: 'activate_governance_management_tools' },
    'index_governanceHash': { category: 'governance', function: 'activate_governance_management_tools' },
    'index_governanceUpdate': { category: 'governance', function: 'activate_governance_management_tools' },
    'manifest_repair': { category: 'manifest', function: 'activate_manifest_management_tools' },
    'manifest_status': { category: 'manifest', function: 'activate_manifest_management_tools' },
    'bootstrap_request': { category: 'bootstrap', function: 'activate_bootstrap_management_tools' },
    'bootstrap_confirmFinalize': { category: 'bootstrap', function: 'activate_bootstrap_management_tools' },
    'bootstrap_status': { category: 'bootstrap', function: 'activate_bootstrap_management_tools' },
    'diagnostics_block': { category: 'diagnostics', function: 'activate_diagnostic_stress_testing_tools' },
    'diagnostics_memoryPressure': { category: 'diagnostics', function: 'activate_diagnostic_stress_testing_tools' },
    'diagnostics_microtaskFlood': { category: 'diagnostics', function: 'activate_diagnostic_stress_testing_tools' },
    'feedback_submit': { category: 'health', function: 'activate_feedback_and_health_monitoring_tools' },
    'health_check': { category: 'health', function: 'activate_feedback_and_health_monitoring_tools' }
  };

  const mapping = toolMapping[toolName];

  if (!mapping) {
    return {
      found: true,
      tool: toolName,
      activationRequired: false,
      message: `Tool '${toolName}' not found in activation mapping. May not require activation, or tool name is incorrect.`
    };
  }

  return {
    found: true,
    tool: toolName,
    activationRequired: true,
    activationFunction: mapping.function,
    activationCategory: mapping.category,
    instructions: `To use '${toolName}' in VSCode:
1. Call: ${mapping.function}()
2. Retry tool call: ${toolName}
3. Tool should now execute successfully

Common issue: Settings.json configuration alone does NOT enable tools.`,
    settingsJsonNote: 'Ensure tool is enabled in settings.json (chat.mcp.tools.index["' + toolName + '"]: true) but this configuration alone is insufficient for activation.'
  };
});
