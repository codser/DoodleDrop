@echo off
title Doodle Drop installer
echo.
echo  Installing Doodle Drop for Adobe Premiere Pro...
echo.

set "SRC=%~dp0DoodleDrop"
set "DEST=%APPDATA%\Adobe\CEP\extensions\DoodleDrop"

if not exist "%SRC%\CSXS\manifest.xml" (
  echo  Couldn't find the DoodleDrop folder next to this file.
  echo  Unzip the whole download first, then run this again.
  echo.
  pause
  exit /b 1
)

if not exist "%APPDATA%\Adobe\CEP\extensions" mkdir "%APPDATA%\Adobe\CEP\extensions"
xcopy "%SRC%" "%DEST%\" /E /I /Y /Q >nul
if errorlevel 1 (
  echo  Copying the files failed. Close Premiere Pro and try again.
  echo.
  pause
  exit /b 1
)

rem Allow unsigned panels (needed for Doodle Drop) for all recent Premiere versions
for %%v in (9 10 11 12 13) do reg add "HKCU\Software\Adobe\CSXS.%%v" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul

echo  Done! Doodle Drop is installed to:
echo  %DEST%
echo.
echo  Restart Premiere Pro, then open Window ^> Extensions ^> Doodle Drop.
echo.
pause
