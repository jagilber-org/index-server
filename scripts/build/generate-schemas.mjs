#!/usr/bin/env node

/**
 * generate-schemas.mjs — TypeScript → JSON Schema generator for index-server
 *
 * Scans src/models/ for exported interfaces, type aliases, and enums,
 * generates JSON Schema (draft-07) for each, and builds a code model
 * summarising the entire source tree.
 *
 * Adapted from copilot-ui's generate-schemas.mjs.
 *
 * Outputs:
 *   schemas/json-schema/*.schema.json   (tracked in git)
 *   dist/schemas/json-schema/*.schema.json (mirrored to dist)
 *   schemas/index-server.code-schema.json
 *   schemas/manifest.json
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { dirname, extname, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import { Project, ts } from 'ts-morph';
import { createGenerator } from 'ts-json-schema-generator';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));

// ── CLI argument parsing ─────────────────────────────────────────────
const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('--')));
function flagValue(name) {
  const idx = args.indexOf(name);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
}
function flagList(name) {
  const val = flagValue(name);
  return val ? val.split(',').map(s => s.trim()).filter(Boolean) : null;
}

if (flags.has('--help')) {
  console.log(`
Usage: node generate-schemas.mjs [options]

Options:
  --source-roots <dirs>     Comma-separated source roots (default: src,scripts)
  --model-dirs <dirs>       Comma-separated model directories for JSON schema (default: src/models)
  --output-dir <dir>        Output directory for schemas (default: schemas)
  --no-archive              Skip archiving previous schemas
  --no-jsdoc                Omit JSDoc descriptions from code model
  --no-line-numbers         Omit line numbers from code model
  --no-type-params          Omit type parameter info from code model
  --no-decorators           Omit decorator info from code model
  --verbose                 Print detailed progress
  --help                    Show this help message
`);
  process.exit(0);
}

const VERBOSE = flags.has('--verbose');
const SKIP_ARCHIVE = flags.has('--no-archive');
const INCLUDE_JSDOC = !flags.has('--no-jsdoc');
const INCLUDE_LINE_NUMBERS = !flags.has('--no-line-numbers');
const INCLUDE_TYPE_PARAMS = !flags.has('--no-type-params');
const INCLUDE_DECORATORS = !flags.has('--no-decorators');

// Directories containing exported types for JSON schema generation
const MODEL_DIRS = flagList('--model-dirs') || ['src/models'];
// Directories scanned for the code model summary
const SOURCE_ROOTS = flagList('--source-roots') || ['src', 'scripts'];
const OUTPUT_BASE = flagValue('--output-dir') || 'schemas';

const TRACKED_SCHEMAS_DIR = join(ROOT, OUTPUT_BASE);
const TRACKED_JSON_SCHEMA_DIR = join(TRACKED_SCHEMAS_DIR, 'json-schema');
const DIST_SCHEMAS_DIR = join(ROOT, 'dist', OUTPUT_BASE);
const DIST_JSON_SCHEMA_DIR = join(DIST_SCHEMAS_DIR, 'json-schema');
const SCHEMA_ARCHIVE_DIR = join(TRACKED_SCHEMAS_DIR, 'archive');
const MAX_ARCHIVES = 100;

// ── Lifecycle ────────────────────────────────────────────────────────

if (VERBOSE) {
  console.log(`[schemas] Source roots: ${SOURCE_ROOTS.join(', ')}`);
  console.log(`[schemas] Model dirs: ${MODEL_DIRS.join(', ')}`);
  console.log(`[schemas] Output: ${OUTPUT_BASE}`);
  console.log(`[schemas] Features: jsdoc=${INCLUDE_JSDOC} lines=${INCLUDE_LINE_NUMBERS} typeParams=${INCLUDE_TYPE_PARAMS} decorators=${INCLUDE_DECORATORS}`);
}

if (!SKIP_ARCHIVE) archiveGeneratedSchemas();
resetDir(TRACKED_JSON_SCHEMA_DIR);
// Only reset the json-schema subdirectory in dist — do NOT wipe dist/schemas/
// because tsc compiles src/schemas/*.ts into dist/schemas/*.js
resetDir(DIST_JSON_SCHEMA_DIR);

const schemaTargets = discoverSchemaTargets();
const generatedSchemas = [];
const skippedJsonSchemas = [];

for (const target of schemaTargets) {
  if (target.hasTypeParameters) {
    skippedJsonSchemas.push({
      type: target.type,
      source: normalizePath(relative(ROOT, target.source)),
      reason: 'generic declarations are skipped for JSON Schema generation',
    });
    continue;
  }

  try {
    const schema = createGenerator({
      path: target.source,
      tsconfig: join(ROOT, 'tsconfig.json'),
      type: target.type,
      expose: 'export',
      jsDoc: 'extended',
      skipTypeCheck: false,
    }).createSchema(target.type);

    const file = join('json-schema', target.outputFile);
    writeMirroredJson(file, schema);
    generatedSchemas.push({
      type: target.type,
      source: normalizePath(relative(ROOT, target.source)),
      file: normalizePath(file),
    });
    console.log(`[schemas] Generated ${target.type} -> ${file}`);
  } catch (err) {
    console.warn(`[schemas] WARN: Failed to generate schema for ${target.type}: ${err.message}`);
    skippedJsonSchemas.push({
      type: target.type,
      source: normalizePath(relative(ROOT, target.source)),
      reason: `generation error: ${err.message}`,
    });
  }
}

const codeModel = buildCodeModel();
writeMirroredJson('index-server.code-schema.json', codeModel);
console.log('[schemas] Generated repo code schema -> index-server.code-schema.json');

const manifest = {
  version: PKG.version,
  generatedAt: new Date().toISOString(),
  trackedDir: normalizePath(relative(ROOT, TRACKED_SCHEMAS_DIR)),
  distDir: normalizePath(relative(ROOT, DIST_SCHEMAS_DIR)),
  jsonSchemas: generatedSchemas,
  skippedJsonSchemas,
  codeModel: {
    file: 'index-server.code-schema.json',
    sourceRoots: SOURCE_ROOTS,
    fileCount: codeModel.summary.fileCount,
    features: {
      jsdoc: INCLUDE_JSDOC,
      lineNumbers: INCLUDE_LINE_NUMBERS,
      typeParameters: INCLUDE_TYPE_PARAMS,
      decorators: INCLUDE_DECORATORS,
    },
  },
};

writeMirroredJson('manifest.json', manifest);
console.log(`[schemas] Wrote manifest for ${generatedSchemas.length} JSON schema(s) and 1 code schema`);

// ── Filesystem helpers ───────────────────────────────────────────────

function resetDir(dirPath) {
  rmSync(dirPath, { recursive: true, force: true });
  mkdirSync(dirPath, { recursive: true });
}

function archiveGeneratedSchemas() {
  // Only archive the generated json-schema/ subdir and generated manifest/code-schema, not hand-maintained files
  if (!existsSync(TRACKED_JSON_SCHEMA_DIR)) return;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const archiveTarget = join(SCHEMA_ARCHIVE_DIR, timestamp);
  mkdirSync(archiveTarget, { recursive: true });
  // Archive json-schema/ generated schemas
  if (existsSync(TRACKED_JSON_SCHEMA_DIR)) {
    cpSync(TRACKED_JSON_SCHEMA_DIR, join(archiveTarget, 'json-schema'), { recursive: true });
  }
  // Archive generated manifest and code-schema if present
  for (const file of ['manifest.json', 'index-server.code-schema.json']) {
    const src = join(TRACKED_SCHEMAS_DIR, file);
    if (existsSync(src)) cpSync(src, join(archiveTarget, file));
  }
  console.log(`[schemas] Archived previous generated schemas -> schemas/archive/${timestamp}`);
  pruneArchives();
}

function pruneArchives() {
  if (!existsSync(SCHEMA_ARCHIVE_DIR)) return;
  const archives = readdirSync(SCHEMA_ARCHIVE_DIR)
    .filter(name => statSync(join(SCHEMA_ARCHIVE_DIR, name)).isDirectory())
    .sort();
  while (archives.length > MAX_ARCHIVES) {
    const oldest = archives.shift();
    rmSync(join(SCHEMA_ARCHIVE_DIR, oldest), { recursive: true, force: true });
    console.log(`[schemas] Pruned old archive: ${oldest}`);
  }
}

function normalizePath(value) {
  return value.replace(/\\/g, '/');
}

function writeMirroredJson(relativeOutputPath, value) {
  const trackedFile = join(TRACKED_SCHEMAS_DIR, relativeOutputPath);
  const distFile = join(DIST_SCHEMAS_DIR, relativeOutputPath);
  mkdirSync(dirname(trackedFile), { recursive: true });
  mkdirSync(dirname(distFile), { recursive: true });
  const content = `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(trackedFile, content);
  writeFileSync(distFile, content);
}

// ── Type discovery ───────────────────────────────────────────────────

function discoverSchemaTargets() {
  const files = [];
  for (const modelDir of MODEL_DIRS) {
    const absDir = join(ROOT, modelDir);
    if (!existsSync(absDir)) continue;
    for (const name of readdirSync(absDir)) {
      if (extname(name) === '.ts') {
        files.push(join(absDir, name));
      }
    }
  }

  const project = new Project({ skipAddingFilesFromTsConfig: true });
  project.addSourceFilesAtPaths(files);

  const targets = [];
  for (const sourceFile of project.getSourceFiles()) {
    const sourcePath = sourceFile.getFilePath();
    for (const declaration of sourceFile.getInterfaces()) {
      if (!declaration.isExported()) continue;
      targets.push(makeTarget(sourcePath, declaration.getName(), declaration.getTypeParameters().length > 0));
    }
    for (const declaration of sourceFile.getTypeAliases()) {
      if (!declaration.isExported()) continue;
      targets.push(makeTarget(sourcePath, declaration.getName(), declaration.getTypeParameters().length > 0));
    }
    for (const declaration of sourceFile.getEnums()) {
      if (!declaration.isExported()) continue;
      targets.push(makeTarget(sourcePath, declaration.getName(), false));
    }
  }

  return targets.sort((left, right) => left.outputFile.localeCompare(right.outputFile));
}

function makeTarget(sourcePath, type, hasTypeParameters) {
  // Derive a relative path from the first matching MODEL_DIR
  let rel = normalizePath(relative(ROOT, sourcePath)).replace(/\.ts$/, '');
  for (const modelDir of MODEL_DIRS) {
    const prefix = normalizePath(modelDir) + '/';
    if (rel.startsWith(prefix)) {
      rel = rel.slice(prefix.length);
      break;
    }
  }
  return {
    source: sourcePath,
    type,
    hasTypeParameters,
    outputFile: `${rel.replace(/\//g, '-')}-${toKebab(type)}.schema.json`,
  };
}

// ── Code model ───────────────────────────────────────────────────────

function buildCodeModel() {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
      allowJs: true,
      checkJs: false,
      target: ts.ScriptTarget.ES2022,
    },
  });

  for (const root of SOURCE_ROOTS) {
    project.addSourceFilesAtPaths(join(ROOT, root, '**', '*.ts'));
    project.addSourceFilesAtPaths(join(ROOT, root, '**', '*.mjs'));
  }

  const files = project.getSourceFiles()
    .filter(sourceFile => !normalizePath(relative(ROOT, sourceFile.getFilePath())).includes('tests/'))
    .map(sourceFile => summarizeSourceFile(sourceFile))
    .sort((left, right) => left.path.localeCompare(right.path));

  const summary = {
    fileCount: files.length,
    exportCount: files.reduce((sum, file) => sum + file.exports.length, 0),
    classCount: files.reduce((sum, file) => sum + file.classes.length, 0),
    interfaceCount: files.reduce((sum, file) => sum + file.interfaces.length, 0),
    typeAliasCount: files.reduce((sum, file) => sum + file.typeAliases.length, 0),
    enumCount: files.reduce((sum, file) => sum + file.enums.length, 0),
    functionCount: files.reduce((sum, file) => sum + file.functions.length, 0),
  };

  return {
    name: PKG.name,
    version: PKG.version,
    generatedAt: new Date().toISOString(),
    sourceRoots: SOURCE_ROOTS,
    summary,
    files,
  };
}

function summarizeSourceFile(sourceFile) {
  const path = normalizePath(relative(ROOT, sourceFile.getFilePath()));
  const exports = Array.from(sourceFile.getExportedDeclarations().entries())
    .map(([name, declarations]) => ({
      name,
      kinds: Array.from(new Set(declarations.map(declaration => declaration.getKindName()))).sort(),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  return {
    path,
    imports: sourceFile.getImportDeclarations().map(declaration => ({
      module: declaration.getModuleSpecifierValue(),
      defaultImport: declaration.getDefaultImport()?.getText() ?? null,
      namedImports: declaration.getNamedImports().map(named => named.getName()),
      namespaceImport: declaration.getNamespaceImport()?.getText() ?? null,
    })),
    exports,
    classes: sourceFile.getClasses().map(classDecl => ({
      name: classDecl.getName() ?? '(anonymous)',
      isExported: classDecl.isExported(),
      extends: classDecl.getExtends()?.getExpression().getText() ?? null,
      implements: classDecl.getImplements().map(impl => impl.getText()),
      ...extractJsDoc(classDecl),
      ...extractLine(classDecl),
      ...extractTypeParams(classDecl),
      ...extractDecorators(classDecl),
      methods: classDecl.getMethods().map(method => ({
        name: method.getName(),
        isStatic: method.isStatic(),
        parameters: method.getParameters().map(parameter => ({
          name: parameter.getName(),
          type: parameter.getTypeNode()?.getText() ?? null,
          optional: parameter.isOptional(),
        })),
        returnType: method.getReturnTypeNode()?.getText() ?? null,
        ...extractJsDoc(method),
        ...extractLine(method),
        ...extractDecorators(method),
      })),
      properties: classDecl.getProperties().map(property => ({
        name: property.getName(),
        type: property.getTypeNode()?.getText() ?? null,
        isStatic: property.isStatic(),
        ...extractJsDoc(property),
        ...extractLine(property),
        ...extractDecorators(property),
      })),
    })),
    interfaces: sourceFile.getInterfaces().map(interfaceDecl => ({
      name: interfaceDecl.getName(),
      isExported: interfaceDecl.isExported(),
      extends: interfaceDecl.getExtends().map(ext => ext.getText()),
      ...extractJsDoc(interfaceDecl),
      ...extractLine(interfaceDecl),
      ...extractTypeParams(interfaceDecl),
      properties: interfaceDecl.getProperties().map(property => ({
        name: property.getName(),
        type: property.getTypeNode()?.getText() ?? null,
        optional: property.hasQuestionToken(),
        ...extractJsDoc(property),
        ...extractLine(property),
      })),
      methods: interfaceDecl.getMethods().map(method => ({
        name: method.getName(),
        parameters: method.getParameters().map(parameter => ({
          name: parameter.getName(),
          type: parameter.getTypeNode()?.getText() ?? null,
          optional: parameter.isOptional(),
        })),
        returnType: method.getReturnTypeNode()?.getText() ?? null,
        ...extractJsDoc(method),
        ...extractLine(method),
      })),
    })),
    typeAliases: sourceFile.getTypeAliases().map(typeAlias => ({
      name: typeAlias.getName(),
      isExported: typeAlias.isExported(),
      type: typeAlias.getTypeNode()?.getText() ?? null,
      ...extractJsDoc(typeAlias),
      ...extractLine(typeAlias),
      ...extractTypeParams(typeAlias),
    })),
    enums: sourceFile.getEnums().map(enumDecl => ({
      name: enumDecl.getName(),
      isExported: enumDecl.isExported(),
      members: enumDecl.getMembers().map(member => member.getName()),
      ...extractJsDoc(enumDecl),
      ...extractLine(enumDecl),
    })),
    functions: sourceFile.getFunctions().map(fn => ({
      name: fn.getName() ?? '(anonymous)',
      isExported: fn.isExported(),
      isAsync: fn.isAsync(),
      parameters: fn.getParameters().map(parameter => ({
        name: parameter.getName(),
        type: parameter.getTypeNode()?.getText() ?? null,
        optional: parameter.isOptional(),
      })),
      returnType: fn.getReturnTypeNode()?.getText() ?? null,
      ...extractJsDoc(fn),
      ...extractLine(fn),
      ...extractTypeParams(fn),
    })),
    constants: sourceFile.getVariableStatements()
      .filter(statement => statement.isExported())
      .flatMap(statement => statement.getDeclarations().map(declaration => {
        const base = {
          name: declaration.getName(),
          type: declaration.getTypeNode()?.getText() ?? null,
          initializerKind: declaration.getInitializer()?.getKindName() ?? null,
          ...extractJsDoc(statement),
          ...extractLine(declaration),
        };
        const init = declaration.getInitializer();
        if (init && (init.getKindName() === 'ArrowFunction' || init.getKindName() === 'FunctionExpression')) {
          base.parameters = init.getParameters().map(parameter => ({
            name: parameter.getName(),
            type: parameter.getTypeNode()?.getText() ?? null,
            optional: parameter.isOptional(),
          }));
          base.returnType = init.getReturnTypeNode()?.getText() ?? null;
          base.isAsync = init.isAsync?.() ?? false;
        }
        return base;
      })),
  };
}

// ── Enrichment helpers ───────────────────────────────────────────────

function extractJsDoc(node) {
  if (!INCLUDE_JSDOC) return {};
  try {
    const jsDocs = node.getJsDocs?.();
    if (!jsDocs || jsDocs.length === 0) return {};
    const text = jsDocs.map(doc => doc.getDescription().trim()).filter(Boolean).join('\n');
    return text ? { description: text } : {};
  } catch { return {}; }
}

function extractLine(node) {
  if (!INCLUDE_LINE_NUMBERS) return {};
  try {
    return { line: node.getStartLineNumber() };
  } catch { return {}; }
}

function extractTypeParams(node) {
  if (!INCLUDE_TYPE_PARAMS) return {};
  try {
    const params = node.getTypeParameters?.();
    if (!params || params.length === 0) return {};
    return {
      typeParameters: params.map(tp => {
        const constraint = tp.getConstraint()?.getText() ?? null;
        const defaultType = tp.getDefault()?.getText() ?? null;
        return { name: tp.getName(), constraint, default: defaultType };
      }),
    };
  } catch { return {}; }
}

function extractDecorators(node) {
  if (!INCLUDE_DECORATORS) return {};
  try {
    const decorators = node.getDecorators?.();
    if (!decorators || decorators.length === 0) return {};
    return {
      decorators: decorators.map(d => ({
        name: d.getName(),
        arguments: d.getArguments().map(a => a.getText()),
      })),
    };
  } catch { return {}; }
}

function toKebab(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}
