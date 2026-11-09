@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js 24，再重新打开本文件。
  pause
  exit /b 1
)
if not exist .env.local (
  copy .env.example .env.local >nul
  echo 已创建 .env.local。请填写 DeepSeek 模型配置，保存后关闭记事本。
  start /wait notepad .env.local
)
if not exist node_modules (
  echo 正在安装依赖，首次运行需要联网……
  call npm.cmd ci
  if errorlevel 1 (
    echo 安装失败，请检查网络。错误信息在上方。
    pause
    exit /b 1
  )
)
echo 启动后请在浏览器打开 http://127.0.0.1:3020
call npm.cmd run dev -- --port 3020
pause
