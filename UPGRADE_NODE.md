# Upgrading from Node 18 to Node 22 LTS

Node 18 is end-of-life. This is a 5-minute guided upgrade that won't break
your other Node-18 projects — we install nvm-windows so you can switch
versions per shell, then audit each project to surface anything that does
need attention.

## What you get

- **Node 22 LTS** as your global default (supported until April 2027)
- **Node 18** still installed and one command away (`nvm use 18`)
- **npm 11** (the latest)
- A scan of every Node project on your machine showing which install
  cleanly under Node 22 and which need a `.nvmrc` pin

## Run it

Open PowerShell in `E:\Hero_quest\scripts` and run:

```powershell
.\upgrade-node.ps1
```

The script is **idempotent** — safe to re-run. It will:

1. Install **nvm-windows** if missing (via `winget`). If it had to install
   it, the script stops and asks you to **close + reopen** PowerShell so
   `PATH` picks up `nvm`. Re-run the script in the new shell.
2. Install Node 22.11.0 (LTS) and Node 18.20.5 (fallback)
3. Switch the global default to Node 22
4. Update `npm` to the latest release
5. Print versions for sanity-check

If anything in step 1 needs admin rights, right-click the .ps1 →
**Run with PowerShell** as Administrator.

If your execution policy blocks scripts:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

## Audit your other projects

Once Node 22 is the default, scan every project on your drive:

```powershell
.\audit-projects.ps1 -Root E:\
```

This visits every `package.json` (excluding `node_modules` / `.git`) up
to 3 directories deep and runs `npm install` against Node 22. Each
project gets a **PASS** / **FAIL** verdict with the last few lines of
the npm error if it failed.

Useful flags:

- `-Root C:\Users\jonathan\code` — different scan root
- `-Depth 5` — search deeper subfolders (default 3)
- `-WithTests` — also run `npm test` for projects that have one
- `-FixRebuild` — automatically retry with `npm rebuild` when install
  fails (helps native-binding packages like `sqlite3`, `sharp`, etc.)

## If a project fails

Most failures are one of:

| Symptom | Fix |
|---|---|
| `Cannot find module 'punycode'` and similar | The package depends on a removed Node built-in. Update the package, or pin the project to Node 18. |
| `node-gyp` errors / native binding compile fails | `npm rebuild` (or run audit with `-FixRebuild`) |
| `EBADENGINE` warning | Just a warning — install actually succeeded. Bump the package's `"engines"` to `>=20` in your `package.json` if you control it. |
| Project really won't run on 22 | Pin it to 18 (see below) |

### Pin a single project to Node 18

In the offending project's root, drop a one-line file `.nvmrc`:

```
18
```

Then any time you `cd` into that project and run `nvm use`, it switches
to Node 18 for that shell. Your global default stays at 22.

You can do this from PowerShell:

```powershell
Set-Content -LiteralPath .\.nvmrc -Value "18"
```

## Manual fallback (if winget isn't available)

1. Download nvm-windows from https://github.com/coreybutler/nvm-windows/releases
2. Run the installer
3. Open a new PowerShell, then:
   ```powershell
   nvm install 22.11.0
   nvm install 18.20.5
   nvm use 22.11.0
   npm install -g npm@latest
   ```
4. Run `.\audit-projects.ps1 -Root E:\` as above.

## Rolling back (if something goes very wrong)

```powershell
nvm use 18.20.5     # back to old Node for this shell
nvm uninstall 22.11.0  # remove Node 22 entirely (only if you really want to)
```

You can have both versions installed indefinitely — there's no harm in it.

## After the upgrade is stable

Once everything passes the audit, you can update `package.json`'s
`engines` field in projects you control:

```json
"engines": {
  "node": ">=20"
}
```

This signals "this project is happy on modern Node" without forcing
anyone to a specific version.
