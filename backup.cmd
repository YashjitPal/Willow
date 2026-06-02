@echo off
SETLOCAL EnableDelayedExpansion

echo ===================================================
echo              WILLOW CODE GITHUB BACKUP             
echo ===================================================

:: Check if git is installed and directory is a repo
git rev-parse --is-inside-work-tree >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] This directory is not a Git repository!
    pause
    exit /b 1
)

:: Check if there are any changes (modified, deleted, or brand new files)
set HAS_CHANGES=
for /f "tokens=*" %%i in ('git status --porcelain') do (
    set HAS_CHANGES=1
)

if "%HAS_CHANGES%"=="" (
    echo [INFO] No changes found. Everything is already up to date on your local!
    exit /b 0
)

:: Get the commit message
set "COMMIT_MSG=%~1"
if "%COMMIT_MSG%"=="" (
    :: Auto-generate a beautiful timestamp message if the user didn't specify one
    set "COMMIT_MSG=Automatic backup on %date% at %time%"
)

echo.
echo [1/3] Staging all changes (new, modified, and deleted files)...
git add .

echo [2/3] Creating a secure backup checkpoint...
git commit -m "%COMMIT_MSG%"

echo [3/3] Uploading safely to GitHub...
git push origin main

echo.
if %ERRORLEVEL% equ 0 (
    echo ===================================================
    echo  SUCCESS! Your changes are safely backed up! 🚀🎉
    echo ===================================================
) else (
    echo [ERROR] Failed to push changes to GitHub.
    echo Please make sure you are connected to the internet.
)

ENDLOCAL
