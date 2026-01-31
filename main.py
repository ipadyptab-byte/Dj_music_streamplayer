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
    """Download audio to a local file and return a local /api/uploads URL.

    This avoids the browser having to talk to googlevideo.com directly,
    which in your environment is returning 403. We let yt_dlp pick a
    good audio format (preferring m4a/mp4 when available) and store it
    under uploads/<id>.<ext>.
    """
    # Prefer m4a/mp4 audio when possible, then fall back to bestaudio.
    ydl_opts = {
        'format': 'bestaudio[ext=m4a]/bestaudio[ext=mp4]/bestaudio[acodec^=mp4a]/bestaudio',
        'quiet': True,
        'noplaylist': True,
        'outtmpl': os.path.join(UPLOAD_FOLDER, '%(id)s.%(ext)s'),
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(video_url, download=True)
    except Exception as e:
        print('yt_dlp download failed:', e, flush=True)
        return None

    if not info:
        print('yt_dlp returned no info after download', flush=True)
        return None

    video_id = info.get('id')
    ext = info.get('ext') or 'm4a'
    if not video_id:
        print('yt_dlp: missing video id after download', flush=True)
        return None

    filename = f"{video_id}.{ext}"
    file_path = os.path.join(UPLOAD_FOLDER, filename)

    if not os.path.exists(file_path):
        # In some cases yt_dlp may change ext; try to locate any file
        # starting with the video id in UPLOAD_FOLDER.
        for f in os.listdir(UPLOAD_FOLDER):
            if f.startswith(video_id + '.'):
                filename = f
                file_path = os.path.join(UPLOAD_FOLDER, filename)
                break

    if os.path.exists(file_path):
        local_url = f"/api/uploads/{filename}"
        print('Serving local audio file:', local_url, flush=True)
        return local_url

    print('Downloaded file not found in uploads folder for id', video_id, flush=True)
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
