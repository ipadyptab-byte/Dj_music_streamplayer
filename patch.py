import re

with open("gui_player.py", "r", encoding="utf-8") as f:
    code = f.read()

# 1. play_with_ffplay
code = re.sub(
    r'except FileNotFoundError:\s+messagebox\.showerror\([^)]+\)',
    r'except FileNotFoundError:\n        raise RuntimeError("ffplay (from ffmpeg) is not installed or not on PATH.\\nPlease install ffmpeg and restart the application.")',
    code
)

# 2. MainTrackPlayer._start_ffplay
code = re.sub(
    r'        return subprocess\.Popen\(\n            cmd,\n            stdout=subprocess\.DEVNULL,\n            stderr=subprocess\.DEVNULL,\n            creationflags=creationflags,\n        \)',
    r'        try:\n            return subprocess.Popen(\n                cmd,\n                stdout=subprocess.DEVNULL,\n                stderr=subprocess.DEVNULL,\n                creationflags=creationflags,\n            )\n        except FileNotFoundError:\n            raise RuntimeError("ffplay (from ffmpeg) is not installed or not on PATH.")',
    code
)

# 3. ad_worker
old_ad_worker = """def ad_worker(state: SchedulerState, ui: "MainWindow") -> None:
    \"\"\"Periodically play advertisement track at a fixed interval.

    Ensures that advertisements never overlap with prayer and only run
    when a main track is currently playing.
    \"\"\"
    while state.running:
        time.sleep(1)
        with state.lock:"""
new_ad_worker = """def ad_worker(state: SchedulerState, ui: "MainWindow") -> None:
    \"\"\"Periodically play advertisement track at a fixed interval.

    Ensures that advertisements never overlap with prayer and only run
    when a main track is currently playing.
    \"\"\"
    while state.running:
        try:
            time.sleep(1)
            with state.lock:"""
code = code.replace(old_ad_worker, new_ad_worker)
# Add try-except around the ad_worker body
code = re.sub(
    r'(def ad_worker.*?while state\.running:\n        try:\n            time\.sleep\(1\).*?)(\ndef prayer_worker)',
    lambda m: m.group(1).replace('\n        ', '\n            ').replace('            try:', '        try:') + '\n        except Exception as e:\n            ui.log(f"Error in ad worker: {e}")\n            time.sleep(2)' + m.group(2),
    code,
    flags=re.DOTALL
)

# 4. prayer_worker
old_prayer_worker = """def prayer_worker(state: SchedulerState, ui: "MainWindow") -> None:
    \"\"\"Check every second and play prayer at configured times.

    When a prayer starts, the main track (if any) is interrupted and will
    resume automatically from the same position once the prayer finishes.
    \"\"\"
    while state.running:
        time.sleep(1)
        now = datetime.now()"""
new_prayer_worker = """def prayer_worker(state: SchedulerState, ui: "MainWindow") -> None:
    \"\"\"Check every second and play prayer at configured times.

    When a prayer starts, the main track (if any) is interrupted and will
    resume automatically from the same position once the prayer finishes.
    \"\"\"
    while state.running:
        try:
            time.sleep(1)
            now = datetime.now()"""
code = code.replace(old_prayer_worker, new_prayer_worker)
code = re.sub(
    r'(def prayer_worker.*?while state\.running:\n        try:\n            time\.sleep\(1\).*?)(\n# -+\n# Tkinter UI)',
    lambda m: m.group(1).replace('\n        ', '\n            ').replace('            try:', '        try:') + '\n        except Exception as e:\n            ui.log(f"Error in prayer worker: {e}")\n            time.sleep(2)' + m.group(2),
    code,
    flags=re.DOTALL
)

# prayer worker play_with_ffplay error handling
code = code.replace(
"""                        try:
                            # Pause main track explicitly so only prayer plays
                            ui.log("Pausing main track for prayer.")
                            state.main_player.pause()
                            # Play prayer track fully (blocking) without touching main state
                            ui.log("Starting prayer track.")
                            play_with_ffplay(prayer_file)
                            ui.log("Prayer track finished, attempting to resume main track (if it was playing before).")
                            state.main_player.resume()
                        finally:""",
"""                        try:
                            # Pause main track explicitly so only prayer plays
                            ui.log("Pausing main track for prayer.")
                            state.main_player.pause()
                            # Play prayer track fully (blocking) without touching main state
                            ui.log("Starting prayer track.")
                            play_with_ffplay(prayer_file)
                            ui.log("Prayer track finished, attempting to resume main track (if it was playing before).")
                            state.main_player.resume()
                        except Exception as e:
                            ui.log(f"Prayer playback error: {e}")
                        finally:"""
)
code = code.replace("                                ui.log(f\"Prayer playback error: {e}\")", "                            ui.log(f\"Prayer playback error: {e}\")")

# 5. search_and_play
old_search_and_play = """    def search_and_play(self) -> None:
        query = self.search_var.get().strip()
        if not query:
            messagebox.showinfo("Search", "Please enter a search term.")
            return

        self.log(f"Searching YouTube for: {query}")
        try:
            results = search_youtube(query)
        except Exception as e:
            messagebox.showerror("Error", f"Search failed: {e}")
            return

        if not results:
            messagebox.showinfo("Search", "No results found.")
            return

        # Store results and show them in the UI listbox
        with self.state.lock:
            self.state.search_results = results
            self.state.search_index = None
            self.state.search_last_index = None
            self.state.search_rounds_completed = 0
            self.state.search_bag = list(range(len(results)))
            random.shuffle(self.state.search_bag)

        self.search_results_listbox.delete(0, "end")
        for idx, item in enumerate(results):
            title = item.get("title", "(no title)")
            self.search_results_listbox.insert("end", f"{idx + 1}. {title}")

        if results:
            self.search_results_listbox.selection_set(0)
            self.search_results_listbox.activate(0)

        self.log(f"Found {len(results)} result(s). Select one and click 'Play Selected'.")
        self._update_search_stats_ui(rounds=0, played=0, total=len(results))"""
new_search_and_play = """    def search_and_play(self) -> None:
        query = self.search_var.get().strip()
        if not query:
            messagebox.showinfo("Search", "Please enter a search term.")
            return

        self.log(f"Searching YouTube for: {query}")
        
        def _do_search() -> None:
            try:
                results = search_youtube(query)
            except Exception as e:
                self.root.after(0, lambda: messagebox.showerror("Error", f"Search failed: {e}"))
                return

            if not results:
                self.root.after(0, lambda: messagebox.showinfo("Search", "No results found."))
                return

            self.root.after(0, self._on_search_results, results)

        threading.Thread(target=_do_search, daemon=True).start()

    def _on_search_results(self, results: list) -> None:
        with self.state.lock:
            self.state.search_results = results
            self.state.search_index = None
            self.state.search_last_index = None
            self.state.search_rounds_completed = 0
            self.state.search_bag = list(range(len(results)))
            random.shuffle(self.state.search_bag)

        self.search_results_listbox.delete(0, "end")
        for idx, item in enumerate(results):
            title = item.get("title", "(no title)")
            self.search_results_listbox.insert("end", f"{idx + 1}. {title}")

        if results:
            self.search_results_listbox.selection_set(0)
            self.search_results_listbox.activate(0)

        self.log(f"Found {len(results)} result(s). Select one and click 'Play Selected'.")
        self._update_search_stats_ui(rounds=0, played=0, total=len(results))"""
code = code.replace(old_search_and_play, new_search_and_play)

# 6. play_search_result
old_play_search = """    def play_search_result(self, track: dict) -> None:
        url = track.get("url")
        title = track.get("title", "(no title)")
        if not url:
            messagebox.showerror("Error", "Selected track has no URL.")
            return

        self.log(f"Resolving and playing: {title}")
        try:
            audio_rel = get_audio_url(url)
        except Exception as e:
            messagebox.showerror("Error", f"Failed to resolve audio: {e}")
            return

        if not audio_rel:
            messagebox.showerror("Error", "Failed to resolve audio URL (yt-dlp error).")
            return

        # get_audio_url returns something like "/api/uploads/<filename>"
        # We only need the filename and play the file from UPLOAD_FOLDER
        fname = os.path.basename(audio_rel)
        path = os.path.join(UPLOAD_FOLDER, fname)
        if not os.path.exists(path):
            messagebox.showerror("Error", f"Audio file not found: {path}")
            return

        self.log(f"Playing search result as main track: {title}")
        # Remember title and track in history for UI and auto-next
        with self.state.lock:
            self.state.main_title = title
            self.state.main_history.append((path, title))
            # Newly selected track becomes the current index
            self.state.main_history_index = len(self.state.main_history) - 1
        # Play as the main track controlled by SchedulerState.main_player
        threading.Thread(target=self.state.main_player.play_new, args=(path,), daemon=True).start()"""
new_play_search = """    def play_search_result(self, track: dict) -> None:
        url = track.get("url")
        title = track.get("title", "(no title)")
        if not url:
            messagebox.showerror("Error", "Selected track has no URL.")
            return

        self.log(f"Resolving and playing: {title}")
        
        def _do_resolve() -> None:
            try:
                audio_rel = get_audio_url(url)
            except Exception as e:
                self.root.after(0, lambda: messagebox.showerror("Error", f"Failed to resolve audio: {e}"))
                return

            if not audio_rel:
                self.root.after(0, lambda: messagebox.showerror("Error", "Failed to resolve audio URL (yt-dlp error)."))
                return

            # get_audio_url returns something like "/api/uploads/<filename>"
            # We only need the filename and play the file from UPLOAD_FOLDER
            fname = os.path.basename(audio_rel)
            path = os.path.join(UPLOAD_FOLDER, fname)
            if not os.path.exists(path):
                self.root.after(0, lambda: messagebox.showerror("Error", f"Audio file not found: {path}"))
                return

            self.log(f"Playing search result as main track: {title}")
            # Remember title and track in history for UI and auto-next
            with self.state.lock:
                self.state.main_title = title
                self.state.main_history.append((path, title))
                # Newly selected track becomes the current index
                self.state.main_history_index = len(self.state.main_history) - 1
            # Play as the main track controlled by SchedulerState.main_player
            try:
                self.state.main_player.play_new(path)
            except Exception as e:
                self.root.after(0, lambda: messagebox.showerror("Playback Error", str(e)))

        threading.Thread(target=_do_resolve, daemon=True).start()"""
code = code.replace(old_play_search, new_play_search)

with open("gui_player.py", "w", encoding="utf-8") as f:
    f.write(code)

print("Done patching gui_player.py")
