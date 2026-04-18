import { flagEnabled } from './featureFlags';
import fs from 'fs';
import path from 'path';

// Resolve version once (lazy) for envelope
let version = '0.0.0';
try {
  const pkg = path.join(process.cwd(),'package.json');
  if(fs.existsSync(pkg)){
    const raw = JSON.parse(fs.readFileSync(pkg,'utf8')); if(raw.version) version = raw.version;
  }
} catch { /* ignore */ }

export interface EnvelopeV1<T=unknown>{ version: number; serverVersion: string; data: T }

export function wrapResponse<T>(data: T): T | EnvelopeV1<T> {
  if(!flagEnabled('response_envelope_v1')) return data;
  return { version: 1, serverVersion: version, data };
}
