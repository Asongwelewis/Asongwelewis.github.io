@echo off
setlocal
cd /d "%~dp0"

set "PYTHON_CMD="
where py >nul 2>nul && set "PYTHON_CMD=py"
if not defined PYTHON_CMD where python >nul 2>nul && set "PYTHON_CMD=python"

if not defined PYTHON_CMD (
  echo.
  echo Python was not found on this computer.
  echo Install Python, or use the Live Server extension in your code editor.
  echo.
  pause
  exit /b 1
)

echo.
echo  ASONGWE LEWIS FON - PORTFOLIO PREVIEW
echo  ---------------------------------------
echo  Opening http://127.0.0.1:4173/
echo  Keep this window open while previewing.
echo  Press Ctrl+C here when you are finished.
echo.

start "" cmd /c "timeout /t 1 /nobreak ^>nul ^& start "" "http://127.0.0.1:4173/""
%PYTHON_CMD% -m http.server 4173 --bind 127.0.0.1

endlocal
