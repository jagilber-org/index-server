import fs from 'fs';
import path from 'path';
import Ajv, { type AnySchema, type ErrorObject, type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { DOCUMENTED_INDEX_SERVER_FLAGS } from './flagCatalog';
import { getServerMap } from './formats';
import type { McpConfigFormat } from './paths';

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

function schemaRoot(): string {
  return path.resolve(__dirname, '..', '..', '..', 'schemas');
}

function schemaPathForFormat(format: McpConfigFormat): string {
  if (format === 'vscode' || format === 'vscode-global') return path.join(schemaRoot(), 'mcp.vscode.schema.json');
  if (format === 'copilot-cli') return path.join(schemaRoot(), 'mcp.copilot-cli.schema.json');
  return path.join(schemaRoot(), 'mcp.claude.schema.json');
}

function loadJson(filePath: string): AnySchema {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as AnySchema;
}

function createAjv(): Ajv {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  ajv.addSchema(loadJson(path.join(schemaRoot(), 'mcp.indexServerEnv.schema.json')), 'mcp.indexServerEnv.schema.json');
  return ajv;
}

function collectAjvErrors(validate: ValidateFunction): string[] {
  return (validate.errors ?? []).map((error: ErrorObject) => `${error.instancePath || '/'} ${error.message ?? 'failed validation'}`);
}

export function validateConfigObject(format: McpConfigFormat, config: Record<string, unknown>): ValidationResult {
  const ajv = createAjv();
  const schema = loadJson(schemaPathForFormat(format));
  const validate = ajv.compile(schema);
  const valid = validate(config);
  const errors = valid ? [] : collectAjvErrors(validate);
  try {
    for (const entry of Object.values(getServerMap(config, format))) {
      if (!entry.env) continue;
      for (const key of Object.keys(entry.env)) {
        if (key.startsWith('INDEX_SERVER_') && !DOCUMENTED_INDEX_SERVER_FLAGS.includes(key as typeof DOCUMENTED_INDEX_SERVER_FLAGS[number])) {
          errors.push(`env contains unsupported INDEX_SERVER key: ${key}`);
        }
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  return { ok: errors.length === 0, errors };
}

export function assertValidConfigObject(format: McpConfigFormat, config: Record<string, unknown>, phase: string): void {
  const result = validateConfigObject(format, config);
  if (!result.ok) throw new Error(`MCP config validation failed during ${phase}: ${result.errors.join('; ')}`);
}
