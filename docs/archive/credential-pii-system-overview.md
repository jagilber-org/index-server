# Centralized Credentials & PII Protection System

> A defense-in-depth system that centralizes many environment variables into a single file outside all Git repositories, auto-loads them into every PowerShell session, and blocks secrets from ever reaching version control through a 3-layer pre-commit scanner deployed across multiple repos in multiple GitHub organizations.

---

## System Architecture

```mermaid
%%{init: {"flowchart": {"defaultRenderer": "elk"}} }%%
graph TB
    subgraph "🔐 Central Store (Outside All Repos)"
        ENV["📄 central .env<br/>many vars · multiple sections<br/>─────────────────<br/>Azure · GitHub · ADO<br/>OpenAI · Certs · Storage<br/>SF · DNS · MCP · Kusto"]
    end

    subgraph "🚀 Bootstrap (scripts-dev repo)"
        IMPORT["⚡ Import-CentralEnv.ps1<br/>Parse KEY=VALUE<br/>Skip comments & blanks<br/>Set ProcessEnv vars"]
    end

    subgraph "🛡️ Protection (scripts-dev repo)"
        SCANNER["🔍 Test-PreCommitPii.ps1<br/>3-Layer Scanner"]
        WRAPPER["🐚 pre-commit (shell)<br/>Cross-platform wrapper"]
        DEPLOYER["📦 Install-PreCommitHook.ps1<br/>Multi-repo deployer"]
    end

    subgraph "👤 Developer Machine"
        PROFILE["📋 $PROFILE<br/>Auto-loads on pwsh start"]
        SESSION["💻 PowerShell Session<br/>all env vars available"]
    end

    subgraph "📂 Many Git Repos (Multiple Orgs)"
        HOOKS1["org-a/ (many repos)<br/>.git/hooks/pre-commit"]
        HOOKS2["org-b/ (several repos)<br/>.git/hooks/pre-commit"]
    end

    subgraph "☁️ Git Remote"
        REMOTE["GitHub.com<br/>multiple organizations"]
    end

    ENV -->|"reads"| IMPORT
    IMPORT -->|"dot-sourced from"| PROFILE
    PROFILE -->|"starts"| SESSION
    ENV -.->|"Layer 2 reads values"| SCANNER
    DEPLOYER -->|"installs to"| HOOKS1
    DEPLOYER -->|"installs to"| HOOKS2
    HOOKS1 -->|"executes"| WRAPPER
    HOOKS2 -->|"executes"| WRAPPER
    WRAPPER -->|"calls"| SCANNER
    SCANNER -->|"✅ pass"| REMOTE
    SCANNER -->|"❌ block"| SESSION

    style ENV fill:#1a1a2e,stroke:#e94560,color:#fff,stroke-width:3px
    style SCANNER fill:#16213e,stroke:#0f3460,color:#fff,stroke-width:2px
    style REMOTE fill:#0f3460,stroke:#533483,color:#fff
    style SESSION fill:#1a1a2e,stroke:#53a8b6,color:#fff
```

---

## How It Works: End-to-End Flow

```mermaid
sequenceDiagram
    participant Dev as 👤 Developer
    participant PS as 💻 PowerShell
    participant Profile as 📋 $PROFILE
    participant Loader as ⚡ Import-CentralEnv
    participant DotEnv as 📄 central .env
    participant Git as 🔀 Git
    participant Hook as 🐚 pre-commit hook
    participant Scanner as 🔍 Test-PreCommitPii
    participant Remote as ☁️ GitHub

    Note over Dev,Remote: ── Shell Startup ──
    Dev->>PS: Opens pwsh terminal
    PS->>Profile: Loads $PROFILE
    Profile->>Loader: dot-sources Import-CentralEnv.ps1 -Quiet
    Loader->>DotEnv: Reads central .env
    DotEnv-->>Loader: many KEY=VALUE pairs
    Loader->>PS: Sets [Environment]::SetEnvironmentVariable()
    Note over PS: All vars now available<br/>$env:AZURE_SUBSCRIPTION_ID<br/>$env:GITHUB_TOKEN<br/>$env:OPENAI_API_KEY<br/>etc.

    Note over Dev,Remote: ── Development Workflow ──
    Dev->>PS: Writes code using $env:MY_SECRET_KEY
    Dev->>Git: git add . && git commit -m "feature"
    Git->>Hook: Triggers .git/hooks/pre-commit
    Hook->>Hook: Finds pwsh or powershell
    Hook->>Scanner: exec pwsh Test-PreCommitPii.ps1

    Note over Scanner: Layer 1: Forbidden Files
    Scanner->>Git: git diff --cached --name-only
    Git-->>Scanner: List of staged files
    Scanner->>Scanner: Check for .env, .key, .pfx, .pem...

    Note over Scanner: Layer 2: Value Matching
    Scanner->>DotEnv: Walk up dirs → find central .env
    DotEnv-->>Scanner: Load values > 8 chars
    Scanner->>Git: git diff --cached (added lines)
    Scanner->>Scanner: Regex-match each value in diffs

    Note over Scanner: Layer 3: Pattern Detection
    Scanner->>Scanner: many block patterns + several warn patterns
    Scanner->>Scanner: Azure SAS, Storage keys, SQL strings...
    Scanner->>Scanner: API prefixes: sk-, ghp_, AKIA, AIza...
    Scanner->>Scanner: PII: SSN, credit cards, private keys

    alt All Layers Pass ✅
        Scanner-->>Git: exit 0
        Git->>Remote: Push allowed
        Note over Remote: ✅ Clean commit
    else Any Layer Blocks ❌
        Scanner-->>Git: exit 1
        Git-->>Dev: ❌ BLOCKED: issue(s) found
        Note over Dev: Fix issues or<br/>--no-verify (emergency)
    end
```

---

## The 3-Layer Scanner Deep Dive

```mermaid
%%{init: {"flowchart": {"defaultRenderer": "elk"}} }%%
graph TD
    START["git commit triggered<br/>Staged files collected"] --> L1

    subgraph "Layer 1 · Forbidden Files"
        L1{"File name/ext<br/>matches blocklist?"}
        L1_ALLOW{"Matches allowlist?<br/>.env.example<br/>.env.sample<br/>.env.template"}
        L1_BLOCK["❌ BLOCK<br/>.env · .key · .pem<br/>.pfx · .p12 · .jks<br/>id_rsa · .htpasswd<br/>.netrc · secrets.*"]
    end

    subgraph "Layer 2 · Value Matching"
        L2["Load central .env<br/>Filter: value.Length ≥ min<br/>Skip placeholders"]
        L2_DIFF["Get added lines from<br/>git diff --cached"]
        L2_MATCH{"Any .env value<br/>found in diff?"}
        L2_BLOCK["❌ BLOCK<br/>Contains actual secret<br/>value found in<br/>central .env"]
    end

    subgraph "Layer 3 · Pattern Detection"
        L3["Scan added lines with<br/>many block + several warn regexes"]
        L3_BLK{"Block pattern<br/>matched?"}
        L3_WARN{"Warn pattern<br/>matched?"}
        L3_BLOCK["❌ BLOCK<br/>Azure SAS token<br/>GitHub PAT<br/>OpenAI key<br/>Private key<br/>SSN / CC#"]
        L3_WARNING["⚠️ WARNING<br/>Email address<br/>Possible api_key=<br/>Thumbprint"]
    end

    PASS["✅ COMMIT ALLOWED"]
    FAIL["❌ COMMIT BLOCKED<br/>exit 1"]

    START --> L1
    L1 -->|"Yes"| L1_ALLOW
    L1_ALLOW -->|"Yes (allowed)"| L2
    L1_ALLOW -->|"No"| L1_BLOCK
    L1 -->|"No match"| L2
    L1_BLOCK --> FAIL

    L2 --> L2_DIFF
    L2_DIFF --> L2_MATCH
    L2_MATCH -->|"Yes"| L2_BLOCK
    L2_MATCH -->|"No"| L3
    L2_BLOCK --> FAIL

    L3 --> L3_BLK
    L3_BLK -->|"Yes"| L3_BLOCK
    L3_BLK -->|"No"| L3_WARN
    L3_WARN -->|"Yes"| L3_WARNING
    L3_WARN -->|"No"| PASS
    L3_WARNING --> PASS
    L3_BLOCK --> FAIL

    style PASS fill:#2d6a4f,stroke:#1b4332,color:#fff,stroke-width:2px
    style FAIL fill:#9d0208,stroke:#6a040f,color:#fff,stroke-width:2px
    style L1_BLOCK fill:#d00000,stroke:#6a040f,color:#fff
    style L2_BLOCK fill:#d00000,stroke:#6a040f,color:#fff
    style L3_BLOCK fill:#d00000,stroke:#6a040f,color:#fff
    style L3_WARNING fill:#e85d04,stroke:#dc2f02,color:#fff
```

---

## Cross-Org Deployment

```mermaid
%%{init: {"flowchart": {"defaultRenderer": "elk"}} }%%
graph LR
    subgraph "🔧 Scripts repo (single source of truth)"
        SRC_HOOK["pre-commit<br/>(shell wrapper)"]
        SRC_SCAN["Test-PreCommitPii.ps1<br/>(scanner)"]
        SRC_INST["Install-PreCommitHook.ps1<br/>(deployer)"]
    end

    SRC_INST -->|"-ParentPath"| DISCOVER

    subgraph "Auto-Discovery"
        DISCOVER["Scan child dirs<br/>for .git/ folders"]
    end

    subgraph "Organization A (many repos)"
        R1[".git/hooks/pre-commit"]
        R2[".git/hooks/pre-commit"]
        R3["... more repos"]
    end

    subgraph "Organization B (several repos)"
        R4[".git/hooks/pre-commit"]
        R5[".git/hooks/pre-commit"]
        R6["... more repos"]
    end

    DISCOVER --> R1
    DISCOVER --> R2
    DISCOVER --> R3
    DISCOVER --> R4
    DISCOVER --> R5
    DISCOVER --> R6

    SRC_HOOK -.->|"copied to each<br/>.git/hooks/"| R1
    SRC_HOOK -.->|"copied"| R2
    SRC_HOOK -.->|"copied"| R4
    SRC_HOOK -.->|"copied"| R5

    R1 -->|"exec"| SRC_SCAN
    R2 -->|"exec"| SRC_SCAN
    R4 -->|"exec"| SRC_SCAN
    R5 -->|"exec"| SRC_SCAN

    style SRC_SCAN fill:#16213e,stroke:#e94560,color:#fff,stroke-width:2px
    style SRC_HOOK fill:#1a1a2e,stroke:#53a8b6,color:#fff
```

**Key design**: The shell wrapper is copied to each repo, but the actual scanner (`Test-PreCommitPii.ps1`) lives in one place. The wrapper walks up directories to find it — so updating the scanner in the scripts repo instantly updates all repos.

---

## Central .env Structure

```mermaid
pie title "Variables by Category"
    "Cloud Identity and Auth" : 25
    "Service Infrastructure" : 18
    "Source Control and CI/CD" : 15
    "Certificates and Keys" : 14
    "Storage and Networking" : 12
    "Analytics and Monitoring" : 10
    "Compute and VMs" : 10
    "DNS and Domain" : 12
    "AI and MCP" : 8
    "App Config" : 15
    "Other Config" : 37
```

```
<root>\.env                          ← OUTSIDE all repos (no .git/ here)
├── # ── Cloud Identity ──
│   ├── CLOUD_SUBSCRIPTION_ID=...
│   ├── CLOUD_TENANT_ID=...
│   └── CLOUD_RESOURCE_GROUP=...
├── # ── Source Control ──
│   ├── SCM_TOKEN=...
│   └── SCM_ORG=...
├── # ── AI Services ──
│   └── AI_API_KEY=...
├── # ── Certificates ──
│   ├── CERT_THUMBPRINT=...
│   └── PFX_BASE64=...
└── ... (many sections)
```

---

## Import-CentralEnv.ps1 Logic

```mermaid
%%{init: {"flowchart": {"defaultRenderer": "elk"}} }%%
flowchart TD
    START["pwsh session starts"] --> PROFILE["$PROFILE loads"]
    PROFILE --> DOTSOURCE[". Import-CentralEnv.ps1 -Quiet"]
    DOTSOURCE --> EXISTS{"central .env<br/>exists?"}
    EXISTS -->|"No"| WARN["⚠️ Warning:<br/>Central .env not found"]
    EXISTS -->|"Yes"| READ["Read all lines"]
    READ --> LOOP["For each line"]
    LOOP --> BLANK{"Empty or<br/># comment?"}
    BLANK -->|"Yes"| SKIP["Skip"] --> LOOP
    BLANK -->|"No"| PARSE{"Matches<br/>KEY=VALUE?"}
    PARSE -->|"No"| SKIP
    PARSE -->|"Yes"| QUOTE["Strip surrounding<br/>quotes if present"]
    QUOTE --> FORCE{"Already set<br/>& no -Force?"}
    FORCE -->|"Yes"| SKIPVAR["Skip (preserve<br/>existing)"] --> LOOP
    FORCE -->|"No"| SET["SetEnvironmentVariable<br/>(key, value, Process)"]
    SET --> COUNT["loadedCount++"] --> LOOP
    LOOP -->|"EOF"| DONE["✅ All vars loaded"]

    style START fill:#1a1a2e,stroke:#53a8b6,color:#fff
    style DONE fill:#2d6a4f,stroke:#1b4332,color:#fff,stroke-width:2px
    style WARN fill:#e85d04,stroke:#dc2f02,color:#fff
```

---

## Hook Resolution Chain

When `git commit` fires the `pre-commit` hook, the shell wrapper must locate `Test-PreCommitPii.ps1`:

```mermaid
%%{init: {"flowchart": {"defaultRenderer": "elk"}} }%%
flowchart LR
    COMMIT["git commit"] --> HOOK[".git/hooks/pre-commit<br/>(shell script)"]
    HOOK --> PWSH{"pwsh<br/>available?"}
    PWSH -->|"Yes"| PS7["Use pwsh"]
    PWSH -->|"No"| PS5{"powershell<br/>available?"}
    PS5 -->|"Yes"| PSWIN["Use powershell"]
    PS5 -->|"No"| SKIP["⚠️ Skip scan<br/>exit 0"]

    PS7 --> FIND
    PSWIN --> FIND

    FIND["Find scanner script"]
    FIND --> E1{"$PRECOMMIT_PII_SCRIPT<br/>env var set?"}
    E1 -->|"Yes"| USE1["Use env var path"]
    E1 -->|"No"| E2{"Sibling .ps1 in<br/>hooks dir?"}
    E2 -->|"Yes"| USE2["Use hooks/Test-PreCommitPii.ps1"]
    E2 -->|"No"| E3["Walk up from repo root<br/>→ find scripts repo/<br/>powershell/git/"]
    E3 --> USE3{"Found?"}
    USE3 -->|"Yes"| EXEC["exec pwsh -File<br/>Test-PreCommitPii.ps1"]
    USE3 -->|"No"| SKIP

    USE1 --> EXEC
    USE2 --> EXEC

    style EXEC fill:#16213e,stroke:#0f3460,color:#fff,stroke-width:2px
    style SKIP fill:#e85d04,stroke:#dc2f02,color:#fff
```

---

## What Gets Blocked vs. Warned

```mermaid
%%{init: {"flowchart": {"defaultRenderer": "elk"}} }%%
graph LR
    subgraph "❌ HARD BLOCK (exit 1)"
        direction TB
        B1["🗂️ Forbidden Files<br/>.env · .key · .pem<br/>.pfx · id_rsa"]
        B2["🔑 Azure Secrets<br/>SAS tokens<br/>Storage keys<br/>SQL passwords<br/>ServiceBus keys"]
        B3["🎫 API Tokens<br/>sk- (OpenAI)<br/>ghp_ (GitHub)<br/>AKIA (AWS)<br/>AIza (Google)"]
        B4["📛 PII Data<br/>SSN: 123-45-6789<br/>CC: 4532-XXXX-XXXX<br/>Private keys"]
        B5["📄 Your Actual Secrets<br/>Any value from<br/>central .env<br/>(≥ min length)"]
    end

    subgraph "⚠️ WARNING ONLY"
        direction TB
        W1["📧 Emails<br/>user@example.com"]
        W2["🔧 Generic Assignments<br/>api_key = abc123<br/>secret = xyz789"]
        W3["📜 Thumbprints<br/>40-char hex strings"]
    end

    style B1 fill:#9d0208,stroke:#6a040f,color:#fff
    style B2 fill:#9d0208,stroke:#6a040f,color:#fff
    style B3 fill:#9d0208,stroke:#6a040f,color:#fff
    style B4 fill:#9d0208,stroke:#6a040f,color:#fff
    style B5 fill:#d00000,stroke:#6a040f,color:#fff,stroke-width:3px
    style W1 fill:#e85d04,stroke:#dc2f02,color:#fff
    style W2 fill:#e85d04,stroke:#dc2f02,color:#fff
    style W3 fill:#e85d04,stroke:#dc2f02,color:#fff
```

---

## Security Posture Summary

```mermaid
%%{init: {"flowchart": {"defaultRenderer": "elk"}} }%%
graph TD
    subgraph "Before"
        OLD1["❌ Many .env files<br/>scattered across repos"]
        OLD2["❌ No pre-commit hooks<br/>on most repos"]
        OLD3["❌ Inconsistent .gitignore<br/>many repos missing .env"]
        OLD4["❌ Duplicated secrets<br/>across multiple repos"]
    end

    ARROW["━━━━━━━━━━━━━━━━━▶"]

    subgraph "After"
        NEW1["✅ Single central .env<br/>outside all repos"]
        NEW2["✅ 3-layer scanner<br/>on all repos"]
        NEW3["✅ Auto .gitignore<br/>added by deployer"]
        NEW4["✅ Single source of truth<br/>zero duplication"]
    end

    OLD1 --> ARROW
    OLD2 --> ARROW
    OLD3 --> ARROW
    OLD4 --> ARROW
    ARROW --> NEW1
    ARROW --> NEW2
    ARROW --> NEW3
    ARROW --> NEW4

    subgraph "Audit Results"
        A1["🔍 All repos scanned"]
        A2["🟢 No .env in git history"]
        A3["🟢 No secrets recoverable"]
        A4["🟢 All .env.example<br/>removed from tracking"]
    end

    NEW1 ~~~ A1
    NEW2 ~~~ A2
    NEW3 ~~~ A3
    NEW4 ~~~ A4

    style OLD1 fill:#9d0208,stroke:#6a040f,color:#fff
    style OLD2 fill:#9d0208,stroke:#6a040f,color:#fff
    style OLD3 fill:#9d0208,stroke:#6a040f,color:#fff
    style OLD4 fill:#9d0208,stroke:#6a040f,color:#fff
    style NEW1 fill:#2d6a4f,stroke:#1b4332,color:#fff
    style NEW2 fill:#2d6a4f,stroke:#1b4332,color:#fff
    style NEW3 fill:#2d6a4f,stroke:#1b4332,color:#fff
    style NEW4 fill:#2d6a4f,stroke:#1b4332,color:#fff
    style A1 fill:#16213e,stroke:#0f3460,color:#fff
    style A2 fill:#16213e,stroke:#0f3460,color:#fff
    style A3 fill:#16213e,stroke:#0f3460,color:#fff
    style A4 fill:#16213e,stroke:#0f3460,color:#fff
```

---

## Quick Reference

| Action | Command |
|--------|---------|
| Reload env vars | `Import-CentralEnv -Force` |
| Test hook (dry run) | `Test-PreCommitPii.ps1 -DryRun -Verbose` |
| Deploy to all repos | `Install-PreCommitHook.ps1 -ParentPath @('<root>\org-a','<root>\org-b') -Force` |
| Deploy to one repo | `Install-PreCommitHook.ps1 -RepoPath '<root>\org-a\my-repo'` |
| Preview deployment | `Install-PreCommitHook.ps1 -ParentPath '<root>\org-a' -WhatIf` |
| Emergency bypass | `git commit --no-verify -m 'reason'` |
| Edit central secrets | `code <root>\.env` then `Import-CentralEnv -Force` |

---

## File Map

```
<root>\
├── .env                                          ← 🔐 Central store (many vars)
├── org-a\                                        ← many repos
│   ├── repo-1\.git\hooks\pre-commit              ← 🛡️ Hook (→ scanner)
│   ├── repo-2\.git\hooks\pre-commit              ← 🛡️ Hook (→ scanner)
│   └── ... (more repos)
├── org-b\                                        ← several repos
│   ├── scripts-dev\powershell\
│   │   ├── automation\Import-CentralEnv.ps1      ← ⚡ Loader
│   │   └── git\
│   │       ├── Test-PreCommitPii.ps1             ← 🔍 Scanner (single copy)
│   │       ├── pre-commit                        ← 🐚 Shell wrapper (template)
│   │       ├── Install-PreCommitHook.ps1         ← 📦 Deployer
│   │       ├── pii-secrets-scan.yml              ← 🔄 CI workflow template (Layer 4)
│   │       ├── Invoke-GitleaksScan.ps1           ← 🔗 Gitleaks wrapper (optional)
│   │       └── SECRET-INCIDENT-RESPONSE.md       ← 📋 Incident response runbook
│   └── ... (more repos with hooks)
└── backup\.env                                    ← 💾 Backup
```

---

## Improvement Review & Recommendations

The following recommendations were reviewed against the current implementation. Each is assessed for accuracy, impact, and compatibility with the existing design.

### 1. Layer 4: Server-Side Enforcement (CI Pipeline)

**Recommendation**: Add a CI check ("PII & Secrets Scan") so the repo is protected even when someone bypasses the local hook with `--no-verify`.

**Assessment**: ✅ **Valid and recommended.** Local hooks are client-side only — any developer can bypass them. A server-side CI step closes this gap. Platform-level push protection (e.g., GitHub Advanced Security secret scanning) adds a second server-side net.

**Implementation sketch**:

```mermaid
%%{init: {"flowchart": {"defaultRenderer": "elk"}} }%%
graph LR
    DEV["Developer"] -->|"git push"| REMOTE["Git Remote"]
    REMOTE -->|"triggers"| CI["CI Pipeline"]
    CI --> L4["Layer 4: Server Scan<br/>Same scanner or<br/>platform secret scanning"]
    L4 -->|"✅ pass"| MERGE["PR Mergeable"]
    L4 -->|"❌ fail"| BLOCK["PR Blocked<br/>+ alert to owner"]

    style L4 fill:#16213e,stroke:#e94560,color:#fff,stroke-width:2px
    style BLOCK fill:#9d0208,stroke:#6a040f,color:#fff
    style MERGE fill:#2d6a4f,stroke:#1b4332,color:#fff
```

**Status**: 🟢 **Scaffolded** — `pii-secrets-scan.yml` workflow template created in scripts repo.

To deploy: copy `powershell/git/pii-secrets-scan.yml` → `<repo>/.github/workflows/pii-secrets-scan.yml`, set `SCRIPTS_REPO_TOKEN` secret, mark check as required in branch protection.

---

### 2. Use `core.hooksPath` Instead of Copying Hooks

**Recommendation**: Set `git config --global core.hooksPath <centralHooksDir>` to avoid copying the wrapper into every repo's `.git/hooks/`.

**Assessment**: ⚠️ **Partially valid — trade-offs exist.**

| Pros | Cons |
|------|------|
| Zero hook drift — one copy, all repos use it | **Global** — applies to ALL repos including third-party clones |
| No deployer needed for hook distribution | Cannot have repo-specific hooks alongside (hooks.d not natively supported) |
| Simpler maintenance | Breaks repos that ship their own hooks (e.g., husky, lefthook) |
| Recommended by Git documentation | Requires onboarding step if developer uses multiple machines |

**Current design already mitigates drift**: The copied wrapper is thin — it walks up directories to find the single scanner. Updating the scanner in the scripts repo updates behavior for all repos instantly. Only the shell wrapper itself (rarely changed) is copied.

**Recommendation**: Offer `core.hooksPath` as an **alternative mode** in the deployer rather than replacing the copy strategy. Developers using JS/Python repos with framework hooks will need the per-repo approach.

```powershell
# Alternative mode in Install-PreCommitHook.ps1
Install-PreCommitHook.ps1 -UseGlobalHooksPath  # sets core.hooksPath
Install-PreCommitHook.ps1 -ParentPath <dirs>    # current copy mode (default)
```

---

### 3. Treat Found Secrets as Incidents

**Recommendation**: When the scanner blocks a commit containing a real secret, treat it as a potential compromise — rotate the credential immediately.

**Assessment**: ✅ **Valid.** If a secret reached a staged diff, it may have been exposed in shell history, logs, or temporary files. Best practice is to rotate proactively.

**Incident Response Procedure**:

```mermaid
%%{init: {"flowchart": {"defaultRenderer": "elk"}} }%%
flowchart TD
    DETECT["🔍 Scanner blocks commit<br/>Secret value detected"] --> ASSESS{"Was the secret<br/>pushed to remote?"}
    ASSESS -->|"Yes (bypassed hook)"| CRITICAL["🔴 CRITICAL<br/>Rotate immediately<br/>Scrub git history"]
    ASSESS -->|"No (hook caught it)"| CHECK{"Could it have leaked<br/>elsewhere? (logs, shell<br/>history, temp files)"}
    CHECK -->|"Possible"| ROTATE["🟡 ROTATE<br/>Rotate credential<br/>Update central .env"]
    CHECK -->|"No"| CLEAN["🟢 LOW RISK<br/>Remove from staged files<br/>Document in incident log"]
    CRITICAL --> UPDATE["Update central .env<br/>Run Import-CentralEnv -Force"]
    ROTATE --> UPDATE
    CLEAN --> VERIFY["Verify clean commit"]
    UPDATE --> VERIFY

    style DETECT fill:#16213e,stroke:#e94560,color:#fff,stroke-width:2px
    style CRITICAL fill:#9d0208,stroke:#6a040f,color:#fff
    style ROTATE fill:#e85d04,stroke:#dc2f02,color:#fff
    style CLEAN fill:#2d6a4f,stroke:#1b4332,color:#fff
```

**Key rotation targets**: Cloud service keys, API tokens, connection strings, certificates (if private key exposed).

**Status**: 🟢 **Scaffolded** — `SECRET-INCIDENT-RESPONSE.md` runbook created in scripts repo with severity levels, step-by-step procedures, rotation quick reference, and incident log template.

---

### 4. Harden Central .env Storage

**Recommendation**: Apply OS-level protections to the central `.env` file.

**Assessment**: ✅ **Valid.** The file contains all credentials in plaintext — defense in depth applies here too.

| Protection | Method | Notes |
|------------|--------|-------|
| **Restrict ACLs** | `icacls .env /inheritance:r /grant:r "%USERNAME%:(R,W)"` | Limit to current user only |
| **Encrypt at rest** | BitLocker (full disk) or EFS (per-file) | EFS is transparent to the user |
| **Prevent cloud sync** | Exclude from OneDrive/Dropbox sync folders | Already addressed — file lives outside user profile |
| **Don't log values** | Scanner already shows "match found" not the value | ✅ Already implemented in Layer 2 |

**Action**: Add ACL hardening to the deployer or as a post-setup step. Document BitLocker/EFS recommendation.

```powershell
# Harden .env file permissions (Windows)
$envPath = "<root>\.env"
icacls $envPath /inheritance:r /grant:r "${env:USERNAME}:(R,W)"
```

---

### 5. Delegate to a Known Scanner Engine (e.g., Gitleaks)

**Recommendation**: Use a battle-tested scanner like Gitleaks under the hood to reduce regex maintenance.

**Assessment**: ⚠️ **Partially valid — hybrid approach best.**

| Current Custom Scanner | Gitleaks / trufflehog |
|------------------------|----------------------|
| ✅ Layer 2 (value matching against actual .env) — **unique capability** | ❌ Cannot match against your real secret values without configuration |
| ✅ No external dependencies | ❌ Requires Go binary or container |
| ⚠️ Regex set needs manual updates | ✅ Community-maintained rules (~800+ patterns) |
| ✅ PowerShell-native, cross-platform | ✅ Cross-platform binary |
| ✅ Integrated warning vs. block behavior | ⚠️ Binary block/allow only |

**Key insight**: Layer 2 (matching actual `.env` values against staged diffs) is a capability that off-the-shelf scanners do not provide without custom configuration. This is the system's strongest differentiator.

**Recommendation**: Keep Layers 1 and 2 as-is. Optionally invoke Gitleaks as an additional Layer 3 sub-check for broader pattern coverage, while retaining custom patterns for organization-specific needs.

**Status**: 🟢 **Scaffolded** — `Invoke-GitleaksScan.ps1` wrapper created in scripts repo. Supports `-Install` (auto-download), `-StagedOnly`, JSON reporting. Non-blocking by default — exits 0 if gitleaks not installed.

```mermaid
%%{init: {"flowchart": {"defaultRenderer": "elk"}} }%%
graph TD
    L1["Layer 1: Forbidden Files<br/>(custom)"] --> L2["Layer 2: Value Matching<br/>(custom — unique capability)"]
    L2 --> L3["Layer 3: Pattern Detection"]
    L3 --> L3A["Custom Patterns<br/>(org-specific)"]
    L3 --> L3B["Gitleaks / trufflehog<br/>(optional, community patterns)"]
    L3A --> RESULT["Combined Result"]
    L3B --> RESULT

    style L2 fill:#2d6a4f,stroke:#1b4332,color:#fff,stroke-width:3px
    style L3B fill:#16213e,stroke:#0f3460,color:#fff,stroke-dasharray:5 5
```

---

### Summary Matrix

| # | Recommendation | Verdict | Priority | Status |
|---|---------------|---------|----------|--------|
| 1 | Layer 4: CI enforcement | ✅ Do it | High | 🟢 Scaffolded — `pii-secrets-scan.yml` |
| 2 | `core.hooksPath` | ⚠️ Offer as option | Medium | ⬜ Deferred |
| 3 | Incident response for found secrets | ✅ Do it | High | 🟢 Scaffolded — `SECRET-INCIDENT-RESPONSE.md` |
| 4 | Harden .env file (ACLs, encryption) | ✅ Do it | Medium | ⬜ Deferred |
| 5 | Gitleaks as optional engine | ⚠️ Consider hybrid | Low | 🟢 Scaffolded — `Invoke-GitleaksScan.ps1` |
