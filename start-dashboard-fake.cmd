@echo off
rem Same as start-dashboard.cmd, but with no Flipper: type in the bridge window to place/remove the orb.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-dashboard.ps1" -Fake %*
if errorlevel 1 pause
