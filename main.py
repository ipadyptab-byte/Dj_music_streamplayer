from flask import Flask, request, jsonify, send_from_directory
from werkzeug.utils import secure_filename
import yt_dlp
import os
import sys
import webbrowser
from threading import Timer
import json
from urllib.parse import urlencode
from urllib.request import urlopen, Request

# ===============================
# PyInstaller-safe base directory
# ===============================
if getattr(sys, 'frozen', False):
    BASE_DIR = sys._MEIPASS
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))

STATIC_DIR = os.path.join(BASE_DIR, 'static')
UPLOAD_FOLDER = os.path.join(BASE_DIR, 'uploads')

os.makedirs(UPLOAD_FOLDER, exist_ok=True)

app = Flask(__name__, static_folder=STATIC_DIR, static_url_path='')
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 1024 * 1024 * 1024  # 1GB

# ===============================
# Auto-open browser
# ===============================
def open_browser():
    webbrowser.open("http://127.0.0.1:5000")

# ===============================
# Helper functions
# ===============================
def search_youtube(query):
    """Search YouTube via yt_dlp (kept as a fallback/source option)."""
    ydl_opts = {
        'format': 'bestaudio/best',
        'noplaylist': True,
        'quiet': True,
        'extract_flat': True,
        'no_warnings': True,
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        try:
            search_results = ydl.extract_info(f"ytsearch20:{query}", download=False)
            results = []
            if search_results and 'entries' in search_results:
                for entry in search_results['entries']:
                    if not entry:
                        continue
                    video_id = entry.get('id')
                    results.append({
                        'id': video_id,
                        'title': entry.get('title'),
                        'thumbnail': f"https://img.youtube.com/vi/{video_id}/mqdefault.jpg" if video_id else None,
                        'url': f"https://www.youtube.com/watch?v/{video_id}" if video_id else None,
                        'source': 'youtube',
                    })
            return results
        except Exception as e:
            print("search_youtube error:", e)
            return []


def search_soundcloud(query):
    """Search SoundCloud using yt_dlp's SoundCloud search (scsearch)."""
    ydl_opts = {
        'format': 'bestaudio/best',
        'noplaylist': True,
        'quiet': True,
        'extract_flat': True,
        'no_warnings': True,
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        try:
            search_results = ydl.extract_info(f"scsearch20:{query}", download=False)
            results = []
            if search_results and 'entries' in search_results:
                for entry in search_results['entries']:
                    if not entry:
                        continue
                    # SoundCloud search entries usually have a direct URL
                    url = entry.get('url')
                    # Try to pick a thumbnail if available, otherwise leave None
                    thumb = entry.get('thumbnail')
                    if not thumb:
                        thumbs = entry.get('thumbnails') or []
                        if thumbs:
                            # thumbnails can be list of dicts with 'url'
                            thumb = thumbs[0].get('url') or thumbs[-1].get('url')
                    results.append({
                        'id': entry.get('id'),
                        'title': entry.get('title'),
                        'thumbnail': thumb,
                        'url': url,
                        'source': 'soundcloud',
                    })
            return results
        except Exception as e:
            print("search_soundcloud error:", e)
            return []


def search_jiosaavn(query):
    """Search JioSaavn using an external API, if configured.

    To use this, set the environment variable JIOSAAVN_API_BASE to the base
    URL of a JioSaavn API service (for example, a self-hosted instance).

    The API is expected to expose something like `/api/search?query=...` and
    return JSON with a top-level `results` list of tracks containing at least
    `title`, `image`, and `perma_url`/`url` fields.
    """
    base = os.environ.get('JIOSAAVN_API_BASE')
    if not base:
        # No API configured – return empty so the frontend can still work.
        return []

    try:
        params = {'query': query}
        url = base.rstrip('/') + '/api/search?' + urlencode(params)
        req = Request(url, headers={'User-Agent': 'music-player/1.0'})
        with urlopen(req, timeout=5) as resp:
            data = json.load(resp)
    except Exception as e:
        print("search_jiosaavn error fetching API:", e)
        return []

    # Adapt to a generic structure: try some common patterns
    tracks = []
    try:
        raw_results = (
            data.get('results')
            or data.get('data')
            or data.get('songs')
            or []
        )
    except AttributeError:
        raw_results = []

    for entry in raw_results:
        if not isinstance(entry, dict):
            continue
        title = entry.get('title') or entry.get('song')
        if not title:
            continue
        thumb = (
            entry.get('image')
            or entry.get('thumbnail')
        )
        url = (
            entry.get('perma_url')
            or entry.get('url')
        )
        tracks.append({
            'id': entry.get('id') or entry.get('songid') or entry.get('id_str'),
            'title': title,
            'thumbnail': thumb,
            'url': url,
            'source': 'jiosaavn',
        })

    return tracks
def get_audio_url(video_url):
    """Download audio for the given YouTube video and return a local URL.

    This avoids the browser having to access googlevideo.com directly, which
    can be blocked in some networks. We download the best audio into the
    UPLOAD_FOLDER and serve it via /api/uploads/...
    """
    # Prefer Python yt_dlp library to download
    ydl_opts = {
        'format': 'bestaudio/best',
        'quiet': True,
        'noplaylist': True,
        'outtmpl': os.path.join(UPLOAD_FOLDER, '%(id)s.%(ext)s'),
    }
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(video_url, download=True)
            video_id = info.get('id')
            ext = info.get('ext', 'm4a')
            if video_id:
                filename = f"{video_id}.{ext}"
                local_url = f"/api/uploads/{filename}"
                return local_url
            else:
                print('yt_dlp: missing video id after download')
    except Exception as e:
        print('Python yt_dlp download failed:', e)

    # Fallback: try external yt-dlp / yt-dlp.exe if present
    try:
        import shutil, subprocess
        ytdlp_path = shutil.which('yt-dlp') or shutil.which('yt-dlp.exe')
        if not ytdlp_path:
            print('yt-dlp executable not found on PATH')
            return None

        # Download to our UPLOAD_FOLDER using yt-dlp CLI
        out_tmpl = os.path.join(UPLOAD_FOLDER, '%(id)s.%(ext)s')
        result = subprocess.run(
            [
                ytdlp_path,
                '-f', 'bestaudio/best',
                '-o', out_tmpl,
                video_url,
            ],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            print('yt-dlp executable download failed:', result.stderr)
            return None

        # At this point yt-dlp CLI has downloaded the file to UPLOAD_FOLDER,
        # but we don't know the exact name without extra probing.
        print('yt-dlp CLI download completed, but filename not resolved in code.')
        return None
    except Exception as e:
        print('yt-dlp executable fallback failed:', e)
        return None


# ===============================
# Routes
# ===============================
@app.route('/')
def index():
    return app.send_static_file('index.html')


@app.route('/api/search')
def search():
    query = request.args.get('q')
    source = request.args.get('source', 'soundcloud')  # default away from YouTube

    if not query:
        return jsonify([])

    if source == 'soundcloud':
        results = search_soundcloud(query)
    elif source == 'jiosaavn':
        results = search_jiosaavn(query)
    elif source == 'youtube':
        results = search_youtube(query)
    else:
        # Unknown source – try SoundCloud first, then YouTube as a fallback
        results = search_soundcloud(query) or search_youtube(query)

    return jsonify(results)


@app.route('/api/play')
def play():
    video_url = request.args.get('url')
    if not video_url:
        print('/api/play: missing url parameter', flush=True)
        return jsonify({'error': 'No URL provided'}), 400

    print('/api/play: resolving', video_url, flush=True)
    audio_url = get_audio_url(video_url)
    print('/api/play: resolved audio_url:', audio_url, flush=True)

    if audio_url:
        return jsonify({'url': audio_url})
    else:
        return jsonify({'error': 'Failed to resolve audio URL'}), 500


@app.route('/api/upload', methods=['POST'])
def api_upload_file():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
    filename = secure_filename(file.filename)
    save_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    file.save(save_path)
    return jsonify({'url': f'/api/uploads/{filename}', 'title': filename})


@app.route('/api/uploads/<filename>')
def api_uploaded_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)


@app.route('/api/files')
def list_files():
    files = os.listdir(app.config['UPLOAD_FOLDER'])
    return jsonify([{'title': f, 'url': f'/api/uploads/{f}'} for f in files])


@app.route('/api/delete', methods=['POST'])
def delete_file():
    filename = secure_filename(request.json.get('filename', ''))
    file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    if os.path.exists(file_path):
        os.remove(file_path)
        return jsonify({'success': True})
    return jsonify({'error': 'File not found'}), 404


# ===============================
# App start
# ===============================
if __name__ == '__main__':
    Timer(1, open_browser).start()
    app.run(host='127.0.0.1', port=5000)</old_code><new_code>@app.route('/api/search')
def search():
    query = request.args.get('q')
    source = request.args.get('source', 'soundcloud')  # default away from YouTube

    if not query:
        return jsonify([])

    if source == 'soundcloud':
        results = search_soundcloud(query)
    elif source == 'jiosaavn':
        results = search_jiosaavn(query)
    elif source == 'youtube':
        results = search_youtube(query)
    else:
        # Unknown source – try SoundCloud first, then YouTube as a fallback
        results = search_soundcloud(query) or search_youtube(query)

    return jsonify(results)
@app.route('/api/play')
def play():
    video_url = request.args.get('url')
    if not video_url:
        print('/api/play: missing url parameter', flush=True)
        return jsonify({'error': 'No URL provided'}), 400

    print('/api/play: resolving', video_url, flush=True)
    audio_url = get_audio_url(video_url)
    print('/api/play: resolved audio_url:', audio_url, flush=True)

    if audio_url:
        return jsonify({'url': audio_url})
    else:
        return jsonify({'error': 'Failed to resolve audio URL'}), 500
@app.route('/api/upload', methods=['POST'])
def api_upload_file():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
    filename = secure_filename(file.filename)
    save_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    file.save(save_path)
    return jsonify({'url': f'/api/uploads/{filename}', 'title': filename})
@app.route('/api/uploads/<filename>')
def api_uploaded_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)
@app.route('/api/files')
def list_files():
    files = os.listdir(app.config['UPLOAD_FOLDER'])
    return jsonify([{'title': f, 'url': f'/api/uploads/{f}'} for f in files])
@app.route('/api/delete', methods=['POST'])
def delete_file():
    filename = secure_filename(request.json.get('filename', ''))
    file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    if os.path.exists(file_path):
        os.remove(file_path)
        return jsonify({'success': True})
    return jsonify({'error': 'File not found'}), 404
# ===============================
# App start
# ===============================
if __name__ == '__main__':
    Timer(1, open_browser).start()
    app.run(host='127.0.0.1', port=5000)
