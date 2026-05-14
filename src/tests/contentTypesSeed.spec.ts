import { describe, expect, it } from 'vitest';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import draft7MetaSchema from 'ajv/dist/refs/json-schema-draft-07.json';
import schema from '../../schemas/instruction.schema.json';
import { buildContentTypesSeed } from '../services/seedBootstrap.contentTypes';
import { SCHEMA_VERSION } from '../versioning/schemaVersion';

function makeAjv() {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  for (const id of ['https://json-schema.org/draft-07/schema', 'https://json-schema.org/draft-07/schema#']) {
    try {
      if (!ajv.getSchema(id)) ajv.addMetaSchema({ ...draft7MetaSchema, $id: id });
    } catch { /* ignore duplicate meta-schema registration */ }
  }
  return ajv;
}

describe('contentTypesSeed (003-content-types)', () => {
  it('builds a schema-valid knowledge seed', () => {
    const seed = buildContentTypesSeed();
    expect(seed.id).toBe('003-content-types');
    expect(seed.file).toBe('003-content-types.json');
    expect(seed.json.contentType).toBe('knowledge');
    const ajv = makeAjv();
    const validate = ajv.compile(JSON.parse(JSON.stringify(schema)));
    const ok = validate(seed.json);
    if (!ok) {
      throw new Error(`content-types seed failed schema: ${JSON.stringify(validate.errors, null, 2)}`);
    }
  });

  it('lists every schema contentType and no removed contentType values', () => {
    const body = buildContentTypesSeed().json.body as string;
    const enumValues = (schema as { properties: { contentType: { enum: string[] } } })
      .properties.contentType.enum;
    for (const value of enumValues) {
      expect(body).toContain(`\`${value}\``);
    }
    expect(body).not.toContain('`reference`');
    expect(body).not.toContain('`example`');
    expect(body).not.toContain('chat-session');
  });

  it('is deterministic and uses schemaVersion from the schema enum', () => {
    const first = buildContentTypesSeed();
    const second = buildContentTypesSeed();
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    // Seed emits the latest schemaVersion (current SCHEMA_VERSION constant);
    // it must also be a member of the schema enum.
    const enumValues = (schema as { properties: { schemaVersion: { enum: string[] } } })
      .properties.schemaVersion.enum;
    expect(enumValues).toContain(first.json.schemaVersion);
    expect(first.json.schemaVersion).toBe(SCHEMA_VERSION);
  });
});
