import os
import threading
import time
import shutil
import subprocess
from datetime import datetime

import tkinter as tk
from tkinter import filedialog, messagebox

from main import UPLOAD_FOLDER, search_youtube, get_audio_url


# ---------------------------
# Low-level audio playback
# ---------------------------

def play_with_ffplay(path: str) -> None:
    """Play an audio file using ffplay (part of ffmpeg).

    This is blocking, so it must be run in a background thread.
    """
    try:
        subprocess.run([
            "ffplay",
            "-nodisp",
            "-autoexit",
            path,
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except FileNotFoundError:
        messagebox.showerror(
            "ffplay not found",
            "ffplay (from ffmpeg) is not installed or not on PATH.\n"
            "Please install ffmpeg and restart the application.",
        )


class FfplayManager:
    """Coordinate ffplay processes so playback does not overlap.

    Priority: main < ad < prayer.
    - A higher-priority kind stops any current playback.
    - A lower-priority kind will *not* interrupt a higher-priority one.
    """

    PRIORITY = {"main": 1, "ad": 2, "prayer": 3}

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._proc: subprocess.Popen | None = None
        self._kind: str | None = None
        self._path: str | None = None

    def _can_preempt(self, new_kind: str) -> bool:
        if self._kind is None:
            return True
        return self.PRIORITY.get(new_kind, 0) >= self.PRIORITY.get(self._kind, 0)

    def _stop_locked(self) -> None:
        if not self._proc:
            return
        try:
            self._proc.terminate()
        except Exception:
            pass

    def play(self, path: str, kind: str, logger=None, on_finished=None, on_preempt=None, start_at: float | None = None) -> None:
        """Start playback in a background thread with priority rules.

        kind is one of "main", "ad", "prayer".
        on_finished(kind, path) is called when playback ends for this call.
        on_preempt(prev_kind, prev_path) is called if this call stops a previous one.
        start_at: optional start offset in seconds (used for resuming main).
        """

        def worker(proc: subprocess.Popen, finished_callback, started_kind: str) -> None:
            try:
                proc.wait()
            finally:
                finished_path: str | None = None
                with self._lock:
                    if self._proc is proc:
                        finished_path = self._path
                        self._proc = None
                        self._kind = None
                        self._path = None
                if finished_callback is not None:
                    finished_callback(started_kind, finished_path)

        with self._lock:
            if self._proc is not None and not self._can_preempt(kind):
                if logger:
                    logger(
                        f"Ignoring {kind} playback because higher-priority {self._kind} is currently playing."
                    )
                return

            if self._proc is not None and self._can_preempt(kind):
                prev_kind = self._kind
                prev_path = self._path
                if on_preempt is not None:
                    on_preempt(prev_kind, prev_path)
                if logger:
                    logger(f"Stopping current {self._kind} playback for new {kind} track.")
                self._stop_locked()

            try:
                proc = subprocess.Popen(
                    [
                        "ffplay",
                        "-nodisp",
                        "-autoexit",
                        path,
                    ],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
            except FileNotFoundError:
                if logger is not None:
                    logger(
                        "ffplay (from ffmpeg) is not installed or not on PATH. "
                        "Please install ffmpeg and restart the application."
                    )
                else:
                    messagebox.showerror(
                        "ffplay not found",
                        "ffplay (from ffmpeg) is not installed or not on PATH.\n"
                        "Please install ffmpeg and restart the application.",
                    )
                return

            self._proc = proc
            self._kind = kind
            self._path = path

        threading.Thread(
            target=worker,
            args=(proc, on_finished, kind),
            daemon=True,
        ).start()


# ---------------------------
# Scheduler state
# ---------------------------

class SchedulerState:
    def __init__(self) -> None:
        os.makedirs(UPLOAD_FOLDER, exist_ok=True)
        self.ad_file: str | None = None
        self.ad_interval_sec: int = 180

        self.prayer_file: str | None = None
        # List[str] of "HH:MM" times
        self.prayer_times: list[str] = []
        # Map time string -> last date run ("YYYY-MM-DD")
        self.prayer_last_run: dict[str, str] = {}

        # Single shared ffplay manager for all playback kinds
        self.player = FfplayManager()

        self.running = True
        self.lock = threading.Lock()

    # Convenience helpers guarded by lock where needed


# ---------------------------
# Background worker threads
# ---------------------------

def ad_worker(state: SchedulerState, ui: "MainWindow") -> None:
    """Periodically play advertisement track at a fixed interval.

    Behaviour:
    - The very first interval starts counting when the first main track starts
      (ui.last_main_path becomes non-None).
    - After an advertisement finishes, the next interval starts counting from
      the end of that advertisement.
    - This pattern continues across tracks.
    """
    started_after_main = False

    while state.running:
        time.sleep(1)
        with state.lock:
            ad_file = state.ad_file
            interval = state.ad_interval_sec
        if not ad_file or interval <= 0:
            continue

        # Wait until some main track has been played at least once
        if not started_after_main:
            if ui.last_main_path is None:
                continue
            started_after_main = True

        # Sleep in chunks to allow quick shutdown
        slept = 0
        while state.running and slept < interval:
            time.sleep(1)
            slept += 1
        if not state.running:
            break

        if ad_file and os.path.exists(ad_file):
            ui.log(f"Playing advertisement: {os.path.basename(ad_file)}")

            done = threading.Event()

            def on_preempt(prev_kind: str | None, prev_path: str | None) -> None:
                if prev_kind == "main" and prev_path:
                    ui.interrupted_main_path = prev_path

            def on_finished(kind: str, _path: str | None) -> None:
                if kind == "ad":
                    ui.resume_main_if_any()
                    done.set()

            state.player.play(
                ad_file,
                kind="ad",
                logger=ui.log,
                on_finished=on_finished,
                on_preempt=on_preempt,
            )

            # Wait until this advertisement finishes before starting the next interval
            while state.running and not done.is_set():
                time.sleep(0.5)


def prayer_worker(state: SchedulerState, ui: "MainWindow") -> None:
    """Check every second and play prayer at configured times."""
    while state.running:
        time.sleep(1)
        now = datetime.now()
        current_hm = now.strftime("%H:%M")
        today = now.strftime("%Y-%m-%d")

        with state.lock:
            prayer_file = state.prayer_file
            times = list(state.prayer_times)
            last_run = dict(state.prayer_last_run)

        if not prayer_file or not times:
            continue

        for t in times:
            if t == current_hm and last_run.get(t) != today:
                if os.path.exists(prayer_file):
                    ui.log(f"Playing prayer for scheduled time {t}: {os.path.basename(prayer_file)}")
                    # Update last_run under lock
                    with state.lock:
                        state.prayer_last_run[t] = today

                    def on_preempt(prev_kind: str | None, prev_path: str | None) -> None:
                        if prev_kind == "main" and prev_path:
                            ui.interrupted_main_path = prev_path

                    def on_finished(kind: str, _path: str | None) -> None:
                        if kind == "prayer":
                            ui.resume_main_if_any()

                    state.player.play(
                        prayer_file,
                        kind="prayer",
                        logger=ui.log,
                        on_finished=on_finished,
                        on_preempt=on_preempt,
                    )


# ---------------------------
# Tkinter UI
# ---------------------------

class MainWindow:
    def __init__(self, root: tk.Tk, state: SchedulerState) -> None:
        self.root = root
        self.state = state
        self.root.title("Headless Music Scheduler (Ad + Prayer)")

        # Track main playback and history for auto-continue
        self.main_history: list[str] = []
        self.last_main_path: str | None = None
        self.interrupted_main_path: str | None = None

        # --- Search & play section ---
        search_frame = tk.LabelFrame(root, text="Search & Play (YouTube via yt-dlp)", padx=10, pady=10)
        search_frame.pack(fill="x", padx=10, pady=5)

        self.search_var = tk.StringVar()
        entry_search = tk.Entry(search_frame, textvariable=self.search_var, width=40)
        entry_search.pack(side="left", padx=(0, 5), fill="x", expand=True)
        btn_search = tk.Button(search_frame, text="Search", command=self.search_and_play)
        btn_search.pack(side="left")

        # --- Advertisement section ---
        ad_frame = tk.LabelFrame(root, text="Advertisement Settings", padx=10, pady=10)
        ad_frame.pack(fill="x", padx=10, pady=5)

        self.ad_label = tk.Label(ad_frame, text="No advertisement track selected")
        self.ad_label.pack(anchor="w")

        btn_ad_select = tk.Button(ad_frame, text="Select Advertisement Track", command=self.select_ad_track)
        btn_ad_select.pack(anchor="w", pady=5)

        interval_frame = tk.Frame(ad_frame)
        interval_frame.pack(anchor="w", pady=5)
        tk.Label(interval_frame, text="Play every").pack(side="left")
        self.ad_interval_var = tk.StringVar(value="180")
        ad_entry = tk.Entry(interval_frame, width=6, textvariable=self.ad_interval_var)
        ad_entry.pack(side="left", padx=5)
        tk.Label(interval_frame, text="seconds").pack(side="left")
        btn_apply_interval = tk.Button(ad_frame, text="Apply Interval", command=self.apply_interval)
        btn_apply_interval.pack(anchor="w")

        # --- Prayer section ---
        prayer_frame = tk.LabelFrame(root, text="Prayer Settings", padx=10, pady=10)
        prayer_frame.pack(fill="x", padx=10, pady=5)

        self.prayer_label = tk.Label(prayer_frame, text="No prayer track selected")
        self.prayer_label.pack(anchor="w")

        btn_prayer_select = tk.Button(prayer_frame, text="Select Prayer Track", command=self.select_prayer_track)
        btn_prayer_select.pack(anchor="w", pady=5)

        times_frame = tk.Frame(prayer_frame)
        times_frame.pack(fill="x", pady=5)

        self.times_listbox = tk.Listbox(times_frame, height=5)
        self.times_listbox.pack(side="left", fill="x", expand=True)

        btns_frame = tk.Frame(times_frame)
        btns_frame.pack(side="left", padx=5)

        btn_add_time = tk.Button(btns_frame, text="Add Time", command=self.add_time)
        btn_add_time.pack(fill="x", pady=2)
        btn_remove_time = tk.Button(btns_frame, text="Remove Selected", command=self.remove_selected_time)
        btn_remove_time.pack(fill="x", pady=2)

        # --- Log/output ---
        log_frame = tk.LabelFrame(root, text="Log", padx=10, pady=10)
        log_frame.pack(fill="both", expand=True, padx=10, pady=5)

        self.log_text = tk.Text(log_frame, height=8, state="disabled")
        self.log_text.pack(fill="both", expand=True)

        # Hook close event
        self.root.protocol("WM_DELETE_WINDOW", self.on_close)

    # ----- UI actions -----

    def log(self, msg: str) -> None:
        self.log_text.configure(state="normal")
        self.log_text.insert("end", f"[{datetime.now().strftime('%H:%M:%S')}] {msg}\n")
        self.log_text.see("end")
        self.log_text.configure(state="disabled")

    def select_ad_track(self) -> None:
        path = filedialog.askopenfilename(
            title="Select Advertisement Audio",
            filetypes=[("Audio Files", "*.mp3 *.wav *.m4a *.aac *.ogg *.flac"), ("All Files", "*.*")],
        )
        if not path:
            return
        try:
            dest = os.path.join(UPLOAD_FOLDER, os.path.basename(path))
            shutil.copy2(path, dest)
            with self.state.lock:
                self.state.ad_file = dest
            self.ad_label.config(text=f"Ad track: {os.path.basename(dest)}")
            self.log(f"Advertisement track set: {dest}")
        except Exception as e:
            messagebox.showerror("Error", f"Failed to copy file: {e}")

    def apply_interval(self) -> None:
        try:
            value = int(self.ad_interval_var.get())
            if value <= 0:
                raise ValueError
        except ValueError:
            messagebox.showerror("Invalid interval", "Please enter a positive integer number of seconds.")
            return
        with self.state.lock:
            self.state.ad_interval_sec = value
        self.log(f"Advertisement interval set to {value} seconds")

    def select_prayer_track(self) -> None:
        path = filedialog.askopenfilename(
            title="Select Prayer Audio",
            filetypes=[("Audio Files", "*.mp3 *.wav *.m4a *.aac *.ogg *.flac"), ("All Files", "*.*")],
        )
        if not path:
            return
        try:
            dest = os.path.join(UPLOAD_FOLDER, os.path.basename(path))
            shutil.copy2(path, dest)
            with self.state.lock:
                self.state.prayer_file = dest
            self.prayer_label.config(text=f"Prayer track: {os.path.basename(dest)}")
            self.log(f"Prayer track set: {dest}")
        except Exception as e:
            messagebox.showerror("Error", f"Failed to copy file: {e}")

    def add_time(self) -> None:
        def on_ok() -> None:
            hm = entry.get().strip()
            if not hm:
                return
            # Basic validation HH:MM
            try:
                datetime.strptime(hm, "%H:%M")
            except ValueError:
                messagebox.showerror("Invalid time", "Please enter time in 24h format HH:MM, e.g. 06:30")
                return
            self.times_listbox.insert("end", hm)
            with self.state.lock:
                self.state.prayer_times = list(self.times_listbox.get(0, "end"))
            self.log(f"Added prayer time: {hm}")
            dlg.destroy()

        dlg = tk.Toplevel(self.root)
        dlg.title("Add Prayer Time")
        tk.Label(dlg, text="Time (HH:MM 24h)").pack(padx=10, pady=5)
        entry = tk.Entry(dlg)
        entry.pack(padx=10, pady=5)
        entry.focus_set()
        btn_ok = tk.Button(dlg, text="OK", command=on_ok)
        btn_ok.pack(pady=5)

    def remove_selected_time(self) -> None:
        sel = list(self.times_listbox.curselection())
        if not sel:
            return
        # Remove from bottom to top
        for idx in reversed(sel):
            self.times_listbox.delete(idx)
        with self.state.lock:
            self.state.prayer_times = list(self.times_listbox.get(0, "end"))
        self.log("Removed selected prayer time(s)")

    def on_close(self) -> None:
        # Signal threads to stop and then destroy window
        self.state.running = False
        self.root.after(200, self.root.destroy)

    def resume_main_if_any(self) -> None:
        """Resume the last interrupted main track, if any, then continue auto-play.

        Main is restarted from the beginning (ffplay cannot seek to the exact
        previous position in this setup).
        """
        path = self.interrupted_main_path
        if not path or not os.path.exists(path):
            self.interrupted_main_path = None
            return

        self.interrupted_main_path = None
        self.log("Resuming main track after interruption.")
        self._play_main_with_autonext(path)

    def _play_main_with_autonext(self, path: str) -> None:
        """Play a main track and, when it finishes, queue a random main track.

        All tracks that have ever been played as main are used as the pool
        for random continuation.
        """
        self.last_main_path = path
        if path not in self.main_history:
            self.main_history.append(path)

        def on_finished(kind: str, finished_path: str | None) -> None:
            if kind != "main":
                return
            # After a main track ends, auto-play a random one from history.
            import random

            candidates = [p for p in self.main_history if os.path.exists(p)]
            if not candidates:
                return
            next_path = random.choice(candidates)
            # Avoid immediate repeat if there is more than one candidate.
            if len(candidates) > 1 and finished_path and next_path == finished_path:
                others = [p for p in candidates if p != finished_path]
                if others:
                    next_path = random.choice(others)

            self.log("Main track finished, playing random track from history.")
            self._play_main_with_autonext(next_path)

        self.state.player.play(path, kind="main", logger=self.log, on_finished=on_finished)

    # ----- Search & play -----

    def search_and_play(self) -> None:
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

        # Build a simple selection dialog
        dlg = tk.Toplevel(self.root)
        dlg.title("Select Track")
        dlg.geometry("500x300")

        listbox = tk.Listbox(dlg)
        listbox.pack(fill="both", expand=True, padx=10, pady=10)

        for idx, item in enumerate(results):
            title = item.get("title", "(no title)")
            listbox.insert("end", f"{idx + 1}. {title}")

        def on_play() -> None:
            sel = listbox.curselection()
            if not sel:
                return
            index = sel[0]
            track = results[index]
            dlg.destroy()
            self.play_search_result(track)

        btn_frame = tk.Frame(dlg)
        btn_frame.pack(fill="x", padx=10, pady=(0, 10))
        tk.Button(btn_frame, text="Play", command=on_play).pack(side="right")

    def play_search_result(self, track: dict) -> None:
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

        self.log(f"Playing search result: {title}")
        # Use shared manager so playback obeys priority rules and auto-continue
        self._play_main_with_autonext(path)


# ---------------------------
# Entry point
# ---------------------------

def main() -> None:
    state = SchedulerState()

    root = tk.Tk()
    ui = MainWindow(root, state)

    # Start background workers
    threading.Thread(target=ad_worker, args=(state, ui), daemon=True).start()
    threading.Thread(target=prayer_worker, args=(state, ui), daemon=True).start()

    ui.log("Application started. Configure advertisement and prayer settings.")

    root.mainloop()


if __name__ == "__main__":
    main()
