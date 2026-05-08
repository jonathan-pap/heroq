<#
.SYNOPSIS
  One-shot Node.js upgrade: installs nvm-windows (if missing), installs
  Node 22 LTS as the new default, keeps Node 18 around as a fallback.

.DESCRIPTION
  Idempotent — safe to re-run. Each phase checks whether it's already
  done before acting. Stops with clear instructions if the shell needs
  to be restarted (which happens once, right after nvm-windows is
  installed via winget, because PATH only picks it up in a new shell).

  Run from any PowerShell window:

      .\upgrade-node.ps1
      .\upgrade-node.ps1 -SkipPrompt    # don't pause between phases

  Re-run after a shell restart and it will pick up where it left off.
#>

[CmdletBinding()]
param(
  [switch]$SkipPrompt
)

$ErrorActionPreference = 'Stop'
$Node22 = '22.11.0'   # latest LTS at time of writing — bump if newer
$Node18 = '18.20.5'   # last 18.x for fallback

function Step($n, $msg) { Write-Host "`n[$n] $msg" -ForegroundColor Cyan }
function Ok($msg)       { Write-Host "    ✓ $msg" -ForegroundColor Green }
function Warn($msg)     { Write-Host "    ! $msg" -ForegroundColor Yellow }
function Fail($msg)     { Write-Host "    ✗ $msg" -ForegroundColor Red }

function Pause-Maybe($msg) {
  if ($SkipPrompt) { return }
  $a = Read-Host "`n$msg [Y/n]"
  if ($a -and $a.ToLower().StartsWith('n')) { Write-Host "Cancelled." ; exit 0 }
}

function Has-Cmd($name) {
  return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

# ---------------------------------------------------------------
# Phase 1 — make sure nvm-windows is installed
# ---------------------------------------------------------------
Step 1 "Checking for nvm-windows…"
if (Has-Cmd 'nvm') {
  Ok "nvm is on PATH ($(nvm version 2>$null | Select-Object -First 1))"
}
else {
  Warn "nvm not found. Installing via winget…"
  if (-not (Has-Cmd 'winget')) {
    Fail "winget is also missing. Install from https://aka.ms/getwinget then re-run."
    exit 1
  }
  Pause-Maybe "Run: winget install --id CoreyButler.NVMforWindows"
  winget install --id CoreyButler.NVMforWindows --silent --accept-source-agreements --accept-package-agreements
  Write-Host ""
  Warn "nvm-windows installed, but PATH won't refresh in this shell."
  Warn "→ CLOSE this PowerShell window, open a NEW one, and re-run this script."
  exit 0
}

# ---------------------------------------------------------------
# Phase 2 — install Node 22 + Node 18, set 22 as default
# ---------------------------------------------------------------
Step 2 "Installing Node $Node22 (LTS) and Node $Node18 (fallback)…"

$installed = (& nvm list) -join "`n"
if ($installed -match [regex]::Escape($Node22)) { Ok "Node $Node22 already installed" }
else {
  Pause-Maybe "Run: nvm install $Node22"
  & nvm install $Node22
}
if ($installed -match [regex]::Escape($Node18)) { Ok "Node $Node18 already installed" }
else {
  Pause-Maybe "Run: nvm install $Node18"
  & nvm install $Node18
}

Step 3 "Switching default to Node $Node22…"
& nvm use $Node22 | Out-Null
$cur = & node --version 2>$null
if ($cur -match [regex]::Escape($Node22)) { Ok "node --version: $cur" }
else { Warn "node --version reports $cur — did 'nvm use' need elevation? Try right-clicking the script → Run as Administrator." }

# ---------------------------------------------------------------
# Phase 4 — bump npm to latest (bundled npm 10 → 11.x)
# ---------------------------------------------------------------
Step 4 "Updating global npm to the latest release…"
Pause-Maybe "Run: npm install -g npm@latest"
& npm install -g npm@latest
$npmV = & npm --version
Ok "npm --version: $npmV"

# ---------------------------------------------------------------
# Phase 5 — summary + next steps
# ---------------------------------------------------------------
Step 5 "Done. Quick verification…"
Write-Host "    node : $(& node --version)"
Write-Host "    npm  : $(& npm --version)"
Write-Host "    nvm  : $((& nvm version | Select-Object -First 1))"

Write-Host ""
Ok "You're on Node $Node22 globally. Node $Node18 is available via 'nvm use $Node18'."
Write-Host ""
Write-Host "Per-project pinning:" -ForegroundColor Cyan
Write-Host "  Drop a one-line file named   .nvmrc   in any project that"
Write-Host "  must stay on a specific Node version. Example contents: 18"
Write-Host "  Then in that project's shell: nvm use   (reads .nvmrc)."
Write-Host ""
Write-Host "Next:" -ForegroundColor Cyan
Write-Host "  Run    .\audit-projects.ps1 -Root E:\    to test-install all"
Write-Host "  your projects under Node 22 and surface anything that breaks."
Write-Host ""
