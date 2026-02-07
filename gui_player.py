import os
import threading
import time
import shutil
import subprocess
import signal
import platform
from datetime import datetime
import random
import json

import tkinter as tk
from tkinter import filedialog, messagebox

from main import UPLOAD_FOLDER, search_youtube, get_audio_url


# ---------------------------
# Low-level audio playback
# ----------</old_code><new_code>def play_with_ffplay(path: str) -> None:
    """Play an audio file using ffplay (part of ffmpeg).

    This is blocking, so it must be run in a background thread.
    """
    # On Windows, hide the console window for ffplay so it runs silently in the background
    creationflags = 0
    if os.name == "nt" and hasattr(subprocess, "CREATE_NO_WINDOW"):
        creationflags = subprocess.CREATE_NO_WINDOW

    try:
        subprocess.run([
            "ffplay",
            "-nodisp",
            "-autoexit",
            path,
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=creationflags)
    except FileNotFoundError:
        messagebox.showerror(
            "ffplay not found",
            "ffplay (from ffmpeg) is not installed or not on PATH.\n"
            "Please install ffmpeg and restart the application.",
        )


class MainTrackPlayer:
    """Controls the main track so it can be interrupted and resumed.

    We keep track of the current file and how many seconds have already
    been played. When a higher‑priority track (prayer) needs to play,
    we stop the main track, remember the elapsed time and later resume
    it from that position using ffplay's -ss seek option.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._proc: subprocess.Popen | None = None
        self._current_file: str | None = None
        self._offset_sec: float = 0.0
        self._start_monotonic: float | None = None
        self._stop_reason: str | None = None

    def _start_ffplay(self, path: str, offset_sec: float) -> subprocess.Popen:
        """Start ffplay with consistent dynamic normalization so tracks have similar loudness.

        On Windows, the ffplay process is created without a visible console window.
        """
        cmd = [
            "ffplay",
            "-nodisp",
            "-autoexit",
            "-af",
            "dynaudnorm",  # dynamic audio normalization filter
        ]
        if offset_sec > 0:
            cmd += ["-ss", str(offset_sec)]
        cmd.append(path)

        creationflags = 0
        if os.name == "nt" and hasattr(subprocess, "CREATE_NO_WINDOW"):
            creationflags = subprocess.CREATE_NO_WINDOW

        return subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=creationflags,
        )

    def play_new(self, path: str) -> None:
        """Start playing a new main track from the beginning.

        Ensures that no priority track (ad/prayer) is playing at the same time.
        """
        # Make sure any priority track is stopped before starting main audio
        self.stop_priority()
        with self._lock:
            # Stop anything currently playing as main
            if self._proc and self._proc.poll() is None:
                self._stop_reason = "stop"
                self._proc.terminate()
            self._proc = self._start_ffplay(path, 0.0)
            self._current_file = path
            self._offset_sec = 0.0
            self._start_monotonic = time.monotonic()
            self._stop_reason = None

    def _update_offset_locked(self) -> None:
        """Update the stored offset based on how long the current process has run."""
        if self._proc and self._proc.poll() is None and self._start_monotonic is not None:
            self._offset_sec += time.monotonic() - self._start_monotonic
            self._start_monotonic = time.monotonic()

    def _play_priority_blocking(self, path: str) -> None:
        """Play a higher-priority track (ad or prayer) in a way that can be stopped.

        Before starting the priority track, ensure main is paused so only one
        thing plays at a time.
        """
        # Ensure main track is not playing concurrently
        with self._lock:
            if self._proc and self._proc.poll() is None:
                self._update_offset_locked()
                self._stop_reason = "interrupt"
                self._proc.terminate()
                self._proc = None
        # Now start the priority track
        proc = self._start_ffplay(path, 0.0)
        with self._lock:
            self._priority_proc = proc
        try:
            proc.wait()
        finally:
            with self._lock:
                if self._priority_proc is proc:
                    self._priority_proc = None

    def interrupt_and_resume(self, priority_path: str) -> None:
        """Pause the main track, play a higher-priority track, then resume.

        Used for both prayer and advertisement interruptions, and intended
        to be called from a background worker thread.
        """
        main_to_resume: str | None = None
        resume_offset: float = 0.0

        with self._lock:
            if self._proc and self._proc.poll() is None and self._current_file:
                # Calculate how long the main track has already played
                self._update_offset_locked()
                try:
                    self._stop_reason = "interrupt"
                    self._proc.terminate()
                finally:
                    self._proc = None
                main_to_resume = self._current_file
                resume_offset = self._offset_sec

        # Play the higher-priority track fully (blocking in this worker thread)
        if os.path.exists(priority_path):
            self._play_priority_blocking(priority_path)

        # Resume the main track from where it left off
        if main_to_resume:
            with self._lock:
                # If a new main track wasn't started in the meantime,
                # resume the previous one.
                if self._current_file is None or self._current_file == main_to_resume:
                    self._proc = self._start_ffplay(main_to_resume, resume_offset)
                    self._current_file = main_to_resume
                    self._start_monotonic = time.monotonic()
                    self._offset_sec = resume_offset
                    self._stop_reason = None

    def pause(self) -> None:
        """Pause the main track (can be resumed)."""
        with self._lock:
            if self._proc and self._proc.poll() is None:
                self._update_offset_locked()
                self._stop_reason = "pause"
                self._proc.terminate()
                self._proc = None

    def stop(self) -> None:
        """Stop the main track and clear state (cannot be resumed)."""
        with self._lock:
            if self._proc and self._proc.poll() is None:
                self._stop_reason = "stop"
                self._proc.terminate()
            self._proc = None
            self._current_file = None
            self._offset_sec = 0.0
            self._start_monotonic = None
            self._stop_reason = None

    def resume(self) -> None:
        """Resume the main track if paused."""
        with self._lock:
            if self._current_file and (self._proc is None or self._proc.poll() is not None):
                self._proc = self._start_ffplay(self._current_file, self._offset_sec)
                self._start_monotonic = time.monotonic()
                self._stop_reason = None

    def stop_priority(self) -> None:
        """Stop any currently playing higher-priority track (ad or prayer)."""
        with self._lock:
            if hasattr(self, "_priority_proc") and self._priority_proc and self._priority_proc.poll() is None:
                self._priority_proc.terminate()
            self._priority_proc = None

    def play_ad_blocking(self, path: str) -> None:
        """Play an advertisement, tracking its process so it can be stopped.

        Pauses the main track, plays the ad, and leaves main paused.
        The caller decides whether and when to resume main.
        """
        # Pause main track if it's playing
        with self._lock:
            if self._proc and self._proc.poll() is None:
                self._update_offset_locked()
                self._stop_reason = "interrupt"
                self._proc.terminate()
                self._proc = None
        # Start ad as a tracked priority process
        proc = self._start_ffplay(path, 0.0)
        with self._lock:
            self._priority_proc = proc
        try:
            proc.wait()
        finally:
            with self._lock:
                if getattr(self, "_priority_proc", None) is proc:
                    self._priority_proc = None

    def get_status(self) -> dict:
        """Return info about the current main track: path, playing flag, elapsed seconds.

        Also signals when a track has ended *naturally* (not via user stop/pause
        or priority interruption) via the "finished" flag.
        """
        with self._lock:
            # Detect natural end
            finished = False
            if self._proc and self._proc.poll() is not None:
                # Process ended; if no explicit stop reason, treat as natural end
                if self._stop_reason is None and self._current_file is not None:
                    finished = True
                # Clear state regardless
                self._proc = None
                self._current_file = None
                self._offset_sec = 0.0
                self._start_monotonic = None
                self._stop_reason = None

            elapsed = self._offset_sec
            if self._proc and self._proc.poll() is None and self._start_monotonic is not None:
                elapsed += time.monotonic() - self._start_monotonic

            return {
                "file": self._current_file,
                "is_playing": bool(self._proc and self._proc.poll() is None),
                "elapsed": elapsed,
                "finished": finished,
            }


# ---------------------------
# Scheduler state
# ---------------------------
# Scheduler state
# ---------------------------

class SchedulerState:
    def __init__(self) -> None:
        os.makedirs(UPLOAD_FOLDER, exist_ok=True)

        # Where to persist GUI settings between runs
        self.settings_path = os.path.join(
            os.path.dirname(__file__), "config", "gui_player_settings.json"
        )

        self.ad_file: str | None = None
        self.ad_interval_sec: int = 180

        self.prayer_file: str | None = None
        # List[str] of "HH:MM" times
        self.prayer_times: list[str] = []
        # Map time string -> last date run ("YYYY-MM-DD")
        self.prayer_last_run: dict[str, str] = {}

        # Controls the main user-selected track so we can interrupt
        # it for higher-priority prayer and then resume.
        self.main_player = MainTrackPlayer()
        self.main_title: str | None = None
        # History of main tracks that have been played (path, title)
        self.main_history: list[tuple[str, str]] = []
        # Index of the currently playing item in history (for auto-next)
        self.main_history_index: int | None = None

        # Last Search & Play results and the index of the currently playing
        # item within that result list. Used to auto-play the next track
        # from the same search without asking the user again.
        self.search_results: list[dict] = []
        self.search_index: int | None = None

        # Flag to indicate that a prayer is currently playing so that
        # advertisements do not interrupt or overlap it.
        self.in_prayer: bool = False

        self.running = True
        self.lock = threading.Lock()

        # Load any saved settings from disk
        self._load_from_disk()

    def _load_from_disk(self) -> None:
        """Load persisted settings (ad/prayer tracks and timings) if present."""
        if not os.path.exists(self.settings_path):
            return
        try:
            with open(self.settings_path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            # If the file is corrupt or unreadable, ignore it.
            return

        with self.lock:
            self.ad_file = data.get("ad_file") or None
            self.ad_interval_sec = int(data.get("ad_interval_sec", 180))

            self.prayer_file = data.get("prayer_file") or None
            self.prayer_times = list(data.get("prayer_times", []))

            # prayer_last_run is runtime-only; no need to persist between runs

            # If referenced files no longer exist, clear them
            if self.ad_file and not os.path.exists(self.ad_file):
                self.ad_file = None
            if self.prayer_file and not os.path.exists(self.prayer_file):
                self.prayer_file = None

    def save_to_disk(self) -> None:
        """Persist current settings so they survive app restarts."""
        os.makedirs(os.path.dirname(self.settings_path), exist_ok=True)
        with self.lock:
            data = {
                "ad_file": self.ad_file,
                "ad_interval_sec": self.ad_interval_sec,
                "prayer_file": self.prayer_file,
                "prayer_times": self.prayer_times,
            }
        try:
            with open(self.settings_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
        except Exception:
            # Persistence failure shouldn't crash the app; ignore errors.
            pass

    # Convenience helpers guarded by lock where needed


# ---------------------------
# Background worker threads
# ---------------------------

def ad_worker(state: SchedulerState, ui: "MainWindow") -> None:
    """Periodically play advertisement track at a fixed interval.

    Ensures that advertisements never overlap with prayer and only run
    when a main track is currently playing.
    """
    while state.running:
        time.sleep(1)
        with state.lock:
            ad_file = state.ad_file
            interval = state.ad_interval_sec
            in_prayer = state.in_prayer
        if not ad_file or interval <= 0 or in_prayer:
            continue
        # Sleep in 1-second chunks so we can react quickly to prayer starting
        slept = 0
        while state.running and slept < interval:
            time.sleep(1)
            slept += 1
            # If a prayer starts during the wait, abort this ad cycle
            with state.lock:
                if state.in_prayer or state.ad_file is None or state.ad_interval_sec <= 0:
                    slept = 0
                    break
        if not state.running:
            break
        # Re-check conditions right before starting the ad
        with state.lock:
            ad_file = state.ad_file
            in_prayer = state.in_prayer
            interval = state.ad_interval_sec
        if not ad_file or interval <= 0 or in_prayer:
            continue

        # Only play advertisement if a main track is currently playing
        main_status = state.main_player.get_status()
        if not main_status.get("is_playing"):
            continue

        if ad_file and os.path.exists(ad_file):
            ui.log(
                "Advertisement cycle: pausing main track for ad "
                f"({os.path.basename(ad_file)})"
            )
            # Play ad as a tracked priority process so it can be stopped by prayer
            try:
                state.main_player.play_ad_blocking(ad_file)
            finally:
                # Only resume main if not in prayer anymore
                with state.lock:
                    in_prayer_now = state.in_prayer
                if not in_prayer_now:
                    ui.log("Advertisement finished, resuming main track.")
                    state.main_player.resume()
                else:
                    ui.log("Advertisement interrupted by prayer; main track remains paused.")


def prayer_worker(state: SchedulerState, ui: "MainWindow") -> None:
    """Check every second and play prayer at configured times.

    When a prayer starts, the main track (if any) is interrupted and will
    resume automatically from the same position once the prayer finishes.
    """
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
                    ui.log(f"Prayer triggered at {t}: {os.path.basename(prayer_file)}")

                    # If an advertisement is currently playing, wait for it to finish
                    # so the ad always plays its full length before prayer starts.
                    while state.running:
                        with state.main_player._lock:
                            has_priority = hasattr(state.main_player, "_priority_proc") and \
                                state.main_player._priority_proc is not None and \
                                state.main_player._priority_proc.poll() is None
                        if not has_priority:
                            break
                        ui.log("Waiting for current advertisement to finish before starting prayer.")
                        time.sleep(1)

                    # Mark that a prayer is in progress so ads do not play
                    with state.lock:
                        state.prayer_last_run[t] = today
                        state.in_prayer = True
                    try:
                        # Pause main track explicitly so only prayer plays
                        ui.log("Pausing main track for prayer.")
                        state.main_player.pause()
                        # Play prayer track fully (blocking) without touching main state
                        ui.log("Starting prayer track.")
                        play_with_ffplay(prayer_file)
                        ui.log("Prayer track finished, attempting to resume main track (if it was playing before).")
                        state.main_player.resume()
                    finally:
                        # Allow ads again after prayer finishes
                        with state.lock:
                            state.in_prayer = False
                            ui.log("Prayer finished, advertisements allowed again.")


# ---------------------------
# Tkinter UI
# ---------------------------
# Tkinter UI
# ---------------------------

class MainWindow:
    def __init__(self, root: tk.Tk, state: SchedulerState) -> None:
        self.root = root
        self.state = state
        self.root.title("Headless Music Scheduler (Ad + Prayer)")

        # Try to set window icon from a local file if available
        # Place a suitable .ico or .png file at static/app_icon.ico or static/app_icon.png
        icon_path_ico = os.path.join(os.path.dirname(__file__), "static", "app_icon.ico")
        icon_path_png = os.path.join(os.path.dirname(__file__), "static", "app_icon.png")
        try:
            if os.path.exists(icon_path_ico):
                self.root.iconbitmap(icon_path_ico)
            elif os.path.exists(icon_path_png):
                icon_img = tk.PhotoImage(file=icon_path_png)
                self.root.iconphoto(True, icon_img)
                # Keep a reference so it is not garbage-collected
                self._icon_img = icon_img
        except Exception:
            # If icon loading fails, continue without crashing
            pass

        # Main layout: left side for controls, right side for log
        left_frame = tk.Frame(root)
        left_frame.pack(side="left", fill="both", expand=True)

        log_container = tk.Frame(root)
        log_container.pack(side="right", fill="both", padx=(5, 10), pady=10)

        # --- Logo at the top ---
        # Place your logo image (e.g. the Devi Jewellers banner) at static/logo.png
        logo_path = os.path.join(os.path.dirname(__file__), "static", "logo.png")
        self._logo_img = None
        if os.path.exists(logo_path):
            try:
                self._logo_img = tk.PhotoImage(file=logo_path)
                logo_label = tk.Label(left_frame, image=self._logo_img)
                # Center the logo at the top of the app UI
                logo_label.pack(anchor="n", pady=(10, 5))
            except Exception:
                # If logo fails to load, ignore and continue
                pass

        # --- Clock ---
        self.clock_label = tk.Label(left_frame, text="--:--:--", font=("TkDefaultFont", 12))
        self.clock_label.pack(anchor="ne", padx=10, pady=(5, 0))
        self._update_clock()

        # --- Search & play section ---
        search_frame = tk.LabelFrame(left_frame, text="Search & Play (YouTube via yt-dlp)", padx=10, pady=10)
        search_frame.pack(fill="both", padx=10, pady=5)

        self.search_var = tk.StringVar()
        entry_search = tk.Entry(search_frame, textvariable=self.search_var, width=40)
        entry_search.pack(side="top", padx=(0, 5), pady=(0, 5), fill="x", expand=True)
        btn_search = tk.Button(search_frame, text="Search", command=self.search_and_play)
        btn_search.pack(side="top", anchor="e")

        results_frame = tk.Frame(search_frame)
        results_frame.pack(fill="both", expand=True, pady=(5, 0))

        self.search_results_listbox = tk.Listbox(results_frame, height=6)
        self.search_results_listbox.pack(side="left", fill="both", expand=True)

        results_scroll = tk.Scrollbar(results_frame, orient="vertical", command=self.search_results_listbox.yview)
        results_scroll.pack(side="right", fill="y")
        self.search_results_listbox.configure(yscrollcommand=results_scroll.set)

        btn_play_selected = tk.Button(search_frame, text="Play Selected", command=self.play_selected_search_result)
        btn_play_selected.pack(side="bottom", anchor="e", pady=(5, 0))

        # --- Main track controls ---
        main_frame = tk.LabelFrame(left_frame, text="Main Track", padx=10, pady=10)
        main_frame.pack(fill="x", padx=10, pady=5)

        self.main_track_label = tk.Label(main_frame, text="No main track")
        self.main_track_label.pack(anchor="w")

        self.main_time_label = tk.Label(main_frame, text="Elapsed: 00:00")
        self.main_time_label.pack(anchor="w")

        controls_frame = tk.Frame(main_frame)
        controls_frame.pack(anchor="w", pady=5)

        btn_main_play = tk.Button(controls_frame, text="Play/Resume", command=self.main_play_resume)
        btn_main_play.pack(side="left", padx=(0, 5))

        btn_main_pause = tk.Button(controls_frame, text="Pause", command=self.main_pause)
        btn_main_pause.pack(side="left", padx=(0, 5))

        btn_main_stop = tk.Button(controls_frame, text="Stop", command=self.main_stop)
        btn_main_stop.pack(side="left", padx=(0, 5))

        # --- Advertisement section ---
        ad_frame = tk.LabelFrame(left_frame, text="Advertisement Settings", padx=10, pady=10)
        ad_frame.pack(fill="x", padx=10, pady=5)

        self.ad_label = tk.Label(ad_frame, text="No advertisement track selected")
        self.ad_label.pack(anchor="w")

        btn_ad_select = tk.Button(ad_frame, text="Select Advertisement Track", command=self.select_ad_track)
        btn_ad_select.pack(anchor="w", pady=5)

        btn_ad_clear = tk.Button(ad_frame, text="Delete Advertisement Track", command=self.clear_ad_track)
        btn_ad_clear.pack(anchor="w")

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
        prayer_frame = tk.LabelFrame(left_frame, text="Prayer Settings", padx=10, pady=10)
        prayer_frame.pack(fill="x", padx=10, pady=5)

        self.prayer_label = tk.Label(prayer_frame, text="No prayer track selected")
        self.prayer_label.pack(anchor="w")

        # Row with select/clear and add-time buttons so they remain visible
        prayer_btn_row = tk.Frame(prayer_frame)
        prayer_btn_row.pack(fill="x", pady=5)

        btn_prayer_select = tk.Button(prayer_btn_row, text="Select Prayer Track", command=self.select_prayer_track)
        btn_prayer_select.pack(side="left")

        btn_prayer_clear = tk.Button(prayer_btn_row, text="Delete Prayer Track", command=self.clear_prayer_track)
        btn_prayer_clear.pack(side="left", padx=(5, 5))

        btn_add_time = tk.Button(prayer_btn_row, text="Add Time", command=self.add_time)
        btn_add_time.pack(side="left")

        # List of configured prayer times with its own frame so it stays readable
        times_frame = tk.Frame(prayer_frame)
        times_frame.pack(fill="both", expand=True, pady=5)

        self.times_listbox = tk.Listbox(times_frame, height=5)
        self.times_listbox.pack(side="left", fill="both", expand=True)

        times_scroll = tk.Scrollbar(times_frame, orient="vertical", command=self.times_listbox.yview)
        times_scroll.pack(side="right", fill="y")
        self.times_listbox.configure(yscrollcommand=times_scroll.set)

        btns_frame = tk.Frame(prayer_frame)
        btns_frame.pack(anchor="w", pady=(0, 2))

        btn_remove_time = tk.Button(btns_frame, text="Remove Selected", command=self.remove_selected_time)
        btn_remove_time.pack(side="left")

        # --- Log/output on the right ---
        log_frame = tk.LabelFrame(log_container, text="Log", padx=10, pady=10)
        log_frame.pack(fill="both", expand=True)

        self.log_text = tk.Text(log_frame, height=20, state="disabled")
        self.log_text.pack(fill="both", expand=True)

        # Hook close event
        self.root.protocol("WM_DELETE_WINDOW", self.on_close)

        # Load any persisted settings into the UI (ad/prayer tracks & timings)
        self._load_state_into_ui()

        # Periodically update main track timing display
        self._update_main_track_ui()

    # ----- UI actions -----

    def _load_state_into_ui(self) -> None:
        """Populate labels, interval and times from persisted state."""
        with self.state.lock:
            ad_file = self.state.ad_file
            ad_interval_sec = self.state.ad_interval_sec
            prayer_file = self.state.prayer_file
            prayer_times = list(self.state.prayer_times)

        # Advertisement UI
        if ad_file:
            self.ad_label.config(text=f"Ad track: {os.path.basename(ad_file)}")
        else:
            self.ad_label.config(text="No advertisement track selected")
        self.ad_interval_var.set(str(ad_interval_sec))

        # Prayer UI
        if prayer_file:
            self.prayer_label.config(text=f"Prayer track: {os.path.basename(prayer_file)}")
        else:
            self.prayer_label.config(text="No prayer track selected")

        self.times_listbox.delete(0, "end")
        for t in prayer_times:
            self.times_listbox.insert("end", t)

    def _update_clock(self) -> None:
        now_str = datetime.now().strftime("%H:%M:%S")
        self.clock_label.config(text=now_str)
        self.root.after(1000, self._update_clock)

    def _update_main_track_ui(self) -> None:
        """Update main track label and elapsed time every second."""
        status = self.state.main_player.get_status()
        file_path = status.get("file")
        is_playing = status.get("is_playing")
        elapsed = status.get("elapsed", 0.0)
        finished = status.get("finished", False)

        if file_path:
            # Prefer stored title if available
            title = None
            with self.state.lock:
                title = self.state.main_title
            display_name = title or os.path.basename(file_path)
            state_str = "Playing" if is_playing else "Paused"
            self.main_track_label.config(text=f"Main track ({state_str}): {display_name}")
        else:
            self.main_track_label.config(text="No main track")

        minutes = int(elapsed) // 60
        seconds = int(elapsed) % 60
        self.main_time_label.config(text=f"Elapsed: {minutes:02d}:{seconds:02d}")

        # If the previous status indicated a natural end, auto-play the next
        # track from the same Search & Play result list (if available).
        if finished:
            self._play_next_from_search_results()

        self.root.after(1000, self._update_main_track_ui)

    def _play_next_from_search_results(self) -> None:
        """Play the next track from the last Search & Play result list.

        When a user picks a track from Search & Play, we remember the full
        result list and the index of the chosen track. When that track ends
        naturally, this method advances to the next item in that same list
        (if any) and plays it automatically.
        """
        with self.state.lock:
            if not self.state.search_results:
                return
            if self.state.search_index is None:
                return
            next_index = self.state.search_index + 1
            if next_index >= len(self.state.search_results):
                # Reached the end of this search result list.
                return
            track = self.state.search_results[next_index]
            self.state.search_index = next_index
        title = track.get("title", "(no title)")
        self.log(f"Auto-playing next track from Search & Play results: {title}")
        self.play_search_result(track)

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
            self.state.save_to_disk()
            self.ad_label.config(text=f"Ad track: {os.path.basename(dest)}")
            self.log(f"Advertisement track set: {dest}")
        except Exception as e:
            messagebox.showerror("Error", f"Failed to copy file: {e}")

    def clear_ad_track(self) -> None:
        """Delete the current advertisement track file and clear the setting."""
        with self.state.lock:
            ad_path = self.state.ad_file
            self.state.ad_file = None
        if ad_path and os.path.exists(ad_path):
            try:
                os.remove(ad_path)
                self.log(f"Deleted advertisement track: {ad_path}")
            except Exception as e:
                messagebox.showerror("Error", f"Failed to delete advertisement track: {e}")
                return
        self.state.save_to_disk()
        self.ad_label.config(text="No advertisement track selected")

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
        self.state.save_to_disk()
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
            self.state.save_to_disk()
            self.prayer_label.config(text=f"Prayer track: {os.path.basename(dest)}")
            self.log(f"Prayer track set: {dest}")
        except Exception as e:
            messagebox.showerror("Error", f"Failed to copy file: {e}")

    def clear_prayer_track(self) -> None:
        """Delete the current prayer track file and clear the setting."""
        with self.state.lock:
            prayer_path = self.state.prayer_file
            self.state.prayer_file = None
        if prayer_path and os.path.exists(prayer_path):
            try:
                os.remove(prayer_path)
                self.log(f"Deleted prayer track: {prayer_path}")
            except Exception as e:
                messagebox.showerror("Error", f"Failed to delete prayer track: {e}")
                return
        self.state.save_to_disk()
        self.prayer_label.config(text="No prayer track selected")

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
            self.state.save_to_disk()
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
        self.state.save_to_disk()
        self.log("Removed selected prayer time(s)")

    def on_close(self) -> None:
        # Signal threads to stop and then destroy window
        self.state.running = False
        # Stop main track process explicitly
        self.state.main_player.stop()
        self.root.after(200, self.root.destroy)

    def main_play_resume(self) -> None:
        """Resume the current main track if available."""
        self.state.main_player.resume()
        self.log("Main track resumed")

    def main_pause(self) -> None:
        """Pause the current main track."""
        self.state.main_player.pause()
        self.log("Main track paused")

    def main_stop(self) -> None:
        """Stop the current main track and clear it."""
        self.state.main_player.stop()
        with self.state.lock:
            self.state.main_title = None
        self.log("Main track stopped")

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

        # Store results and show them in the UI listbox
        with self.state.lock:
            self.state.search_results = results
            self.state.search_index = None

        self.search_results_listbox.delete(0, "end")
        for idx, item in enumerate(results):
            title = item.get("title", "(no title)")
            self.search_results_listbox.insert("end", f"{idx + 1}. {title}")

        if results:
            self.search_results_listbox.selection_set(0)
            self.search_results_listbox.activate(0)

        self.log(f"Found {len(results)} result(s). Select one and click 'Play Selected'.")

    def play_selected_search_result(self) -> None:
        sel = self.search_results_listbox.curselection()
        if not sel:
            messagebox.showinfo("Play", "Please select a result to play.")
            return
        index = sel[0]
        with self.state.lock:
            if not self.state.search_results or index >= len(self.state.search_results):
                messagebox.showerror("Error", "Selected result is no longer available.")
                return
            self.state.search_index = index
            track = self.state.search_results[index]
        self.play_search_result(track)

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

        self.log(f"Playing search result as main track: {title}")
        # Remember title and track in history for UI and auto-next
        with self.state.lock:
            self.state.main_title = title
            self.state.main_history.append((path, title))
            # Newly selected track becomes the current index
            self.state.main_history_index = len(self.state.main_history) - 1
        # Play as the main track controlled by SchedulerState.main_player
        threading.Thread(target=self.state.main_player.play_new, args=(path,), daemon=True).start()


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
