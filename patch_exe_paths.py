with open("gui_player.py", "r", encoding="utf-8") as f:
    code = f.read()

# Add get_binary_path function
injection = """import sys

def get_binary_path(binary_name: str) -> str:
    \"\"\"Return the absolute path to the binary if running in PyInstaller, else just the name.\"\"\"
    if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
        return os.path.join(sys._MEIPASS, binary_name + (".exe" if platform.system() == "Windows" else ""))
    return binary_name

# --- PyInstaller Bundle Path Fix ---
"""
code = code.replace("import sys\n\n# --- PyInstaller Bundle Path Fix ---", injection)

# Fix play_with_ffplay
code = code.replace(
    'subprocess.run([\n            "ffplay",\n            "-nodisp",',
    'subprocess.run([\n            get_binary_path("ffplay"),\n            "-nodisp",'
)

# Fix MainTrackPlayer._start_ffplay
code = code.replace(
    '        cmd = [\n            "ffplay",\n            "-nodisp",',
    '        cmd = [\n            get_binary_path("ffplay"),\n            "-nodisp",'
)

# Fix ffprobe
code = code.replace(
    '                cmd = [\n                    "ffprobe",',
    '                cmd = [\n                    get_binary_path("ffprobe"),'
)

with open("gui_player.py", "w", encoding="utf-8") as f:
    f.write(code)

print("Paths patched.")
