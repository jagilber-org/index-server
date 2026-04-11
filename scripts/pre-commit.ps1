Param()
Write-Host "Running pre-commit checks (PII + env-var leak scan)..." -ForegroundColor Cyan
$errors = 0

function Fail($msg){ Write-Host "[FAIL] $msg" -ForegroundColor Red; $script:errors++ }
function Info($msg){ Write-Host "[INFO] $msg" -ForegroundColor Gray }

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
  @{ pat = 'DefaultEndpointsProtocol=https?;AccountName=[^;]+;AccountKey=[^;]+'; label = 'Azure connection string' }
  @{ pat = 'SharedAccessSignature=sig=[A-Za-z0-9%+/=]+'; label = 'SAS token' }
)

# ── 2. PII patterns ────────────────────────────────────────────────────────
$piiPatterns = @(
  @{ pat = '\b\d{3}-\d{2}-\d{4}\b'; label = 'SSN-like' }
  @{ pat = '\b\d{16}\b'; label = 'credit card-like' }
)

# ── 3. Build env-var leak detection map ────────────────────────────────────
Info 'Building env-var leak detection map...'
$sensitivePrefixes = @('AZURE_','ARM_','TF_VAR_','VITE_AZURE_','WEBVIEW_TEST_',
  'SUBSCRIPTION','TENANT','CLIENT','ADMIN_','SF_','DEMO_','COST_','ADO_','AI_','USER_TENANT')
$sensitiveExact = @('ANTHROPIC_API_KEY','OPENAI_API_KEY','FIGMA_API_KEY','NPM_TOKEN',
  'CODECOV_TOKEN','GITHUB_APP_PRIVATE_KEY_FILE','GODADDY_API_KEY','GODADDY_API_SECRET',
  'KEY_VAULT_1','DEMO_KEY_VAULT_1')
$sensitiveKeywords = @('SECRET','KEY','TOKEN','PASSWORD','CREDENTIAL','SAS','SUBSCRIPTION','TENANT','CLIENT_ID')
$valueAllowlist = @('true','false','0','1','yes','no','null','undefined','',
  'eastus','westus','eastus2','westus2','centralus','public','private','default',
  './exports','./export',
  # Public owner slug that appears in repository metadata and schema URLs.
  'jagilber',
  '00000000-0000-0000-0000-000000000000')

$envLeakMap = @{}
foreach($item in (Get-ChildItem env:)) {
  $key = $item.Name
  $value = $item.Value
  if (-not $value -or $value.Length -lt 8) { continue }
  if ($valueAllowlist -contains $value.ToLower()) { continue }

  $isSensitive = $false
  foreach($p in $sensitivePrefixes) { if ($key.StartsWith($p)) { $isSensitive = $true; break } }
  if (-not $isSensitive) { if ($sensitiveExact -contains $key) { $isSensitive = $true } }
  if (-not $isSensitive) {
    foreach($kw in $sensitiveKeywords) { if ($key -match $kw) { $isSensitive = $true; break } }
  }
  if ($isSensitive) { $envLeakMap[$value] = $key }
}
Info "Monitoring $($envLeakMap.Count) sensitive env var values for leaks"

# ── 4. Scan staged files ──────────────────────────────────────────────────
$staged = git diff --cached --name-only | Where-Object {
  $_ -and (Test-Path $_) -and ($_ -notmatch '^scripts/pre-commit\.(ps1|mjs)$')
}
Info "Scanning $(@($staged).Count) staged files..."

foreach($file in $staged) {
  $normalized = ($file -replace '\\','/')
  if ($normalized -match '(^|/)\.env$' -or $normalized -match '(^|/)\.env\.(?!example$|sample$|template$|test$)[^/]+$') {
    Fail "Forbidden sensitive file path committed: $file"
    continue
  }

  $content = Get-Content -Raw -ErrorAction SilentlyContinue -Path $file
  if (-not $content) { continue }

  # 4a. Secret patterns
  foreach($sp in $secretPatterns) {
    if ($content -match $sp.pat) { Fail "Secret pattern ($($sp.label)) in $file" }
  }

  # 4b. PII patterns
  if ($file -notmatch '\.(png|jpg|gif|ico|woff|ttf|eot|svg|map)$') {
    foreach($pp in $piiPatterns) {
      if ($content -match $pp.pat) { Fail "PII pattern ($($pp.label)) in $file" }
    }
  }

  # 4c. Env var value leak detection
  foreach($entry in $envLeakMap.GetEnumerator()) {
    if ($content.Contains($entry.Key)) {
      Fail "ENV VAR LEAK: Value of `$$($entry.Value) found in $file"
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
  Write-Host '║  If a value is a false positive, add it to valueAllowlist  ║' -ForegroundColor Red
  Write-Host '║  in scripts/pre-commit.ps1 (with justification comment).   ║' -ForegroundColor Red
  Write-Host '╚══════════════════════════════════════════════════════════════╝' -ForegroundColor Red
  Write-Host ''
  exit 1
}
Write-Host "Pre-commit checks passed ($(@($staged).Count) files scanned, $($envLeakMap.Count) env vars monitored)." -ForegroundColor Green
exit 0
