@echo off
echo ==============================================
echo Installing PyInstaller...
echo ==============================================
pip install pyinstaller

echo.
echo ==============================================
echo Building the standalone Windows Executable...
echo ==============================================

:: This command compiles everything into a single .exe file.
:: It automatically embeds the ffmpeg binaries from C:\ffmpeg\bin
:: inside the executable so you don't need them installed on other PCs.

pyinstaller --noconfirm --onefile --windowed ^
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
echo You can copy this .exe to any Windows computer and it will work immediately
echo without needing to install Python or FFmpeg!
echo.
pause
