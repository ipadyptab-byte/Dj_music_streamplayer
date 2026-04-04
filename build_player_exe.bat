@echo off
:: Force Windows to use the directory where this .bat file is located
cd /d "%~dp0"

echo ==============================================
echo Installing PyInstaller and Pillow...
echo ==============================================
pip install pyinstaller pillow

echo.
echo ==============================================
echo Cleaning up corrupted build files...
echo ==============================================

:: Gracefully try to close the running app so we can overwrite it
taskkill /IM MusicSchedulerPlayer.exe /F 2>nul
:: Wait 2 seconds for the process to fully close
timeout /t 2 /nobreak >nul

rmdir /s /q build
rmdir /s /q dist

echo.
echo ==============================================
echo Building the standalone Windows Executable...
echo ==============================================

pyinstaller --noconfirm --clean --onefile --windowed ^
  --add-binary "C:\ffmpeg\bin\ffmpeg.exe;." ^
  --add-binary "C:\ffmpeg\bin\ffplay.exe;." ^
  --add-binary "C:\ffmpeg\bin\ffprobe.exe;." ^
  --icon "C:\Users\Gusts\Pictures\icon.png" ^
  --name "MusicSchedulerPlayer" ^
  gui_player.py

echo.
echo ==============================================
echo Build Complete!
echo ==============================================
echo Look for "MusicSchedulerPlayer.exe" inside the "dist" folder.
pause
