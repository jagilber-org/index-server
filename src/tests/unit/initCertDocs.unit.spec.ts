import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const root = process.cwd();

function readRepoFile(...segments: string[]): string {
  return fs.readFileSync(path.join(root, ...segments), 'utf8');
}

describe('--init-cert OpenSSL guidance', () => {
  it('documents Windows OpenSSL prerequisites across docs, README, help, and errors', () => {
    const certDocs = readRepoFile('docs', 'cert_init.md');
    const readme = readRepoFile('README.md');
    const server = readRepoFile('src', 'server', 'index-server.ts');
    const certInit = readRepoFile('src', 'server', 'certInit.ts');

    expect(certDocs).toContain('## Prerequisites');
    expect(certDocs).toContain('C:\\Program Files\\Git\\usr\\bin\\openssl.exe');
    expect(certDocs).toContain('brew install openssl@3');
    expect(certDocs).toContain('apt install openssl');
    expect(certDocs).toContain('dnf install openssl');

    expect(readme).toContain('**Prerequisite:** `openssl` must be on `PATH`');
    expect(readme).toContain('[`docs/cert_init.md`](docs/cert_init.md)');

    expect(server).toContain('Requires openssl on PATH (Windows: C:\\\\Program Files\\\\Git\\\\usr\\\\bin).');
    expect(server).toContain('See docs/cert_init.md for setup.');

    expect(certInit).toContain('C:\\\\Program Files\\\\Git\\\\usr\\\\bin\\\\openssl.exe');
    expect(certInit).toContain('See docs/cert_init.md for setup guidance.');
  });
});
