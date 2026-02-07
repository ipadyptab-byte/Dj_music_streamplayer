@echo off
REM Build a standalone Windows GUI executable for the Devi Jewellers player.
REM This bundles Python and all dependencies so the target PC does not need Python installed.

REM Change working directory to the location of this script
cd /d "%~dp0"

REM Ensure pyinstaller is installed in the current Python environment
python -m pip install --upgrade pyinstaller >nul

REM Remove previous build artifacts
if exist build rmdir /s /q build
if exist dist rmdir /s /q dist
if exist __pycache__ rmdir /s /q __pycache__

REM Build one-file, windowed EXE for gui_player.py
REM --add-data "static;static" copies the static/ folder into the bundle
pyinstaller ^
  --noconfirm ^
  --onefile ^
  --windowed ^
  --name "DeviJewellersPlayer" ^
  --icon "static\app_icon.ico" ^
  --add-data "static;static" ^
  gui_player.py

if %errorlevel% neq 0 (
  echo PyInstaller build failed.
  pause
  exit /b 1
)

echo.
echo Build finished. Standalone EXE is in the dist\DeviJewellersPlayer.exe
pause
