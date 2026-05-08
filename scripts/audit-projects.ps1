<#
.SYNOPSIS
  Scan a folder tree for Node projects and try installing each under
  the current Node version. Prints PASS / FAIL / WARN per project.

.PARAMETER Root
  Folder to scan. Defaults to E:\.

.PARAMETER Depth
  Maximum directory depth. Default 3.

.PARAMETER WithTests
  Also run 'npm test' if a test script exists. Off by default.

.PARAMETER FixRebuild
  If 'npm install' fails, retry with 'npm rebuild'.
#>

[CmdletBinding()]
param(
  [string]$Root = 'E:\',
  [int]$Depth = 3,
  [switch]$WithTests,
  [switch]$FixRebuild
)

$ErrorActionPreference = 'Continue'

function Header($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Pass($msg)   { Write-Host "  PASS  $msg" -ForegroundColor Green }
function Fail($msg)   { Write-Host "  FAIL  $msg" -ForegroundColor Red }
function Warn($msg)   { Write-Host "  WARN  $msg" -ForegroundColor Yellow }
function Info($msg)   { Write-Host "        $msg" -ForegroundColor DarkGray }

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "node is not on PATH. Run upgrade-node.ps1 first." -ForegroundColor Red
  exit 1
}
$nodeV = & node --version
$npmV  = & npm --version
Header "Auditing under Node $nodeV / npm $npmV"
Header "Scanning $Root (max depth $Depth) for package.json files..."

$projects = @()
$skipPatterns = @(
  '\\node_modules\\',
  '\\\.git\\',
  '\\\.vscode\\extensions\\',     # editor-managed extensions, not user projects
  '\\AppData\\Roaming\\npm\\',    # global-install cache
  '\\AppData\\Local\\nvm\\',      # nvm install staging
  '\\OneDriveTemp\\',
  '\\Microsoft Teams Chat Files\\',
  '\\Microsoft Copilot Chat Files\\'
)
Get-ChildItem -LiteralPath $Root -Recurse -Depth $Depth -Filter package.json -File -ErrorAction SilentlyContinue |
  Where-Object {
    $full = $_.FullName
    $skip = $false
    foreach ($p in $skipPatterns) { if ($full -match $p) { $skip = $true; break } }
    -not $skip
  } |
  ForEach-Object { $projects += $_ }

if ($projects.Count -eq 0) {
  Warn "No package.json files found. Try a different -Root or -Depth."
  exit 0
}
Info "Found $($projects.Count) project(s)."

# Default-npm-init test script literal (compared against the placeholder
# npm puts in a fresh package.json so we don't run those).
$placeholderTest = 'echo "Error: no test specified" ' + [char]0x26 + [char]0x26 + ' exit 1'

$results = @()
foreach ($pkg in $projects) {
  $dir  = $pkg.Directory.FullName
  $name = $pkg.Directory.Name
  Header "$name  ($dir)"

  Push-Location $dir
  try {
    $j = $null
    try { $j = Get-Content $pkg.FullName -Raw | ConvertFrom-Json } catch { Warn "package.json is not valid JSON: $($_.Exception.Message)" }
    if ($j -and $j.engines -and $j.engines.node) { Info "engines.node = $($j.engines.node)" }
    if ($j -and $j.scripts) {
      $names = @()
      foreach ($p in $j.scripts.PSObject.Properties) { $names += $p.Name }
      if ($names.Count -gt 0) { Info ("scripts: " + ($names -join ', ')) }
    }

    Info "-> npm install (this may take a moment)..."
    $out = & npm install --no-audit --no-fund --silent 2>&1
    $code = $LASTEXITCODE
    if ($code -ne 0) {
      if ($FixRebuild) {
        Warn "npm install failed (code $code). Trying npm rebuild..."
        $out2 = & npm rebuild 2>&1
        if ($LASTEXITCODE -eq 0) {
          Pass "npm rebuild fixed it."
          $results += [pscustomobject]@{ Name=$name; Path=$dir; Status='PASS (rebuild)' }
          continue
        } else {
          Fail "npm install AND rebuild failed."
        }
      } else {
        Fail "npm install failed (code $code)."
      }
      $tail = ($out -join "`n").Split("`n") | Select-Object -Last 5
      foreach ($line in $tail) { Info $line }
      $results += [pscustomobject]@{ Name=$name; Path=$dir; Status='FAIL' }
      continue
    }
    Pass "npm install OK"

    if ($WithTests -and $j -and $j.scripts -and $j.scripts.test) {
      $isPlaceholder = ($j.scripts.test -eq $placeholderTest)
      if (-not $isPlaceholder) {
        Info "-> npm test..."
        $tout = & npm test --silent 2>&1
        if ($LASTEXITCODE -eq 0) {
          Pass "tests OK"
        } else {
          Warn "tests failed -- but install worked. Investigate manually."
        }
      }
    }

    $results += [pscustomobject]@{ Name=$name; Path=$dir; Status='PASS' }
  }
  catch {
    Fail "Exception: $($_.Exception.Message)"
    $results += [pscustomobject]@{ Name=$name; Path=$dir; Status='ERROR' }
  }
  finally {
    Pop-Location
  }
}

Header "Summary"
$results | Sort-Object Status, Name | Format-Table -AutoSize

$fails = $results | Where-Object { $_.Status -like 'FAIL*' -or $_.Status -eq 'ERROR' }
if ($fails) {
  Write-Host "`nProjects to investigate:" -ForegroundColor Yellow
  foreach ($f in $fails) { Write-Host "  - $($f.Path)" }
  Write-Host "`nFor any project that needs to stay on Node 18, run from its folder:" -ForegroundColor Cyan
  Write-Host '  Set-Content -LiteralPath .\.nvmrc -Value "18"'
  Write-Host "Then run 'nvm use' in that project to switch automatically."
} else {
  Write-Host "`nAll projects passed. Safe to use Node $nodeV as your default." -ForegroundColor Green
}
