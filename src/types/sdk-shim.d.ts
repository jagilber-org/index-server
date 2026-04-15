// Temporary shim so TypeScript in CommonJS mode can resolve ESM SDK subpath imports.
// The SDK publishes types under dist/ with package exports mapping, but TS resolution in this project
// (module=CommonJS) fails to pick them. We declare modules pointing to the compiled .d.ts outputs.
// Remove this shim once tsconfig is migrated to moduleResolution "Bundler" or ESM.

declare module '@modelcontextprotocol/sdk/server' {
  export * from '@modelcontextprotocol/sdk/dist/server';
}
declare module '@modelcontextprotocol/sdk/transports/stdio' {
  export { StdioServerTransport } from '@modelcontextprotocol/sdk/dist/server/stdio';
}
declare module '@modelcontextprotocol/sdk' {
  export * from '@modelcontextprotocol/sdk/dist/types';
}
