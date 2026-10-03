@echo off
setlocal EnableExtensions
title Spotlight Studio (server)
cd /d "%~dp0"

echo.
echo  =====================================================
echo   Spotlight Studio - Server  ^(open http://127.0.0.1:8765/^)
echo  =====================================================
echo   Press Ctrl+C to stop.
echo.

call scripts\setup_env.bat
if errorlevel 1 ( pause & exit /b 1 )

"%VENV_PY%" main.py --server %*
if errorlevel 1 (
    echo.
    echo  The server stopped with an error. Details: data\downloader.log
    echo.
    pause
)
