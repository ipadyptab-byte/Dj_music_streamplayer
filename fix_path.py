import re

with open("gui_player.py", "r", encoding="utf-8") as f:
    code = f.read()

# Replace get_binary_path function
code = re.sub(
    r'def get_binary_path\(binary_name: str\) -> str:.*?return binary_name',
    '''def get_binary_path(binary_name: str) -> str:
    if getattr(sys, "frozen", False):
        exe_dir = os.path.dirname(sys.executable)
        return os.path.join(exe_dir, binary_name + (".exe" if platform.system() == "Windows" else ""))
    return binary_name''',
    code,
    flags=re.DOTALL
)

# Replace the PyInstaller bundle PATH fix
code = re.sub(
    r'# --- PyInstaller Bundle Path Fix ---.*?# -----------------------------------',
    '''# --- PyInstaller Bundle Path Fix ---
if getattr(sys, "frozen", False):
    exe_dir = os.path.dirname(sys.executable)
    os.environ["PATH"] = exe_dir + os.pathsep + os.environ.get("PATH", "")
# -----------------------------------''',
    code,
    flags=re.DOTALL
)

with open("gui_player.py", "w", encoding="utf-8") as f:
    f.write(code)

print("Paths definitively patched.")
