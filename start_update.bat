@echo off
rem ---------------------------------------------------------------------------
rem  Headless "check for new wallpapers": downloads what is new, then exits.
rem  Point Windows Task Scheduler at this file for an automatic daily update
rem  (see docs/DEPLOYMENT.md).  Extra arguments are passed through, e.g.
rem      start_update.bat --mode full
rem      start_update.bat --source peapix
rem ---------------------------------------------------------------------------
setlocal EnableExtensions
cd /d "%~dp0"

call scripts\setup_env.bat
if errorlevel 1 exit /b 1

"%VENV_PY%" main.py --crawl --mode quick %*
exit /b %errorlevel%
