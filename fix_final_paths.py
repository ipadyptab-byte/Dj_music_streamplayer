import re

with open("gui_player.py", "r", encoding="utf-8") as f:
    code = f.read()

# 1. Update the get_binary_path function to check the current working directory first
old_get_binary = """def get_binary_path(binary_name: str) -> str:
    binary_name_ext = binary_name + (".exe" if platform.system() == "Windows" else "")
    if getattr(sys, "frozen", False):
        exe_dir = os.path.dirname(sys.executable)
        exe_path = os.path.join(exe_dir, binary_name_ext)
        if os.path.exists(exe_path):
            return exe_path
    # Fallback to just the command name (relies on system PATH)
    return binary_name"""

new_get_binary = """def get_binary_path(binary_name: str) -> str:
    binary_name_ext = binary_name + (".exe" if platform.system() == "Windows" else "")
    
    # 1. Check current working directory (where the bat file ran or user double-clicked)
    cwd_path = os.path.join(os.getcwd(), binary_name_ext)
    if os.path.exists(cwd_path):
        return cwd_path
        
    # 2. Check exactly where the .exe lives
    if getattr(sys, "frozen", False):
        exe_dir = os.path.dirname(sys.executable)
        exe_path = os.path.join(exe_dir, binary_name_ext)
        if os.path.exists(exe_path):
            return exe_path
            
    # 3. Fallback to system PATH
    return binary_name_ext"""

code = code.replace(old_get_binary, new_get_binary)

# 2. Update the PATH injection for yt-dlp to include both CWD and EXE dir
old_path_fix = """# --- PyInstaller Bundle Path Fix ---
if getattr(sys, "frozen", False):
    exe_dir = os.path.dirname(sys.executable)
    os.environ["PATH"] = exe_dir + os.pathsep + os.environ.get("PATH", "")
# -----------------------------------"""

new_path_fix = """# --- PyInstaller Bundle Path Fix ---
if getattr(sys, "frozen", False):
    exe_dir = os.path.dirname(sys.executable)
    cwd_dir = os.getcwd()
    os.environ["PATH"] = cwd_dir + os.pathsep + exe_dir + os.pathsep + os.environ.get("PATH", "")
# -----------------------------------"""

code = code.replace(old_path_fix, new_path_fix)

with open("gui_player.py", "w", encoding="utf-8") as f:
    f.write(code)

print("Final pathing fixes applied.")
