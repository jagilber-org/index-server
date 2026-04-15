# build-vsix.ps1 -- Build and optionally publish the Index Server VS Code extension
# Usage: pwsh release/vscode-extension/build-vsix.ps1 [-Publish marketplace|openvsx|both]
#
# Prerequisites:
#   - Node.js >= 20
#   - npm
#   - For publishing: VSCE_PAT and/or OVSX_PAT environment variables
#
# Outputs:
#   release/vscode-extension/index-server-<version>.vsix

param(
    [switch]$IncludeServer,
    [string]$ServerRoot,
    [ValidateSet('none', 'marketplace', 'openvsx', 'both')]
    [string]$Publish = 'none'
)

$ErrorActionPreference = 'Stop'
$extDir = $PSScriptRoot
$repoRoot = Resolve-Path (Join-Path $extDir '../..')

Push-Location $extDir
try {
    Write-Host "=== Index Server VSIX Build ===" -ForegroundColor Cyan

    # 0. Sync extension version with server version
    $serverPkg = Get-Content (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json
    $extPkg = Get-Content (Join-Path $extDir 'package.json') -Raw | ConvertFrom-Json
    if ($extPkg.version -ne $serverPkg.version) {
        Write-Host "[0/4] Syncing extension version $($extPkg.version) -> $($serverPkg.version)" -ForegroundColor Yellow
        $extPkgRaw = Get-Content (Join-Path $extDir 'package.json') -Raw
        $extPkgRaw = $extPkgRaw -replace ('"version":\s*"' + [regex]::Escape($extPkg.version) + '"'), ('"version": "' + $serverPkg.version + '"')
        Set-Content (Join-Path $extDir 'package.json') -Value $extPkgRaw -NoNewline
    }

    # 1. Install extension dev dependencies
    Write-Host "`n[1/4] Installing extension dependencies..." -ForegroundColor Yellow
    npm install --ignore-scripts 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "npm install failed" }

    # 2. Compile TypeScript
    Write-Host "[2/4] Compiling extension TypeScript..." -ForegroundColor Yellow
    npx tsc -p tsconfig.json
    if ($LASTEXITCODE -ne 0) { throw "TypeScript compilation failed" }

    # 3. Optionally bundle the server
    if ($IncludeServer) {
        Write-Host "[3/4] Bundling MCP server into extension..." -ForegroundColor Yellow
        $src = if ($ServerRoot) { $ServerRoot } else { $repoRoot.Path }
        $dest = Join-Path $extDir 'server'

        if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
        New-Item -ItemType Directory -Path $dest -Force | Out-Null

        # Copy built server
        if (Test-Path (Join-Path $src 'dist')) {
            Copy-Item -Recurse (Join-Path $src 'dist') (Join-Path $dest 'dist')
        } else {
            Write-Warning "Server dist/ not found at $src. Run 'npm run build' in the repo root first."
        }

        # Copy instructions
        if (Test-Path (Join-Path $src 'instructions')) {
            Copy-Item -Recurse (Join-Path $src 'instructions') (Join-Path $dest 'instructions')
        }

        # Copy node_modules (production only)
        if (Test-Path (Join-Path $src 'node_modules')) {
            Write-Host "  Copying production node_modules..." -ForegroundColor Gray
            $prodModules = Join-Path $dest 'node_modules'
            New-Item -ItemType Directory -Path $prodModules -Force | Out-Null
            # Copy only production dependencies
            $pkgJson = Get-Content (Join-Path $src 'package.json') | ConvertFrom-Json
            foreach ($dep in $pkgJson.dependencies.PSObject.Properties.Name) {
                $depPath = Join-Path $src "node_modules/$dep"
                if (Test-Path $depPath) {
                    Copy-Item -Recurse $depPath (Join-Path $prodModules $dep)
                }
            }
        }

        # Copy package.json for the server
        Copy-Item (Join-Path $src 'package.json') (Join-Path $dest 'package.json')

        # Copy distributable user scripts
        $scriptsSrc = Join-Path $src 'scripts' 'dist'
        if (Test-Path $scriptsSrc) {
            $scriptsDest = Join-Path $dest 'scripts'
            New-Item -ItemType Directory -Path $scriptsDest -Force | Out-Null
            Copy-Item (Join-Path $scriptsSrc '*') $scriptsDest -Recurse
            Write-Host "  User scripts bundled ($((Get-ChildItem $scriptsDest -File).Count) files)" -ForegroundColor Gray
        }

        Write-Host "  Server bundled successfully" -ForegroundColor Green
    } else {
        Write-Host "[3/4] Skipping server bundle (use -IncludeServer to embed)" -ForegroundColor Gray
    }

    # 4. Verify icon exists (committed PNG, no longer a placeholder)
    $pngIcon = Join-Path $extDir 'images/icon.png'
    if (-not (Test-Path $pngIcon)) {
        throw "images/icon.png not found. The icon PNG should be committed to source control."
    }

    # 5. Package VSIX
    Write-Host "[4/4] Packaging VSIX..." -ForegroundColor Yellow
    npx @vscode/vsce package --no-dependencies --allow-missing-repository 2>&1
    if ($LASTEXITCODE -ne 0) { throw "VSIX packaging failed" }

    $vsixFile = Get-ChildItem -Path $extDir -Filter '*.vsix' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($vsixFile) {
        # Move to release root for easy access
        $releaseDir = Split-Path $extDir
        $destVsix = Join-Path $releaseDir $vsixFile.Name
        Copy-Item $vsixFile.FullName $destVsix -Force
        Write-Host "`n=== BUILD SUCCESS ===" -ForegroundColor Green
        Write-Host "VSIX package: $destVsix" -ForegroundColor Green
        Write-Host "Size: $([math]::Round($vsixFile.Length / 1KB, 1)) KB" -ForegroundColor Gray

        # Publish to marketplaces if requested
        if ($Publish -in 'marketplace', 'both') {
            Write-Host "`n[Publish] Publishing to VS Code Marketplace..." -ForegroundColor Yellow
            if (-not $env:VSCE_PAT) { throw "VSCE_PAT environment variable required for marketplace publishing" }
            npx @vscode/vsce publish --no-dependencies --packagePath $vsixFile.FullName --pat $env:VSCE_PAT 2>&1
            if ($LASTEXITCODE -ne 0) { throw "Marketplace publish failed" }
            Write-Host "Published to VS Code Marketplace" -ForegroundColor Green
        }
        if ($Publish -in 'openvsx', 'both') {
            Write-Host "`n[Publish] Publishing to Open VSX..." -ForegroundColor Yellow
            if (-not $env:OVSX_PAT) { throw "OVSX_PAT environment variable required for Open VSX publishing" }
            npx ovsx publish --no-dependencies --packagePath $vsixFile.FullName --pat $env:OVSX_PAT 2>&1
            if ($LASTEXITCODE -ne 0) { throw "Open VSX publish failed" }
            Write-Host "Published to Open VSX" -ForegroundColor Green
        }
    } else {
        throw "No VSIX file found after packaging"
    }
} finally {
    Pop-Location
}
