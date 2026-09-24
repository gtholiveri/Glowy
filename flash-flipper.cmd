@echo off
rem Builds the local Flipper app and installs + launches it on a Flipper plugged in over USB.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scriptslash-flipper.ps1" %*
pause
