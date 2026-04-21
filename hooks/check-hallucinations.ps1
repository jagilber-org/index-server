<##
.SYNOPSIS
    Detect common agent hallucination patterns in staged files.

.DESCRIPTION
    Scans staged files for three categories of hallucinated code:

    1. Fabricated dependencies — newly added packages in manifests that match
       known typosquatting patterns or suspicious naming conventions.
    2. Phantom imports — import/require/using statements referencing modules
       not present in the project tree or declared dependencies.
    3. Self-validating tests — test assertions that are trivially true or
       test functions with no assertions at all.

    Supports inline hallucination-allowlist markers and a repo-level
    `.hallucination-allowlist` file.
#>
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Files
)

$ErrorActionPreference = 'Stop'

function Test-IsBinaryFile {
    param([string]$Path)
    try {
        $bytes = [System.IO.File]::ReadAllBytes($Path) | Select-Object -First 8000
        return $bytes -contains 0
    }
    catch { return $true }
}

function Get-StagedFiles {
    param([string[]]$CandidateFiles)
    if ($CandidateFiles -and $CandidateFiles.Count -gt 0) {
        return $CandidateFiles | Where-Object { $_ -and (Test-Path $_) }
    }
    $gitFiles = git diff --cached --name-only --diff-filter=ACM 2>$null
    return $gitFiles | Where-Object { $_ -and (Test-Path $_) }
}

$allowlistPath = Join-Path $PSScriptRoot '..' '.hallucination-allowlist'
$allowlistEntries = @{ dependency = @(); import = @(); test = @() }
if (Test-Path $allowlistPath) {
    Get-Content $allowlistPath |
        Where-Object { $_ -and -not $_.StartsWith('#') } |
        ForEach-Object {
            $parts = $_.Trim() -split ':', 2
            if ($parts.Count -eq 2 -and $allowlistEntries.ContainsKey($parts[0])) {
                $pattern = $parts[1].Trim()
                # Reject category-wide wildcards that could bypass all checks
                if ($pattern -eq '*' -or $pattern -eq '?' -or $pattern -eq '**' -or -not $pattern) {
                    Write-Warning "Ignoring overly broad allowlist pattern: $($parts[0]):$pattern"
                    continue
                }
                $allowlistEntries[$parts[0]] += $pattern
            }
        }
}

function Test-Allowlisted {
    param([string]$Category, [string]$Value)
    foreach ($entry in $allowlistEntries[$Category]) {
        if ($Value -like $entry -or $Value -eq $entry) { return $true }
    }
    return $false
}

# Default popular package lists — can be extended via .hallucination-packages.json
$popularNpmPackages = @(
    'lodash', 'express', 'react', 'axios', 'moment', 'webpack', 'babel',
    'typescript', 'eslint', 'prettier', 'jest', 'mocha', 'chalk', 'commander',
    'inquirer', 'debug', 'dotenv', 'uuid', 'cors', 'helmet', 'passport',
    'mongoose', 'sequelize', 'knex', 'redis', 'socket.io', 'nodemon',
    'next', 'vue', 'angular', 'svelte', 'tailwindcss', 'postcss'
)

$popularPyPackages = @(
    'requests', 'flask', 'django', 'numpy', 'pandas', 'scipy', 'matplotlib',
    'tensorflow', 'torch', 'scikit-learn', 'pillow', 'boto3', 'celery',
    'sqlalchemy', 'fastapi', 'uvicorn', 'pydantic', 'pytest', 'black',
    'mypy', 'pylint', 'httpx', 'aiohttp', 'beautifulsoup4', 'scrapy',
    'redis', 'psycopg2', 'cryptography', 'paramiko', 'fabric'
)

# Load external package config if present (allows maintaining lists without editing the hook)
$packagesConfigPath = Join-Path $PSScriptRoot '..' '.hallucination-packages.json'
if (Test-Path $packagesConfigPath) {
    try {
        $pkgConfig = Get-Content $packagesConfigPath -Raw | ConvertFrom-Json
        if ($pkgConfig.PSObject.Properties['npm']) {
            $popularNpmPackages = @($popularNpmPackages) + @($pkgConfig.npm)
        }
        if ($pkgConfig.PSObject.Properties['pypi']) {
            $popularPyPackages = @($popularPyPackages) + @($pkgConfig.pypi)
        }
    }
    catch {
        Write-Warning "Failed to load .hallucination-packages.json: $_"
    }
}

function Test-TyposquatCandidate {
    param([string]$PackageName, [string[]]$KnownPackages)
    $lower = $PackageName.ToLower()
    foreach ($known in $KnownPackages) {
        if ($lower -eq $known) { return $false }
        # Skip packages that are just a known name with trailing digits (e.g., axios1, lodash2)
        if ($lower -match "^${known}\d+$") { continue }
        if ($lower.Length -eq $known.Length) {
            $diffs = 0
            for ($i = 0; $i -lt $lower.Length; $i++) {
                if ($lower[$i] -ne $known[$i]) { $diffs++ }
            }
            if ($diffs -eq 1) { return $true }
        }
        if ($lower -match "^${known}[-_\.]?(js|py|ts|node|lib|util|utils|helper|dev|official|real|secure|fast|new|alt)$") {
            return $true
        }
        if ($lower -match "^(the-?|my-?|real-?|original-?|secure-?|fast-?)${known}$") {
            return $true
        }
    }
    return $false
}

function Find-FabricatedDependencies {
    param([string]$FilePath)
    $findings = @()
    $fileName = Split-Path -Leaf $FilePath

    if ($fileName -eq 'package.json') {
        try {
            $json = Get-Content $FilePath -Raw | ConvertFrom-Json
            $depSections = @('dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies')
            foreach ($section in $depSections) {
                if ($json.PSObject.Properties[$section]) {
                    $json.$section.PSObject.Properties | ForEach-Object {
                        $pkgName = $_.Name
                        if (-not (Test-Allowlisted -Category 'dependency' -Value $pkgName) -and
                            (Test-TyposquatCandidate -PackageName $pkgName -KnownPackages $popularNpmPackages)) {
                            $findings += [PSCustomObject]@{
                                File = $FilePath; Line = 0
                                Type = 'Fabricated dependency (typosquat candidate)'
                                Detail = "$pkgName in $section"
                            }
                        }
                    }
                }
            }
        }
        catch { }
    }

    if ($fileName -eq 'requirements.txt' -or $fileName -match '^requirements[-_].+\.txt$') {
        $lineNumber = 0
        Get-Content $FilePath -ErrorAction SilentlyContinue | ForEach-Object {
            $lineNumber++
            $line = $_.Trim()
            if ($line -and -not $line.StartsWith('#') -and -not $line.StartsWith('-')) {
                $pkgName = ($line -split '[>=<!~;\[]')[0].Trim()
                if ($pkgName -and
                    -not (Test-Allowlisted -Category 'dependency' -Value $pkgName) -and
                    (Test-TyposquatCandidate -PackageName $pkgName -KnownPackages $popularPyPackages)) {
                    $findings += [PSCustomObject]@{
                        File = $FilePath; Line = $lineNumber
                        Type = 'Fabricated dependency (typosquat candidate)'
                        Detail = $pkgName
                    }
                }
            }
        }
    }
    return $findings
}

$importPatterns = @(
    @{ Regex = "(?:import\s+.*?\s+from\s+[""'``]([^""'``]+)[""'``]|require\s*\(\s*[""'``]([^""'``]+)[""'``]\s*\))"; Language = 'js' },
    @{ Regex = '(?:^|\s)(?:from\s+(\S+)\s+import|import\s+(\S+))'; Language = 'py' },
    @{ Regex = '^\s*using\s+(?!var\s)([A-Z][\w.]+)\s*;'; Language = 'cs' },
    @{ Regex = "(?:import\s+[""'``]([^""'``]+)[""'``]|^\s*[""'``]([^""'``]+)[""'``]\s*$)"; Language = 'go' }
)

$builtinModules = @{
    'js' = @('path','fs','os','util','http','https','url','crypto','stream',
             'events','child_process','cluster','net','dns','tls','readline',
             'zlib','assert','buffer','console','process','querystring',
             'string_decoder','timers','vm','worker_threads','perf_hooks',
             'node:path','node:fs','node:os','node:util','node:http',
             'node:https','node:url','node:crypto','node:stream',
             'node:events','node:child_process','node:net','node:dns',
             'node:tls','node:readline','node:zlib','node:assert',
             'node:buffer','node:console','node:process','node:querystring',
             'node:string_decoder','node:timers','node:vm','node:worker_threads',
             'node:perf_hooks','node:test','react','react-dom')
    'py' = @('os','sys','io','json','csv','re','math','random','datetime',
             'time','collections','itertools','functools','operator','string',
             'textwrap','unicodedata','struct','codecs','pprint','reprlib',
             'enum','graphlib','numbers','cmath','decimal','fractions',
             'statistics','pathlib','fileinput','stat','glob','fnmatch',
             'shutil','tempfile','copy','pickle','shelve','marshal','dbm',
             'sqlite3','zipfile','tarfile','gzip','bz2','lzma','hashlib',
             'hmac','secrets','subprocess','sched','queue','contextvars',
             'threading','multiprocessing','concurrent','asyncio','socket',
             'ssl','select','signal','mmap','email','html','xml',
             'urllib','http','ftplib','smtplib','imaplib','poplib',
             'xmlrpc','ipaddress','logging','warnings','dataclasses',
             'contextlib','abc','typing','types','traceback','inspect',
             'dis','gc','weakref','pdb','unittest','doctest',
             'pytest','argparse','getopt','configparser','tomllib',
             'platform','errno','ctypes','__future__')
    'cs' = @('System','System.Collections','System.Collections.Generic',
             'System.IO','System.Linq','System.Net','System.Net.Http',
             'System.Text','System.Text.Json','System.Text.RegularExpressions',
             'System.Threading','System.Threading.Tasks','System.Diagnostics',
             'System.Globalization','System.Reflection','System.Runtime',
             'System.Security','System.ComponentModel','Microsoft.Extensions',
             'Microsoft.AspNetCore','Microsoft.EntityFrameworkCore')
    'go' = @('fmt','os','io','net','net/http','encoding','encoding/json',
             'encoding/xml','strings','strconv','math','time','sync',
             'context','errors','log','path','path/filepath','regexp',
             'sort','bytes','bufio','crypto','database/sql','flag',
             'html','html/template','text/template','testing','reflect',
             'runtime','unsafe','embed')
}

$fileExtToLanguage = @{
    '.js'='js'; '.jsx'='js'; '.ts'='js'; '.tsx'='js'; '.mjs'='js'; '.cjs'='js'
    '.py'='py'; '.pyi'='py'; '.cs'='cs'; '.go'='go'
}

function Find-PhantomImports {
    param([string]$FilePath)
    $findings = @()
    $ext = [System.IO.Path]::GetExtension($FilePath).ToLower()
    if (-not $fileExtToLanguage.ContainsKey($ext)) { return $findings }
    $lang = $fileExtToLanguage[$ext]
    $builtins = $builtinModules[$lang]
    $lineNumber = 0
    $lines = Get-Content $FilePath -ErrorAction SilentlyContinue
    if (-not $lines) { return $findings }

    foreach ($line in $lines) {
        $lineNumber++
        if (Test-InlineAllowlisted -Line $line -FilePath $FilePath) { continue }
        foreach ($pattern in $importPatterns) {
            if ($pattern.Language -ne $lang) { continue }
            $matchResults = [regex]::Matches($line, $pattern.Regex)
            foreach ($m in $matchResults) {
                $moduleName = $null
                for ($g = 1; $g -le $m.Groups.Count - 1; $g++) {
                    if ($m.Groups[$g].Success) { $moduleName = $m.Groups[$g].Value; break }
                }
                if (-not $moduleName -or $moduleName.StartsWith('.')) { continue }
                $rootModule = ($moduleName -split '[/\\]')[0]
                if ($builtins -contains $moduleName -or $builtins -contains $rootModule) { continue }
                if ($lang -eq 'py') {
                    $rootModule = ($moduleName -split '\.')[0]
                    if ($builtins -contains $rootModule) { continue }
                }
                if ($lang -eq 'cs') {
                    $isKnown = $false
                    foreach ($ns in $builtins) {
                        if ($moduleName -eq $ns -or $moduleName.StartsWith("$ns.")) { $isKnown = $true; break }
                    }
                    if ($isKnown) { continue }
                }
                if (Test-Allowlisted -Category 'import' -Value $moduleName) { continue }
                $isSuspicious = $false
                if ($moduleName -match '[-_](helper|utils?|lib|core|base|main|app|service|manager|handler|factory|provider|wrapper|adapter|plugin|extension|module|component|controller|middleware|interceptor|resolver|decorator|mixin|trait|interface|abstract|impl|concrete|real|actual|true|original|secure|safe|fast|quick|super|mega|ultra|hyper|turbo)\d+$') {
                    $isSuspicious = $true
                }
                $segments = ($moduleName -split '[-_/.]')
                if ($segments.Count -ge 5) { $isSuspicious = $true }
                if ($isSuspicious) {
                    $findings += [PSCustomObject]@{
                        File = $FilePath; Line = $lineNumber
                        Type = 'Phantom import (suspicious module name)'; Detail = $moduleName
                    }
                }
            }
        }
    }
    return $findings
}

$selfValidatingPatterns = @(
    @{ Regex = 'expect\s*\(\s*true\s*\)\s*\.toBe\s*\(\s*true\s*\)'; Name = 'expect(true).toBe(true)' },
    @{ Regex = 'expect\s*\(\s*false\s*\)\s*\.toBe\s*\(\s*false\s*\)'; Name = 'expect(false).toBe(false)' },
    @{ Regex = 'expect\s*\(\s*1\s*\)\s*\.toBe\s*\(\s*1\s*\)'; Name = 'expect(1).toBe(1)' },
    @{ Regex = 'expect\s*\(\s*true\s*\)\s*\.toBeTruthy\s*\(\s*\)'; Name = 'expect(true).toBeTruthy()' },
    @{ Regex = 'expect\s*\(\s*true\s*\)\s*\.not\s*\.toBeFalsy\s*\(\s*\)'; Name = 'expect(true).not.toBeFalsy()' },
    @{ Regex = 'assert\s*\.\s*strictEqual\s*\(\s*true\s*,\s*true\s*\)'; Name = 'assert.strictEqual(true, true)' },
    @{ Regex = 'assert\s*\.\s*equal\s*\(\s*true\s*,\s*true\s*\)'; Name = 'assert.equal(true, true)' },
    @{ Regex = 'assert\s*\.\s*ok\s*\(\s*true\s*\)'; Name = 'assert.ok(true)' },
    @{ Regex = '(?:self\.)?assert\s+True\s*$'; Name = 'assert True' },
    @{ Regex = '(?:self\.)?assertTrue\s*\(\s*True\s*\)'; Name = 'assertTrue(True)' },
    @{ Regex = '(?:self\.)?assertEqual\s*\(\s*True\s*,\s*True\s*\)'; Name = 'assertEqual(True, True)' },
    @{ Regex = '(?:self\.)?assertEqual\s*\(\s*1\s*,\s*1\s*\)'; Name = 'assertEqual(1, 1)' },
    @{ Regex = '(?:self\.)?assertFalse\s*\(\s*False\s*\)'; Name = 'assertFalse(False)' },
    @{ Regex = 'Assert\s*\.\s*IsTrue\s*\(\s*true\s*\)'; Name = 'Assert.IsTrue(true)' },
    @{ Regex = 'Assert\s*\.\s*AreEqual\s*\(\s*true\s*,\s*true\s*\)'; Name = 'Assert.AreEqual(true, true)' },
    @{ Regex = 'Assert\s*\.\s*That\s*\(\s*true\s*,\s*Is\s*\.\s*True\s*\)'; Name = 'Assert.That(true, Is.True)' },
    @{ Regex = 'assert\s*\.\s*True\s*\(\s*t\s*,\s*true\s*\)'; Name = 'assert.True(t, true)' },
    @{ Regex = 'assert\s*\.\s*Equal\s*\(\s*t\s*,\s*true\s*,\s*true\s*\)'; Name = 'assert.Equal(t, true, true)' },
    @{ Regex = '\$true\s*\|\s*Should\s+-Be\s+\$true'; Name = '$true | Should -Be $true' },
    @{ Regex = '\$false\s*\|\s*Should\s+-Be\s+\$false'; Name = '$false | Should -Be $false' }
)

$testFilePatterns = @(
    '*.test.js','*.test.ts','*.test.jsx','*.test.tsx',
    '*.spec.js','*.spec.ts','*.spec.jsx','*.spec.tsx',
    'test_*.py','*_test.py','*_test.go','*Test.cs','*.Tests.ps1'
)

$fixturePathPatterns = @('*/test/*', '*/tests/*', '*fixture*', '*__tests__/*', '*__mocks__/*', '*testdata/*')

function Test-IsTestFile {
    param([string]$Path)
    $fileName = Split-Path -Leaf $Path
    foreach ($pattern in $testFilePatterns) {
        if ($fileName -like $pattern) { return $true }
    }
    return $false
}

function Test-IsTestOrFixturePath {
    param([string]$Path)
    if (Test-IsTestFile -Path $Path) { return $true }
    $normalised = $Path -replace '\\', '/'
    foreach ($pattern in $fixturePathPatterns) {
        if ($normalised -like $pattern) { return $true }
    }
    return $false
}

function Test-InlineAllowlisted {
    param([string]$Line, [string]$FilePath)
    if ($Line -match 'hallucination-allowlist') {
        return (Test-IsTestOrFixturePath -Path $FilePath)
    }
    return $false
}

$assertionPatterns = @(
    'expect\s*\(', 'assert', 'Assert', 'Should\s', '\|\s*Should',
    'verify', 'Verify', 'check\s*\(', 'Check\s*\('
)

function Find-SelfValidatingTests {
    param([string]$FilePath)
    $findings = @()
    if (-not (Test-IsTestFile -Path $FilePath)) { return $findings }
    if (Test-Allowlisted -Category 'test' -Value $FilePath) { return $findings }
    $lines = Get-Content $FilePath -ErrorAction SilentlyContinue
    if (-not $lines) { return $findings }

    $lineNumber = 0
    foreach ($line in $lines) {
        $lineNumber++
        if (Test-InlineAllowlisted -Line $line -FilePath $FilePath) { continue }
        foreach ($pattern in $selfValidatingPatterns) {
            if ($line -match $pattern.Regex) {
                $findings += [PSCustomObject]@{
                    File = $FilePath; Line = $lineNumber
                    Type = 'Self-validating test (trivially true assertion)'; Detail = $pattern.Name
                }
            }
        }
    }

    $ext = [System.IO.Path]::GetExtension($FilePath).ToLower()
    if ($ext -eq '.py') {
        $inTestFunc = $false; $testFuncName = ''; $testFuncLine = 0; $hasAssertion = $false
        $lineNumber = 0
        foreach ($line in $lines) {
            $lineNumber++
            if ($line -match '^\s*def\s+(test_\w+)\s*\(') {
                if ($inTestFunc -and -not $hasAssertion -and $testFuncName) {
                    $findings += [PSCustomObject]@{
                        File = $FilePath; Line = $testFuncLine
                        Type = 'Self-validating test (no assertions)'; Detail = $testFuncName
                    }
                }
                $inTestFunc = $true; $testFuncName = $Matches[1]; $testFuncLine = $lineNumber; $hasAssertion = $false
                continue
            }
            if ($inTestFunc) {
                if ($line.Trim() -and $line -match '^\S') {
                    if (-not $hasAssertion -and $testFuncName) {
                        $findings += [PSCustomObject]@{
                            File = $FilePath; Line = $testFuncLine
                            Type = 'Self-validating test (no assertions)'; Detail = $testFuncName
                        }
                    }
                    $inTestFunc = $false
                    if ($line -match '^\s*def\s+(test_\w+)\s*\(') {
                        $inTestFunc = $true; $testFuncName = $Matches[1]; $testFuncLine = $lineNumber; $hasAssertion = $false
                    }
                } else {
                    foreach ($ap in $assertionPatterns) {
                        if ($line -match $ap) { $hasAssertion = $true; break }
                    }
                }
            }
        }
        if ($inTestFunc -and -not $hasAssertion -and $testFuncName) {
            $findings += [PSCustomObject]@{
                File = $FilePath; Line = $testFuncLine
                Type = 'Self-validating test (no assertions)'; Detail = $testFuncName
            }
        }
    }
    return $findings
}

$stagedFiles = Get-StagedFiles -CandidateFiles $Files
$findings = @()
foreach ($file in $stagedFiles) {
    if (Test-IsBinaryFile -Path $file) { continue }
    $findings += Find-FabricatedDependencies -FilePath $file
    $findings += Find-PhantomImports -FilePath $file
    $findings += Find-SelfValidatingTests -FilePath $file
}

if ($findings.Count -gt 0) {
    Write-Host 'ERROR: Possible agent hallucination patterns detected in staged files.' -ForegroundColor Red
    $findings | ForEach-Object {
        $lineInfo = if ($_.Line -gt 0) { ":$($_.Line)" } else { '' }
        Write-Host "  $($_.File)${lineInfo} [$($_.Type)] -> $($_.Detail)" -ForegroundColor Red
    }
    Write-Host ''
    Write-Host 'To suppress an intentional false positive:' -ForegroundColor Yellow
    Write-Host '  - Add a hallucination-allowlist comment to the line' -ForegroundColor Yellow
    Write-Host '  - Or add an entry to .hallucination-allowlist (category:pattern)' -ForegroundColor Yellow
    exit 1
}

exit 0
