/**
 * Placeholder declaration wrapper.
 *
 * This file previously caused a typescript-eslint parsing error because it was
 * completely empty, meaning the TypeScript program sometimes excluded it when
 * building the project referenced via parserOptions.project. Adding an empty
 * module export guarantees inclusion while remaining a no-op for builds.
 */
export {};
