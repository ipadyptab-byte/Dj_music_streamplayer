from flask import Flask, request, jsonify, send_from_directory
from werkzeug.utils import secure_filename
import yt_dlp
import os
import sys
import webbrowser
from threading import Timer
import socket

# ===============================
# PyInstaller-safe base directory
# ===============================
if getattr(sys, 'frozen', False):
    # When packaged (PyInstaller), static files live in the temp
    # extraction directory, but user data (uploads) should live
    # next to the executable so it persists between runs.
    EXEC_DIR = os.path.dirname(sys.executable)
    BASE_DIR = sys._MEIPASS
else:
    EXEC_DIR = os.path.dirname(os.path.abspath(__file__))
    BASE_DIR = EXEC_DIR

STATIC_DIR = os.path.join(BASE_DIR, 'static')
UPLOAD_FOLDER = os.path.join(EXEC_DIR, 'uploads')

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


@app.route('/shutdown', methods=['POST'])
def shutdown():
    """Shutdown the Flask development server (used when browser window is closed)."""
    func = request.environ.get('werkzeug.server.shutdown')
    if func is None:
        return jsonify({'error': 'Not running with the Werkzeug Server'}), 500
    func()
    return jsonify({'success': True, 'message': 'Server shutting down...'})

def is_port_in_use(host="127.0.0.1", port=5000):
    """Return True if the port is already in use on the given host."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind((host, port))
            return False
        except OSError:
            return True


# ===============================
# App start
# ===============================
if __name__ == "__main__":
    host = "127.0.0.1"
    port = 5000

    # If another instance is already running, just open the browser and exit.
    if is_port_in_use(host, port):
        try:
            webbrowser.open(f"http://{host}:{port}")
        finally:
            sys.exit(0)

    Timer(1, open_browser).start()
    app.run(host=host, port=port)
