@echo off
rem ---------------------------------------------------------------------------
rem  Shared by the start_*.bat launchers: finds Python, creates the virtual
rem  environment on first run and re-installs dependencies when requirements.txt
rem  changed.  On success the variable VENV_PY points at the venv's python.exe.
rem ---------------------------------------------------------------------------
set "VENV_PY="

set "PY="
where py >nul 2>&1 && set "PY=py -3"
if not defined PY (
    where python >nul 2>&1 && set "PY=python"
)
if not defined PY (
    echo.
    echo  ERROR: Python was not found. Install Python 3.10 or newer from https://www.python.org/
    echo         ^(tick "Add python.exe to PATH" in the installer^).
    exit /b 1
)

if not exist "venv\Scripts\python.exe" (
    echo  First run: creating the virtual environment...
    %PY% -m venv venv
    if errorlevel 1 (
        echo  ERROR: could not create the virtual environment.
        exit /b 1
    )
)

rem Re-install only when requirements.txt differs from the copy used last time.
if not exist "venv\requirements.stamp" goto :install
fc /b requirements.txt "venv\requirements.stamp" >nul 2>&1
if errorlevel 1 goto :install
goto :ready

:install
echo  Installing dependencies ^(first run or requirements changed^)...
"venv\Scripts\python.exe" -m pip install --disable-pip-version-check -q -r requirements.txt
if errorlevel 1 (
    echo  ERROR: dependency installation failed. Check your internet connection and try again.
    exit /b 1
)
copy /y requirements.txt "venv\requirements.stamp" >nul

:ready
if not exist ".env" if exist ".env.example" copy ".env.example" ".env" >nul
set "VENV_PY=venv\Scripts\python.exe"
exit /b 0
