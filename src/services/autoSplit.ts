/**
 * Auto-split oversized instruction entries into cross-linked sub-instructions.
 * Used by the index loader on startup to handle entries written directly to disk
 * by agents that bypass MCP tool size validation.
 */

interface InstructionLike {
  id: string;
  title: string;
  body: string;
  priority: number;
  audience: string;
  requirement: string;
  categories: string[];
  schemaVersion?: string;
  [key: string]: unknown;
}

/**
 * Split an oversized instruction entry into multiple parts that each fit within the body limit.
 * If the entry body is within the limit, returns a single-element array with the original entry.
 *
 * Splitting strategy:
 * 1. Attempt to split by markdown H2 headings (## Section)
 * 2. If sections are still too large, split by paragraphs (double newline)
 * 3. As a last resort, split at character boundaries
 *
 * Each part gets:
 * - Sequential ID: `{original-id}-part-{n}`
 * - Preserved metadata (priority, audience, requirement, categories)
 * - Cross-link footer referencing all sibling parts
 */
export function splitOversizedEntry(entry: InstructionLike, maxLength: number): InstructionLike[] {
  if (entry.body.length <= maxLength) {
    return [{ ...entry }];
  }

  // Try heading-based split first
  let chunks = splitByHeadings(entry.body);

  // If any chunk is still too large, further split by paragraphs
  chunks = chunks.flatMap(chunk =>
    chunk.length > maxLength ? splitByParagraphs(chunk, maxLength) : [chunk]
  );

  // Last resort: hard split at character boundary
  chunks = chunks.flatMap(chunk =>
    chunk.length > maxLength ? hardSplit(chunk, maxLength) : [chunk]
  );

  // Merge tiny trailing chunks into the previous one when possible
  const merged: string[] = [];
  for (const chunk of chunks) {
    if (merged.length > 0 && merged[merged.length - 1].length + chunk.length + 2 <= maxLength) {
      merged[merged.length - 1] += '\n\n' + chunk;
    } else {
      merged.push(chunk);
    }
  }

  // If merging produced a single chunk (edge case), return as-is
  if (merged.length <= 1) {
    return [{ ...entry, body: merged[0] || entry.body.slice(0, maxLength) }];
  }

  // Generate part IDs
  const partIds = merged.map((_, i) => `${entry.id}-part-${i + 1}`);

  // Build cross-link footer
  const parts: InstructionLike[] = merged.map((chunk, i) => {
    const siblingIds = partIds.filter((_, j) => j !== i);
    const crossLinkFooter = `\n\n---\n**Cross-linked parts:** ${siblingIds.join(', ')}`;

    // Reserve space for footer in body
    const maxBodyContent = maxLength - crossLinkFooter.length;
    const bodyContent = chunk.length > maxBodyContent ? chunk.slice(0, maxBodyContent) : chunk;

    const { body: _body, id: _id, title: _title, ...rest } = entry;
    return {
      ...rest,
      id: partIds[i],
      title: `${entry.title} (Part ${i + 1}/${merged.length})`,
      body: bodyContent + crossLinkFooter,
      categories: [...entry.categories],
    } as InstructionLike;
  });

  return parts;
}

/** Split body text at ## heading boundaries */
function splitByHeadings(body: string): string[] {
  const headingPattern = /^## /m;
  if (!headingPattern.test(body)) return [body];

  const parts: string[] = [];
  const lines = body.split('\n');
  let current: string[] = [];

  for (const line of lines) {
    if (/^## /.test(line) && current.length > 0) {
      parts.push(current.join('\n').trim());
      current = [];
    }
    current.push(line);
  }
  if (current.length > 0) {
    parts.push(current.join('\n').trim());
  }

  return parts.filter(p => p.length > 0);
}

/** Split a chunk by double-newline paragraph boundaries */
function splitByParagraphs(text: string, maxLength: number): string[] {
  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let current = '';

  for (const para of paragraphs) {
    if (current.length + para.length + 2 > maxLength && current.length > 0) {
      chunks.push(current.trim());
      current = para;
    } else {
      current = current ? current + '\n\n' + para : para;
    }
  }
  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

/** Hard split at character boundaries (last resort) */
function hardSplit(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += maxLength) {
    chunks.push(text.slice(i, i + maxLength));
  }
  return chunks;
}
