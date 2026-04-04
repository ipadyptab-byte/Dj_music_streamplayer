import re

with open("gui_player.py", "r", encoding="utf-8") as f:
    code = f.read()

# 1. Update get_binary_path to fallback to system PATH if not found next to EXE
old_get_binary = """def get_binary_path(binary_name: str) -> str:
    if getattr(sys, "frozen", False):
        exe_dir = os.path.dirname(sys.executable)
        return os.path.join(exe_dir, binary_name + (".exe" if platform.system() == "Windows" else ""))
    return binary_name"""

new_get_binary = """def get_binary_path(binary_name: str) -> str:
    binary_name_ext = binary_name + (".exe" if platform.system() == "Windows" else "")
    if getattr(sys, "frozen", False):
        exe_dir = os.path.dirname(sys.executable)
        exe_path = os.path.join(exe_dir, binary_name_ext)
        if os.path.exists(exe_path):
            return exe_path
    # Fallback to just the command name (relies on system PATH)
    return binary_name"""

code = code.replace(old_get_binary, new_get_binary)

# 2. Add an initialization check in MainWindow to log the binary paths
init_hook = """        # Periodically update main track timing display
        self._update_main_track_ui()"""

new_init_hook = """        # Periodically update main track timing display
        self._update_main_track_ui()
        
        # Log binary paths for debugging
        self.log(f"Executable directory: {os.path.dirname(sys.executable) if getattr(sys, 'frozen', False) else 'Not frozen'}")
        self.log(f"Resolved ffplay path: {get_binary_path('ffplay')}")
        self.log(f"Resolved ffprobe path: {get_binary_path('ffprobe')}")
"""

code = code.replace(init_hook, new_init_hook)

with open("gui_player.py", "w", encoding="utf-8") as f:
    f.write(code)

print("Binary fallback and logging patched.")
