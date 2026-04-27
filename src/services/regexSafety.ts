import safeRegex from 'safe-regex2';

export const MAX_REGEX_PATTERN_LENGTH = 200;

export function getRegexSafetyError(pattern: string): string | undefined {
  if (pattern.length > MAX_REGEX_PATTERN_LENGTH) {
    return 'Regex patterns must not exceed 200 characters to prevent ReDoS';
  }
  if (/\([^)]*[+*}]\)[+*{]/.test(pattern)) {
    return 'Regex pattern rejected: nested quantifiers can cause catastrophic backtracking';
  }
  if (/\)[+*}][^(]*\)[+*{]/.test(pattern)) {
    return 'Regex pattern rejected: nested quantifiers can cause catastrophic backtracking';
  }
  if (/\([^)]*\|[^)]*\)[+*]{1,}/.test(pattern)) {
    return 'Regex pattern rejected: alternation with quantifiers can cause catastrophic backtracking';
  }
  try {
    new RegExp(pattern);
  } catch {
    return `Invalid regex pattern "${pattern}": check syntax and try again`;
  }
  if (!safeRegex(pattern)) {
    return 'Regex pattern rejected: potentially catastrophic backtracking detected';
  }
  return undefined;
}

export function compileSafeRegex(pattern: string, flags?: string): { regex?: RegExp; error?: string } {
  const error = getRegexSafetyError(pattern);
  if (error) {
    return { error };
  }
  try {
    return { regex: new RegExp(pattern, flags) };
  } catch {
    return { error: `Invalid regex pattern "${pattern}": check syntax and try again` };
  }
}
