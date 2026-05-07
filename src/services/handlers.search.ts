/**
 * MCP Instructions Search Handler
 *
 * Provides keyword-based search functionality for discovering instruction IDs.
 * This is the PRIMARY discovery tool for MCP clients to find relevant instructions
 * before retrieving detailed content via instructions/get or index_dispatch.
 *
 * Search Strategy:
 * - Multi-keyword support with configurable matching
 * - Searches instruction titles, bodies, and optionally categories
 * - Returns lightweight ID list for efficient follow-up queries
 * - Case-insensitive by default with case-sensitive option
 * - Relevance scoring based on match frequency and location
 *
 * MCP Compliance:
 * - Full JSON Schema validation
 * - Structured error responses
 * - Proper tool registration
 * - Input sanitization and limits
 */

import { registerHandler } from '../server/registry';
import { logDebug, logInfo, logWarn, logError } from './logger';
import { InstructionEntry } from '../models/instruction';
import { ensureLoaded, incrementUsage } from './indexContext';
import { semanticError } from './errors';
import { getRuntimeConfig } from '../config/runtimeConfig';
import { cosineSimilarity, embedText, getInstructionEmbeddings } from './embeddingService';
import safeRegex from 'safe-regex2';

const SEARCH_SCHEMA = {
  type: 'object',
  required: ['keywords'],
  properties: {
    keywords: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 100 }, minItems: 1, maxItems: 10, description: 'Array of search keywords (each word separately for best results)' },
    mode: { type: 'string', enum: ['keyword', 'regex', 'semantic'], description: 'Search mode: keyword (substring match), regex (treat keywords as regex patterns), or semantic (embedding-based similarity). Default is semantic when INDEX_SERVER_SEMANTIC_ENABLED=1, otherwise keyword.' },
    limit: { type: 'number', minimum: 1, maximum: 100, default: 50 },
    includeCategories: { type: 'boolean', default: false },
    caseSensitive: { type: 'boolean', default: false },
    contentType: { type: 'string', enum: ['instruction', 'template', 'workflow', 'reference', 'example', 'agent'] }
  },
  example: { keywords: ['build', 'validate', 'discipline'], limit: 10, includeCategories: true }
};

const VALID_MODES = ['keyword', 'regex', 'semantic'] as const;
type SearchMode = typeof VALID_MODES[number];

interface SearchParams {
  keywords: string[];
  mode?: SearchMode;
  limit?: number;
  includeCategories?: boolean;
  caseSensitive?: boolean;
  contentType?: string; // Filter by content type: instruction, template, workflow, reference, example
}

export type SearchMatchedField = 'id' | 'title' | 'semanticSummary' | 'body' | 'categories';

export interface SearchResult {
  instructionId: string;
  relevanceScore: number;
  matchedFields: SearchMatchedField[];
}

export interface SearchResponse {
  results: SearchResult[];
  totalMatches: number;
  query: {
    keywords: string[];
    mode: SearchMode;
    limit: number;
    includeCategories: boolean;
    caseSensitive: boolean;
    contentType?: string;
  };
  executionTimeMs: number;
  /** Set when the original multi-word keywords yielded 0 results and were auto-tokenized into individual words */
  autoTokenized?: boolean;
  /** Hints for improving search results when matches are low or zero */
  hints?: string[];
  /** Post-retrieval hints for MCP clients (e.g. call usage_track, feedback_submit) */
  _meta?: { afterRetrieval: string[] };
}

interface KeywordScoreResult {
  score: number;
  matchedFields: SearchMatchedField[];
}

interface KeywordSearchContext {
  normalizedKeywords: string[];
  keywordWeights: Map<string, number>;
  totalKeywordWeight: number;
}

interface CompiledRegexKeyword {
  source: string;
  testRegex: RegExp;
  countRegex: RegExp;
}

interface InternalSearchParams extends SearchParams {
  compiledRegexKeywords?: CompiledRegexKeyword[];
}

const MAX_REGEX_PATTERN_LENGTH = 200;

function normalizeSearchText(text: string, caseSensitive: boolean): string {
  const normalized = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[-_/\\.:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return caseSensitive ? normalized : normalized.toLowerCase();
}

function countSubstringMatches(text: string, searchTerm: string): number {
  if (!searchTerm || !text) return 0;
  let count = 0;
  let offset = 0;
  while (offset <= text.length) {
    const index = text.indexOf(searchTerm, offset);
    if (index === -1) break;
    count++;
    offset = index + Math.max(searchTerm.length, 1);
  }
  return count;
}

function findOrderedKeywordSpan(text: string, keywords: string[]): number | undefined {
  if (!text || keywords.length < 2) return undefined;

  let searchFrom = 0;
  let firstIndex: number | undefined;
  let lastEnd = 0;

  for (const keyword of keywords) {
    const index = text.indexOf(keyword, searchFrom);
    if (index === -1) return undefined;
    if (firstIndex === undefined) firstIndex = index;
    lastEnd = index + keyword.length;
    searchFrom = index + keyword.length;
  }

  return firstIndex === undefined ? undefined : lastEnd - firstIndex;
}

function calculateOrderedProximityBonus(text: string, keywords: string[], maxBonus: number): number {
  const span = findOrderedKeywordSpan(text, keywords);
  if (span === undefined) return 0;

  const minimumSpan = keywords.reduce((total, keyword) => total + keyword.length, 0);
  const gap = Math.max(0, span - minimumSpan);
  return Math.max(0, maxBonus - Math.floor(gap / 6));
}

function buildInstructionSearchText(
  instruction: InstructionEntry,
  caseSensitive: boolean,
  includeCategories: boolean
): string {
  const parts = [
    instruction.id,
    instruction.title,
    instruction.semanticSummary || '',
    instruction.body,
  ];

  if (includeCategories) {
    parts.push((instruction.categories || []).join(' '));
  }

  return normalizeSearchText(parts.join(' '), caseSensitive);
}

function buildKeywordSearchContext(
  instructions: InstructionEntry[],
  keywords: string[],
  caseSensitive: boolean,
  includeCategories: boolean
): KeywordSearchContext {
  const normalizedKeywords = [...new Set(
    keywords
      .map(keyword => normalizeSearchText(keyword, caseSensitive))
      .filter(keyword => keyword.length > 0)
  )];

  const keywordWeights = new Map<string, number>();
  if (normalizedKeywords.length === 0) {
    return { normalizedKeywords, keywordWeights, totalKeywordWeight: 0 };
  }

  const searchableDocuments = instructions.map(instruction => buildInstructionSearchText(instruction, caseSensitive, includeCategories));
  const documentCount = Math.max(searchableDocuments.length, 1);

  for (const keyword of normalizedKeywords) {
    const documentFrequency = searchableDocuments.reduce((count, documentText) => (
      documentText.includes(keyword) ? count + 1 : count
    ), 0);
    const weight = 1 + (Math.log((documentCount + 1) / (documentFrequency + 1)) * 1.5);
    keywordWeights.set(keyword, Math.min(4, Math.max(1, weight)));
  }

  const totalKeywordWeight = normalizedKeywords.reduce((sum, keyword) => sum + (keywordWeights.get(keyword) ?? 1), 0);
  return { normalizedKeywords, keywordWeights, totalKeywordWeight };
}

/**
 * Calculate relevance score for an instruction based on keyword matches
 */
function calculateRelevance(
  instruction: InstructionEntry,
  keywords: string[],
  caseSensitive: boolean,
  includeCategories: boolean,
  mode: SearchMode = 'keyword',
  keywordContext?: KeywordSearchContext,
  regexKeywords?: CompiledRegexKeyword[]
): KeywordScoreResult {
  let score = 0;
  const matchedFieldSet = new Set<SearchMatchedField>();

  const prepareText = (text: string) => caseSensitive ? text : text.toLowerCase();
  const preparedKeywords = keywords.map(k => mode === 'keyword' ? prepareText(k) : k);
  const regexFlags = caseSensitive ? 'g' : 'gi';
  const compiledRegexKeywords = mode === 'regex'
    ? (regexKeywords ?? keywords.map((keyword) => {
      // Defense-in-depth: production callers route through compileRegexKeywords →
      // validateRegexKeyword. Re-validate here in the fallback path so direct
      // invocations (tests, future handlers) cannot bypass ReDoS / unsupported-
      // construct rejection. Throws on invalid pattern.
      return {
        source: keyword,
        testRegex: compileSafeUserRegex(keyword, caseSensitive ? '' : 'i'),
        countRegex: compileSafeUserRegex(keyword, regexFlags),
      };
    }))
    : [];

  // Build matchers: regex mode uses raw patterns, keyword mode uses substring/escaped regex
  const testMatch = (text: string, keyword: string | CompiledRegexKeyword): boolean => {
    if (mode === 'regex') {
      try {
        const compiled = keyword as CompiledRegexKeyword;
        compiled.testRegex.lastIndex = 0;
        return compiled.testRegex.test(text); // lgtm[js/regex-injection] — patterns pre-validated and pre-compiled at handler entry
      } catch { return false; }
    }
    return prepareText(text).includes(prepareText(keyword as string));
  };

  if (mode === 'keyword') {
    const normalizedId = normalizeSearchText(instruction.id, caseSensitive);
    const normalizedTitle = normalizeSearchText(instruction.title, caseSensitive);
    const normalizedSummary = normalizeSearchText(instruction.semanticSummary || '', caseSensitive);
    const normalizedBody = normalizeSearchText(instruction.body, caseSensitive);
    const normalizedCategoryValues = (instruction.categories || []).map(category => normalizeSearchText(category, caseSensitive));
    const normalizedCategoryText = normalizedCategoryValues.join(' ');
    const normalizedKeywords = keywordContext?.normalizedKeywords ?? keywords
      .map(keyword => normalizeSearchText(keyword, caseSensitive))
      .filter(keyword => keyword.length > 0);
    const keywordWeights = keywordContext?.keywordWeights ?? new Map<string, number>();
    const uniqueMatches = new Set<string>();

    for (const normalizedKeyword of normalizedKeywords) {
      if (!normalizedKeyword) continue;
      const keywordWeight = keywordWeights.get(normalizedKeyword) ?? 1;

      let keywordMatched = false;

      if (normalizedId === normalizedKeyword) {
        score += 40 * keywordWeight;
        matchedFieldSet.add('id');
        keywordMatched = true;
      } else if (normalizedId.startsWith(normalizedKeyword)) {
        score += 28 * keywordWeight;
        matchedFieldSet.add('id');
        keywordMatched = true;
      } else if (normalizedId.includes(normalizedKeyword)) {
        score += 18 * keywordWeight;
        matchedFieldSet.add('id');
        keywordMatched = true;
      }

      const titleMatches = countSubstringMatches(normalizedTitle, normalizedKeyword);
      if (titleMatches > 0) {
        score += (normalizedTitle === normalizedKeyword ? 20 : Math.min(titleMatches * 10, 20)) * keywordWeight;
        matchedFieldSet.add('title');
        keywordMatched = true;
      }

      const summaryMatches = countSubstringMatches(normalizedSummary, normalizedKeyword);
      if (summaryMatches > 0) {
        score += (normalizedSummary === normalizedKeyword ? 14 : Math.min(summaryMatches * 7, 14)) * keywordWeight;
        matchedFieldSet.add('semanticSummary');
        keywordMatched = true;
      }

      const bodyMatches = countSubstringMatches(normalizedBody, normalizedKeyword);
      if (bodyMatches > 0) {
        score += Math.min(bodyMatches * 2, 20) * keywordWeight;
        matchedFieldSet.add('body');
        keywordMatched = true;
      }

      if (includeCategories && normalizedCategoryValues.length > 0) {
        const exactCategoryMatch = normalizedCategoryValues.some(category => category === normalizedKeyword);
        const categoryMatches = exactCategoryMatch
          ? 1
          : countSubstringMatches(normalizedCategoryText, normalizedKeyword);
        if (categoryMatches > 0) {
          score += (exactCategoryMatch ? 8 : Math.min(categoryMatches * 3, 9)) * keywordWeight;
          matchedFieldSet.add('categories');
          keywordMatched = true;
        }
      }

      if (keywordMatched) uniqueMatches.add(normalizedKeyword);
    }

    if (uniqueMatches.size > 1) {
      const matchedWeight = Array.from(uniqueMatches).reduce((sum, keyword) => sum + (keywordWeights.get(keyword) ?? 1), 0);
      const strongestWeight = Math.max(...Array.from(uniqueMatches).map(keyword => keywordWeights.get(keyword) ?? 1));
      score += (matchedWeight - strongestWeight) * 5;
      if (keywordContext && keywordContext.totalKeywordWeight > 0) {
        score += (matchedWeight / keywordContext.totalKeywordWeight) * 8;
      }
    }

    if (normalizedKeywords.length > 1) {
      score += calculateOrderedProximityBonus(normalizedId, normalizedKeywords, 18);
      score += calculateOrderedProximityBonus(normalizedTitle, normalizedKeywords, 14);
      score += calculateOrderedProximityBonus(normalizedSummary, normalizedKeywords, 10);
      score += calculateOrderedProximityBonus(normalizedBody, normalizedKeywords, 8);
      if (includeCategories) {
        score += calculateOrderedProximityBonus(normalizedCategoryText, normalizedKeywords, 4);
      }
    }

    return { score, matchedFields: Array.from(matchedFieldSet) };
  }

  const countMatches = (text: string, keyword: string | CompiledRegexKeyword): number => {
    if (mode === 'regex') {
      try {
        const compiled = keyword as CompiledRegexKeyword;
        compiled.countRegex.lastIndex = 0;
        return (text.match(compiled.countRegex) || []).length; // lgtm[js/regex-injection] — patterns pre-validated and pre-compiled at handler entry
      } catch { return 0; }
    }
    return (text.match(new RegExp(escapeRegex(keyword as string), regexFlags)) || []).length;
  };

  let idMatches = 0;
  for (const keyword of mode === 'regex' ? compiledRegexKeywords : preparedKeywords) {
    if (testMatch(instruction.id, keyword)) {
      idMatches += countMatches(instruction.id, keyword);
    }
  }
  if (idMatches > 0) {
    score += idMatches * 18;
    matchedFieldSet.add('id');
  }

  let titleMatches = 0;
  for (const keyword of mode === 'regex' ? compiledRegexKeywords : preparedKeywords) {
    titleMatches += countMatches(instruction.title, keyword);
  }
  if (titleMatches > 0) {
    score += titleMatches * 10;
    matchedFieldSet.add('title');
  }

  let summaryMatches = 0;
  for (const keyword of mode === 'regex' ? compiledRegexKeywords : preparedKeywords) {
    summaryMatches += countMatches(instruction.semanticSummary || '', keyword);
  }
  if (summaryMatches > 0) {
    score += Math.min(summaryMatches * 7, 14);
    matchedFieldSet.add('semanticSummary');
  }

  let bodyMatches = 0;
  for (const keyword of mode === 'regex' ? compiledRegexKeywords : preparedKeywords) {
    bodyMatches += countMatches(instruction.body, keyword);
  }
  if (bodyMatches > 0) {
    score += Math.min(bodyMatches * 2, 20);
    matchedFieldSet.add('body');
  }

  if (includeCategories && instruction.categories?.length) {
    const categoryText = instruction.categories.join(' ');
    let categoryMatches = 0;
    for (const keyword of mode === 'regex' ? compiledRegexKeywords : preparedKeywords) {
      categoryMatches += countMatches(categoryText, keyword);
    }
    if (categoryMatches > 0) {
      score += Math.min(categoryMatches * 3, 9);
      matchedFieldSet.add('categories');
    }
  }

  const uniqueMatches = new Set<string>();
  for (const keyword of mode === 'regex' ? compiledRegexKeywords : preparedKeywords) {
    const keywordSource = mode === 'regex' ? (keyword as CompiledRegexKeyword).source : keyword as string;
    if (testMatch(instruction.id, keyword) ||
        testMatch(instruction.title, keyword) ||
        testMatch(instruction.semanticSummary || '', keyword) ||
        testMatch(instruction.body, keyword) ||
        (includeCategories && instruction.categories?.some((cat: string) => testMatch(cat, keyword)))) {
      uniqueMatches.add(keywordSource);
    }
  }

  if (uniqueMatches.size > 1) {
    score += (uniqueMatches.size - 1) * 5;
  }

  return { score, matchedFields: Array.from(matchedFieldSet) };
}

/**
 * Escape special regex characters
 */
function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizeKeywords(keywords: string[]): string[] {
  return keywords
    .filter(k => typeof k === 'string' && k.trim().length > 0)
    .map(k => k.trim())
    .slice(0, 10);
}

function validateRegexKeyword(keyword: string): void {
  if (keyword.length > MAX_REGEX_PATTERN_LENGTH) {
    throw new Error(`Regex patterns must not exceed ${MAX_REGEX_PATTERN_LENGTH} characters to prevent ReDoS`);
  }
  try {
    new RegExp(keyword); // lgtm[js/regex-injection] — this IS the syntax validation step
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
 * `new RegExp(<user input>)` in the search pipeline; all callers must route
 * through here so the validation step is provably adjacent to construction.
 */
function compileSafeUserRegex(pattern: string, flags: string): RegExp {
  validateRegexKeyword(pattern);
  return new RegExp(pattern, flags); // lgtm[js/regex-injection] — pattern validated by validateRegexKeyword above
}

function compileRegexKeywords(keywords: string[], caseSensitive: boolean): CompiledRegexKeyword[] {
  return keywords.map((keyword) => ({
    source: keyword,
    testRegex: compileSafeUserRegex(keyword, caseSensitive ? '' : 'i'),
    countRegex: compileSafeUserRegex(keyword, caseSensitive ? 'g' : 'gi'),
  }));
}

/**
 * Load and search instructions from the index
 */
function performSearch(params: InternalSearchParams): SearchResponse {
  const startTime = performance.now();

  // Load instruction index state
  const state = ensureLoaded();

  if (!state || !state.list) {
    throw new Error('instruction index not available');
  }

  // Ensure defaults are explicitly applied
  const keywords = params.keywords;
  const mode = params.mode ?? (getRuntimeConfig().semantic.enabled ? 'semantic' : 'keyword');
  const limit = params.limit ?? 50;
  const includeCategories = params.includeCategories ?? false;
  const caseSensitive = params.caseSensitive ?? false;
  const contentType = params.contentType;

  // Validate contentType if provided
  const validContentTypes = ['instruction', 'template', 'workflow', 'reference', 'example', 'agent'];
  if (contentType && !validContentTypes.includes(contentType)) {
    throw new Error(`Invalid contentType: must be one of ${validContentTypes.join(', ')}`);
  }

  // Validate and sanitize keywords
  const sanitizedKeywords = sanitizeKeywords(keywords);

  if (sanitizedKeywords.length === 0) {
    throw new Error('At least one valid keyword is required');
  }

  const results: SearchResult[] = [];
  const searchableInstructions = state.list.filter(instruction => {
    if (!contentType) return true;
    const instrContentType = instruction.contentType || 'instruction';
    return instrContentType === contentType;
  });
  const keywordContext = mode === 'keyword'
    ? buildKeywordSearchContext(searchableInstructions, sanitizedKeywords, caseSensitive, includeCategories)
    : undefined;

  // Search through all instructions
  for (const instruction of state.list) {
    // Filter by contentType if specified
    if (contentType) {
      const instrContentType = instruction.contentType || 'instruction';
      if (instrContentType !== contentType) {
        continue; // Skip instructions that don't match the contentType filter
      }
    }

    const { score, matchedFields } = calculateRelevance(
      instruction,
      sanitizedKeywords,
      caseSensitive,
      includeCategories,
      mode,
      keywordContext,
      params.compiledRegexKeywords
    );

    if (score > 0) {
      results.push({
        instructionId: instruction.id,
        relevanceScore: score,
        matchedFields
      });
    }
  }

  // Sort by relevance score (descending) and apply limit
  results.sort((a, b) => b.relevanceScore - a.relevanceScore);
  const limitedResults = results.slice(0, Math.min(limit, 100));

  const executionTime = performance.now() - startTime;

  logInfo(`[search] Search completed: ${sanitizedKeywords.length} keywords, ${limitedResults.length}/${results.length} results, ${executionTime}ms`);

  return {
    results: limitedResults,
    totalMatches: results.length,
    query: {
      keywords: sanitizedKeywords,
      mode,
      limit: Math.min(limit, 100),
      includeCategories,
      caseSensitive,
      contentType
    },
    executionTimeMs: executionTime
  };
}

/**
 * Perform semantic (embedding-based) search.
 * Computes cosine similarity between query embedding and instruction embeddings.
 */
async function performSemanticSearch(params: SearchParams): Promise<SearchResponse> {
  const startTime = performance.now();
  const state = ensureLoaded();
  if (!state || !state.list) {
    throw new Error('instruction index not available');
  }

  const cfg = getRuntimeConfig().semantic;
  const queryText = params.keywords.join(' ');
  const limit = Math.min(params.limit ?? 50, 100);
  const contentType = params.contentType;

  logInfo(`[search] Semantic search starting: query="${queryText}", device=${cfg.device}, model=${cfg.model}, index=${state.list.length} entries`);

  // Get embeddings for query and index
  const embedStart = performance.now();
  const queryVec = await embedText(queryText, cfg.model, cfg.cacheDir, cfg.device, cfg.localOnly);
  logDebug(`[search] Query embedding computed in ${(performance.now() - embedStart).toFixed(1)}ms, dimensions=${queryVec.length}`);

  const indexEmbedStart = performance.now();
  const instrEmbeddings = await getInstructionEmbeddings(
    state.list, state.hash, cfg.embeddingPath, cfg.model, cfg.cacheDir, cfg.device, cfg.localOnly
  );
  logDebug(`[search] index embeddings ready in ${(performance.now() - indexEmbedStart).toFixed(1)}ms, entries=${Object.keys(instrEmbeddings).length}`);

  // Score each instruction
  const scored: SearchResult[] = [];
  for (const instruction of state.list) {
    if (contentType) {
      const instrContentType = instruction.contentType || 'instruction';
      if (instrContentType !== contentType) continue;
    }
    const vec = instrEmbeddings[instruction.id];
    if (!vec) continue;
    const similarity = cosineSimilarity(queryVec, vec);
    if (similarity > 0) {
      scored.push({
        instructionId: instruction.id,
        relevanceScore: Math.round(similarity * 100), // normalize to 0-100 scale
        matchedFields: ['body'], // semantic matches are conceptual, mark as body
      });
    }
  }

  scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
  const limitedResults = scored.slice(0, limit);
  const executionTime = performance.now() - startTime;

  logInfo(`[search] Semantic search completed: "${queryText}", ${limitedResults.length}/${scored.length} results, ${executionTime}ms`);

  return {
    results: limitedResults,
    totalMatches: scored.length,
    query: {
      keywords: params.keywords,
      mode: 'semantic',
      limit,
      includeCategories: params.includeCategories ?? false,
      caseSensitive: params.caseSensitive ?? false,
      contentType,
    },
    executionTimeMs: executionTime,
  };
}

/**
 * MCP Handler for index_search
 */
export async function handleInstructionsSearch(params: SearchParams): Promise<SearchResponse> {
  try {
    // Input validation
    if (!params || typeof params !== 'object') {
      throw new Error('Invalid parameters: expected object');
    }

    if (!Array.isArray(params.keywords)) {
      throw new Error('Invalid keywords: expected array');
    }

    if (params.keywords.length === 0) {
      throw new Error('At least one keyword is required');
    }

    if (params.keywords.length > 10) {
      throw new Error('Maximum 10 keywords allowed');
    }

    // Validate keyword strings
    for (const keyword of params.keywords) {
      if (typeof keyword !== 'string') {
        throw new Error('All keywords must be strings');
      }
      if (keyword.trim().length === 0) {
        throw new Error('Keywords cannot be empty');
      }
      if (keyword.length > 100 && params.mode !== 'regex') {
        throw new Error('Keywords cannot exceed 100 characters');
      }
    }

    // Validate optional parameters
    if (params.limit !== undefined) {
      if (typeof params.limit !== 'number' || params.limit < 1 || params.limit > 100) {
        throw new Error('Limit must be a number between 1 and 100');
      }
    }

    if (params.includeCategories !== undefined && typeof params.includeCategories !== 'boolean') {
      throw new Error('includeCategories must be a boolean');
    }

    if (params.caseSensitive !== undefined && typeof params.caseSensitive !== 'boolean') {
      throw new Error('caseSensitive must be a boolean');
    }

    if (params.contentType !== undefined) {
      if (typeof params.contentType !== 'string') {
        throw new Error('contentType must be a string');
      }
      const validContentTypes = ['instruction', 'template', 'workflow', 'reference', 'example', 'agent'];
      if (!validContentTypes.includes(params.contentType)) {
        throw new Error(`contentType must be one of: ${validContentTypes.join(', ')}`);
      }
    }

    // Validate mode parameter
    const mode = params.mode ?? (getRuntimeConfig().semantic.enabled ? 'semantic' : 'keyword');
    if (!VALID_MODES.includes(mode as SearchMode)) {
      throw new Error(`Invalid mode: must be one of ${VALID_MODES.join(', ')}`);
    }

    logInfo(`[search] Search request: mode=${mode}, keywords=[${params.keywords.join(', ')}], limit=${params.limit ?? 50}, contentType=${params.contentType ?? 'any'}`);

    const sanitizedKeywords = sanitizeKeywords(params.keywords);
    // Regex mode validation: pattern safety checks
    const compiledRegexKeywords = mode === 'regex'
      ? compileRegexKeywords(sanitizedKeywords, params.caseSensitive ?? false)
      : undefined;

    // Semantic mode: check feature flag
    if (mode === 'semantic') {
      const cfg = getRuntimeConfig().semantic;
      logDebug(`[search] Semantic config: enabled=${cfg.enabled}, device=${cfg.device}, model=${cfg.model}, localOnly=${cfg.localOnly}`);
      if (!cfg.enabled) {
        logWarn('[search] Semantic search requested but INDEX_SERVER_SEMANTIC_ENABLED is not set');
        throw new Error('Semantic search mode is disabled. Set INDEX_SERVER_SEMANTIC_ENABLED=1 to enable.');
      }
    }

    // Ensure case-insensitive search by default
    const searchParams: InternalSearchParams = {
      keywords: sanitizedKeywords,
      mode: mode as SearchMode,
      limit: params.limit,
      includeCategories: params.includeCategories,
      caseSensitive: params.caseSensitive ?? false, // Explicit default to false for case-insensitive search
      contentType: params.contentType,
      compiledRegexKeywords,
    };

    // Semantic mode: embedding-based similarity search
    if (mode === 'semantic') {
      try {
        const result = await performSemanticSearch(searchParams);
        if (result.totalMatches > 0) {
          result._meta = buildAfterRetrievalMeta();
          autoTrackSearchResults(result.results);
        } else {
          result.hints = buildSearchHints(searchParams);
        }
        return result;
      } catch (err) {
        // Graceful degradation: fall back to keyword mode
        const errMsg = err instanceof Error ? err.message : String(err);
        const errStack = err instanceof Error ? err.stack : undefined;
        logError(`[search] Semantic search failed, falling back to keyword mode: ${errMsg}`);
        if (errStack) {
          logDebug(`[search] Semantic fallback stack trace: ${errStack}`);
        }
        searchParams.mode = 'keyword';
      }
    }

    const result = performSearch(searchParams);

    // Auto-tokenize fallback: if no results and any keyword contains whitespace,
    // split multi-word keywords into individual tokens and retry.
    // Skip auto-tokenize for regex mode — patterns should be used as-is.
    if (result.totalMatches === 0 && mode !== 'regex') {
      const hasMultiWord = searchParams.keywords.some(k => k.trim().includes(' '));
      if (hasMultiWord) {
        const tokenized = searchParams.keywords
          .flatMap(k => k.split(/\s+/))
          .map(t => t.trim())
          .filter(t => t.length > 0);
        // Deduplicate and enforce limits
        const unique = [...new Set(tokenized)].slice(0, 10);
        if (unique.length > 0 && unique.length !== searchParams.keywords.length || unique.some((t, i) => t !== searchParams.keywords[i])) {
          logInfo(`[search] Auto-tokenizing keywords: [${searchParams.keywords.join(', ')}] -> [${unique.join(', ')}]`);
        const retryParams: SearchParams = { ...searchParams, keywords: unique };
          const retryResult = performSearch(retryParams);
          retryResult.autoTokenized = true;
          if (retryResult.totalMatches === 0) {
            retryResult.hints = buildSearchHints(retryParams);
            if (getRuntimeConfig().index.omitZeroResultQuery) delete (retryResult as Partial<SearchResponse>).query;
          } else {
            autoTrackSearchResults(retryResult.results);
          }
          return retryResult;
        }
      }
    }

    // Attach hints on zero-result responses
    if (result.totalMatches === 0) {
      result.hints = buildSearchHints(searchParams);
      if (getRuntimeConfig().index.omitZeroResultQuery) delete (result as Partial<SearchResponse>).query;
    }

    // Attach _meta hints on successful (non-empty) responses
    if (result.totalMatches > 0) {
      result._meta = buildAfterRetrievalMeta();
      autoTrackSearchResults(result.results);
    }

    return result;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown search error';
    logWarn(`[search] Search error: ${errorMessage}`);
    semanticError(-32602, `Search failed: ${errorMessage}`, {
      reason: 'invalid_params',
      hint: 'Use q as a single phrase for index_dispatch search, or pass keywords as an array for index_search. Multi-word phrases are auto-tokenized only on retry.',
      schema: SEARCH_SCHEMA,
      example: { keywords: ['build', 'validate'], includeCategories: true }
    });
  }
}

/**
 * Fire-and-forget usage tracking for search results.
 * Tracks top results only to avoid excessive writes.
 */
function autoTrackSearchResults(results: SearchResult[]): void {
  if (!getRuntimeConfig().index?.autoUsageTrack) return;
  const top = results.slice(0, 10);
  for (const r of top) {
    try { incrementUsage(r.instructionId, { action: 'search' }); } catch { /* fire-and-forget */ }
  }
}

/**
 * Build _meta.afterRetrieval hints for MCP clients.
 * Encourages callers to record usage and submit feedback.
 */
export function buildAfterRetrievalMeta(): { afterRetrieval: string[] } {
  return {
    afterRetrieval: [
      'Call usage_track with the instruction id and signal (helpful|not-relevant|outdated|applied) to record usage quality.',
      'Call feedback_submit to report issues, request features, or flag outdated content.',
    ],
  };
}

/**
 * Build actionable hints for zero-result searches
 */
function buildSearchHints(params: SearchParams): string[] {
  const hints: string[] = [];
  if (!params.includeCategories) {
    hints.push('Try setting includeCategories: true to also search category tags.');
  }
  if (params.keywords.length === 1) {
    hints.push('Try using multiple shorter keywords instead of one long phrase, e.g. ["build", "validate"] instead of ["build validate"].');
  }
  if (params.keywords.some(k => k.length > 15)) {
    hints.push('Try shorter or more general keywords — substring matching is used, not fuzzy/stemming.');
  }
  if (params.contentType) {
    hints.push(`Remove the contentType filter ("${params.contentType}") to search across all content types.`);
  }
  if (params.mode !== 'regex') {
    hints.push('Try mode: "regex" to use regex patterns (e.g. "deploy|release" for alternation).');
  }
  hints.push('Use index_dispatch with action="capabilities" to discover other retrieval methods.');
  return hints;
}

// Register the handler
registerHandler('index_search', handleInstructionsSearch);
