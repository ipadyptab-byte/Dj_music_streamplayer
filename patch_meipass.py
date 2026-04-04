with open("gui_player.py", "r", encoding="utf-8") as f:
    code = f.read()

injection = """import sys

# --- PyInstaller Bundle Path Fix ---
# When running as a compiled PyInstaller EXE, binaries (ffplay, ffmpeg) are extracted
# to a temporary folder (_MEIPASS). We add this folder to the system PATH so 
# subprocess and yt-dlp can find them automatically without modifying the rest of the code.
if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
    os.environ["PATH"] = sys._MEIPASS + os.pathsep + os.environ.get("PATH", "")
# -----------------------------------"""

code = code.replace("import sys", injection, 1)

with open("gui_player.py", "w", encoding="utf-8") as f:
    f.write(code)

print("MEIPASS patch applied.")
