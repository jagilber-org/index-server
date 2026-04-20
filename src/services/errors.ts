// Central semantic JSON-RPC error helper to ensure code/message survive wrapping layers.
// We use a simple plain-object shape (instead of Error subclass) to avoid any
// library/runtime wrapping stripping custom enumerable properties under load.
// Shape intentionally mirrors JSON-RPC error with an added __semantic marker.
export interface SemanticRpcErrorShape<TData extends Record<string, unknown> | undefined = Record<string, unknown>> {
  code: number;
  message: string;
  data: TData;
  __semantic: true;
}

/**
 * Throw a structured JSON-RPC-compatible semantic error object.
 * The thrown value is a plain object (not an Error instance) so that downstream
 * serialization layers can pass it through without losing custom properties.
 * @param code - JSON-RPC error code (e.g. -32602 for invalid params)
 * @param message - Human-readable error message
 * @param data - Optional additional data attached to the error
 * @throws Always throws the constructed {@link SemanticRpcErrorShape}
 */
export function semanticError<TData extends Record<string, unknown> | undefined = Record<string, unknown>>(code: number, message: string, data?: TData): never {
  const err: SemanticRpcErrorShape<TData> = { code, message, data: (data === undefined ? ({} as TData) : data), __semantic: true };
  // Throw plain object so downstream passes through as-is.
  // (Stack trace not required for semantic validation errors.)
  // eslint-disable-next-line no-throw-literal
  throw err;
}

/**
 * Type-guard that tests whether an unknown value is a semantic RPC error object.
 * @param e - Value to inspect
 * @returns `true` if `e` is a {@link SemanticRpcErrorShape}, `false` otherwise
 */
export function isSemanticError(e: unknown): e is SemanticRpcErrorShape<Record<string, unknown>> {
  if(!e || typeof e !== 'object') return false;
  const maybe = e as { code?: unknown; message?: unknown; __semantic?: unknown };
  return maybe.__semantic === true && Number.isSafeInteger(maybe.code) && typeof maybe.message === 'string';
}
