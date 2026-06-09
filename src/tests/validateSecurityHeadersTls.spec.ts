/**
 * Regression tests for issue #352 / CodeQL alert #54 (js/disabling-certificate-validation).
 *
 * Origin: 15-alert security wave on jagilber-org/index-server mirror.
 * Owner (red phase): Tank.  Owner (green phase): Trinity.
 *
 * Constitution refs:
 *   TS-8 / TS-9 / TS-12
 *   SH-6  — strict-reading: even opt-in cert-disable should be replaced with
 *           explicit `ca` trust configuration; legacy `allowInsecureTls` (if
 *           retained) must log a SH-6 warning AND be gated to non-prod env.
 *
 * Target: scripts/governance/validate-security-headers.mjs
 *   `{ rejectUnauthorized: false }` behind `allowInsecureTls` flag (line 65).
 *
 * Test theory: assert the desired post-fix contract. Trinity's green-phase
 * deliverables:
 *   (a) default httpGet() rejects a self-signed cert (TLS verify ON by default)
 *   (b) httpGet()/validateSecurityHeaders() accept an explicit `ca: Buffer|string`
 *       option for self-signed scenarios
 *   (c) if legacy `allowInsecureTls` is retained, it must:
 *         - log a SH-6 warning to stderr
 *         - throw when NODE_ENV === 'production' (gated to non-prod)
 *
 * Until Trinity's refactor lands, the script does not export `httpGet` and
 * does not implement the `ca` option / env gating, so the tests fail
 * (import-time or runtime) — that IS the desired RED state.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as https from 'node:https';
import { pathToFileURL } from 'node:url';
import { execSync } from 'node:child_process';

const SCRIPT_URL = pathToFileURL(
  path.resolve(__dirname, '..', '..', 'scripts', 'governance', 'validate-security-headers.mjs')
).href;

// Trinity green-phase contract: export `httpGet(url, options)` from the script
// where `options` accepts `{ ca?: string|Buffer, allowInsecureTls?: boolean }`.
let scriptModule: any = {};
beforeAll(async () => {
  try {
    scriptModule = await import(SCRIPT_URL);
  } catch {
    scriptModule = {};
  }
});

// -----------------------------------------------------------------
// Self-signed HTTPS server fixture
// -----------------------------------------------------------------
// Use the repo's local cert if present; otherwise generate via openssl.
const CERT_DIR = path.resolve(__dirname, '..', '..', 'certs');
// Prefer dev-{key,cert}.pem if present, else fall back to repo's server.{key,crt}.
// `caPath` is the trust anchor a client must pass as the `ca` option to validate
// the served leaf: a self-signed cert is its own anchor, while the CA-signed
// `server.crt` is verified against the issuing `ca.crt`. Using the leaf as its
// own `ca` for a CA-signed cert yields "unable to verify the first certificate"
// (the failure observed on CI, where only `server.{key,crt}` + `ca.crt` exist
// and the self-signed `dev-cert.pem` is absent).
function pickCerts(): { keyPath: string; certPath: string; caPath: string } | null {
  const candidates = [
    {
      keyPath: path.join(CERT_DIR, 'dev-key.pem'),
      certPath: path.join(CERT_DIR, 'dev-cert.pem'),
      // dev-cert.pem is self-signed → it is its own trust anchor.
      caPath: path.join(CERT_DIR, 'dev-cert.pem'),
    },
    {
      keyPath: path.join(CERT_DIR, 'server.key'),
      certPath: path.join(CERT_DIR, 'server.crt'),
      // server.crt is signed by the local CA → anchor on ca.crt when present.
      caPath: path.join(CERT_DIR, 'ca.crt'),
    },
  ];
  for (const c of candidates) {
    if (fs.existsSync(c.keyPath) && fs.existsSync(c.certPath)) {
      // Fall back to the leaf itself if the CA bundle is missing.
      const caPath = fs.existsSync(c.caPath) ? c.caPath : c.certPath;
      return { keyPath: c.keyPath, certPath: c.certPath, caPath };
    }
  }
  return null;
}
const KEY_PATH = pickCerts()?.keyPath ?? path.join(CERT_DIR, 'dev-key.pem');
const CERT_PATH = pickCerts()?.certPath ?? path.join(CERT_DIR, 'dev-cert.pem');
const CA_PATH = pickCerts()?.caPath ?? path.join(CERT_DIR, 'dev-cert.pem');

function loadOrSkipCerts(): { key: string; cert: string; ca: string } | null {
  try {
    if (fs.existsSync(KEY_PATH) && fs.existsSync(CERT_PATH)) {
      return {
        key: fs.readFileSync(KEY_PATH, 'utf8'),
        cert: fs.readFileSync(CERT_PATH, 'utf8'),
        ca: fs.readFileSync(fs.existsSync(CA_PATH) ? CA_PATH : CERT_PATH, 'utf8'),
      };
    }
  } catch { /* ignore */ }
  return null;
}

let server: https.Server | undefined;
let baseUrl = '';
let certPem = '';
let fixtureCleanup: (() => void) | undefined;

beforeAll(async () => {
  // Primary path: generate a fresh self-signed cert (its own CA) with an
  // `IP:127.0.0.1` SAN into a temp dir. This makes the (b) `ca: certPem`
  // validation deterministic on every runner regardless of which repo cert
  // fixtures happen to be present. The committed `certs/` dir is gitignored,
  // and on CI only the CA-signed `server.crt` may exist — passing that leaf as
  // its own `ca` yields "unable to verify the first certificate".
  let key: string | undefined;
  let cert: string | undefined;
  try {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sh352-tls-'));
    const k = path.join(tmp, 'key.pem');
    const c = path.join(tmp, 'cert.pem');
    execSync(
      `openssl req -x509 -newkey rsa:2048 -keyout "${k}" -out "${c}" -days 1 -nodes ` +
        `-subj "/CN=127.0.0.1" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"`,
      { stdio: 'pipe', timeout: 15000 },
    );
    key = fs.readFileSync(k, 'utf8');
    cert = fs.readFileSync(c, 'utf8');
    certPem = cert; // self-signed: the served cert is its own trust anchor
    fixtureCleanup = () => fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    // Fallback: reuse committed repo certs when openssl is unavailable. The
    // self-signed `dev-cert.pem` is its own anchor; the CA-signed `server.crt`
    // is validated against its issuing `ca.crt` (see pickCerts()).
    const creds = loadOrSkipCerts();
    if (creds) {
      key = creds.key;
      cert = creds.cert;
      certPem = creds.ca;
    }
  }
  if (!key || !cert) return; // tests will skip-equivalent via expect.fail in body
  server = https.createServer({ key, cert }, (_req, res) => {
    res.writeHead(200, { 'x-content-type-options': 'nosniff' });
    res.end('ok');
  });
  await new Promise<void>((resolve) => {
    server!.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server!.address();
  if (addr && typeof addr === 'object') {
    baseUrl = `https://127.0.0.1:${addr.port}`;
  }
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  fixtureCleanup?.();
});

describe('#352 disable-cert-validation regression (validate-security-headers.mjs)', () => {
  it('exports httpGet (Trinity green-phase contract)', () => {
    expect(
      typeof scriptModule.httpGet,
      'validate-security-headers.mjs must export `httpGet(url, options)` so cert handling is testable'
    ).toBe('function');
  });

  describe('(a) default behavior: TLS verify ON by default', () => {
    it('rejects a self-signed cert with no options', async () => {
      if (!server) {
        return expect.fail('cert fixture missing — generate certs/dev-{key,cert}.pem first');
      }
      expect(scriptModule.httpGet).toBeTypeOf('function');
      // Default call (no allowInsecureTls, no ca) MUST reject self-signed certs.
      await expect(scriptModule.httpGet(baseUrl)).rejects.toThrow(
        /self[- ]signed|unable to verify|UNABLE_TO_VERIFY|DEPTH_ZERO|certificate/i
      );
    });

    it('rejects when options === undefined explicitly', async () => {
      if (!server) return expect.fail('cert fixture missing');
      await expect(scriptModule.httpGet(baseUrl, undefined)).rejects.toThrow(/cert|verify|self[- ]signed/i);
    });
  });

  describe('(b) explicit `ca` option enables self-signed validation safely', () => {
    it('succeeds when caller provides the cert as `ca` (no global verify bypass)', async () => {
      if (!server) return expect.fail('cert fixture missing');
      expect(scriptModule.httpGet).toBeTypeOf('function');
      const res = await scriptModule.httpGet(baseUrl, { ca: certPem });
      expect(res.status).toBe(200);
    });

    it('still rejects a DIFFERENT self-signed cert when `ca` is provided for cert A', async () => {
      if (!server) return expect.fail('cert fixture missing');
      // Generate a throwaway cert different from the server's
      let otherCert = '';
      try {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tank-352-'));
        execSync(
          `openssl req -x509 -nodes -newkey rsa:2048 -keyout "${path.join(tmp,'k.pem')}" -out "${path.join(tmp,'c.pem')}" -days 1 -subj "/CN=other"`,
          { stdio: 'ignore' }
        );
        otherCert = fs.readFileSync(path.join(tmp, 'c.pem'), 'utf8');
      } catch {
        return; // openssl missing on this runner; skip silently
      }
      await expect(scriptModule.httpGet(baseUrl, { ca: otherCert })).rejects.toThrow(
        /verify|self[- ]signed|UNABLE_TO_VERIFY|DEPTH_ZERO/i
      );
    });
  });

  describe('(c) legacy `allowInsecureTls` flag is gated + audible', () => {
    it('logs a SH-6 warning to stderr when allowInsecureTls=true', async () => {
      if (!server) return expect.fail('cert fixture missing');
      expect(scriptModule.httpGet).toBeTypeOf('function');
      const orig = process.stderr.write.bind(process.stderr);
      const captured: string[] = [];
      (process.stderr.write as any) = (chunk: any) => { captured.push(String(chunk)); return true; };
      try {
        await scriptModule.httpGet(baseUrl, { allowInsecureTls: true }).catch(() => {});
      } finally {
        (process.stderr.write as any) = orig;
      }
      expect(captured.join(''), 'must announce SH-6 cert bypass to operator').toMatch(/SH-6|cert.*bypass|insecure.*tls/i);
    });

    it('throws when NODE_ENV=production and allowInsecureTls=true', async () => {
      if (!server) return expect.fail('cert fixture missing');
      const prev = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        await expect(
          scriptModule.httpGet(baseUrl, { allowInsecureTls: true })
        ).rejects.toThrow(/production|SH-6|forbidden|not permitted/i);
      } finally {
        if (prev === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prev;
      }
    });

    it('source: `rejectUnauthorized: false` only reachable through allowInsecureTls path (not on default code path)', () => {
      // Defense in depth: belt-and-braces source-level check that the
      // dangerous literal is gated, not unconditional.
      const src = fs.readFileSync(
        path.resolve(__dirname, '..', '..', 'scripts', 'governance', 'validate-security-headers.mjs'),
        'utf8'
      );
      // Every occurrence of rejectUnauthorized: false MUST be guarded by an
      // allowInsecureTls check on the same or preceding line.
      const lines = src.split(/\r?\n/);
      lines.forEach((line, i) => {
        if (/rejectUnauthorized\s*:\s*false/.test(line)) {
          const window = lines.slice(Math.max(0, i - 3), i + 1).join('\n');
          expect(
            window,
            `line ${i + 1}: rejectUnauthorized:false must be gated by allowInsecureTls`
          ).toMatch(/allowInsecureTls/);
        }
      });
    });
  });
});
