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
import sys

import tkinter as tk
from tkinter import filedialog, messagebox

from main import UPLOAD_FOLDER, search_all_platforms, get_audio_url


# ---------------------------
# Low-level audio playback
# ---------------------------

# Global volume level (shared by all tracks)
GLOBAL_VOLUME = 80.0  # Default volume (0-100)

def set_global_volume(volume: float) -> None:
    """Set global volume for all tracks."""
    global GLOBAL_VOLUME
    GLOBAL_VOLUME = max(0, min(100, volume))

def get_global_volume() -> float:
    """Get current global volume."""
    return GLOBAL_VOLUME


def play_with_ffplay(path: str) -> None:
    """Play an audio file using ffplay (part of ffmpeg).

    This is blocking, so it must be run in a background thread.
    Uses global volume for consistent audio across all tracks.
    """
    try:
        # On Windows, prevent a console window from popping up for ffplay.
        creationflags = 0
        if platform.system() == "Windows":
            creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        
        # Apply volume filter for consistent audio level
        vol_filter = f"volume={GLOBAL_VOLUME * 0.5}dB"
        
        subprocess.run([
            "ffplay",
            "-nodisp",
            "-autoexit",
            "-af", vol_filter,
            path,
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=creationflags)
    except FileNotFoundError:
        raise RuntimeError(
            "ffplay (from ffmpeg) is not installed or not on PATH.\n"
            "Please install ffmpeg and restart the application."
        )


class MainTrackPlayer:
    """Controls the main track so it can be interrupted and resumed.

    We keep track of the current file and how many seconds have already
    been played. When a higher‑priority track (prayer) needs to play,
    we stop the main track, remember the elapsed time and later resume
    it from that position using ffplay's -ss seek option.
    
    Volume control: All tracks (main, ad, prayer) use the same volume level
    for consistent audio experience.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._proc: subprocess.Popen | None = None
        self._current_file: str | None = None
        self._offset_sec: float = 0.0
        self._start_monotonic: float | None = None
        self._stop_reason: str | None = None
        # Volume level (0-100), same for all tracks
        self._volume: float = 80.0
    
    def set_volume(self, volume: float) -> None:
        """Set volume level (0-100) for all tracks."""
        self._volume = max(0, min(100, volume))
    
    def get_volume(self) -> float:
        """Get current volume level."""
        return self._volume

    def _start_ffplay(self, path: str, offset_sec: float, *, normalize: bool = True, use_volume: bool = True) -> subprocess.Popen:
        """Start ffplay with consistent volume for all tracks.

        By default we apply dynamic normalization (dynaudnorm) so tracks have
        similar loudness. For short advertisement jingles this filter has
        sometimes caused early termination with certain files, so ads can
        request normalize=False to play them as‑is.
        
        Volume is controlled via -af volume filter or -af volumedetect for consistent
        audio level across all track types.
        """
        cmd = [
            "ffplay",
            "-nodisp",
            "-autoexit",
        ]
        
        if normalize:
            cmd += [
                "-af",
                "dynaudnorm",  # dynamic audio normalization filter
            ]
        
        # Apply consistent volume for all tracks (main, ad, prayer)
        if use_volume:
            # Use volume filter to get consistent audio level
            vol_filter = f"volume={self._volume * 0.5}dB"  # Convert 0-100 to dB
            if normalize:
                # Append to existing filter
                cmd[-1] = cmd[-1] + f",{vol_filter}"
            else:
                cmd += ["-af", vol_filter]
        
        if offset_sec > 0:
            cmd += ["-ss", str(offset_sec)]
        cmd.append(path)
        # On Windows, prevent an extra console window from opening for ffplay.
        creationflags = 0
        if platform.system() == "Windows":
            creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        try:
            return subprocess.Popen(
                cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=creationflags,
            )
        except FileNotFoundError:
            raise RuntimeError("ffplay (from ffmpeg) is not installed or not on PATH.")

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
            # Main tracks keep normalization
            self._proc = self._start_ffplay(path, 0.0, normalize=True, use_volume=True)
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
        # Now start the priority track (ads play without normalization to avoid
        # any interaction between dynaudnorm and short jingle files)
        proc = self._start_ffplay(path, 0.0, normalize=False, use_volume=True)
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
                    self._proc = self._start_ffplay(main_to_resume, resume_offset, use_volume=True)
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
                self._proc = self._start_ffplay(self._current_file, self._offset_sec, use_volume=True)
                self._start_monotonic = time.monotonic()
                self._stop_reason = None

    def stop_priority(self) -> None:
        """Stop any currently playing higher-priority track (ad or prayer)."""
        with self._lock:
            if hasattr(self, "_priority_proc") and self._priority_proc and self._priority_proc.poll() is None:
                self._priority_proc.terminate()
            self._priority_proc = None

    def play_ad_blocking(self, path: str, expected_duration: float | None = None) -> None:
        """Play an advertisement, tracking its process so it can be stopped.

        Pauses the main track, plays the ad, and leaves main paused.
        The caller decides whether and when to resume main.

        Advertisements are now played exactly as they are uploaded,
        without any additional timing control beyond the natural
        lifetime of the ffplay process.
        """
        # Pause main track if it's playing
        with self._lock:
            if self._proc and self._proc.poll() is None:
                self._update_offset_locked()
                self._stop_reason = "interrupt"
                self._proc.terminate()
                self._proc = None
        # Start ad as a tracked priority process (no normalization)
        start_ts = time.monotonic()
        proc = self._start_ffplay(path, 0.0, normalize=False, use_volume=True)
        with self._lock:
            self._priority_proc = proc
        try:
            # Always just wait for the actual ad playback to finish.
            # We deliberately ignore expected_duration so the ad plays
            # with its natural length and timing.
            proc.wait()
        finally:
            total_elapsed = time.monotonic() - start_ts
            print(f"[DEBUG] Ad playback finished, elapsed ~{total_elapsed:.1f}s for file: {path}")
            # Ensure the ffplay process is not left running indefinitely
            if proc.poll() is None:
                try:
                    proc.terminate()
                except Exception:
                    pass
                try:
                    proc.wait(timeout=2)
                except Exception:
                    pass
            with self._lock:
                if getattr(self, "_priority_proc", None) is proc:
                    self._priority_proc = None

    def play_ad_timed(self, path: str, play_duration_sec: int) -> None:
        """Play an advertisement for the specified duration, then stop it.

        This is used for the repeat mode where the ad plays for a fixed time
        then repeats. The ad file is played but cut off after play_duration_sec.
        """
        # Pause main track if it's playing
        with self._lock:
            if self._proc and self._proc.poll() is None:
                self._update_offset_locked()
                self._stop_reason = "interrupt"
                self._proc.terminate()
                self._proc = None
        
        # Start ad as a tracked priority process (no normalization)
        start_ts = time.monotonic()
        proc = self._start_ffplay(path, 0.0, normalize=False, use_volume=True)
        with self._lock:
            self._priority_proc = proc
        
        try:
            # Wait for either the ad to finish OR the duration to elapse
            while proc.poll() is None:
                elapsed = time.monotonic() - start_ts
                if elapsed >= play_duration_sec:
                    # Time's up - stop the ad
                    break
                time.sleep(0.1)
        finally:
            # Ensure the ffplay process is stopped
            if proc.poll() is None:
                try:
                    proc.terminate()
                except Exception:
                    pass
                try:
                    proc.wait(timeout=2)
                except Exception:
                    pass
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

            # Check if ad is currently playing (priority process is running)
            is_ad_playing = bool(self._priority_proc and self._priority_proc.poll() is None)

            return {
                "file": self._current_file,
                "is_playing": bool(self._proc and self._proc.poll() is None),
                "elapsed": elapsed,
                "finished": finished,
                "is_ad_playing": is_ad_playing,
            }


# ---------------------------
# Scheduler state
# ---------------------------

class SchedulerState:
    def __init__(self) -> None:
        os.makedirs(UPLOAD_FOLDER, exist_ok=True)

        # Where to persist GUI settings between runs.
        #
        # When running as a PyInstaller EXE, __file__ points into a
        # temporary unpack directory that is recreated on each run, so
        # we resolve a stable base directory differently in that case
        # (next to the executable). For normal Python runs we keep the
        # existing behaviour of using the source directory.
        if getattr(sys, "frozen", False):
            base_dir = os.path.dirname(sys.executable)
        else:
            base_dir = os.path.dirname(os.path.abspath(__file__))

        config_dir = os.path.join(base_dir, "config")
        self.settings_path = os.path.join(config_dir, "gui_player_settings.json")

        self.ad_file: str | None = None
        self.ad_interval_sec: int = 180
        # Duration (seconds) of the current advertisement track, if known
        self.ad_duration_sec: float | None = None
        # How many seconds to play the ad track before repeating (until main track changes)
        self.ad_play_duration_sec: int = 30

        # Try to load settings from database on startup
        self._load_from_database()

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
        # item within that result list.
        self.search_results: list[dict] = []
        self.search_index: int | None = None

        # Random play without repeats: this is a "bag" of remaining indexes
        # to be played for the current search_results list. Once empty, we
        # refill it with a new shuffle.
        self.search_bag: list[int] = []
        self.search_last_index: int | None = None
        self.search_rounds_completed: int = 0

        # Flag to indicate that a prayer is currently playing so that
        # advertisements do not interrupt or overlap it.
        self.in_prayer: bool = False

        self.running = True
        self.lock = threading.Lock()

        # Load any saved settings from disk
        self._load_from_disk()

    def _load_from_database(self) -> None:
        """Load settings from database on startup (if available)."""
        # First try via API (works if Flask is running), else fallback to direct SQLite
        try:
            import urllib.request
            import urllib.parse
            
            # Call the Flask API to get settings
            req = urllib.request.Request('http://127.0.0.1:5000/api/settings')
            with urllib.request.urlopen(req, timeout=5) as response:
                if response.status == 200:
                    import json
                    data = json.loads(response.read().decode())
                    
                    tracks = data.get('tracks', {})
                    
                    # Load advertisement settings
                    if 'ad' in tracks:
                        ad_track = tracks['ad']
                        filepath = ad_track.get('filepath')
                        if filepath and os.path.exists(filepath):
                            self.ad_file = filepath
                        self.ad_duration_sec = ad_track.get('duration_sec')
                    
                    # Load prayer settings
                    if 'prayer' in tracks:
                        prayer_track = tracks['prayer']
                        filepath = prayer_track.get('filepath')
                        if filepath and os.path.exists(filepath):
                            self.prayer_file = filepath
                    
                    print(f"Loaded settings from database: ad_file={self.ad_file}, prayer_file={self.prayer_file}")
                    return  # Success via API
        except Exception as api_err:
            print(f"API load failed, trying direct SQLite: {api_err}")
        
        # Fallback: Direct SQLite load (for local without Flask)
        try:
            import sqlite3
            
            # Get DB path
            base_dir = os.path.dirname(os.path.abspath(__file__))
            if getattr(sys, "frozen", False):
                base_dir = os.path.dirname(sys.executable)
            db_path = os.path.join(base_dir, "player.db")
            
            if not os.path.exists(db_path):
                self._load_from_disk()
                return
            
            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()
            
            # Load ad track
            cursor.execute('SELECT filename, filepath, duration_sec FROM tracks WHERE track_type = ?', ('ad',))
            row = cursor.fetchone()
            if row:
                filepath = row[1]
                if filepath and os.path.exists(filepath):
                    self.ad_file = filepath
                    self.ad_duration_sec = row[2]
            
            # Load prayer track
            cursor.execute('SELECT filename, filepath, duration_sec FROM tracks WHERE track_type = ?', ('prayer',))
            row = cursor.fetchone()
            if row:
                filepath = row[1]
                if filepath and os.path.exists(filepath):
                    self.prayer_file = filepath
            
            conn.close()
            print(f"Loaded settings from local SQLite: ad_file={self.ad_file}, prayer_file={self.prayer_file}")
        except Exception as e:
            # If database is not available, just use local file
            print(f"Could not load from database (using local file): {e}")
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
            self.ad_duration_sec = float(data.get("ad_duration_sec")) if data.get("ad_duration_sec") is not None else None
            self.ad_play_duration_sec = int(data.get("ad_play_duration_sec", 30))

            self.prayer_file = data.get("prayer_file") or None
            self.prayer_times = list(data.get("prayer_times", []))

            # prayer_last_run is runtime-only; no need to persist between runs

            # If referenced files no longer exist, clear them
            if self.ad_file and not os.path.exists(self.ad_file):
                self.ad_file = None
            if self.prayer_file and not os.path.exists(self.prayer_file):
                self.prayer_file = None

    def save_to_disk(self) -> None:
        """Persist current settings to both local file AND database."""
        os.makedirs(os.path.dirname(self.settings_path), exist_ok=True)
        with self.lock:
            data = {
                "ad_file": self.ad_file,
                "ad_interval_sec": self.ad_interval_sec,
                "ad_duration_sec": self.ad_duration_sec,
                "ad_play_duration_sec": self.ad_play_duration_sec,
                "prayer_file": self.prayer_file,
                "prayer_times": self.prayer_times,
            }
        
        # Save to local file (always)
        try:
            with open(self.settings_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
        except Exception:
            # Persistence failure shouldn't crash the app; ignore errors.
            pass
        
        # Also try to save to database
        self._save_to_database()

    def _save_to_database(self) -> None:
        """Save settings to database (direct SQLite)."""
        # First try via API (works if Flask is running), else fallback to direct SQLite
        try:
            import urllib.request
            import urllib.parse
            import json
            
            settings_data = {
                "ad": {
                    "filename": os.path.basename(self.ad_file) if self.ad_file else None,
                    "filepath": self.ad_file,
                    "interval_sec": self.ad_interval_sec,
                    "play_duration_sec": self.ad_play_duration_sec
                },
                "prayer": {
                    "filename": os.path.basename(self.prayer_file) if self.prayer_file else None,
                    "filepath": self.prayer_file,
                    "times": list(self.prayer_times),
                    "duration_sec": None
                }
            }
            
            data = urllib.parse.urlencode(settings_data).encode()
            req = urllib.request.Request(
                'http://127.0.0.1:5000/api/settings',
                data=data,
                method='POST'
            )
            with urllib.request.urlopen(req, timeout=5) as response:
                print(f"Settings saved to database: {response.status}")
                return  # Success via API
        except Exception as api_err:
            print(f"API save failed, trying direct SQLite: {api_err}")
        
        # Fallback: Direct SQLite save (for local without Flask or GUI-only mode)
        try:
            import sqlite3
            
            # Get DB path
            base_dir = os.path.dirname(os.path.abspath(__file__))
            if getattr(sys, "frozen", False):
                base_dir = os.path.dirname(sys.executable)
            db_path = os.path.join(base_dir, "player.db")
            
            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()
            
            # Create tables if not exists
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS tracks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    track_type TEXT NOT NULL UNIQUE,
                    filename TEXT NOT NULL,
                    filepath TEXT,
                    duration_sec REAL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            # Save ad track
            if self.ad_file:
                cursor.execute('''
                    INSERT OR REPLACE INTO tracks (track_type, filename, filepath, duration_sec, updated_at)
                    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                ''', ('ad', os.path.basename(self.ad_file), self.ad_file, self.ad_play_duration_sec))
            
            # Save prayer track
            if self.prayer_file:
                cursor.execute('''
                    INSERT OR REPLACE INTO tracks (track_type, filename, filepath, duration_sec, updated_at)
                    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                ''', ('prayer', os.path.basename(self.prayer_file), self.prayer_file, None))
            
            conn.commit()
            conn.close()
            print("Settings saved to local SQLite")
        except Exception as e:
            print(f"Could not save to database: {e}")


# ---------------------------
# Background worker threads
# ---------------------------

def ad_worker(state: SchedulerState, ui: "MainWindow") -> None:
    """Periodically play advertisement track at a fixed interval.

    Plays ad for user-specified duration (ad_play_duration_sec), then repeats
    until main track changes or ends. When main track ends, picks another
    random track from history and plays it.
    Ensures that advertisements never overlap with prayer.
    
    IMPORTANT: Main track must already be playing before ad cycle starts.
    """
    # Track current main file to detect when it changes
    current_main_file = None
    # Track if we've already logged the waiting message
    waiting_logged = False
    # Track pending interval wait (seconds remaining)
    interval_pending = None
    
    while state.running:
        try:
            time.sleep(1)
            with state.lock:
                ad_file = state.ad_file
                interval = state.ad_interval_sec
                in_prayer = state.in_prayer
                ad_play_duration = state.ad_play_duration_sec
            
            if not ad_file or interval <= 0 or in_prayer:
                interval_pending = None
                continue
                
            # Check if main track is currently playing FIRST
            main_status = state.main_player.get_status()
            if not main_status.get("is_playing"):
                # No main track playing - just wait for main to start
                # Don't track any pending interval
                if not waiting_logged:
                    ui.log("Waiting for main track to start playing...")
                    waiting_logged = True
                interval_pending = None
                continue
            
            # Main track IS playing now
            waiting_logged = False
            
            # Handle interval timing
            if interval_pending is None:
                # First time main is playing (or after main was stopped)
                # Start fresh interval countdown
                interval_pending = interval
            
            # Countdown the interval
            interval_pending -= 1
            if interval_pending > 0:
                continue
            
            # Interval complete - now play ad!
            # Reset interval for next cycle
            interval_pending = None
            # Re-check conditions right before starting the ad
            with state.lock:
                ad_file = state.ad_file
                in_prayer = state.in_prayer
                interval = state.ad_interval_sec
                ad_play_duration = state.ad_play_duration_sec
            if not ad_file or interval <= 0 or in_prayer:
                continue

            # Only play advertisement if a main track is currently playing
            main_status = state.main_player.get_status()
            if not main_status.get("is_playing"):
                continue

            if ad_file and os.path.exists(ad_file):
                # Get current main file to track for changes
                current_main_file = main_status.get("file")
                ui.log(
                    f"Advertisement cycle: pausing main track for ad "
                    f"({os.path.basename(ad_file)}, {ad_play_duration}s per play)"
                )
                
                # Record ad start time for database
                ad_start_time = datetime.now().isoformat()
                
                # Play ad in repeat mode until main track ends or changes
                while state.running:
                    # Check if prayer started
                    with state.lock:
                        if state.in_prayer:
                            break
                    
                    # Check main track status
                    main_status = state.main_player.get_status()
                    
                    # If main track ended naturally, get another random track
                    if main_status.get("finished") or not main_status.get("is_playing"):
                        # Try to get another random track from history
                        with state.lock:
                            history = list(state.main_history)
                            history_index = state.main_history_index
                        
                        if history and len(history) > 1:
                            # Pick a random track different from current
                            import random
                            available_indices = [i for i in range(len(history)) if i != history_index]
                            if available_indices:
                                new_index = random.choice(available_indices)
                                new_path, new_title = history[new_index]
                                ui.log(f"Main track ended, auto-playing next: {new_title}")
                                with state.lock:
                                    state.main_history_index = new_index
                                # Play the new track
                                state.main_player.play_new(new_path)
                                with state.lock:
                                    state.main_title = new_title
                                current_main_file = new_path
                            else:
                                # No other tracks available, stop ad cycle
                                break
                        else:
                            # No history or only one track, stop ad cycle
                            break
                        
                        # After starting new track, continue ad cycle
                        main_status = state.main_player.get_status()
                        if not main_status.get("is_playing"):
                            break
                    
                    # Check if main track changed (user selected new track)
                    if current_main_file and main_status.get("file") != current_main_file:
                        current_main_file = main_status.get("file")
                        # Continue ad cycle with new main track
                    
                    # Play ad for the specified duration
                    ad_play_start = time.monotonic()
                    try:
                        # Use play_ad_timed to play ad for limited duration
                        state.main_player.play_ad_timed(ad_file, ad_play_duration)
                        ad_elapsed = time.monotonic() - ad_play_start
                    except Exception as e:
                        ui.log(f"Ad playback error: {e}")
                        ad_elapsed = 0
                        break
                    
                    # Save ad play event to database
                    try:
                        save_play_event_to_db(
                            "ad",
                            None,  # track_id
                            ad_start_time,
                            datetime.now().isoformat(),
                            ad_elapsed,
                            True
                        )
                    except Exception as db_err:
                        ui.log(f"Warning: Could not save ad play event to database: {db_err}")
                    
                    # If we reach here, ad finished its duration, loop to repeat
                    # Small delay between ad repeats
                    time.sleep(0.5)
                
                # Ad cycle ended (prayer started or main track stopped/changed)
                # Only resume main if not in prayer anymore
                with state.lock:
                    in_prayer_now = state.in_prayer
                if not in_prayer_now:
                    ui.log("Ad cycle ended, resuming main track.")
                    state.main_player.resume()
                else:
                    ui.log("Ad cycle interrupted by prayer; main track remains paused.")
        except Exception as e:
            ui.log(f"Error in ad worker: {e}")
            time.sleep(2)


def prayer_worker(state: SchedulerState, ui: "MainWindow") -> None:
    """Check every second and play prayer at configured times.

    When a prayer starts:
    - Wait for any running ad track to complete first (if ad is playing)
    - Then stop main track
    - Play prayer track
    
    After prayer ends:
    - Start main track first from history (or resume if was paused)
    - Then ad_worker will resume the normal ad scheduling
    
    IMPORTANT: If prayer is below 60 seconds, it still plays fully - ad must complete first.
    """
    while state.running:
        try:
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

                        # First, wait for advertisement to complete (if running)
                        ui.log("Checking for running advertisement...")
                        ad_completed = False
                        max_wait_time = 120  # Max wait 2 minutes for ad to finish
                        waited_sec = 0
                        
                        while waited_sec < max_wait_time and state.running:
                            main_status = state.main_player.get_status()
                            if not main_status.get("is_ad_playing"):
                                ad_completed = True
                                break
                            time.sleep(1)
                            waited_sec += 1
                        
                        if not ad_completed:
                            ui.log(f"Warning: Ad did not complete after {max_wait_time}s, proceeding anyway")
                        
                        if ad_completed:
                            ui.log("Advertisement completed, proceeding with prayer")

                        # STOP advertisement immediately after ad completes
                        ui.log("Stopping advertisement track for prayer.")
                        state.main_player.stop_priority()

                        # Mark that a prayer is in progress so new ads do not start
                        with state.lock:
                            state.prayer_last_run[t] = today
                            state.in_prayer = True
                        
                        # Store main track info for potential restart after prayer
                        main_was_playing = False
                        main_path_before = None
                        main_title_before = None
                        
                        # Get current main track info before pausing
                        main_status = state.main_player.get_status()
                        if main_status.get("is_playing"):
                            main_was_playing = True
                            main_path_before = main_status.get("file")
                            with state.lock:
                                if state.main_title:
                                    main_title_before = state.main_title
                        
                        # Record prayer start time for database
                        prayer_start_time = datetime.now().isoformat()
                        
                        try:
                            # Pause (stop) main track explicitly so only prayer plays
                            if main_was_playing:
                                ui.log("Pausing main track for prayer.")
                                state.main_player.pause()
                            
                            # Play prayer track fully (blocking) without touching main state
                            ui.log("Starting prayer track.")
                            prayer_elapsed = play_with_ffplay_timed(prayer_file)
                            prayer_duration = prayer_elapsed if prayer_elapsed else 0
                            
                            ui.log(f"Prayer track finished (duration: {prayer_duration:.1f}s)")
                        except Exception as e:
                            ui.log(f"Prayer playback error: {e}")
                            prayer_duration = 0
                        finally:
                            # Allow ads again after prayer finishes
                            with state.lock:
                                state.in_prayer = False
                            
                            # Save play event to database for prayer track
                            try:
                                save_play_event_to_db(
                                    "prayer", 
                                    None,  # track_id 
                                    prayer_start_time, 
                                    datetime.now().isoformat(), 
                                    prayer_duration, 
                                    True
                                )
                                ui.log("Prayer play event saved to database")
                            except Exception as db_err:
                                ui.log(f"Warning: Could not save prayer play event to database: {db_err}")
                            
                            ui.log("Prayer finished, restarting main track.")
                            
                            # START main track first (play from history or resume)
                            if main_was_playing and main_path_before:
                                # Try to resume from saved position
                                state.main_player.resume()
                                # If resume didn't work (track was cleared), play from history
                                status_after = state.main_player.get_status()
                                if not status_after.get("is_playing"):
                                    # Need to play from history
                                    with state.lock:
                                        history = list(state.main_history)
                                        history_index = state.main_history_index
                                    
                                    if history and history_index is not None and history_index < len(history):
                                        path, title = history[history_index]
                                        ui.log(f"Restarting main track: {title}")
                                        state.main_player.play_new(path)
                                    elif history:
                                        # Play first track in history
                                        path, title = history[0]
                                        ui.log(f"Restarting main track: {title}")
                                        state.main_player.play_new(path)
                                        with state.lock:
                                            state.main_history_index = 0
                            elif main_path_before:
                                # Main was stopped during prayer, play it again
                                with state.lock:
                                    history = list(state.main_history)
                                
                                if history:
                                    path, title = history[0]
                                    ui.log(f"Restarting main track: {title}")
                                    state.main_player.play_new(path)
                                    with state.lock:
                                        state.main_history_index = 0
                            else:
                                # No main track was playing, try to get from history
                                with state.lock:
                                    history = list(state.main_history)
                                
                                if history:
                                    path, title = history[0]
                                    ui.log(f"Starting main track: {title}")
                                    state.main_player.play_new(path)
                                    with state.lock:
                                        state.main_history_index = 0
                            
                            ui.log("Main track started, advertisements will resume on next cycle.")
        except Exception as e:
            ui.log(f"Error in prayer worker: {e}")
            time.sleep(2)


def play_with_ffplay_timed(path: str) -> float | None:
    """Play an audio file and return the elapsed time in seconds.
    
    Returns the actual duration played, or None if the file doesn't exist.
    Uses global volume for consistent audio across all tracks.
    """
    if not os.path.exists(path):
        return None
    
    start_time = time.monotonic()
    
    try:
        # On Windows, prevent a console window from popping up for ffplay.
        creationflags = 0
        if platform.system() == "Windows":
            creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        
        # Apply volume filter for consistent audio level
        vol_filter = f"volume={GLOBAL_VOLUME * 0.5}dB"
        
        subprocess.run([
            "ffplay",
            "-nodisp",
            "-autoexit",
            "-af", vol_filter,
            path,
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=creationflags)
        # Process finished naturally
        elapsed = time.monotonic() - start_time
        return elapsed
    except FileNotFoundError:
        raise RuntimeError(
            "ffplay (from ffmpeg) is not installed or not on PATH.\n"
            "Please install ffmpeg and restart the application."
        )


def save_play_event_to_db(track_type: str, track_id: int | None, started_at: str, ended_at: str, duration_sec: float, completed: bool) -> bool:
    """Save a play event to the database via API call"""
    try:
        import urllib.request
        import urllib.parse
        
        # Call the Flask API to save the event
        data = urllib.parse.urlencode({
            'track_type': track_type,
            'track_id': track_id if track_id else '',
            'started_at': started_at,
            'ended_at': ended_at,
            'duration_sec': duration_sec,
            'completed': 'true' if completed else 'false'
        }).encode()
        
        req = urllib.request.Request(
            'http://127.0.0.1:5000/api/play_events',
            data=data,
            method='POST'
        )
        with urllib.request.urlopen(req, timeout=5) as response:
            return response.status == 200
    except Exception as e:
        print(f"Failed to save play event to database: {e}")
        return False


# ---------------------------
# Tkinter UI
# ---------------------------

class MainWindow:
    def __init__(self, root: tk.Tk, state: SchedulerState) -> None:
        self.root = root
        self.state = state
        self._ui_thread_id = threading.get_ident()
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

        # --- Volume Control (shared for all tracks) ---
        volume_frame = tk.LabelFrame(left_frame, text="Volume Control", padx=10, pady=10)
        volume_frame.pack(fill="x", padx=10, pady=5)
        
        self.volume_var = tk.IntVar(value=int(GLOBAL_VOLUME))
        volume_scale = tk.Scale(volume_frame, from_=0, to=100, orient="horizontal",
                            variable=self.volume_var, label="Volume (%)",
                            command=self._on_volume_change)
        volume_scale.pack(fill="x", padx=10)
        self.volume_label = tk.Label(volume_frame, text=f"Volume: {int(GLOBAL_VOLUME)}%")
        self.volume_label.pack()

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

        self.search_rounds_label = tk.Label(search_frame, text="Rounds completed: 0")
        self.search_rounds_label.pack(side="bottom", anchor="w", pady=(5, 0))

        self.search_progress_label = tk.Label(search_frame, text="Tracks played: 0/0")
        self.search_progress_label.pack(side="bottom", anchor="w")

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

        # New: Ad play duration control
        duration_frame = tk.Frame(ad_frame)
        duration_frame.pack(anchor="w", pady=5)
        tk.Label(duration_frame, text="Play for").pack(side="left")
        self.ad_duration_var = tk.StringVar(value="30")
        dur_entry = tk.Entry(duration_frame, width=6, textvariable=self.ad_duration_var)
        dur_entry.pack(side="left", padx=5)
        tk.Label(duration_frame, text="seconds each time").pack(side="left")
        btn_apply_duration = tk.Button(ad_frame, text="Apply Ad Duration", command=self.apply_ad_duration)
        btn_apply_duration.pack(anchor="w")

        # --- Prayer section ---
        prayer_frame = tk.LabelFrame(left_frame, text="Prayer Settings", padx=10, pady=10)
        prayer_frame.pack(fill="x", padx=10, pady=5)

        self.prayer_label = tk.Label(prayer_frame, text="No prayer track selected")
        self.prayer_label.pack(anchor="w")

        # Row of prayer controls: select track, add time, remove time, clear track
        prayer_btn_row = tk.Frame(prayer_frame)
        prayer_btn_row.pack(anchor="w", pady=5, fill="x")

        btn_prayer_select = tk.Button(prayer_btn_row, text="Select Prayer Track", command=self.select_prayer_track)
        btn_prayer_select.pack(side="left", padx=(0, 5))

        btn_add_time = tk.Button(prayer_btn_row, text="Add Time", command=self.add_time)
        btn_add_time.pack(side="left", padx=(0, 5))

        btn_remove_time = tk.Button(prayer_btn_row, text="Remove Time", command=self.remove_selected_time)
        btn_remove_time.pack(side="left", padx=(0, 5))

        btn_prayer_clear = tk.Button(prayer_btn_row, text="Delete Prayer Track", command=self.clear_prayer_track)
        btn_prayer_clear.pack(side="left")

        times_frame = tk.Frame(prayer_frame)
        times_frame.pack(fill="x", pady=5)

        self.times_listbox = tk.Listbox(times_frame, height=5)
        self.times_listbox.pack(side="left", fill="x", expand=True)

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

    def _on_volume_change(self, value: str) -> None:
        """Handle volume slider change."""
        vol = int(value)
        set_global_volume(vol)
        self.volume_label.config(text=f"Volume: {vol}%")
        
        # Also update MainTrackPlayer volume
        self.state.main_player.set_volume(vol)

    def _load_state_into_ui(self) -> None:
        """Populate labels, interval, duration and times from persisted state."""
        # Also load volume
        self.volume_var.set(int(GLOBAL_VOLUME))
        self.volume_label.config(text=f"Volume: {int(GLOBAL_VOLUME)}%")
        
        with self.state.lock:
            ad_file = self.state.ad_file
            ad_interval_sec = self.state.ad_interval_sec
            ad_play_duration = self.state.ad_play_duration_sec
            prayer_file = self.state.prayer_file
            prayer_times = list(self.state.prayer_times)

        # Advertisement UI
        if ad_file:
            self.ad_label.config(text=f"Ad track: {os.path.basename(ad_file)}")
        else:
            self.ad_label.config(text="No advertisement track selected")
        self.ad_interval_var.set(str(ad_interval_sec))
        self.ad_duration_var.set(str(ad_play_duration))

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
        """Play a random next track from the last Search & Play result list.

        Requirement:
        - Random order
        - No repeats until all tracks have played
        - Then reshuffle and continue

        "Rounds completed" means: how many full cycles have finished where all
        results were played once (without repeats).
        """
        round_completed = False
        with self.state.lock:
            results = self.state.search_results
            if not results:
                return

            # Refill the bag when empty (new shuffle cycle).
            if not self.state.search_bag:
                # If we already played something, an empty bag means one full round finished.
                if self.state.search_last_index is not None:
                    self.state.search_rounds_completed += 1
                    round_completed = True

                self.state.search_bag = list(range(len(results)))
                random.shuffle(self.state.search_bag)

                # Avoid immediate repeat across cycles if possible.
                if (
                    self.state.search_last_index is not None
                    and len(self.state.search_bag) > 1
                    and self.state.search_bag[0] == self.state.search_last_index
                ):
                    self.state.search_bag.append(self.state.search_bag.pop(0))

            next_index = self.state.search_bag.pop(0)
            self.state.search_index = next_index
            self.state.search_last_index = next_index
            rounds = self.state.search_rounds_completed
            track = results[next_index]

        if round_completed:
            self.log(f"Round completed: {rounds}")

        total = len(results)
        played = total - len(self.state.search_bag)
        self._update_search_stats_ui(rounds=rounds, played=played, total=total)

        title = track.get("title", "(no title)")
        self.log(f"Auto-playing random track: {title}")
        self.play_search_result(track)

    def _append_log_line(self, msg: str) -> None:
        self.log_text.configure(state="normal")
        self.log_text.insert("end", f"[{datetime.now().strftime('%H:%M:%S')}] {msg}\n")
        self.log_text.see("end")
        self.log_text.configure(state="disabled")

    def _set_search_rounds_label(self, rounds: int) -> None:
        if hasattr(self, "search_rounds_label") and self.search_rounds_label.winfo_exists():
            self.search_rounds_label.config(text=f"Rounds completed: {rounds}")

    def _set_search_progress_label(self, played: int, total: int) -> None:
        if hasattr(self, "search_progress_label") and self.search_progress_label.winfo_exists():
            self.search_progress_label.config(text=f"Tracks played: {played}/{total}")

    def _update_search_stats_ui(self, *, rounds: int, played: int, total: int) -> None:
        if threading.get_ident() == self._ui_thread_id:
            self._set_search_rounds_label(rounds)
            self._set_search_progress_label(played, total)
        else:
            try:
                self.root.after(0, self._set_search_rounds_label, rounds)
                self.root.after(0, self._set_search_progress_label, played, total)
            except Exception:
                pass

    def log(self, msg: str) -> None:
        if not self.root.winfo_exists():
            return
        # Tkinter widgets must only be touched from the UI thread.
        if threading.get_ident() == self._ui_thread_id:
            self._append_log_line(msg)
        else:
            try:
                self.root.after(0, self._append_log_line, msg)
            except Exception:
                # If the app is shutting down, ignore log calls.
                pass

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

            # Probe duration using ffprobe so we know how long to keep main paused
            duration_sec: float | None = None
            try:
                import subprocess, json as _json
                cmd = [
                    "ffprobe",
                    "-v",
                    "error",
                    "-show_entries",
                    "format=duration",
                    "-of",
                    "json",
                    dest,
                ]
                result = subprocess.run(cmd, capture_output=True, text=True, check=False)
                if result.returncode == 0 and result.stdout:
                    info = _json.loads(result.stdout)
                    dur_str = info.get("format", {}).get("duration")
                    if dur_str is not None:
                        duration_sec = float(dur_str)
            except Exception:
                # If ffprobe is not available or fails, we simply won't enforce
                # a specific duration and will fall back to process lifetime.
                duration_sec = None

            with self.state.lock:
                self.state.ad_file = dest
                self.state.ad_duration_sec = duration_sec
            self.state.save_to_disk()
            self.ad_label.config(text=f"Ad track: {os.path.basename(dest)}")
            if duration_sec is not None:
                self.log(f"Advertisement track set: {dest} (duration ~{duration_sec:.1f}s)")
            else:
                self.log(f"Advertisement track set: {dest} (duration unknown)")
        except Exception as e:
            messagebox.showerror("Error", f"Failed to copy file: {e}")

    def clear_ad_track(self) -> None:
        """Delete the current advertisement track file and clear the setting."""
        with self.state.lock:
            ad_path = self.state.ad_file
            self.state.ad_file = None
            self.state.ad_duration_sec = None
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

    def apply_ad_duration(self) -> None:
        """Apply the ad play duration setting."""
        try:
            value = int(self.ad_duration_var.get())
            if value <= 0:
                raise ValueError
        except ValueError:
            messagebox.showerror("Invalid duration", "Please enter a positive integer number of seconds.")
            return
        with self.state.lock:
            self.state.ad_play_duration_sec = value
        self.state.save_to_disk()
        self.log(f"Advertisement play duration set to {value} seconds per play")

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

        self.log(f"Searching all platforms for: {query}")
        
        def _do_search() -> None:
            try:
                results = search_all_platforms(query)
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
            platform = item.get("platform", "YouTube")
            self.search_results_listbox.insert("end", f"{idx + 1}. [{platform}] {title}")

        if results:
            self.search_results_listbox.selection_set(0)
            self.search_results_listbox.activate(0)

        self.log(f"Found {len(results)} result(s). Select one and click 'Play Selected'.")
        self._update_search_stats_ui(rounds=0, played=0, total=len(results))

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
            # Mark this as current/last played.
            self.state.search_index = index
            self.state.search_last_index = index

            # Remove from the random bag so it won't repeat until the bag refills.
            try:
                self.state.search_bag.remove(index)
            except ValueError:
                pass

            rounds = self.state.search_rounds_completed
            total = len(self.state.search_results)
            played = total - len(self.state.search_bag)
            track = self.state.search_results[index]

        self._update_search_stats_ui(rounds=rounds, played=played, total=total)
        self.play_search_result(track)

    def play_search_result(self, track: dict) -> None:
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

        threading.Thread(target=_do_resolve, daemon=True).start()


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
