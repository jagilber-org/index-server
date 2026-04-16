# Tests — Cross-Platform npx Validation

Smoke tests to verify the published `@jagilber-org/index-server` npm package
installs and boots correctly on fresh machines.

## Quick Start

### Windows (PowerShell)

```powershell
# Public (npmjs.org) — no token needed
.\tests\validate-npx-install.ps1

# GitHub Packages (private)
$env:NPM_TOKEN = "ghp_your_token_here"
.\tests\validate-npx-install.ps1 -Registry github
```

### Linux / macOS (Bash)

```bash
# Public
./tests/validate-npx-install.sh

# GitHub Packages
export NPM_TOKEN="ghp_your_token_here"
./tests/validate-npx-install.sh --registry github
```

## What Gets Tested

| Test | Description |
|------|-------------|
| Node.js version | ≥ 22 required |
| npm available | npm cli present |
| npx --help | Server boots and prints help text |
| Package version | `npm view` resolves the package |
| Binary output | Output contains `MCP TRANSPORT`, `dashboard`, or `stdio` |
| Dashboard TLS | `--dashboard-tls` flag is accepted |

## Registry Options

| Flag | Registry | Auth Required |
|------|----------|---------------|
| `npmjs` (default) | `registry.npmjs.org` | No |
| `github` | `npm.pkg.github.com` | Yes — `NPM_TOKEN` env var |

## Azure VM Testing

For cross-OS validation on real VMs, use the companion Azure test-environment scripts:

```powershell
# 1. Deploy VMs (Linux + Windows, Node.js pre-installed)
cd <path-to-your-scripts-repo>
$pass = Read-Host "Password" -AsSecureString
.\powershell\azure\Deploy-AzTestVmEnvironment.ps1 -AdminPassword $pass

# 2. Validate npx on all VMs (no SSH needed — uses Azure control plane)
$token = Read-Host "GitHub PAT" -AsSecureString
.\powershell\azure\Test-AzTestVmValidation.ps1 `
    -ResourceGroupName rg-test-vms `
    -PackageName '@jagilber-org/index-server' `
    -NpmToken $token -NpmRegistry github

# 3. Teardown
.\powershell\azure\Deploy-AzTestVmEnvironment.ps1 -Teardown
```

### Pen Testing (Future)

Add `-EnablePenTest` to the deploy command to get attacker VMs with nmap, nikto,
ZAP, and certbot. Opens dashboard ports (8787/443) to your IP only.

```powershell
.\powershell\azure\Deploy-AzTestVmEnvironment.ps1 `
    -AdminPassword $pass -EnablePenTest -AttackerVmCount 1
```

## Prerequisites

- **Node.js ≥ 22** — [nodejs.org](https://nodejs.org/)
- **npm** — bundled with Node.js
- **Azure VMs** (optional) — requires Az PowerShell module + `Connect-AzAccount`
