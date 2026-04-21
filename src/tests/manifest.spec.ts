import { describe, it, expect } from 'vitest';
import path from 'path';
import fs from 'fs';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
// Explicitly register draft-07 meta schema under both IDs (with and without trailing #) to avoid
// runtime 'no schema with key or ref' errors when the $schema field uses the https URL with '#'.
// Ajv sometimes lacks the variant with trailing # depending on build footprint.
// This mirrors the defensive logic used in the index loader.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - module provides JSON meta-schema
import draft7MetaSchema from 'ajv/dist/refs/json-schema-draft-07.json';
import { IndexLoader } from '../services/indexLoader';

describe('index manifest', () => {
  const dir = process.env.INDEX_SERVER_DIR || path.join(process.cwd(),'instructions');
  const loader = new IndexLoader(dir);
  const result = loader.load();
  const manifestPath = path.join(dir, '_manifest.json');

  it('manifest file exists', () => {
    expect(fs.existsSync(manifestPath)).toBe(true);
  });

  it('manifest validates against schema', () => {
    const raw = fs.readFileSync(manifestPath,'utf8');
    const json = JSON.parse(raw);
    const schemaRaw = fs.readFileSync(path.join(process.cwd(),'schemas','manifest.schema.json'),'utf8');
    const schema = JSON.parse(schemaRaw);
    const ajv = new Ajv({ allErrors: true, strict: false });
    try {
      const httpsIdNoHash = 'https://json-schema.org/draft-07/schema';
      const httpsIdHash = 'https://json-schema.org/draft-07/schema#';
      if(!ajv.getSchema(httpsIdNoHash)){
        ajv.addMetaSchema({ ...draft7MetaSchema, $id: httpsIdNoHash });
      }
      if(!ajv.getSchema(httpsIdHash)){
        ajv.addMetaSchema({ ...draft7MetaSchema, $id: httpsIdHash });
      }
    } catch { /* ignore meta-schema registration issues */ }
    addFormats(ajv);
    let validate; let ok = false; let compileErr: unknown = undefined;
    try {
      validate = ajv.compile(schema);
      ok = validate(json) as boolean;
    } catch (err: unknown) {
      compileErr = err;
      // Fallback: if draft-07 meta schema still not resolvable, strip $schema and retry.
      if(err instanceof Error && /no schema with key or ref/.test(err.message)){
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete (schema as any).$schema; // remove external meta reference
        try {
          validate = ajv.compile(schema);
          ok = validate(json) as boolean;
        } catch(reErr){
          compileErr = reErr; // prefer second error
        }
      }
    }
    if(!ok){
      // Helpful diagnostics
      // eslint-disable-next-line no-console
      console.error('[manifest.validate][diagnostic]', { compileErr, errors: validate?.errors });
    }
    expect(ok, 'manifest schema validation (with fallback)').toBe(true);
  });

  it('count matches entries length and accepted count', () => {
    const raw = fs.readFileSync(manifestPath,'utf8');
    const json = JSON.parse(raw) as { count:number; entries:Array<{id:string}> };
    expect(json.count).toBe(json.entries.length);
    expect(json.count).toBe(result.entries.length);
  });

  it('entries have required hashes', () => {
    const raw = fs.readFileSync(manifestPath,'utf8');
    const json = JSON.parse(raw) as { entries:Array<{bodyHash:string; sourceHash:string}> };
    const bad = json.entries.filter(e => !/^([a-f0-9]{64})$/.test(e.bodyHash) || !/^([a-f0-9]{64})$/.test(e.sourceHash));
    expect(bad.length).toBe(0);
  });
});
