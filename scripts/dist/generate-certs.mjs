#!/usr/bin/env node
/**
 * generate-certs.mjs — Generate self-signed TLS certificates for Index Server.
 *
 * Creates a CA + server certificate pair in ./certs/ for HTTPS dashboard access.
 * For production, replace with certificates from a real CA.
 *
 * Usage:
 *   node scripts/generate-certs.mjs [--hostname <name>] [--days <n>] [--output <dir>]
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    hostname: 'localhost',
    days: 365,
    outputDir: path.join(ROOT, 'certs'),
    keySize: 4096,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--hostname' && args[i + 1]) config.hostname = args[++i];
    else if (args[i] === '--days' && args[i + 1]) config.days = parseInt(args[++i], 10);
    else if (args[i] === '--output' && args[i + 1]) config.outputDir = path.resolve(args[++i]);
    else if (args[i] === '--key-size' && args[i + 1]) config.keySize = parseInt(args[++i], 10);
    else if (args[i] === '--help') {
      console.log(`Usage: generate-certs.mjs [options]
  --hostname <name>  Server hostname (default: localhost)
  --days <n>         Certificate validity in days (default: 365)
  --output <dir>     Output directory (default: ./certs)
  --key-size <bits>  RSA key size (default: 4096)`);
      process.exit(0);
    }
  }
  return config;
}

const WELL_KNOWN_OPENSSL_DIRS = [
  'C:\\Program Files\\Git\\usr\\bin',
  'C:\\Program Files (x86)\\Git\\usr\\bin',
  'C:\\Program Files\\OpenSSL-Win64\\bin',
  'C:\\Program Files\\OpenSSL\\bin',
];

function checkOpenssl() {
  try {
    execSync('openssl version', { stdio: 'pipe' });
    return true;
  } catch {
    // Try well-known paths on Windows
    for (const dir of WELL_KNOWN_OPENSSL_DIRS) {
      const exe = path.join(dir, 'openssl.exe');
      if (fs.existsSync(exe)) {
        console.log(`ℹ️  Found OpenSSL at: ${dir}`);
        process.env.PATH = `${dir}${path.delimiter}${process.env.PATH}`;
        return true;
      }
    }
    return false;
  }
}

function generateCerts(config) {
  const { hostname, days, outputDir, keySize } = config;

  // Validate hostname to prevent command injection via -subj parameter
  if (!/^[a-zA-Z0-9._-]+$/.test(hostname)) {
    console.error(`❌ Invalid hostname: "${hostname}". Only alphanumeric, dots, hyphens, and underscores allowed.`);
    process.exit(1);
  }

  // Ensure output directory exists
  fs.mkdirSync(outputDir, { recursive: true });

  const caKeyPath = path.join(outputDir, 'ca.key');
  const caCertPath = path.join(outputDir, 'ca.crt');
  const serverKeyPath = path.join(outputDir, 'server.key');
  const serverCsrPath = path.join(outputDir, 'server.csr');
  const serverCertPath = path.join(outputDir, 'server.crt');
  const extPath = path.join(outputDir, 'server.ext');
  const cnfPath = path.join(outputDir, 'openssl.cnf');

  console.log(`\n🔐 Generating TLS certificates for: ${hostname}`);
  console.log(`   Output: ${outputDir}`);
  console.log(`   Validity: ${days} days`);
  console.log(`   Key size: ${keySize} bits\n`);

  // Create a minimal openssl config to avoid system config issues (Windows compat)
  const cnfContent = `[req]
distinguished_name = req_dn
prompt = no

[req_dn]
C = US
ST = Dev
L = Local
O = IndexServer
`;
  fs.writeFileSync(cnfPath, cnfContent, 'utf8');
  const cnfEnv = { ...process.env, OPENSSL_CONF: cnfPath };

  // Step 1: Generate CA private key
  console.log('1/5 Generating CA private key...');
  execSync(`openssl genrsa -out "${caKeyPath}" ${keySize}`, { stdio: 'pipe', env: cnfEnv });

  // Step 2: Generate CA certificate
  console.log('2/5 Generating CA certificate...');
  execSync(
    `openssl req -x509 -new -nodes -key "${caKeyPath}" -sha256 -days ${days} ` +
    `-subj "/C=US/ST=Dev/L=Local/O=IndexServer/OU=Dev/CN=IndexServerCA" ` +
    `-config "${cnfPath}" -out "${caCertPath}"`,
    { stdio: 'pipe', env: cnfEnv }
  );

  // Step 3: Generate server private key
  console.log('3/5 Generating server private key...');
  execSync(`openssl genrsa -out "${serverKeyPath}" ${keySize}`, { stdio: 'pipe', env: cnfEnv });

  // Step 4: Generate server CSR
  console.log('4/5 Generating server CSR...');
  execSync(
    `openssl req -new -key "${serverKeyPath}" ` +
    `-subj "/C=US/ST=Dev/L=Local/O=IndexServer/OU=Server/CN=${hostname}" ` +
    `-config "${cnfPath}" -out "${serverCsrPath}"`,
    { stdio: 'pipe', env: cnfEnv }
  );

  // Step 5: Create extensions file and sign server cert
  console.log('5/5 Signing server certificate...');
  const extContent = `authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage=digitalSignature,nonRepudiation,keyEncipherment,dataEncipherment
subjectAltName=@alt_names

[alt_names]
DNS.1=${hostname}
DNS.2=*.${hostname}
IP.1=127.0.0.1
IP.2=::1`;

  fs.writeFileSync(extPath, extContent, 'utf8');

  execSync(
    `openssl x509 -req -in "${serverCsrPath}" -CA "${caCertPath}" -CAkey "${caKeyPath}" ` +
    `-CAcreateserial -out "${serverCertPath}" -days ${days} -sha256 -extfile "${extPath}"`,
    { stdio: 'pipe', env: cnfEnv }
  );

  // Cleanup intermediate files
  try { fs.unlinkSync(serverCsrPath); } catch { /* ok */ }
  try { fs.unlinkSync(extPath); } catch { /* ok */ }
  try { fs.unlinkSync(cnfPath); } catch { /* ok */ }
  try { fs.unlinkSync(path.join(outputDir, 'ca.srl')); } catch { /* ok */ }

  // Set restrictive permissions on private keys
  try {
    fs.chmodSync(caKeyPath, 0o600);
    fs.chmodSync(serverKeyPath, 0o600);
  } catch { /* Windows doesn't support chmod */ }

  console.log('\n✅ TLS certificates generated successfully:');
  console.log(`   CA cert:     ${caCertPath}`);
  console.log(`   Server cert: ${serverCertPath}`);
  console.log(`   Server key:  ${serverKeyPath}`);
  console.log(`   CA key:      ${caKeyPath}`);
  console.log('\nTo use with Docker:');
  console.log('  docker compose --profile tls up -d');
  console.log('\nTo use standalone:');
  console.log(`  INDEX_SERVER_DASHBOARD_TLS=1 \\`);
  console.log(`  INDEX_SERVER_DASHBOARD_TLS_CERT=${serverCertPath} \\`);
  console.log(`  INDEX_SERVER_DASHBOARD_TLS_KEY=${serverKeyPath} \\`);
  console.log('  node dist/server/index-server.js --dashboard');
}

// Main
const config = parseArgs();
if (!checkOpenssl()) {
  console.error('❌ OpenSSL is not installed or not in PATH.');
  console.error('   Install OpenSSL and try again.');
  console.error('   Options:');
  console.error('   - Install Git for Windows (includes OpenSSL): https://git-scm.com/download/win');
  console.error('   - Install OpenSSL directly: https://slproweb.com/products/Win32OpenSSL.html');
  console.error('   - On Linux/macOS: sudo apt install openssl / brew install openssl');
  process.exit(1);
}
generateCerts(config);
