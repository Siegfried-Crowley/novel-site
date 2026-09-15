@echo off
chcp 65001 >nul
title 公益书坊 - 小说站
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js，请先到 https://nodejs.org/ 安装
  pause
  exit /b 1
)

if not exist node_modules (
  echo 首次运行，正在安装依赖，请稍候...
  call npm install
)

echo 正在启动小说站，浏览器打开 http://localhost:3000
call npm start

echo.
echo 服务已停止。
pause
