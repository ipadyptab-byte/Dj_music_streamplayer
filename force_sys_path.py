import re

with open("gui_player.py", "r", encoding="utf-8") as f:
    code = f.read()

# Completely replace get_binary_path to literally just return the filename.
# This forces Windows to look in the same folder, because if we don't pass a directory,
# Windows CreateProcess() natively looks in the directory of the executable first.
new_get_binary = """def get_binary_path(binary_name: str) -> str:
    binary_name_ext = binary_name + (".exe" if platform.system() == "Windows" else "")
    return binary_name_ext"""

code = re.sub(
    r'def get_binary_path\(binary_name: str\) -> str:.*?return binary_name_ext',
    new_get_binary,
    code,
    flags=re.DOTALL
)

# Rewrite the main track player and worker processes so they do NOT use absolute paths.
# We will rely entirely on Windows natively finding it in the same directory or PATH.
code = code.replace("bin_path = get_binary_path(\"ffplay\")", 'bin_path = "ffplay.exe"')
code = code.replace("exists = os.path.exists(bin_path)", 'exists = shutil.which("ffplay.exe") is not None')

# Fix the main window log hook
code = code.replace(
    'self.log(f"Resolved ffplay path: {get_binary_path(\'ffplay\')}")',
    'self.log(f"Resolved ffplay via shutil.which: {shutil.which(\'ffplay.exe\')}")'
)
code = code.replace(
    'self.log(f"Resolved ffprobe path: {get_binary_path(\'ffprobe\')}")',
    'self.log(f"Resolved ffprobe via shutil.which: {shutil.which(\'ffprobe.exe\')}")'
)

# And inject the directory of the executable directly into os.environ["PATH"]
# so that python's subprocess and shutil.which() can see it natively.
path_fix = """# --- PyInstaller Bundle Path Fix ---
if getattr(sys, "frozen", False):
    exe_dir = os.path.dirname(sys.executable)
    cwd_dir = os.getcwd()
    os.environ["PATH"] = cwd_dir + os.pathsep + exe_dir + os.pathsep + os.environ.get("PATH", "")
# -----------------------------------"""

new_path_fix = """# --- PyInstaller Bundle Path Fix ---
if getattr(sys, "frozen", False):
    # This is the ONE TRUE WAY to get the directory of the .exe in PyInstaller onefile mode
    exe_dir = os.path.dirname(sys.executable)
    # Inject it at the very front of the system PATH
    os.environ["PATH"] = exe_dir + os.pathsep + os.environ.get("PATH", "")
# -----------------------------------"""

code = code.replace(path_fix, new_path_fix)

with open("gui_player.py", "w", encoding="utf-8") as f:
    f.write(code)

print("Forced system PATH patch applied.")
