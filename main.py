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
INTERVAL_FOLDER = os.path.join(UPLOAD_FOLDER, 'interval')
SCHEDULE_FOLDER = os.path.join(UPLOAD_FOLDER, 'schedule')

os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(INTERVAL_FOLDER, exist_ok=True)
os.makedirs(SCHEDULE_FOLDER, exist_ok=True)

app = Flask(__name__, static_folder=STATIC_DIR, static_url_path='')
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
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

    upload_type = request.args.get('type', 'general')

    if upload_type == 'interval':
        folder = app.config['INTERVAL_FOLDER']
        url_prefix = '/api/uploads/interval'
    elif upload_type == 'schedule':
        folder = app.config['SCHEDULE_FOLDER']
        url_prefix = '/api/uploads/schedule'
    else:
        folder = app.config['UPLOAD_FOLDER']
        url_prefix = '/api/uploads'

    filename = secure_filename(file.filename)
    save_path = os.path.join(folder, filename)
    file.save(save_path)
    return jsonify({'url': f'{url_prefix}/{filename}', 'title': filename})


@app.route('/api/uploads/<filename>')
def uploaded_file(filename):
    # backward compatibility for old uploads (no type)
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)


@app.route('/api/uploads/<category>/<filename>')
def uploaded_file_typed(category, filename):
    if category == 'interval':
        folder = app.config['INTERVAL_FOLDER']
    elif category == 'schedule':
        folder = app.config['SCHEDULE_FOLDER']
    else:
        folder = app.config['UPLOAD_FOLDER']
    return send_from_directory(folder, filename)

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
    file_type = request.args.get('type', 'general')
    if file_type == 'interval':
        folder = app.config['INTERVAL_FOLDER']
        url_prefix = '/api/uploads/interval'
    elif file_type == 'schedule':
        folder = app.config['SCHEDULE_FOLDER']
        url_prefix = '/api/uploads/schedule'
    else:
        folder = app.config['UPLOAD_FOLDER']
        url_prefix = '/api/uploads'

    if not os.path.exists(folder):
        return jsonify([])

    files = os.listdir(folder)
    return jsonify([{'title': f, 'url': f'{url_prefix}/{f}'} for f in files])


@app.route('/api/delete', methods=['POST'])
def delete_file():
    data = request.json or {}
    filename = secure_filename(data.get('filename', ''))
    file_type = data.get('type', 'general')

    if not filename:
        return jsonify({'error': 'Filename required'}), 400

    if file_type == 'interval':
        folder = app.config['INTERVAL_FOLDER']
    elif file_type == 'schedule':
        folder = app.config['SCHEDULE_FOLDER']
    else:
        folder = app.config['UPLOAD_FOLDER']

    file_path = os.path.join(folder, filename)
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
