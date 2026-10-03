@echo off
setlocal EnableExtensions
title Spotlight Studio
cd /d "%~dp0"

echo.
echo  =====================================================
echo   Spotlight Studio - Desktop
echo  =====================================================
echo.

call scripts\setup_env.bat
if errorlevel 1 ( pause & exit /b 1 )

"%VENV_PY%" main.py %*
if errorlevel 1 (
    echo.
    echo  The application stopped with an error. Details: data\downloader.log
    echo.
    pause
)
