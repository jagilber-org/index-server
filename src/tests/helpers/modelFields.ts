// Shared source-scraping helpers for the TS-interface ⇄ JSON-schema parity tests.
//
// These tests compare the field names declared on `InstructionEntry` in
// src/models/instruction.ts against schemas/instruction.schema.json. TypeScript
// types are erased at runtime, so the field list has to be read out of the source
// text — there is no reflective alternative.
//
// The scrape MUST be scoped to a single interface. Both parity tests originally
// ran `/^\s+(\w+)\??:\s/gm` across the whole module, which silently swept in the
// fields of every other interface in the file. That went unnoticed until schema v8
// added `InstructionLink { target, rel, label }` and the tests began reporting those
// three as root-level `InstructionEntry` fields missing from the JSON schema — a
// false positive, since `links` (the actual root field) was present all along.

/**
 * Returns the body text of a named top-level interface, brace-matched so nested
 * object types are included rather than truncating at the first `}`.
 * Throws if the interface is absent: a renamed or deleted interface must fail the
 * calling test loudly, not silently degrade into an empty field set that passes.
 */
export function extractInterfaceBody(source: string, interfaceName: string): string {
  const decl = new RegExp(`(?:export\\s+)?interface\\s+${interfaceName}\\b[^{]*\\{`, 'm');
  const match = decl.exec(source);
  if (!match) {
    throw new Error(`interface ${interfaceName} not found — parity test can no longer scrape it`);
  }
  const start = match.index + match[0].length;
  let depth = 1;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i);
    }
  }
  throw new Error(`interface ${interfaceName} is unterminated in the scraped source`);
}

/**
 * Field names declared directly on the named interface. Only matches `name:` /
 * `name?:` at the start of a line, so inline nested object types (e.g.
 * `changeLog?: { version: string }[]`) contribute the outer field name only.
 */
export function interfaceFieldNames(source: string, interfaceName: string): Set<string> {
  const body = extractInterfaceBody(source, interfaceName);
  const fieldRegex = /^\s+(\w+)\??:\s/gm;
  const names = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = fieldRegex.exec(body)) !== null) names.add(m[1]);
  return names;
}
