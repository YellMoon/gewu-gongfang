@echo off
chcp 65001 >nul
cd /d "%~dp0"
setlocal enabledelayedexpansion

for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value 2^>nul') do set DT=%%I
if "!DT!"=="" set DT=%date:~0,4%%date:~5,2%%date:~8,2%
set TODAY=%date:~0,4%-%date:~5,2%-%date:~8,2%
set COMMIT_MSG=自动发布 %TODAY%

echo [1/5] Git 提交: "!COMMIT_MSG!"
git add -A
git commit -m "!COMMIT_MSG!" >nul 2>&1
if !ERRORLEVEL! EQU 0 (echo [OK] 提交成功) else (echo [--] 无新变更)

echo.
echo [2/5] Git Push...
git push origin 2>&1 | findstr /v "Everything up-to-date" | findstr /v "up to date"
echo [OK] origin 推送完成
git push gewu 2>&1 | findstr /v "Everything up-to-date" | findstr /v "up to date"
echo [OK] gewu 推送完成

echo.
echo [3/5] 安装依赖...
call npm install --legacy-peer-deps 2>&1 | findstr /v "deprecated"
if !ERRORLEVEL! EQU 0 (echo [OK]) else (echo [警告] 可能有兼容性问题)

echo.
echo [4/5] 打包安装包 (npm run dist:win)...
call npm run dist:win
if !ERRORLEVEL! EQU 0 (echo [OK] 打包完成) else (echo [错误] 打包失败 & exit /b 1)

echo.
echo [5/5] 上传夸克网盘...
node scripts/upload-quark.js
if !ERRORLEVEL! EQU 0 (echo [OK] 夸克上传完成) else (echo [警告] 夸克上传可能失败)

echo.
echo ===== 全部完成 !TODAY! =====
