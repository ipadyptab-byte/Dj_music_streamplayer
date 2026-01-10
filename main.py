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
UPLOAD_ROOT = os.path.join(BASE_DIR, 'uploads')
INTERVAL_FOLDER = os.path.join(UPLOAD_ROOT, 'interval')
SCHEDULE_FOLDER = os.path.join(UPLOAD_ROOT, 'schedule')

os.makedirs(INTERVAL_FOLDER, exist_ok=True)
os.makedirs(SCHEDULE_FOLDER, exist_ok=True)

app = Flask(__name__, static_folder=STATIC_DIR, static_url_path='')
app.config['UPLOAD_ROOT'] = UPLOAD_ROOT
app.config['INTERVAL_FOLDER'] = INTERVAL_FOLDER
app.config['SCHEDULE_FOLDER'] = SCHEDULE_FOLDER
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

    upload_type = request.args.get('type', 'common')
    filename = secure_filename(file.filename)

    if upload_type == 'interval':
        folder = app.config['INTERVAL_FOLDER']
        url = f'/api/uploads/interval/{filename}'
    elif upload_type == 'schedule':
        folder = app.config['SCHEDULE_FOLDER']
        url = f'/api/uploads/schedule/{filename}'
    else:
        # Default: store under uploads root without subfolder
        folder = app.config['UPLOAD_ROOT']
        url = f'/api/uploads/{filename}'

    os.makedirs(folder, exist_ok=True)
    save_path = os.path.join(folder, filename)
    file.save(save_path)

    return jsonify({'url': url, 'title': filename})


@app.route('/api/uploads/<path:subpath>')
def uploaded_file(subpath):
    parts = subpath.split('/')
    if len(parts) == 2:
        folder_key, filename = parts
        if folder_key == 'interval':
            directory = app.config['INTERVAL_FOLDER']
        elif folder_key == 'schedule':
            directory = app.config['SCHEDULE_FOLDER']
        else:
            directory = app.config['UPLOAD_ROOT']
            filename = subpath
    else:
        directory = app.config['UPLOAD_ROOT']
        filename = subpath

    return send_from_directory(directory, filename)

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
            print(e)
            return []

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
    audio_url = get_audio_url(video_url)
    return jsonify({'url': audio_url}) if audio_url else jsonify({'error': 'Failed'}), 500

@app.route('/api/files')
def list_files():
    list_type = request.args.get('type')
    files = []

    if list_type == 'interval':
        folder = app.config['INTERVAL_FOLDER']
        if os.path.isdir(folder):
            files = [{'title': f, 'url': f'/api/uploads/interval/{f}'} for f in os.listdir(folder)]
    elif list_type == 'schedule':
        folder = app.config['SCHEDULE_FOLDER']
        if os.path.isdir(folder):
            files = [{'title': f, 'url': f'/api/uploads/schedule/{f}'} for f in os.listdir(folder)]
    else:
        # Default: aggregate all
        all_files = []
        for folder, prefix in [
            (app.config['INTERVAL_FOLDER'], 'interval'),
            (app.config['SCHEDULE_FOLDER'], 'schedule'),
            (app.config['UPLOAD_ROOT'], '')
        ]:
            if os.path.isdir(folder):
                for f in os.listdir(folder):
                    url = f'/api/uploads/{prefix}/{f}' if prefix else f'/api/uploads/{f}'
                    all_files.append({'title': f, 'url': url})
        files = all_files

    return jsonify(files)


@app.route('/api/delete', methods=['POST'])
def delete_file():
    filename = secure_filename(request.json.get('filename', ''))
    delete_type = request.json.get('type')

    folders = []
    if delete_type == 'interval':
        folders = [app.config['INTERVAL_FOLDER']]
    elif delete_type == 'schedule':
        folders = [app.config['SCHEDULE_FOLDER']]
    else:
        folders = [app.config['INTERVAL_FOLDER'], app.config['SCHEDULE_FOLDER'], app.config['UPLOAD_ROOT']]

    deleted = False
    for folder in folders:
        file_path = os.path.join(folder, filename)
        if os.path.exists(file_path):
            os.remove(file_path)
            deleted = True

    if deleted:
        return jsonify({'success': True})
    return jsonify({'error': 'File not found'}), 404

# ===============================
# App start
# ===============================
if __name__ == "__main__":
    Timer(1, open_browser).start()
    app.run(host="127.0.0.1", port=5000)
