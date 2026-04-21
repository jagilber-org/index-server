Param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Files
)

$ErrorActionPreference = 'Stop'
Write-Host "Running pre-commit checks (PII + env-var leak scan)..." -ForegroundColor Cyan
$errors = 0

function Fail($msg){ Write-Host "[FAIL] $msg" -ForegroundColor Red; $script:errors++ }
function Info($msg){ Write-Host "[INFO] $msg" -ForegroundColor Gray }

function Test-IsBinaryFile {
  param([string]$Path)

  try {
    $stream = [System.IO.File]::OpenRead($Path)
    try {
      $buffer = New-Object byte[] 8000
      $bytesRead = $stream.Read($buffer, 0, 8000)
      for ($i = 0; $i -lt $bytesRead; $i++) {
        if ($buffer[$i] -eq 0) { return $true }
      }
      return $false
    }
    finally {
      $stream.Close()
    }
  }
  catch {
    return $true
  }
}

function Test-LuhnNumber {
  param([string]$Value)

  $digits = ($Value -replace '[^0-9]', '')
  if ($digits.Length -lt 13 -or $digits.Length -gt 19) {
    return $false
  }

  $sum = 0
  $double = $false
  for ($index = $digits.Length - 1; $index -ge 0; $index--) {
    $digit = [int][string]$digits[$index]
    if ($double) {
      $digit *= 2
      if ($digit -gt 9) {
        $digit -= 9
      }
    }

    $sum += $digit
    $double = -not $double
  }

  return ($sum % 10) -eq 0
}

function Test-IsPublicIpv4 {
  param([string]$Value)

  $octets = $Value.Split('.')
  if ($octets.Count -ne 4) {
    return $false
  }

  foreach ($octet in $octets) {
    if ($octet -notmatch '^\d+$') {
      return $false
    }

    $number = [int]$octet
    if ($number -lt 0 -or $number -gt 255) {
      return $false
    }
  }

  if ($Value -match '^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|255\.|224\.)') {
    return $false
  }

  return $true
}

function Get-TargetFiles {
  param([string[]]$CandidateFiles)

  if ($CandidateFiles -and $CandidateFiles.Count -gt 0) {
    return $CandidateFiles | Where-Object {
      $_ -and (Test-Path $_) -and ($_ -notmatch '^scripts/pre-commit\.(ps1|mjs)$')
    }
  }

  return git diff --cached --name-only --diff-filter=ACM 2>$null | Where-Object {
    $_ -and (Test-Path $_) -and ($_ -notmatch '^scripts/pre-commit\.(ps1|mjs)$')
  }
}

$allowlistPath = Join-Path $PSScriptRoot '..' '.pii-allowlist'
$piiAllowlist = @()
if (Test-Path $allowlistPath) {
  $piiAllowlist = Get-Content $allowlistPath |
    Where-Object { $_ -and -not $_.StartsWith('#') } |
    ForEach-Object { $_.Trim() }
}
$piiFileAllowlist = @(
  'package-lock.json', 'security-scan.mjs', 'test_results.txt',
  'mermaid.min.js', 'elk.bundled.js',       # vendored dashboard libraries
  'copilot-ui.json',                         # dashboard UI config
  'pre-commit.ps1',                          # contains PII regex patterns themselves
  'test-results.json'                        # vitest output with timestamps flagged as credit cards
)

# ── 1. Static secret patterns ──────────────────────────────────────────────
$secretPatterns = @(
  @{ pat = 'AKIA[0-9A-Z]{16}'; label = 'AWS access key' }
  @{ pat = '(?i)(?:secret[_-]?key|client[_-]?secret|api[_-]?secret)\s*[:=]\s*["'']?[A-Za-z0-9/+=]{8,}'; label = 'secret key assignment' }
  @{ pat = '-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----'; label = 'private key' }
  @{ pat = 'ghp_[0-9A-Za-z]{36}'; label = 'GitHub PAT' }
  @{ pat = 'gho_[0-9A-Za-z]{36}'; label = 'GitHub OAuth token' }
  @{ pat = 'github_pat_[0-9A-Za-z]{22}_[0-9A-Za-z]{59}'; label = 'GitHub fine-grained PAT' }
  @{ pat = 'sk-[A-Za-z0-9]{20,}'; label = 'OpenAI/API secret key' }
  @{ pat = 'npm_[A-Za-z0-9]{36}'; label = 'npm token' }
  @{ pat = 'xox[bpars]-[0-9A-Za-z-]{10,}'; label = 'Slack token' }
  @{ pat = 'eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}'; label = 'JWT token' }
)

# ── 2. Curated PII and sensitive infrastructure patterns ──────────────────
$piiPatterns = @(
  @{ Name = 'Email address'; Regex = '(?i)\b[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}\b' }
  @{ Name = 'US phone number'; Regex = '\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})\b' }
  @{ Name = 'SSN'; Regex = '\b\d{3}-\d{2}-\d{4}\b' }
  @{ Name = 'Public IPv4 address'; Regex = '(?<!\d)(?:\d{1,3}\.){3}\d{1,3}(?!\d)' }
  @{ Name = 'Credit card number'; Regex = '\b(?:\d[ -]?){13,19}\b'; RequiresLuhn = $true }
  @{ Name = 'Azure connection string'; Regex = 'DefaultEndpointsProtocol=https?;AccountName=[^;]+;AccountKey=[^;]+' }
  @{ Name = 'SAS token'; Regex = '(?:SharedAccessSignature=[^;\s]+|[?&]sig=[A-Za-z0-9%+/=]+)' }
  @{ Name = 'Certificate thumbprint'; Regex = '\b[a-fA-F0-9]{40}\b' }
)

# ── 3. Build env-var leak detection map ────────────────────────────────────
Info 'Building env-var leak detection map...'
$sensitivePrefixes = @(
  'AZURE_','ARM_','AWS_','TF_VAR_','VITE_AZURE_','WEBVIEW_TEST_','NPM_','OPENAI_','ANTHROPIC_',
  'SUBSCRIPTION','TENANT','CLIENT','ADMIN_','SF_','DEMO_','COST_','ADO_','AI_','USER_TENANT',
  'SECRET_','TOKEN_','PASSWORD_','KEY_','CONNECTION_'
)
$sensitiveExact = @(
  'ANTHROPIC_API_KEY','OPENAI_API_KEY','FIGMA_API_KEY','NPM_TOKEN','GITHUB_TOKEN',
  'CODECOV_TOKEN','GITHUB_APP_PRIVATE_KEY_FILE','GODADDY_API_KEY','GODADDY_API_SECRET',
  'AZURE_CLIENT_SECRET','AZURE_TENANT_ID','AZURE_SUBSCRIPTION_ID','AZURE_STORAGE_CONNECTION_STRING',
  'KEY_VAULT_1','DEMO_KEY_VAULT_1',
  'USERPROFILE','USERNAME','HOMEPATH','APPDATA','LOCALAPPDATA'
)
$sensitiveKeywords = @('SECRET','KEY','TOKEN','PASSWORD','CREDENTIAL','SAS','SUBSCRIPTION','TENANT','CLIENT_ID','VAULT','CERTIFICATE','RESOURCE_GROUP','CLUSTER')
$valueAllowlist = @(
  'true','false','0','1','yes','no','null','undefined','',
  'main','master','eastus','westus','eastus2','westus2','centralus','public','private','default',
  './exports','./export',
  # Public owner slug that appears in repository metadata and schema URLs.
  'jagilber',
  '00000000-0000-0000-0000-000000000000'
)

$envLeakMap = @{}
foreach($item in (Get-ChildItem env:)) {
  $key = $item.Name
  $value = $item.Value
  if (-not $value -or $value.Length -lt 8) { continue }
  if ($valueAllowlist -contains $value.ToLower()) { continue }

  $isSensitive = $false
  foreach($prefix in $sensitivePrefixes) {
    if ($key.StartsWith($prefix)) {
      $isSensitive = $true
      break
    }
  }

  if (-not $isSensitive -and $sensitiveExact -contains $key) {
    $isSensitive = $true
  }

  if (-not $isSensitive) {
    foreach($keyword in $sensitiveKeywords) {
      if ($key -match $keyword) {
        $isSensitive = $true
        break
      }
    }
  }

  if ($isSensitive) {
    $envLeakMap[$value] = $key
  }
}
Info "Monitoring $($envLeakMap.Count) sensitive env var values for leaks"

# ── 3b. Username-in-path detection ─────────────────────────────────────────
$currentUser = $env:USERNAME
if (-not $currentUser) { $currentUser = $env:USER }
$userPathRegexes = @()
if ($currentUser -and $currentUser.Length -ge 2) {
  $escapedUser = [regex]::Escape($currentUser)
  $boundary = '(?=[\\/''""\s]|$)'
  $userPathRegexes += "C:\\Users\\$escapedUser$boundary"
  $userPathRegexes += "C:/Users/$escapedUser$boundary"
  $userPathRegexes += "/home/$escapedUser$boundary"
  $userPathRegexes += "/Users/$escapedUser$boundary"
}

# ── 3c. Lockfile skip patterns ─────────────────────────────────────────────
$lockfilePatterns = @(
  '*.lock', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  'Pipfile.lock', 'poetry.lock', 'composer.lock', 'Gemfile.lock',
  'packages.lock.json', 'go.sum'
)

# ── 4. Scan target files ───────────────────────────────────────────────────
$targets = @(Get-TargetFiles -CandidateFiles $Files)
Info "Scanning $($targets.Count) staged files..."

$fileIndex = 0
foreach($file in $targets) {
  $fileIndex++
  if ($fileIndex % 100 -eq 0) {
    Info "  Progress: $fileIndex / $($targets.Count) files scanned..."
  }
  $normalized = ($file -replace '\\','/')
  if ($normalized -match '(^|/)\.env$' -or $normalized -match '(^|/)\.env\.(?!example$|sample$|template$|test$)[^/]+$') {
    Fail "Forbidden sensitive file path committed: $file"
    continue
  }

  # Skip lockfiles for env-leak and username-in-path checks (too many false positives)
  $isLockfile = $false
  $basename = [System.IO.Path]::GetFileName($file)
  foreach ($lp in $lockfilePatterns) {
    if ($basename -like $lp) { $isLockfile = $true; break }
  }

  if (Test-IsBinaryFile -Path $file) {
    continue
  }

  $content = Get-Content -Raw -ErrorAction SilentlyContinue -Path $file
  if ($null -eq $content) { $content = ''; $lines = @() } else { $lines = $content -split '\r?\n' }

  foreach($sp in $secretPatterns) {
    if ($content -match $sp.pat) {
      Fail "Secret pattern ($($sp.label)) in $file"
    }
  }

  $lineNumber = 0
  foreach($line in $lines) {
    $lineNumber++

    if ($basename -notin $piiFileAllowlist -and $line -notmatch '(#|//)\s*pii-allowlist') {
      foreach($pattern in $piiPatterns) {
        $matches = [regex]::Matches($line, $pattern.Regex)
        foreach($match in $matches) {
          $value = $match.Value

          if ($pattern.Name -eq 'Email address' -and $value -match '@(example\.(com|net|org)|contoso\.com|company\.com|localhost)$') {
            continue
          }

          if ($pattern.Name -eq 'Public IPv4 address' -and -not (Test-IsPublicIpv4 -Value $value)) {
            continue
          }

          if ($pattern.ContainsKey('RequiresLuhn') -and $pattern.RequiresLuhn -and -not (Test-LuhnNumber -Value $value)) {
            continue
          }

          $isAllowlisted = $false
          foreach($entry in $piiAllowlist) {
            if ($value -match $entry) {
              $isAllowlisted = $true
              break
            }
          }

          if ($isAllowlisted) {
            continue
          }

          Fail "PII pattern ($($pattern.Name)) in $($file):$lineNumber -> $value"
        }
      }
    }

    if ($line -match 'env-leak-allowlist') {
      continue
    }

  }

  # Env-leak and username-in-path: check whole-file first, line-scan only on hit
  if (-not $isLockfile) {
    foreach($entry in $envLeakMap.GetEnumerator()) {
      if ($content.Contains($entry.Key)) {
        $lineNumber = 0
        foreach($scanLine in $lines) {
          $lineNumber++
          if ($scanLine.Contains($entry.Key)) {
            Fail ('ENV VAR LEAK: Value of ${0} found in {1}:{2}' -f $entry.Value, $file, $lineNumber)
          }
        }
      }
    }

    foreach($upr in $userPathRegexes) {
      if ($content -match $upr) {
        $lineNumber = 0
        foreach($scanLine in $lines) {
          $lineNumber++
          if ($scanLine -match $upr) {
            Fail "USERNAME-IN-PATH: $($file):$lineNumber contains user-specific path"
            break
          }
        }
      }
    }
  }
}

# ── Result ─────────────────────────────────────────────────────────────────
if ($errors -gt 0) {
  Write-Host ''
  Write-Host '╔══════════════════════════════════════════════════════════════╗' -ForegroundColor Red
  Write-Host '║  PRE-COMMIT BLOCKED — sensitive content detected!          ║' -ForegroundColor Red
  Write-Host '╠══════════════════════════════════════════════════════════════╣' -ForegroundColor Red
  Write-Host "║  $errors issue(s) found. Fix before committing." -ForegroundColor Red
  Write-Host '║                                                            ║' -ForegroundColor Red
  Write-Host '║  Use .pii-allowlist, # pii-allowlist, or env-leak-allowlist║' -ForegroundColor Red
  Write-Host '║  only for intentional false positives with rationale.      ║' -ForegroundColor Red
  Write-Host '╚══════════════════════════════════════════════════════════════╝' -ForegroundColor Red
  Write-Host ''
  exit 1
}
Write-Host "Pre-commit checks passed ($($targets.Count) files scanned, $($envLeakMap.Count) env vars monitored)." -ForegroundColor Green
exit 0
