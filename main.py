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
                        'thumbnail': f"https://img.youtube.com/vi/{video_id}/mqdefault.jpg",
                        'url': f"https://www.youtube.com/watch?v={video_id}"
                    })
            return results
        except Exception as e:
            print("search_youtube error:", e)
            return []
def get_audio_url(video_url):
    """Resolve a direct audio stream URL for the given YouTube video.

    We ask yt_dlp for the available formats (without downloading) and
    return a browser-playable audio URL, preferring m4a/AAC where
    possible to avoid unsupported WebM/Opus issues in some browsers.
    """
    ydl_opts = {
        'quiet': True,
        'noplaylist': True,
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(video_url, download=False)
    except Exception as e:
        print('yt_dlp extract_info failed:', e, flush=True)
        return None

    # info for a single video may be nested under "entries"
    if info is None:
        print('yt_dlp returned no info', flush=True)
        return None
    if 'entries' in info and info['entries']:
        info = info['entries'][0]

    formats = info.get('formats') or []
    if not formats:
        print('No formats found in yt_dlp info', flush=True)
        return None

    # Prefer audio-only formats in common browser-friendly containers.
    preferred_exts = ['m4a', 'mp4', 'mp3', 'aac', 'ogg']

    def is_audio_only(f):
        return f.get('vcodec') in (None, 'none') and f.get('acodec') not in (None, 'none')

    audio_only = [f for f in formats if is_audio_only(f)]

    # Try to pick the best audio-only format with a preferred extension.
    for ext in preferred_exts:
        candidates = [f for f in audio_only if f.get('ext') == ext and f.get('url')]
        if candidates:
            # Let yt_dlp's sorting decide quality; pick the last (usually best)
            chosen = candidates[-1]
            print('Selected audio format:', chosen.get('format_id'), chosen.get('ext'), flush=True)
            return chosen.get('url')

    # Fallback: any audio-only format with a URL.
    for f in audio_only:
        if f.get('url'):
            print('Fallback audio format:', f.get('format_id'), f.get('ext'), flush=True)
            return f.get('url')

    print('No usable audio URL found in formats list', flush=True)
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
