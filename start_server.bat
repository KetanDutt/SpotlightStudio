@echo off
setlocal enabledelayedexpansion
title Spotlight Studio (Headless Server)
echo.
echo  =====================================================
echo   Spotlight Studio — Headless API Server
echo  =====================================================
echo.

cd /d "%~dp0"

REM Check if Python is installed
python --version >nul 2>&1
if errorlevel 1 (
    echo  ERROR: Python is not installed or not in your system PATH.
    echo  Please install Python 3.10+ from https://www.python.org/
    echo.
    pause
    exit /b 1
)

REM Check if virtual environment exists
if not exist "venv\Scripts\activate.bat" (
    echo  Virtual environment not found. Setting up venv...
    python -m venv venv
    if errorlevel 1 (
        echo  ERROR: Failed to create virtual environment.
        pause
        exit /b 1
    )
    echo  Installing dependencies from requirements.txt...
    call "venv\Scripts\activate.bat"
    pip install --upgrade pip
    pip install -r requirements.txt
    if errorlevel 1 (
        echo  ERROR: Failed to install dependencies.
        pause
        exit /b 1
    )
    echo  Setup completed successfully!
    echo.
)

REM Activate venv and run main.py in headless server mode
call "venv\Scripts\activate.bat"
echo  Starting server at http://127.0.0.1:8765/
echo  Press Ctrl+C to stop.
echo.
python main.py --server
if errorlevel 1 (
    echo.
    echo  Server stopped with an error code. Check data\downloader.log for details.
    echo.
    pause
)
