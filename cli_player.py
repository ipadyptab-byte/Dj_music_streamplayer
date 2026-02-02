import os
import sys
import subprocess
import platform

from main import search_youtube, get_audio_url, UPLOAD_FOLDER


def ensure_upload_folder() -> None:
    os.makedirs(UPLOAD_FOLDER, exist_ok=True)


def play_file_with_ffplay(path: str) -> None:
    """Play an audio file using ffplay (part of ffmpeg).

    This avoids the browser completely. The user must have ffmpeg/ffplay
    installed and available on PATH.
    """
    try:
        subprocess.run([
            "ffplay",
            "-nodisp",
            "-autoexit",
            path,
        ])
    except FileNotFoundError:
        print("ffplay (from ffmpeg) is not installed or not on PATH.")
        print("Please install ffmpeg, then run this script again.")


def choose_from_list(items):
    for idx, item in enumerate(items, start=1):
        print(f"{idx}. {item['title']}")
    while True:
        choice = input("Select number (or blank to cancel): ").strip()
        if not choice:
            return None
        if choice.isdigit() and 1 <= int(choice) <= len(items):
            return items[int(choice) - 1]
        print("Invalid choice.")


def play_youtube_search():
    query = input("Search YouTube: ").strip()
    if not query:
        return
    print("Searching YouTube...")
    results = search_youtube(query)
    if not results:
        print("No results.")
        return
    track = choose_from_list(results)
    if not track:
        return
    print(f"Resolving audio for: {track['title']}")
    audio_rel = get_audio_url(track["url"])
    if not audio_rel:
        print("Failed to resolve audio URL.")
        return
    audio_path = os.path.join(UPLOAD_FOLDER, os.path.basename(audio_rel))
    print(f"Playing: {track['title']}")
    play_file_with_ffplay(audio_path)


def play_direct_url():
    url = input("Enter media URL (YouTube / JioSaavn / SoundCloud / etc.): ").strip()
    if not url:
        return
    print("Downloading/resolving audio via yt-dlp...")
    audio_rel = get_audio_url(url)
    if not audio_rel:
        print("Failed to resolve audio URL.")
        return
    audio_path = os.path.join(UPLOAD_FOLDER, os.path.basename(audio_rel))
    print(f"Playing from: {url}")
    play_file_with_ffplay(audio_path)


def main():
    ensure_upload_folder()
    print("=== Headless Music Player ===")
    print("No browser UI is used. Playback is via ffplay (ffmpeg).")
    print("yt-dlp is used under the hood and supports many sites.")

    while True:
        print("\nMenu:")
        print("  1) Search YouTube and play")
        print("  2) Play from direct URL (JioSaavn / SoundCloud / YouTube / etc.)")
        print("  3) Quit")
        choice = input("Select option: ").strip()

        if choice == "1":
            play_youtube_search()
        elif choice == "2":
            play_direct_url()
        elif choice == "3":
            break
        else:
            print("Unknown option.")


if __name__ == "__main__":
    main()
