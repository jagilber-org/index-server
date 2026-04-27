/**
 * Test suite for index_schema tool (Priority 2.1)
 *
 * Validates self-documentation of instruction schema format:
 * - Schema structure and required fields
 * - Minimal and comprehensive examples
 * - Validation rules
 * - Promotion workflow guidance
 */
import { describe, it, expect } from 'vitest';
import { getRuntimeConfig } from '../config/runtimeConfig';
import { spawnServer } from './helpers/mcpTestClient.js';

/**
 * Helper to call index_schema via SDK test client and parse result
 */
async function callSchema() {
  const conn = await spawnServer();
  const client = conn.client;
  const close = conn.close;

  try {
    const resp = await client.callTool({ name: 'index_schema', arguments: {} });

    // Parse result from test client response
    let result: any = undefined;
    if (Array.isArray(resp?.content)) {
      for (const content of resp.content) {
        if (content?.data && content.data.schema) { result = content.data; break; }
        if (typeof content?.text === 'string') {
          try {
            const parsed = JSON.parse(content.text);
            if (parsed && parsed.schema) { result = parsed; break; }
          } catch { /* ignore */ }
        }
      }
    }
    if (!result && resp && resp.schema) result = resp; // direct fallback

    return result;
  } finally {
    await close();
  }
}

describe('index_schema tool', () => {
  it('returns valid schema response with required fields', async () => {
    const result = await callSchema();

    expect(result).toBeDefined();
    expect(result.generatedAt).toBeDefined();
    expect(result.version).toBeDefined();
    expect(result.summary).toBeTruthy();

    // Core schema present
    expect(result.schema).toBeDefined();
    expect(result.schema).toBeTypeOf('object');
    expect(result.schema.$schema).toBe('https://json-schema.org/draft-07/schema#');
    expect(result.schema.title).toBe('InstructionEntry');

    // Examples present
    expect(result.minimalExample).toBeDefined();
    expect(result.minimalExample).toBeTypeOf('object');

    // Field lists
    expect(result.requiredFields).toBeDefined();
    expect(Array.isArray(result.requiredFields)).toBe(true);
    expect(result.requiredFields.length).toBeGreaterThan(0);

    expect(result.optionalFieldsCommon).toBeDefined();
    expect(Array.isArray(result.optionalFieldsCommon)).toBe(true);

    // Validation rules
    expect(result.validationRules).toBeDefined();
    expect(Array.isArray(result.validationRules)).toBe(true);
    expect(result.validationRules.length).toBeGreaterThan(0);

    // Promotion workflow
    expect(result.promotionWorkflow).toBeDefined();
    expect(Array.isArray(result.promotionWorkflow)).toBe(true);
    expect(result.promotionWorkflow.length).toBeGreaterThanOrEqual(4); // P0, pre-review, P1, P2+

    // Next steps
    expect(result.nextSteps).toBeDefined();
    expect(Array.isArray(result.nextSteps)).toBe(true);
    expect(result.nextSteps.length).toBeGreaterThan(0);
  });

  it('includes all required field names in requiredFields array', async () => {
    const result = await callSchema();

    const expectedRequired = ['id', 'title', 'body', 'priority', 'audience', 'requirement', 'categories'];
    for (const field of expectedRequired) {
      expect(result.requiredFields, `Required fields missing: ${field}`).toContain(field);
    }
  });

  it('provides minimal example with only required fields', async () => {
    const result = await callSchema();

    const minimal = result.minimalExample;
    expect(minimal.id).toBeDefined();
    expect(minimal.title).toBeDefined();
    expect(minimal.body).toBeDefined();
    expect(minimal.priority).toBeDefined();
    expect(minimal.audience).toBeDefined();
    expect(minimal.requirement).toBeDefined();
    expect(minimal.categories).toBeDefined();
    expect(Array.isArray(minimal.categories)).toBe(true);
  });

  it('includes key validation rules covering format and constraints', async () => {
    const result = await callSchema();

    const rules = result.validationRules;
    const fields = rules.map((r: any) => r.field);

    // Should cover critical fields
    expect(fields).toContain('id');
    expect(fields).toContain('title');
    expect(fields).toContain('body');
    expect(fields).toContain('priority');
    expect(fields).toContain('categories');

    // Each rule should have structure
    for (const rule of rules) {
      expect(rule.field).toBeDefined();
      expect(rule.rule).toBeDefined();
      expect(rule.constraint).toBeDefined();
    }
  });

  it('provides promotion workflow with P0 through P2+ stages', async () => {
    const result = await callSchema();

    const workflow = result.promotionWorkflow;
    const stages = workflow.map((w: any) => w.stage);

    // Expect multiple stages including P0, P1, and refinement
    expect(stages.some((s: string) => s.includes('P0'))).toBe(true);
    expect(stages.some((s: string) => s.includes('P1'))).toBe(true);
    expect(stages.some((s: string) => s.includes('P2'))).toBe(true);

    // Each stage should have checklist
    for (const stage of workflow) {
      expect(stage.stage).toBeDefined();
      expect(stage.description).toBeDefined();
      expect(Array.isArray(stage.checklistItems)).toBe(true);
      expect(stage.checklistItems.length).toBeGreaterThan(0);
    }
  });

  it('references help_overview in next steps', async () => {
    const result = await callSchema();

    const nextStepsText = result.nextSteps.join(' ');
    expect(nextStepsText).toContain('help_overview');
  });

  it('references index_dispatch for adding instructions', async () => {
    const result = await callSchema();

    const nextStepsText = result.nextSteps.join(' ');
    expect(nextStepsText).toContain('index_dispatch');
    expect(nextStepsText).toContain('add');
  });

  it('mentions INDEX_SERVER_MUTATION requirement', async () => {
    const result = await callSchema();

    const nextStepsText = result.nextSteps.join(' ');
    expect(nextStepsText).toContain('INDEX_SERVER_MUTATION');
  });

  it('includes id pattern validation rule', async () => {
    const result = await callSchema();

    const idRules = result.validationRules.filter((r: any) => r.field === 'id');
    expect(idRules.length).toBeGreaterThan(0);

    const patternRule = idRules.find((r: any) => r.rule === 'Pattern');
    expect(patternRule).toBeDefined();
    expect(patternRule.constraint).toContain('lowercase');
  });

  it('includes body length constraint', async () => {
    const result = await callSchema();

    const bodyRules = result.validationRules.filter((r: any) => r.field === 'body');
    expect(bodyRules.length).toBeGreaterThan(0);

    const lengthRule = bodyRules.find((r: any) => r.rule === 'Length');
    expect(lengthRule).toBeDefined();
    expect(lengthRule.constraint).toContain(getRuntimeConfig().index.bodyWarnLength.toLocaleString('en-US'));
  });

  it('includes priority range constraint', async () => {
    const result = await callSchema();

    const priorityRules = result.validationRules.filter((r: any) => r.field === 'priority');
    expect(priorityRules.length).toBeGreaterThan(0);

    const rangeRule = priorityRules.find((r: any) => r.rule === 'Range');
    expect(rangeRule).toBeDefined();
    expect(rangeRule.constraint).toContain('1-100');
  });

  it('documents audience enum values', async () => {
    const result = await callSchema();

    const audienceRules = result.validationRules.filter((r: any) => r.field === 'audience');
    expect(audienceRules.length).toBeGreaterThan(0);

    const enumRule = audienceRules.find((r: any) => r.rule === 'Enum');
    expect(enumRule).toBeDefined();
    expect(enumRule.constraint).toContain('individual');
    expect(enumRule.constraint).toContain('group');
    expect(enumRule.constraint).toContain('all');
  });

  it('documents requirement enum values', async () => {
    const result = await callSchema();

    const requirementRules = result.validationRules.filter((r: any) => r.field === 'requirement');
    expect(requirementRules.length).toBeGreaterThan(0);

    const enumRule = requirementRules.find((r: any) => r.rule === 'Enum');
    expect(enumRule).toBeDefined();
    expect(enumRule.constraint).toContain('mandatory');
    expect(enumRule.constraint).toContain('recommended');
    expect(enumRule.constraint).toContain('optional');
    expect(enumRule.constraint).toContain('deprecated');
  });
});
