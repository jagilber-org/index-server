import safeRegex from 'safe-regex2';

export const MAX_REGEX_PATTERN_LENGTH = 200;

export function validateRegexKeyword(keyword: string): void {
  if (keyword.length > MAX_REGEX_PATTERN_LENGTH) {
    throw new Error(`Regex patterns must not exceed ${MAX_REGEX_PATTERN_LENGTH} characters to prevent ReDoS`);
  }
  try {
    new RegExp(keyword); // lgtm[js/regex-injection] - this IS the syntax validation step
  } catch {
    throw new Error(`Invalid regex pattern "${keyword}": check syntax and try again`);
  }
  if (/\(\?(?:[=!]|<[=!])/.test(keyword)) {
    throw new Error('Regex pattern rejected: lookaround assertions are not supported in regex search mode');
  }
  if (/\\[1-9]/.test(keyword)) {
    throw new Error('Regex pattern rejected: backreferences are not supported in regex search mode');
  }
  if (/\([^)]*[+*?}]\)[+*?{]/.test(keyword)) {
    throw new Error('Regex pattern rejected: nested quantifiers can cause catastrophic backtracking');
  }
  if (/\)[+*?}][^(]*\)[+*?{]/.test(keyword)) {
    throw new Error('Regex pattern rejected: nested quantifiers can cause catastrophic backtracking');
  }
  if (/\([^)]*\|[^)]*\)[+*?{]/.test(keyword)) {
    throw new Error('Regex pattern rejected: alternation with quantifiers can cause catastrophic backtracking');
  }
  if (!safeRegex(keyword)) {
    throw new Error('Regex pattern rejected: potentially catastrophic backtracking detected');
  }
}

/**
 * Compile a user-supplied regex pattern after running ReDoS / unsupported-
 * construct validation. This is the single trusted construction site for
 * `new RegExp(<user input>)` in the search pipeline.
 */
export function compileSafeUserRegex(pattern: string, flags: string): RegExp {
  validateRegexKeyword(pattern);
  return new RegExp(pattern, flags); // lgtm[js/regex-injection] - pattern validated by validateRegexKeyword above
}
