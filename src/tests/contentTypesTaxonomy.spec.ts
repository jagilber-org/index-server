import { describe, expect, it } from 'vitest';
import schema from '../../schemas/instruction.schema.json';
import { _getCanonicalSeeds } from '../services/seedBootstrap';
import { validateInstructionInputEnumMembership } from '../services/instructionRecordValidation';
import { migrateInstructionRecord, SCHEMA_VERSION } from '../versioning/schemaVersion';
import { getToolRegistry } from '../services/toolRegistry';
import { getZodEnhancedRegistry } from '../services/toolRegistry.zod';
import { validateParams } from '../services/validationService';

const CANONICAL_CONTENT_TYPES = [
  'agent',
  'skill',
  'instruction',
  'prompt',
  'workflow',
  'knowledge',
  'template',
  'integration',
] as const;

function schemaContentTypes(): string[] {
  return (schema as { properties: { contentType: { enum: string[] } } }).properties.contentType.enum;
}

describe('canonical content type taxonomy', () => {
  it('instruction schema exposes exactly the eight canonical content types', () => {
    expect(schemaContentTypes()).toEqual(CANONICAL_CONTENT_TYPES);
    expect(schemaContentTypes()).not.toContain('reference');
    expect(schemaContentTypes()).not.toContain('example');
    expect(schemaContentTypes()).not.toContain('chat-session');
  });

  it('schemaVersion is bumped to 6 in schema and migration constant', () => {
    const enumValues = (schema as { properties: { schemaVersion: { enum: string[] } } })
      .properties.schemaVersion.enum;
    expect(enumValues).toEqual(['6']);
    expect(SCHEMA_VERSION).toBe('6');
  });

  it('input validation rejects removed contentType values instead of normalizing them', () => {
    for (const contentType of ['reference', 'example', 'chat-session']) {
      const errs = validateInstructionInputEnumMembership({ contentType });
      expect(errs).toContain(`/contentType: must be one of ${CANONICAL_CONTENT_TYPES.join(', ')}`);
    }
  });

  it('migration leaves invalid persisted contentType values invalid for quarantine/rejection', () => {
    for (const contentType of ['reference', 'example', 'chat-session']) {
      const rec: Record<string, unknown> = {
        id: `legacy-${contentType.replace('-', '')}`,
        title: 'Legacy',
        body: 'Legacy content type should not be silently rewritten.',
        priority: 50,
        audience: 'all',
        requirement: 'optional',
        categories: ['legacy'],
        contentType,
        schemaVersion: '5',
      };
      migrateInstructionRecord(rec);
      expect(rec.contentType).toBe(contentType);
      expect(rec.schemaVersion).toBe('6');
    }
  });

  it('tool registry and Zod validation expose the same canonical contentType enum', () => {
    const registry = getToolRegistry();
    const searchSchema = registry.find(t => t.name === 'index_search')!.inputSchema as {
      properties: { contentType: { enum: string[] } };
    };
    expect(searchSchema.properties.contentType.enum).toEqual(CANONICAL_CONTENT_TYPES);

    getZodEnhancedRegistry();
    const ok = validateParams('index_add', {
      entry: {
        id: 'canonical-skill',
        title: 'Canonical skill',
        body: 'Skill is a canonical content type.',
        contentType: 'skill',
      },
      lax: true,
      overwrite: true,
    });
    expect(ok.ok).toBe(true);

    const rejected = validateParams('index_add', {
      entry: {
        id: 'legacy-reference',
        title: 'Legacy reference',
        body: 'Reference is not a canonical content type.',
        contentType: 'reference',
      },
      lax: true,
      overwrite: true,
    });
    expect(rejected.ok).toBe(false);
  });

  it('registers the schema-derived 003-content-types canonical seed', () => {
    const seeds = _getCanonicalSeeds();
    expect(seeds).toContainEqual({ id: '003-content-types', file: '003-content-types.json' });
  });
});
