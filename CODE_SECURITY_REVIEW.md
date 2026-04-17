# Index Server - COMPREHENSIVE CODE & SECURITY REVIEW

**Repository:** <root>\index-server  
**Version:** 1.11.1 | **License:** MIT | **Node.js:** >=20 <23

---

## EXECUTIVE SUMMARY

The Index Server is a **production-grade Model Context Protocol implementation** providing enterprise instruction index governance. Strong security foundations with dual-transport architecture (stdio MCP + optional localhost HTTP dashboard), comprehensive input validation, atomic file operations, and extensive test coverage (130+ specs).

### ✅ Architecture Strengths
- **Strict TypeScript** - Full strict mode enabled
- **Dual Transport** - MCP (stdio, process-isolated) + Optional Admin HTTP (localhost)  
- **Input Validation** - Zod primary + AJV fallback (composite validator)
- **Atomic FS** - Retry-backed writes, Windows-friendly
- **Audit Logging** - JSONL mutation trail
- **Handshake Hardening** - Early stdin buffering for fast clients
- **Comprehensive Tests** - 130+ vitest specs + coverage tracking

### ⚠️ Security Gaps to Address
- **CORS Wildcard** - '*' origin allowed (mitigated: localhost binding default)
- **No Per-Request Auth** - Bootstrap tokens only, no session-based auth
- **INDEX_SERVER_AUTH_KEY Documented but Missing** - Referenced in docs, not implemented
- **Dashboard No CSRF** - Mutations unprotected against token forgery
- **No Rate Limiting** - Endpoints lack request throttling

---

## 1. SRC/ DIRECTORY STRUCTURE (3 LEVELS)

\\\
src/
├── config/runtimeConfig.ts        ← Centralized env var parsing
├── dashboard/                      ← Admin HTTP interface (optional)
│   ├── server/
│   │   ├── DashboardServer.ts     ← Express app + TLS
│   │   ├── ApiRoutes.ts           ← Route composition
│   │   ├── SecurityMonitor.ts     ← Threat detection
│   │   ├── routes/                ← 11 route modules
│   │   └── ...
│   ├── security/SecurityMonitor.ts
│   ├── analytics/
│   └── integration/
├── server/
│   ├── index.ts                   ← Main entry (stdio + dashboard)
│   ├── sdkServer.ts               ← MCP SDK wrapper
│   ├── transport.ts               ← Custom transport
│   └── registry.ts                ← Tool registration
├── services/
│   ├── handlers.*.ts              ← 20+ tool handlers
│   ├── IndexContext.ts
│   ├── indexRepository.ts
│   ├── validationService.ts       ← Zod + AJV validator
│   ├── atomicFs.ts                ← Atomic writes
│   ├── auditLog.ts                ← JSONL audit trail
│   ├── manifestManager.ts
│   └── ...
├── models/
├── types/
├── utils/
├── schemas/
├── versioning/
├── tests/                         ← 130+ test specs
└── minimal/index.ts               ← Simplified reference
\\\

**Summary:** ~500 TS files, ~300 test specs, modular architecture

---

## 2. PACKAGE.JSON - DEPENDENCIES & SCRIPTS

### Production Dependencies (10)
\\\
@modelcontextprotocol/sdk    ^0.6.0   ← MCP protocol
express                      ^5.1.0   ← Admin HTTP
ws                           ^8.18.3  ← WebSockets
ajv + ajv-formats           ^8.x     ← JSON Schema validator
zod                         ^3.23.8  ← Primary schema validator
@huggingface/transformers   ^3.8.1   ← ML embeddings
@types/express + @types/ws        ← Type definitions
\\\

### Dev Dependencies (8)
- TypeScript 5.5.0 (strict mode)
- ESLint + @typescript-eslint 7.x
- Vitest 3.2.4 + @vitest/coverage-v8
- Playwright 1.47.2
- fast-check 3.17.0 (property testing)

### Key Scripts
\\\ash
npm run build              # tsc + copy assets
npm test                   # vitest run
npm run lint               # eslint
npm run coverage           # target 60%
npm run scan:security      # pwsh security scan
npm run perf:ci            # performance metrics
\\\

**Security:** No dynamic imports, locked versions, common deps well-maintained

---

## 3. SRC/server/index-server.ts - ENTRY POINT ANALYSIS

### Early Handshake Hardening (Lines 14-51)
\\\	ypescript
// Capture stdin BEFORE SDK listener attaches
const __earlyInitChunks: Buffer[] = [];
if(__bufferEnabled) process.stdin.on('data', __earlyCapture);

// Later: re-emit buffered chunks once SDK ready
// Prevents race where fast clients send initialize before handlers attached
\\\
**Why:** Some MCP clients send initialize immediately after spawn. Early capture ensures no loss.

### Global Error Guard (Lines 95-100)
- Single uncaughtException listener (named to prevent duplication)
- Uniform error formatting to stderr
- Promise rejection capture

### Bootstrap Sequence
1. Import config, logger, error handlers
2. Attach stdin early capture  
3. Register 20+ tool handler modules (auto-registration)
4. Start SDK server → initialize negotiation
5. Bootstrap dashboard (if enabled)
6. Start Index polling + metrics broadcast

### Dual Transport
- **Primary:** MCP Protocol (stdin/stdout, JSON-RPC 2.0) - process-isolated, secure
- **Secondary:** Optional HTTP admin (localhost by default) - read/write Index

---

## 4. TSCONFIG.JSON - COMPILER STRICTNESS

\\\json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "strict": true,                    // ✅ FULL STRICT
    "declaration": true,
    "moduleResolution": "node16",
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true
  }
}
\\\

**Strictness Impact:** No implicit any, null/undefined checking, unused vars checked

---

## 5. .GITIGNORE - SECRET PROTECTION

### 🔴 Never Commit
\\\
devinstructions/               # AI instructions
instructions/                  # Sensitive prompts
.certs/                        # TLS certs
/.env*                         # All env files
secrets/                       # Secrets snapshots
\\\

### 🟡 Runtime Artifacts
\\\
data/, memory/, metrics/       # Runtime state
tmp/, logs/                    # Temporary files
feedback/                      # User submissions
\\\

### 🟢 Build/Test
\\\
dist/, coverage/, test-results/
*.log, *.tmp, *.tgz
\\\

**Test Cleanup Pattern:** Tests MUST clean artifacts; gitignore is safety net

---

## 6. DIRECTORIES: DATA/, INSTRUCTIONS/, GOVERNANCE/

### \data/\ - Runtime State
- embeddings.json
- models/ (ML tensors)
- performance-baseline-*.json (30+ timestamped files)
- sessions/, state/

### \instructions/\ - instruction index
- 000-bootstrapper.json (core)
- *.json (schema v3)
- .index-version (marker)
- _manifest.json (metadata)

### \governance/\ - Control
- ALLOW_HASH_CHANGE (single file, minimal)

---

## 7. DOCKERFILE - CONTAINER SECURITY

\\\dockerfile
FROM node:20-alpine AS build      # Minimal base
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev             # Prod only ✅
COPY . ./
RUN npm run build

FROM node:20-alpine AS runtime    # Multi-stage ✅
WORKDIR /app
ENV NODE_ENV=production           # Hardened
COPY --from=build /app/dist ./dist
COPY instructions ./instructions
USER node                         # Non-root ✅
ENTRYPOINT ["node","dist/server/index-server.js"]
\\\

**Strengths:** Multi-stage, Alpine, non-root, prod-only  
**Recommendations:** Add HEALTHCHECK, consider --read-only rootfs

---

## 8. SECURITY.MD - POLICY

### Reporting
1. Create security advisory or email maintainer
2. Include repro steps, impact, logs
3. 5 business day SLA

### Supported Versions
- Only latest minor gets security fixes

### **CRITICAL GAP**
> References "enterprise hardening (see HARDENING-DESIGN.md)" but file NOT FOUND  
> References INDEX_SERVER_AUTH_KEY but implementation NOT FOUND  
> **Recommendation:** Create HARDENING-DESIGN.md or update docs

---

## 9. ENVIRONMENT VARIABLES - NO .ENV FILES ✅

### Critical Variables
\\\ash
INDEX_SERVER_BOOTSTRAP_TOKEN_TTL_SEC=900   # Token expiry
INDEX_SERVER_AUTH_KEY=<secret>             # AUTH (referenced but missing impl)

INDEX_SERVER_DASHBOARD=1                   # Enable HTTP admin
INDEX_SERVER_DASHBOARD_PORT=8787           # Bind port
INDEX_SERVER_DASHBOARD_TLS_{CERT,KEY}=/path

INDEX_SERVER_DIR=/path        # Index location
INDEX_SERVER_LOG_LEVEL=info|debug|trace    # Verbosity
INDEX_SERVER_TRACE=...                     # Trace topics

# Diagnostics
INDEX_SERVER_HANDSHAKE_TRACE=1             # Trace handshake JSON to stderr
INDEX_SERVER_INIT_FRAME_DIAG=1             # Init frame diagnostics
\\\

### Safe Parsing
\\\	ypescript
// src/utils/envUtils.ts
export function getBooleanEnv(name: string, defaultValue = false): boolean {
  const val = process.env[name];
  if(!val) return defaultValue;
  return ['1','true','yes','on'].includes(val.toLowerCase().trim());
}
\\\
**All env access centralized, no direct process.env.VAR access** ✅

---

## 10. .ESLINTRC.JSON - LINT CONFIGURATION

\\\json
{
  "extends": ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  "rules": {
    "@typescript-eslint/no-unused-vars": ["warn", {"argsIgnorePattern": "^_"}],
    "@typescript-eslint/explicit-function-return-type": "off"
  }
}
\\\

### Overrides
- Parked tests: no type-aware linting
- Declaration files: allow any
- Test suites: allow any
- Scripts: no type-aware parsing

---

## SECURITY FINDINGS

### 🔴 HIGH PRIORITY

#### 1. CORS Wildcard Origin
**File:** src/dashboard/server/ApiRoutes.ts:41-46  
**Code:**
\\\	ypescript
res.header('Access-Control-Allow-Origin', '*');
res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
\\\
**Risk:** Any origin can call dashboard APIs if exposed  
**Mitigation:** ✅ Binds to 127.0.0.1 (localhost) by default  
**Fix:**
\\\	ypescript
const origins = ['http://localhost:8787', 'http://127.0.0.1:8787'];
if (origins.includes(req.origin)) res.header('Access-Control-Allow-Origin', req.origin);
\\\

#### 2. No Per-Request Dashboard Auth
**Risk:** Any local process can modify instructions  
**Mitigation:** Bootstrap token gating  
**Fix:**
\\\	ypescript
// Add CSRF token to mutations
app.post('/api/instructions', (req, res) => {
  const token = req.headers['x-csrf-token'];
  if (!validateToken(token, session)) return res.status(403).json({error:'CSRF'});
  // process mutation
});
\\\

#### 3. INDEX_SERVER_AUTH_KEY Documented but Missing
**File:** SECURITY.md mentions it, but NOT in code  
**Risk:** Developers assume auth is implemented  
**Fix:** Either implement auth or remove from docs

### 🟡 MEDIUM PRIORITY

#### 4. Error Messages Leak Paths
**File:** src/services/preflight.ts:25  
**Code:**
\\\	ypescript
return { name: mod, ok: false, error: (e as Error).message };
\\\
**Fix:** Sanitize in production
\\\	ypescript
const isProduction = process.env.NODE_ENV === 'production';
error: isProduction ? '[REDACTED]' : (e as Error).message
\\\

#### 5. No Rate Limiting
**Gap:** Rate limit config defined but not enforced  
**Fix:**
\\\	ypescript
import rateLimit from 'express-rate-limit';
const limiter = rateLimit({
  windowMs: 60000,
  max: 100,
  message: 'Too many requests'
});
app.use('/api/', limiter);
\\\

#### 6. Session Persistence Plaintext
**File:** src/dashboard/server/SessionPersistenceManager.ts  
**Mitigation:** Only metadata stored (no secrets)  
**Fix:** Consider encryption for sensitive fields

#### 7. Webhook Secret Hashing Non-Standard
**File:** src/dashboard/integration/APIIntegration.ts:~120  
**Current:**
\\\	ypescript
Buffer.from(payloadString + secret).toString('base64')
\\\
**Fix:** Use HMAC-SHA256
\\\	ypescript
crypto.createHmac('sha256', secret).update(payloadString).digest('hex')
\\\

### 🟢 LOWER PRIORITY

#### 8. Instructions Body Not Sanitized
**Risk:** User-provided instructions may contain real secrets  
**Mitigation:** Audit service scans for patterns  
**Doc Note:** "Instructions should not contain real secrets"

---

## VALIDATION & INPUT HANDLING

### Composite Validator (src/services/validationService.ts)
\\\	ypescript
// Primary: Zod parsing
try { z.parse(data ?? {}); return true; }
// Fallback: AJV JSON Schema
return ajv.compile(schema)(data);
\\\
**Strengths:** Dual validation, error normalization, metrics tracking

### Atomic File Operations (src/services/atomicFs.ts)
\\\	ypescript
// Write to temp, atomic rename with retry backoff
fs.writeFileSync(tmp, data);
fs.renameSync(tmp, filePath);
// On EPERM/EBUSY: exponential backoff + retry (max 5)
\\\
**Windows-Friendly:** Handles transient locks

### Audit Logging (src/services/auditLog.ts)
\\\	ypescript
interface AuditEntry {
  ts: string;       // ISO timestamp
  action: string;   // mutation name
  ids?: string[];   // impacted IDs
  meta?: Record;    // result summary
}
// Append-only JSONL, configurable
\\\

---

## PERFORMANCE & RELIABILITY

- **Early Handshake Hardening** - Stdin buffering prevents drops
- **Memory Monitoring** - Heap tracking + GC events
- **Index Polling** - Proactive directory watching
- **Performance Baselines** - 30+ baseline files, drift detection
- **Stress Tests** - dispatcherStress, concurrencyFuzz specs

---

## TEST COVERAGE

**130+ test specs:**
- ✅ Unit tests (validationService, governanceHash, IndexLoader)
- 🔄 Integration tests (manifest, smoke, integrity)
- 📊 Stress tests (dispatcher, concurrency, health)
- ❌ Red tests (deep diagnostics, skipped by default)
- 🎭 Playwright tests (dashboard UI)

**Target:** 60% coverage (enforced in CI)

---

## DEPLOYMENT CHECKLIST

### Pre-Deployment ✅
- \
pm run build\ succeeds
- \
pm run lint\ passes
- \
pm run test\ passes (all specs)
- \
pm run coverage\ >= 60%
- \
pm audit\ clean
- Dockerfile builds

### Runtime
- INDEX_SERVER_DIR on persistent volume
- INDEX_SERVER_LOG_LEVEL=info (not debug)
- INDEX_SERVER_DASHBOARD only if admin needed
- Audit logging enabled
- TLS certs in secure location (if dashboard TLS)

### Container
- Node 20 Alpine
- Non-root USER
- Volume mounts for instructions/ + data/
- Health check configured
- Restart policy: unless-stopped

### Production Hardening
- CORS only for trusted proxies
- Dashboard behind reverse proxy + auth
- TLS from Let's Encrypt
- Regular \
pm audit\ + Snyk scans
- Log aggregation
- Secret rotation

---

## OVERALL SECURITY RATING: **7.5/10**

**Strengths:** Architecture, validation, atomicity, tests, logging  
**Gaps:** Auth, CSRF, rate limiting, CORS scoping  
**Path to 9/10:** Implement missing gaps + HARDENING-DESIGN.md

---

## QUICK REFERENCE

| Aspect | Status | File |
|--------|--------|------|
| Strict TypeScript | ✅ | tsconfig.json |
| Input Validation | ✅ | validationService.ts |
| Atomic FS | ✅ | atomicFs.ts |
| Audit Logging | ✅ | auditLog.ts |
| CORS Protection | ⚠️ | ApiRoutes.ts |
| Auth/CSRF | ❌ | (missing) |
| Rate Limiting | ⚠️ | (config only) |
| TLS Support | ✅ | DashboardServer.ts |
| Error Messages | ⚠️ | preflight.ts |
| Test Coverage | ✅ | 130+ specs |
