@echo off
cd /d "%~dp0"
node --import tsx scripts/local/run.mjs %*
if errorlevel 1 pause
