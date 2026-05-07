import { applyEdits, modify, parse, ParseError } from 'jsonc-parser';

function formatErrors(errors: ParseError[]): string {
  return errors.map(error => `${error.error} at offset ${error.offset}`).join(', ');
}

export function parseJsonc(text: string): Record<string, unknown> {
  const errors: ParseError[] = [];
  const parsed = parse(text, errors, { allowTrailingComma: true, disallowComments: false }) as unknown;
  if (errors.length > 0) throw new Error(`Invalid JSONC: ${formatErrors(errors)}`);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid JSONC: expected object root');
  }
  return parsed as Record<string, unknown>;
}

export function applyJsoncEdit(text: string, editPath: Array<string | number>, value: unknown): string {
  const errors: ParseError[] = [];
  parse(text, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length > 0) throw new Error(`Invalid JSONC: ${formatErrors(errors)}`);
  const edits = modify(text, editPath, value, {
    formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' },
    getInsertionIndex: properties => properties.length,
  });
  return applyEdits(text, edits);
}
