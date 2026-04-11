/**
 * Type declarations for Node.js built-in node:sqlite module.
 * Available in Node.js >= 22.5.0 (experimental).
 * No third-party packages required.
 */
declare module 'node:sqlite' {
  export interface DatabaseSyncOptions {
    open?: boolean;
    readOnly?: boolean;
    enableForeignKeys?: boolean;
    enableDoubleQuotedStringLiterals?: boolean;
  }

  export interface RunResult {
    changes: number;
    lastInsertRowid: number | bigint;
  }

  export class StatementSync {
    run(...params: unknown[]): RunResult;
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Record<string, unknown>[];
    expandedSQL: string;
    sourceSQL: string;
  }

  export class DatabaseSync {
    constructor(location: string, options?: DatabaseSyncOptions);
    close(): void;
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    open(): void;
  }
}
