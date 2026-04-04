with open("gui_player.py", "r", encoding="utf-8") as f:
    code = f.read()

# 1. Update SchedulerState to include a persistent_audio_dir
old_state_init = """        config_dir = os.path.join(base_dir, "config")
        self.settings_path = os.path.join(config_dir, "gui_player_settings.json")

        self.ad_file: str | None = None"""

new_state_init = """        config_dir = os.path.join(base_dir, "config")
        self.settings_path = os.path.join(config_dir, "gui_player_settings.json")
        self.persistent_audio_dir = os.path.join(base_dir, "stored_audio")
        os.makedirs(self.persistent_audio_dir, exist_ok=True)

        self.ad_file: str | None = None"""

code = code.replace(old_state_init, new_state_init)

# 2. Update select_ad_track to use persistent_audio_dir instead of UPLOAD_FOLDER
old_ad_dest = """        try:
            dest = os.path.join(UPLOAD_FOLDER, os.path.basename(path))
            shutil.copy2(path, dest)"""

new_ad_dest = """        try:
            dest = os.path.join(self.state.persistent_audio_dir, os.path.basename(path))
            shutil.copy2(path, dest)"""

code = code.replace(old_ad_dest, new_ad_dest)

# 3. Update select_prayer_track to use persistent_audio_dir instead of UPLOAD_FOLDER
old_prayer_dest = """        try:
            dest = os.path.join(UPLOAD_FOLDER, os.path.basename(path))
            shutil.copy2(path, dest)"""

new_prayer_dest = """        try:
            dest = os.path.join(self.state.persistent_audio_dir, os.path.basename(path))
            shutil.copy2(path, dest)"""

code = code.replace(old_prayer_dest, new_prayer_dest)

with open("gui_player.py", "w", encoding="utf-8") as f:
    f.write(code)

print("Persistence patch applied.")
