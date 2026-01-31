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
            print(e)
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
        import shutil, subprocess, tempfile
        ytdlp_path = shutil.which('yt-dlp') or shutil.which('yt-dlp.exe')
        if not ytdlp_path:
            print('yt-dlp executable not found on PATH')
            return None

        # Download to our UPLOAD_FOLDER using yt-dlp CLI
        # -f bestaudio/best, -o "<upload_folder>/%(id)s.%(ext)s"
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

        # We don't know exact ext from CLI output easily, so re-probe with
        # --get-id and --get-filename could be added; for simplicity assume
        # Python path succeeded before, otherwise no fallback filename.
        # As a basic fallback, we won't try to guess the filename here.
        print('yt-dlp executable ran successfully, but filename unknown; please consider using Python yt_dlp')
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
    app.run(host='127.0.0.1', port=5000)lask import Flask, request, jsonify, send_from_directory
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
    """Return a direct audio URL for the given YouTube video.

    Tries the Python yt_dlp library first, then (optionally) falls back to a
    local yt-dlp / yt-dlp.exe binary if available. This is useful on systems
    where the Python package is broken but a working executable exists.
    """
    # First try the Python library
    ydl_opts = {
        # Prefer m4a when available, then bestaudio
        'format': 'bestaudio[ext=m4a]/bestaudio/best',
        'quiet': True,
        'noplaylist': True,
    }
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(video_url, download=False)
            direct_url = info.get('url')

            # Newer YouTube responses (esp. with SABR) sometimes do not fill
            # info['url'], but provide URLs in the formats list only.
            if not direct_url:
                formats = info.get('formats') or []
                audio_best = None
                for f in formats:
                    # Prefer pure-audio formats with a valid direct URL
                    if f.get('vcodec') == 'none' and f.get('acodec') != 'none' and f.get('url'):
                        audio_best = f
                        break
                if audio_best:
                    direct_url = audio_best.get('url')

            if direct_url:
                return direct_url
            else:
                print('Python yt_dlp: no direct_url found in info or formats')
    except Exception as e:
        print("Python yt_dlp failed:", e)

    # Fallback: try external yt-dlp / yt-dlp.exe if present
    try:
        import shutil, subprocess
        ytdlp_path = shutil.which('yt-dlp') or shutil.which('yt-dlp.exe')
        if not ytdlp_path:
            print('yt-dlp executable not found on PATH')
            return None

        # -g / --get-url prints the direct media URL to stdout
        result = subprocess.run(
            [ytdlp_path, '-f', 'bestaudio[ext=m4a]/bestaudio/best', '-g', video_url],
            capture_output=True,
            text=True,
            check=True,
        )
        output = (result.stdout or '').strip().splitlines()
        if output:
            return output[0].strip() or None
        print('yt-dlp executable returned no URLs')
        return None
    except Exception as e:
        print('yt-dlp executable fallback failed:', e)
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
        print("/api/play: missing url parameter", flush=True)
        return jsonify({'error': 'No URL provided'}), 400

    print("/api/play: resolving", video_url, flush=True)
    audio_url = get_audio_url(video_url)
    print("/api/play: resolved audio_url:", audio_url, flush=True)

    if audio_url:
        return jsonify({'url': audio_url})
    else:
        return jsonify({'error': 'Failed to resolve audio URL'}), 500

</newCode>)
def index():
    return app.send_static_file('index.html')

@app.route('/api/search')
def search():
    query = request.args.get('q')
    return jsonify(search_youtube(query)) if que</old_code><new_code>@app.route('/api/play')
def play():
    video_url = request.args.get('url')
    if not video_url:
        print("/api/play: missing url parameter", flush=True)
        return jsonify({'error': 'No URL provided'}), 400

    print("/api/play: resolving", video_url, flush=True)
    audio_url = get_audio_url(video_url)
    print("/api/play: resolved audio_url:", audio_url, flush=True)

    if audio_url:
        return jsonify({'url': audio_url})
    else:
        return jsonify({'error': 'Failed to resolve audio URL'}), 500lay')
def play():
    video_url = request.args.get('url')
    if not video_url:
        print("/api/play: missing url parameter", flush=True)
        return jsonify({'error': 'No URL provided'}), 400

    print("/api/play: resolving", video_url, flush=True)
    audio_url = get_audio_url(video_url)
    print("/api/play: resolved audio_url:", audio_url, flush=True)

    if audio_url:
        return jsonify({'00

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
