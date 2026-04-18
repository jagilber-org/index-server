import { registerHandler } from '../server/registry';

// Test-only primitive returning handler used by feature flag tests to ensure envelope works with non-object values.
registerHandler('test_primitive', () => 42);

export {};
