# Convert the local MongoDB service to a single-node replica set.
#
# Why this is needed: Prisma's MongoDB connector wraps writes in transactions to
# emulate referential integrity, and MongoDB only supports transactions on a
# replica set. A standalone mongod fails every write with P2031 — which is why
# GET /api/health reports "connected" while POST /api/auth/register returns 500.
#
# A single-node replica set is still one mongod on one port with your existing
# data. Nothing is deleted and no data is moved.
#
# RUN THIS IN AN **ADMINISTRATOR** POWERSHELL:
#   Right-click Windows Terminal / PowerShell -> "Run as administrator", then:
#   cd "C:\Users\vijay\OneDrive\Desktop\project\HackInMotion-RICR-HIM-1104"
#   powershell -ExecutionPolicy Bypass -File .\setup-mongo-replicaset.ps1
#
# To undo: restore mongod.cfg from the .bak-before-replset file this creates,
# then restart the MongoDB service.

$ErrorActionPreference = 'Stop'

$cfg = 'C:\Program Files\MongoDB\Server\8.2\bin\mongod.cfg'
$bak = "$cfg.bak-before-replset"

# ── Verify we are elevated, or nothing below will work ──
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host 'This script must run as Administrator.' -ForegroundColor Red
    Write-Host 'Close this window, reopen PowerShell with "Run as administrator", and try again.'
    exit 1
}

Write-Host "`n[1/5] Backing up mongod.cfg" -ForegroundColor Cyan
if (-not (Test-Path $bak)) {
    Copy-Item $cfg $bak
    Write-Host "      Saved to $bak"
} else {
    Write-Host "      Backup already exists, keeping it: $bak"
}

Write-Host "`n[2/5] Enabling replication in mongod.cfg" -ForegroundColor Cyan
$content = Get-Content $cfg -Raw

if ($content -match '(?m)^\s*replication:') {
    Write-Host '      replication: is already enabled, leaving the file alone.'
} else {
    # Replace the commented placeholder if present, otherwise append.
    if ($content -match '(?m)^#replication:') {
        $content = $content -replace '(?m)^#replication:', "replication:`r`n  replSetName: rs0"
    } else {
        $content = $content.TrimEnd() + "`r`n`r`nreplication:`r`n  replSetName: rs0`r`n"
    }
    # -Encoding ascii avoids a BOM, which older mongod builds refuse to parse.
    Set-Content -Path $cfg -Value $content -Encoding ascii
    Write-Host '      Added: replication.replSetName = rs0'
}

Write-Host "`n[3/5] Restarting the MongoDB service" -ForegroundColor Cyan
Restart-Service -Name MongoDB
# The service reports Running before mongod is actually accepting connections.
$deadline = (Get-Date).AddSeconds(45)
do {
    Start-Sleep -Milliseconds 800
    $up = Test-NetConnection -ComputerName 127.0.0.1 -Port 27017 -InformationLevel Quiet -WarningAction SilentlyContinue
} until ($up -or (Get-Date) -gt $deadline)

if (-not $up) {
    Write-Host '      MongoDB did not come back up. Check the log:' -ForegroundColor Red
    Write-Host '      C:\Program Files\MongoDB\Server\8.2\log\mongod.log'
    Write-Host "      To roll back: Copy-Item '$bak' '$cfg' -Force; Restart-Service MongoDB"
    exit 1
}
Write-Host '      MongoDB is accepting connections.'

Write-Host "`n[4/5] Initiating the replica set" -ForegroundColor Cyan
# Idempotent: rs.initiate() throws AlreadyInitialized (code 23) on a second run,
# which is a success case here, not a failure.
$js = @'
try {
  const status = rs.status();
  print("ALREADY_OK:" + status.set);
} catch (e) {
  if (e.code === 94 || /no replset config/i.test(e.message)) {
    rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "127.0.0.1:27017" }] });
    print("INITIATED");
  } else if (e.code === 23) {
    print("ALREADY_OK");
  } else {
    print("ERROR:" + e.message);
  }
}
'@
$jsFile = Join-Path $env:TEMP 'sf-rs-init.js'
Set-Content -Path $jsFile -Value $js -Encoding ascii
& mongosh --quiet --port 27017 --file $jsFile
Remove-Item $jsFile -ErrorAction SilentlyContinue

Write-Host "`n[5/5] Waiting for the node to become PRIMARY" -ForegroundColor Cyan
# Election on a single-node set takes a second or two. Writes fail until then.
$waitJs = @'
let ok = false;
for (let i = 0; i < 40; i++) {
  try { if (db.hello().isWritablePrimary) { ok = true; break; } } catch (e) {}
  sleep(500);
}
print(ok ? "PRIMARY" : "NOT_PRIMARY");
'@
$waitFile = Join-Path $env:TEMP 'sf-rs-wait.js'
Set-Content -Path $waitFile -Value $waitJs -Encoding ascii
$result = & mongosh --quiet --port 27017 --file $waitFile
Remove-Item $waitFile -ErrorAction SilentlyContinue

if ($result -match 'PRIMARY' -and $result -notmatch 'NOT_PRIMARY') {
    Write-Host '      Node is PRIMARY. Transactions are now available.' -ForegroundColor Green
    Write-Host "`nDone. Back in your normal terminal, run:" -ForegroundColor Green
    Write-Host '  npm run db:push'
    Write-Host '  npm run db:seed'
    Write-Host '  npm run dev:backend'
} else {
    Write-Host "      Node did not reach PRIMARY. Output: $result" -ForegroundColor Red
    Write-Host '      Check: mongosh --port 27017 --eval "rs.status()"'
    exit 1
}
