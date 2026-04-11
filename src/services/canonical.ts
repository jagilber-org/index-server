/**
 * Canonicalize instruction body text for hashing & comparison.
 * Non-destructive normalization choices are intentionally conservative to avoid
 * retroactive hash churn across existing index entries while still removing
 * accidental instability sources (line ending variance, trailing spaces, outer blank lines).
 *
 * Rules:
 *  - Normalize CRLF/CR to LF
 *  - Strip trailing spaces / tabs from each line
 *  - Trim leading & trailing blank lines
 *  - Collapse runs of >2 blank lines to a single blank line (optional; disabled by default)
 *
 * NOTE: We do NOT reorder semantic list blocks or collapse internal single blank lines so that
 * meaningful ordering (e.g., link lists) still produces distinct hashes.
 * @param body - Raw instruction body text to normalize
 * @param options - Optional normalization options
 * @param options.collapseMultipleBlankLines - When `true`, runs of more than one blank line are collapsed to a single blank line
 * @returns Canonicalized body string
 */
export function canonicalizeBody(body: string, options?: { collapseMultipleBlankLines?: boolean }): string {
  if(typeof body !== 'string') body = String(body||'');
  // Normalize line endings
  const text = body.replace(/\r\n?|\u2028|\u2029/g, '\n');
  // Split & trim right side whitespace
  const lines = text.split('\n').map(l => l.replace(/[ \t]+$/,''));
  // Trim leading blank lines
  while(lines.length && lines[0].trim()==='') lines.shift();
  // Trim trailing blank lines
  while(lines.length && lines[lines.length-1].trim()==='') lines.pop();
  if(options?.collapseMultipleBlankLines){
    const collapsed: string[] = [];
    let blankRun = 0;
    for(const l of lines){
      if(l.trim()===''){
        blankRun++;
        if(blankRun>1) continue; // keep only one
      } else blankRun = 0;
      collapsed.push(l);
    }
    return collapsed.join('\n');
  }
  return lines.join('\n');
}

/** Compute stable SHA-256 hash over canonicalized body.
 * @param body - Raw instruction body text
 * @returns Hex-encoded SHA-256 digest of the canonicalized body
 */
import crypto from 'crypto';
export function hashBody(body: string): string {
  const canon = canonicalizeBody(body);
  return crypto.createHash('sha256').update(canon,'utf8').digest('hex');
}
