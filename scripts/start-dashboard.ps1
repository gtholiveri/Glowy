# Starts the GlowyMacgOrb bridge in its own window and opens the dashboard.
# Any bridge that's already running is stopped first, so you always get the latest code.
#
#   -Fake       no Flipper: type in the bridge window to place/remove the orb
#   -Port 8765  port to serve the dashboard on
#   -NoBrowser  start the bridge but don't open the dashboard
param(
    [switch]$Fake,
    [int]$Port = 8765,
    [switch]$NoBrowser
)

$ProgressPreference = 'SilentlyContinue'
$root = Split-Path -Parent $PSScriptRoot
$bridge = Join-Path $root 'dashboard\bridge.py'
$url = "http://localhost:$Port/"

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Host "Python isn't on PATH. Install Python 3, then run this again." -ForegroundColor Red
    exit 1
}

# --- stop bridges that are already running ---
# Ours (started with the full path) or anything running bridge.py that's holding our port.
$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
$old = Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -match 'bridge\.py' -and (
        $_.CommandLine -match 'GlowyMacgOrb' -or
        ($listener -and $_.ProcessId -eq $listener.OwningProcess))
}
foreach ($p in $old) {
    Write-Host "Stopping the bridge that was already running (PID $($p.ProcessId))"
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}

# --- make sure the port is free ---
$busy = $null
for ($i = 0; $i -lt 16; $i++) {
    $busy = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $busy) { break }
    Start-Sleep -Milliseconds 250
}
if ($busy) {
    $owner = Get-Process -Id $busy.OwningProcess -ErrorAction SilentlyContinue
    Write-Host "Port $Port is taken by $($owner.ProcessName) (PID $($busy.OwningProcess)), which isn't the bridge." -ForegroundColor Red
    Write-Host "Close that program, or pick another port:  start-dashboard.cmd -Port 8766"
    exit 1
}

# --- start the bridge in its own window (its output, and the fake-orb keys, live there) ---
if ($Fake) {
    $title = 'GlowyMacgOrb bridge - FAKE ORB, type here'
    $flags = ' --fake'
} else {
    $title = 'GlowyMacgOrb bridge'
    $flags = ''
}
Start-Process cmd -WorkingDirectory (Split-Path $bridge) -ArgumentList "/k title $title & python `"$bridge`" $Port$flags"

# --- wait until it answers, then open the dashboard ---
# (Poll 127.0.0.1: "localhost" can stall on IPv6 for ~2 s per try on Windows.)
$ready = $false
for ($i = 0; $i -lt 60; $i++) {
    try {
        Invoke-WebRequest "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 1 | Out-Null
        $ready = $true
        break
    } catch {
        Start-Sleep -Milliseconds 250
    }
}
if (-not $ready) {
    Write-Host "The bridge didn't start. Check its window for the error." -ForegroundColor Red
    exit 1
}

if (-not $NoBrowser) { Start-Process $url }
Write-Host "Dashboard: $url  (click the page once so it can play sound)" -ForegroundColor Green
if ($Fake) {
    Write-Host "Fake orb: click the bridge window, then Space/Enter = toggle, p = place, r = remove, q = quit"
}
exit 0
