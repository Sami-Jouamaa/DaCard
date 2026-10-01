@echo off
setlocal
title DaCard Dashboard
set "DASHBOARD=%~dp0dashboard"
set "NODE=%DASHBOARD%\node\node.exe"
if not exist "%NODE%" (
    where node >nul 2>nul
    if errorlevel 1 (
        echo DaCard Dashboard needs Node.js, and dashboard\node\node.exe is missing.
        echo Reinstall DaCard, or install Node.js 22.13 or newer from https://nodejs.org
        pause
        exit /b 1
    )
    set "NODE=node"
)
cd /d "%DASHBOARD%"
"%NODE%" --disable-warning=ExperimentalWarning "%DASHBOARD%\server\main.mjs" --open
if errorlevel 1 pause
