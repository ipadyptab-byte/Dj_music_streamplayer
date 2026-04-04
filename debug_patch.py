import re

with open("gui_player.py", "r", encoding="utf-8") as f:
    code = f.read()

# Make the error message highly descriptive so we know exactly why it's failing
old_err_1 = """    except FileNotFoundError:
        raise RuntimeError(
            "ffplay (from ffmpeg) is not installed or not on PATH.\\n"
            "Please install ffmpeg and restart the application."
        )"""

new_err_1 = """    except FileNotFoundError:
        bin_path = get_binary_path("ffplay")
        exists = os.path.exists(bin_path)
        raise RuntimeError(f"Could not launch ffplay.\\nTried path: {bin_path}\\nFile exists: {exists}\\nAre you running the EXE or the Python script?")"""

code = code.replace(old_err_1, new_err_1)

old_err_2 = """        except FileNotFoundError:
            raise RuntimeError("ffplay (from ffmpeg) is not installed or not on PATH.")"""

new_err_2 = """        except FileNotFoundError:
            bin_path = get_binary_path("ffplay")
            exists = os.path.exists(bin_path)
            raise RuntimeError(f"Could not launch ffplay.\\nTried path: {bin_path}\\nFile exists: {exists}\\nAre you running the EXE or the Python script?")"""

code = code.replace(old_err_2, new_err_2)

with open("gui_player.py", "w", encoding="utf-8") as f:
    f.write(code)

print("Debug patch applied.")
