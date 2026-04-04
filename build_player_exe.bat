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
timeout /t 2 /nobreak >nul

rmdir /s /q build
rmdir /s /q dist

echo.
echo ==============================================
echo Building the standalone Windows Executable...
echo ==============================================

pyinstaller --noconfirm --clean --onefile --windowed ^
  --icon "C:\Users\Gusts\Pictures\icon.png" ^
  --name "MusicSchedulerPlayer" ^
  gui_player.py

echo.
echo ==============================================
echo Copying FFmpeg files to the dist folder...
echo ==============================================
:: This copies the FFmpeg binaries physically right next to the new .exe
copy "C:\ffmpeg\bin\ffmpeg.exe" "dist\"
copy "C:\ffmpeg\bin\ffplay.exe" "dist\"
copy "C:\ffmpeg\bin\ffprobe.exe" "dist\"

echo.
echo ==============================================
echo Build Complete!
echo ==============================================
echo Inside your "dist" folder, you now have:
echo - MusicSchedulerPlayer.exe
echo - ffmpeg.exe
echo - ffplay.exe
echo - ffprobe.exe
echo.
echo Keep them together in the same folder!
pause
