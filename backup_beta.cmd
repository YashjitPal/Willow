@echo off
cd /d "%~dp0"
SETLOCAL EnableDelayedExpansion

echo ===================================================
echo              WILLOW CODE GITHUB BACKUP (BETA)     
echo ===================================================

:: Check if git is installed and directory is a repo
git rev-parse --is-inside-work-tree >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] This directory is not a Git repository.
    echo.
    pause
    exit /b 1
)

:: Set target branch to beta
set "BRANCH=beta"

:: Check for uncommitted changes (modified, deleted, or brand new files)
set HAS_UNCOMMITTED=
for /f "tokens=*" %%i in ('git status --porcelain') do (
    set HAS_UNCOMMITTED=1
)

:: Stage and commit if there are uncommitted changes
if defined HAS_UNCOMMITTED (
    set "COMMIT_MSG=%~1"
    if "!COMMIT_MSG!"=="" (
        set "COMMIT_MSG=Automatic backup on %date% at %time%"
    )
    echo.
    echo [1/4] Staging all changes...
    git add -A

    echo [2/4] Creating backup checkpoint...
    git commit -m "!COMMIT_MSG!"
) else (
    echo.
    echo [INFO] No uncommitted local file changes found.
)

:: Fetch and integrate remote changes before pushing
echo [3/4] Syncing with remote repository (%BRANCH%)...
git fetch origin %BRANCH% >nul 2>&1
git pull --rebase origin %BRANCH% >nul 2>&1
if %ERRORLEVEL% neq 0 (
    git rebase --abort >nul 2>&1
    git pull --no-edit origin %BRANCH% >nul 2>&1
)

:: Check if remote branch exists first
git rev-parse --verify origin/%BRANCH% >nul 2>&1
if %ERRORLEVEL% neq 0 (
    :: Remote branch doesn't exist, so local commits are unpushed
    set HAS_UNPUSHED=1
) else (
    :: Remote branch exists, check for unpushed commits comparing current state to remote branch
    set HAS_UNPUSHED=
    for /f "tokens=*" %%c in ('git log origin/%BRANCH%..HEAD 2^>nul') do (
        set HAS_UNPUSHED=1
    )
)

if not defined HAS_UNCOMMITTED (
    if not defined HAS_UNPUSHED (
        echo.
        echo ===================================================
        echo  SUCCESS: Everything is already up to date on GitHub.
        echo ===================================================
        echo.
        pause
        ENDLOCAL
        exit /b 0
    )
)

echo [4/4] Uploading safely to GitHub (%BRANCH%)...
git push origin HEAD:%BRANCH%

echo.
if %ERRORLEVEL% equ 0 (
    echo ===================================================
    echo  SUCCESS: Your changes are safely backed up.
    echo ===================================================
) else (
    echo ===================================================
    echo [ERROR] Failed to push changes to GitHub.
    echo Please check your internet connection or git permissions.
    echo ===================================================
)

echo.
pause
ENDLOCAL
