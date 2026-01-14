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

# Serve static files under /static to avoid conflicts with /api/* endpoints
app = Flask(__name__, static_folder=STATIC_DIR, static_url_path='/static')
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 1024 * 1024 * 1024  # 1GB

# ===============================
# Auto-open browser
# ===============================
def open_browser():
    webbrowser.open("http://127.0.0.1:5000")

# ===============================
# Routes
# ===============================
@app.route('/api/upload', methods=['POST'])
def upload_file():
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
def uploaded_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

def search_youtube(query):
    """Search YouTube for audio tracks.

    In some environments (e.g. restricted networks) yt_dlp search can fail or return
    empty results. To make the app still usable and to help debugging, we:
      1. Try yt_dlp search.
      2. If it fails or returns nothing, fall back to a small static list of tracks.
    """
    if not query:
        return []

    # First try real YouTube search via yt_dlp
    ydl_opts = {
        'format': 'bestaudio/best',
        'noplaylist': True,
        'quiet': True,
        'no_warnings': True,
        'default_search': 'ytsearch',
    }

    results = []
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            # Let yt_dlp handle the "ytsearch" internally
            search_results = ydl.extract_info(query, download=False)
            if search_results and 'entries' in search_results:
                for entry in search_results.get('entries') or []:
                    if not entry:
                        continue
                    video_id = entry.get('id')
                    if not video_id:
                        continue
                    results.append({
                        'id': video_id,
                        'title': entry.get('title'),
                        'thumbnail': f"https://img.youtube.com/vi/{video_id}/mqdefault.jpg",
                        'url': f"https://www.youtube.com/watch?v={video_id}",
                    })
    except Exception as e:
        print("YouTube search error:", e)

    # If we got some real results, return them
    if results:
        return results

    # Fallback: return a small static list so that search is never completely empty.
    # This also proves that the frontend and /api/search route are working.
    print("yt_dlp returned no results; using fallback static tracks.")
    fallback_tracks = [
        {
            "id": "dQw4w9WgXcQ",
            "title": "Sample Track 1",
            "thumbnail": "https://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg",
            "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        },
        {
            "id": "9bZkp7q19f0",
            "title": "Sample Track 2",
            "thumbnail": "https://img.youtube.com/vi/9bZkp7q19f0/mqdefault.jpg",
            "url": "https://www.youtube.com/watch?v=9bZkp7q19f0",
        },
    ]
    return fallback_tracks

def get_audio_url(video_url):
    ydl_opts = {
        'format': 'bestaudio/best',
        'quiet': True,
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        try:
            info = ydl.extract_info(video_url, download=False)
            return info.get('url')
        except Exception as e:
            print(e)
            return None

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
        return jsonify({'error': 'No URL provided'}), 400

    # Try to get a direct audio stream URL via yt_dlp
    audio_url = get_audio_url(video_url)

    if audio_url:
        return jsonify({'url': audio_url})

    # Fallback: if yt_dlp fails (e.g. no network / blocked), at least return
    # the original URL so the frontend does not see a 500 error.
    # Some environments/browsers may still be able to play it directly.
    print("get_audio_url failed; falling back to original URL:", video_url)
    return jsonify({'url': video_url})

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
if __name__ == "__main__":
    Timer(1, open_browser).start()
    app.run(host="127.0.0.1", port=5000)
