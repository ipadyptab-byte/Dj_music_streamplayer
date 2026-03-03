from flask import Flask, request, jsonify, send_from_directory
from werkzeug.utils import secure_filename
import yt_dlp
import os
import sys
import webbrowser
from threading import Timer

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
    ydl_opts = {
        'format': 'bestaudio/best',
        'noplaylist': True,
        'quiet': True,
        'extract_flat': True,
        'no_warnings': True,
    }
    # Request at least 30 search results (YouTube search is limited by yt_dlp;
    # if fewer are available, you'll simply get as many as YouTube returns).
    max_results = 30
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        try:
            search_results = ydl.extract_info(f"ytsearch{max_results}:{query}", download=False)
            results = []
            if search_results and 'entries' in search_results:
                for entry in search_results['entries']:
                    if not entry:
                        continue
                    video_id = entry.get('id')
                    results.append({
                        'id': video_id,
                        'title': entry.get('title'),
                        'thumbnail': f"https://img.youtube.com/vi/{video_id}/mqdefault.jpg",
                        'url': f"https://www.youtube.com/watch?v={video_id}"
                    })
            return results
        except Exception as e:
            print("search_youtube error:", e)
            return []
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

    def _resolve_downloaded_basename(video_id: str | None) -> str | None:
        if not video_id:
            return None
        # Try to find an on-disk file matching <id>.* (newest wins).
        try:
            candidates = [
                os.path.join(UPLOAD_FOLDER, f)
                for f in os.listdir(UPLOAD_FOLDER)
                if f.startswith(f"{video_id}.")
            ]
            candidates = [p for p in candidates if os.path.isfile(p)]
            if not candidates:
                return None
            candidates.sort(key=lambda p: os.path.getmtime(p), reverse=True)
            return os.path.basename(candidates[0])
        except Exception:
            return None

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(video_url, download=True)

            # yt-dlp can yield the final output path in different places.
            # Prefer the post-download filepath if present.
            video_id = info.get('id')
            filepath = None
            if isinstance(info.get('requested_downloads'), list) and info['requested_downloads']:
                filepath = info['requested_downloads'][0].get('filepath')

            if filepath and os.path.exists(filepath):
                return f"/api/uploads/{os.path.basename(filepath)}"

            basename = _resolve_downloaded_basename(video_id)
            if basename:
                return f"/api/uploads/{basename}"

            print('yt_dlp: download succeeded but output file could not be resolved')
    except Exception as e:
        print('Python yt_dlp download failed:', e)

    # Fallback: try external yt-dlp / yt-dlp.exe if present
    try:
        import shutil, subprocess
        ytdlp_path = shutil.which('yt-dlp') or shutil.which('yt-dlp.exe')
        if not ytdlp_path:
            print('yt-dlp executable not found on PATH')
            return None

        # Use yt-dlp's printing to reliably capture the final filepath.
        out_tmpl = os.path.join(UPLOAD_FOLDER, '%(id)s.%(ext)s')
        result = subprocess.run(
            [
                ytdlp_path,
                '-f', 'bestaudio/best',
                '--no-playlist',
                '--print', 'after_move:filepath',
                '-o', out_tmpl,
                video_url,
            ],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            print('yt-dlp executable download failed:', result.stderr)
            return None

        downloaded_path = (result.stdout or '').strip().splitlines()[-1] if (result.stdout or '').strip() else ''
        if downloaded_path and os.path.exists(downloaded_path):
            return f"/api/uploads/{os.path.basename(downloaded_path)}"

        print('yt-dlp CLI download completed, but output file could not be resolved')
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
    return jsonify(search_youtube(query)) if query else jsonify([])
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
