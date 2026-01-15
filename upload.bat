@echo off
chcp 65001 >nul
REM Roulettist Upload Script for Windows

REM ========== Settings ==========
SET SERVER_IP=tw5399.com
SET SERVER_USER=root
SET REMOTE_PATH=/opt/lampp/htdocs/Roulettist
REM ==============================

echo ==========================================
echo   Roulettist File Upload Tool
echo ==========================================
echo.
echo Target: %SERVER_USER%@%SERVER_IP%
echo Path: %REMOTE_PATH%
echo.

where scp >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [Error] scp command not found
    echo Please install OpenSSH or use FileZilla
    pause
    exit /b 1
)

echo Files to upload:
echo   - index.html
echo   - mobile.html
echo   - admin.html
echo   - login.html
echo   - server.js
echo   - database.js
echo   - script.js
echo   - package.json
echo   - members.json
echo   - deploy.sh
echo.

set /p CONFIRM=Continue? (Y/N):
if /I not "%CONFIRM%"=="Y" (
    echo Cancelled
    pause
    exit /b 0
)

echo.
echo [1/2] Creating remote directory...
ssh %SERVER_USER%@%SERVER_IP% "mkdir -p %REMOTE_PATH%"

echo [2/2] Uploading files...
scp index.html mobile.html admin.html login.html server.js database.js script.js package.json members.json deploy.sh %SERVER_USER%@%SERVER_IP%:%REMOTE_PATH%/

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ==========================================
    echo   Upload Complete!
    echo ==========================================
    echo.
    echo Next steps - SSH to server and run:
    echo   cd %REMOTE_PATH%
    echo   chmod +x deploy.sh
    echo   ./deploy.sh
    echo.
) else (
    echo.
    echo [Error] Upload failed
)

pause
