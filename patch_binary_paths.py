import os
import platform

with open("gui_player.py", "r", encoding="utf-8") as f:
    code = f.read()

old_get_binary = """def get_binary_path(binary_name: str) -> str:
    \"\"\"Return the absolute path to the binary if running in PyInstaller, else just the name.\"\"\"
    if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
        return os.path.join(sys._MEIPASS, binary_name + (".exe" if platform.system() == "Windows" else ""))
    return binary_name

# --- PyInstaller Bundle Path Fix ---
# When running as a compiled PyInstaller EXE, binaries (ffplay, ffmpeg) are extracted
# to a temporary folder (_MEIPASS). We add this folder to the system PATH so 
# subprocess and yt-dlp can find them automatically without modifying the rest of the code.
if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
    os.environ["PATH"] = sys._MEIPASS + os.pathsep + os.environ.get("PATH", "")
# -----------------------------------"""

new_get_binary = """def get_binary_path(binary_name: str) -> str:
    \"\"\"Return the absolute path to the binary. Checks next to the EXE first.\"\"\"
    binary_name_ext = binary_name + (".exe" if platform.system() == "Windows" else "")
    if getattr(sys, 'frozen', False):
        exe_dir = os.path.dirname(sys.executable)
        exe_path = os.path.join(exe_dir, binary_name_ext)
        if os.path.exists(exe_path):
            return exe_path
        if hasattr(sys, '_MEIPASS'):
            return os.path.join(sys._MEIPASS, binary_name_ext)
    return binary_name

# --- PyInstaller Bundle Path Fix ---
if getattr(sys, 'frozen', False):
    exe_dir = os.path.dirname(sys.executable)
    # Add the folder where the EXE lives to PATH so yt-dlp can find ffmpeg.exe there
    os.environ["PATH"] = exe_dir + os.pathsep + os.environ.get("PATH", "")
    if hasattr(sys, '_MEIPASS'):
        os.environ["PATH"] = sys._MEIPASS + os.pathsep + os.environ["PATH"]
# -----------------------------------"""

code = code.replace(old_get_binary, new_get_binary)

with open("gui_player.py", "w", encoding="utf-8") as f:
    f.write(code)

print("Binary paths patched.")
