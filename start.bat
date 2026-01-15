@echo off
cd /d %~dp0

:: 檢查 port 3000 是否已被使用
netstat -ano | findstr ":3000" | findstr "LISTENING" >nul
if %errorlevel%==0 (
    echo 伺服器已在運行中
    start http://localhost:3000
) else (
    echo 正在啟動伺服器...
    start /b node server.js
    timeout /t 2 /nobreak >nul
    start http://localhost:3000
)
