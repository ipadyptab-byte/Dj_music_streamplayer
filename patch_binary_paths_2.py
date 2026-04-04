import os

with open("gui_player.py", "r", encoding="utf-8") as f:
    code = f.read()

old_get_binary = """def get_binary_path(binary_name: str) -> str:
    \"\"\"Return the absolute path to the binary. Checks next to the EXE first.\"\"\"
    binary_name_ext = binary_name + (".exe" if platform.system() == "Windows" else "")
    if getattr(sys, 'frozen', False):
        exe_dir = os.path.dirname(sys.executable)
        exe_path = os.path.join(exe_dir, binary_name_ext)
        if os.path.exists(exe_path):
            return exe_path
        if hasattr(sys, '_MEIPASS'):
            return os.path.join(sys._MEIPASS, binary_name_ext)
    return binary_name"""

new_get_binary = """def get_binary_path(binary_name: str) -> str:
    \"\"\"Return the absolute path to the binary. STRICTLY forces the folder next to the EXE.\"\"\"
    binary_name_ext = binary_name + (".exe" if platform.system() == "Windows" else "")
    if getattr(sys, 'frozen', False):
        exe_dir = os.path.dirname(sys.executable)
        return os.path.join(exe_dir, binary_name_ext)
    return binary_name_ext"""

code = code.replace(old_get_binary, new_get_binary)

with open("gui_player.py", "w", encoding="utf-8") as f:
    f.write(code)

print("Binary paths strictly patched to same folder.")
