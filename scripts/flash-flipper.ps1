# Builds the Flipper app from the code in this folder and installs + launches it on a
# Flipper plugged in over USB.

$root = Split-Path -Parent $PSScriptRoot
$app = Join-Path $root 'flipper\glowymacgorb'

# --- is a Flipper plugged in? (Flipper Zero's USB id is 0483:5740) ---
$flipper = Get-CimInstance Win32_PnPEntity |
    Where-Object { $_.DeviceID -like '*VID_0483&PID_5740*' -and $_.Name -match '\(COM\d+\)' } |
    Select-Object -First 1
if (-not $flipper) {
    Write-Host 'No Flipper found on USB. Plug it in with its screen on, then run this again.' -ForegroundColor Red
    exit 1
}
Write-Host "Flipper found: $($flipper.Name)"

# --- qFlipper holds the Flipper's USB port while it's open ---
$qflipper = Get-Process -Name 'qFlipper*' -ErrorAction SilentlyContinue
if ($qflipper) {
    $answer = Read-Host "qFlipper is open and blocks the Flipper's USB port. Close it now? (y/n)"
    if ($answer -notmatch '^[yY]') {
        Write-Host 'OK. Close qFlipper yourself, then run this again.'
        exit 1
    }
    $qflipper | Stop-Process -Force
    Start-Sleep -Seconds 1
}

# --- make sure the build tool and SDK are there ---
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Host "Python isn't on PATH. Install Python 3, then run this again." -ForegroundColor Red
    exit 1
}
python -c 'import ufbt' 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Installing ufbt (the Flipper build tool)...'
    python -m pip install --quiet ufbt
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Couldn't install ufbt." -ForegroundColor Red
        exit 1
    }
}
if (-not (Test-Path (Join-Path $env:USERPROFILE '.ufbt\current'))) {
    Write-Host 'Downloading the Flipper SDK (first run only)...'
    python -m ufbt update
}

# --- build from the local code, install, and launch ---
Write-Host 'Building and installing GlowyMacgOrb...'
Push-Location $app
try {
    python -m ufbt launch
    $code = $LASTEXITCODE
} finally {
    Pop-Location
}
if ($code -ne 0) {
    Write-Host "Flashing failed (exit code $code). Is the Flipper unlocked and on its main screen?" -ForegroundColor Red
    exit $code
}
Write-Host 'Done: GlowyMacgOrb is running on the Flipper.' -ForegroundColor Green
exit 0
