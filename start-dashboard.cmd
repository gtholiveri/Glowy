@echo off
rem Starts the bridge (stopping any old one) and opens the dashboard.
rem Extra options pass through, e.g.  start-dashboard.cmd -Port 8766
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-dashboard.ps1" %*
if errorlevel 1 pause
