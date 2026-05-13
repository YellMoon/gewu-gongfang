@echo off
chcp 65001 >nul
cd /d "%~dp0"
setlocal enabledelayedexpansion

for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value 2^>nul') do set DT=%%I
if "!DT!"=="" set DT=%date:~0,4%%date:~5,2%%date:~8,2%
set TODAY=%date:~0,4%-%date:~5,2%-%date:~8,2%
set COMMIT_MSG=鑷姩鍙戝竷 %TODAY%

echo [1/5] Git 鎻愪氦: "!COMMIT_MSG!"
git add -A
git commit -m "!COMMIT_MSG!" >nul 2>&1
if !ERRORLEVEL! EQU 0 (echo [OK] 鎻愪氦鎴愬姛) else (echo [--] 鏃犳柊鍙樻洿)

echo.
echo [2/5] Git Push...
git push origin 2>&1 | findstr /v "Everything up-to-date" | findstr /v "up to date"
echo [OK] origin 鎺ㄩ€佸畬鎴?git push gewu 2>&1 | findstr /v "Everything up-to-date" | findstr /v "up to date"
echo [OK] gewu 鎺ㄩ€佸畬鎴?
echo.
echo [3/5] 瀹夎渚濊禆...
call npm install --legacy-peer-deps 2>&1 | findstr /v "deprecated"
if !ERRORLEVEL! EQU 0 (echo [OK]) else (echo [璀﹀憡] 鍙兘鏈夊吋瀹规€ч棶棰?

echo.
echo [4/5] 鎵撳寘瀹夎鍖?(npm run dist:win)...
call npm run dist:win
if !ERRORLEVEL! EQU 0 (echo [OK] 鎵撳寘瀹屾垚) else (echo [閿欒] 鎵撳寘澶辫触 & exit /b 1)

echo.
echo [5/5] 涓婁紶澶稿厠缃戠洏...
node scripts/upload-quark-clean.js
if !ERRORLEVEL! EQU 0 (echo [OK] 澶稿厠涓婁紶瀹屾垚) else (echo [璀﹀憡] 澶稿厠涓婁紶鍙兘澶辫触)

echo.
echo ===== 鍏ㄩ儴瀹屾垚 !TODAY! =====

