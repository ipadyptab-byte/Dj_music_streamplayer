from flask import Flask, request, jsonify, send_from_directory
from werkzeug.utils import secure_filename
import os
import sys
import json

# Only import these for local development
if os.environ.get('VERCEL') != '1':
    import webbrowser
    from threading import Timer

# Conditional imports for serverless
try:
    import yt_dlp
except ImportError:
    yt_dlp = None

try:
    from supabase import create_client, Client
except ImportError:
    create_client = None
    Client = None

try:
    import pytube
except ImportError:
    pytube = None

# ===============================
# Supabase database setup
# ===============================
SUPABASE_URL = os.environ.get('NEXT_PUBLIC_SUPABASE_URL', 'https://pgzgyhhldijveoykszhz.supabase.co')
SUPABASE_KEY = os.environ.get('SUPABASE_SECRET_KEY', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBnemd5aGhsZGlqdmVveWtzemh6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTg3NjYxMCwiZXhwIjoyMDkxNDUyNjEwfQ.N-extU8G4pnGiD_m3wiFR1f4LHav1Brq_k-bgv0LYF0')

supabase_client = None

last_error = None

def get_supabase():
    global supabase_client, last_error
    if supabase_client is None:
        if not create_client:
            last_error = "supabase package not installed"
            return None
        if not SUPABASE_URL or not SUPABASE_KEY:
            last_error = "SUPABASE_URL or SUPABASE_KEY not set"
            return None
        try:
            supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)
        except Exception as e:
            last_error = f"{type(e).__name__}: {e}"
            return None
    return supabase_client

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

# Debug endpoint
@app.route('/api/debug')
def debug():
    get_supabase()  # Try to initialize
    return jsonify({
        'supabase_url': SUPABASE_URL[:30] + '...' if SUPABASE_URL else 'NOT SET',
        'supabase_key_set': bool(SUPABASE_KEY),
        'create_client_exists': create_client is not None,
        'supabase_client_exists': supabase_client is not None,
        'last_error': last_error
    })

# ===============================
# Auto-open browser
# ===============================
def open_browser():
    webbrowser.open("http://127.0.0.1:5000")

# ===============================
# Helper functions
# ===============================
def search_youtube(query):
    if yt_dlp is None:
        return []
    
    ydl_opts = {
        'format': 'bestaudio/best',
        'noplaylist': True,
        'quiet': True,
        'extract_flat': True,
        'no_warnings': True,
    }
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
                        'url': f"https://www.youtube.com/watch?v={video_id}",
                        'platform': 'YouTube'
                    })
            return results
        except Exception as e:
            print("YouTube search error:", e)
            return []

def search_soundcloud(query):
    """Search SoundCloud for tracks"""
    try:
        import urllib.parse
        url = f"https://api.soundcloud.com/tracks?q={urllib.parse.quote(query)}&limit=15"
        # SoundCloud API requires OAuth, so we'll try their web search instead
        # Use a workaround - search via oEmbed
        search_url = f"https://soundcloud.com/search?q={urllib.parse.quote(query)}"
        # We'll parse the search page
        with urllib.request.urlopen(search_url, timeout=10) as response:
            import re
            html = response.read().decode()
            # Extract track info from HTML
            results = []
            # Pattern to find track info
            pattern = r'href="/tracks/(\d+)"[^>]*>([^<]+)'
            matches = re.findall(pattern, html)
            for i, (track_id, title) in enumerate(matches[:15]):
                if title.strip():
                    results.append({
                        'id': f'sc_{track_id}',
                        'title': title.strip(),
                        'thumbnail': 'https://via.placeholder.com/60x60?text=SC',
                        'url': f"https://soundcloud.com/tracks/{track_id}",
                        'platform': 'SoundCloud'
                    })
            return results
    except Exception as e:
        print("SoundCloud search error:", e)
        return []

def search_jio_saavn(query):
    """Search JioSaavn for songs"""
    try:
        import urllib.parse
        # JioSaavn API endpoint
        url = f"https://www.jiosaavn.com/api.php?__call=search.getResults&p=1&n=15&q={urllib.parse.quote(query)}"
        with urllib.request.urlopen(url, timeout=10) as response:
            import json
            data = json.loads(response.read().decode())
            results = []
            if 'results' in data:
                for track in data['results']:
                    results.append({
                        'id': track.get('id', ''),
                        'title': track.get('title', ''),
                        'thumbnail': track.get('image', 'https://via.placeholder.com/60x60?text=Saavn'),
                        'url': track.get('perma_url', ''),
                        'platform': 'JioSaavn'
                    })
            return results
    except Exception as e:
        print("JioSaavn search error:", e)
        return []

def search_spotify(query):
    """Search Spotify for tracks - requires API key"""
    # Spotify requires OAuth, we'll show a message
    return []

def search_gaana(query):
    """Search Gaana for songs"""
    try:
        import urllib.parse
        url = f"https://gaana.com/search/{urllib.parse.quote(query)}"
        with urllib.request.urlopen(url, timeout=10) as response:
            import re
            html = response.read().decode()
            results = []
            # Extract song info - Gaana uses different patterns
            # This is a basic implementation
            pattern = r'title="([^"]+)"[^>]*href="/song/[^"]+'
            titles = re.findall(pattern, html)[:15]
            for i, title in enumerate(titles):
                results.append({
                    'id': f'gaana_{i}',
                    'title': title,
                    'thumbnail': 'https://via.placeholder.com/60x60?text=Gaana',
                    'url': f"https://gaana.com/search/{urllib.parse.quote(query)}",
                    'platform': 'Gaana'
                })
            return results
    except Exception as e:
        print("Gaana search error:", e)
        return []

def search_all_platforms(query):
    """Search all music platforms and combine results"""
    all_results = []
    seen_titles = set()
    
    # YouTube (only platform that works for streaming)
    yt_results = search_youtube(query)
    for track in yt_results:
        title_lower = track['title'].lower()
        if title_lower not in seen_titles:
            all_results.append(track)
            seen_titles.add(title_lower)
    
    # Return only YouTube results (other platforms require API keys)
    return all_results
import json
import urllib.request
import urllib.parse

def get_youtube_audio_url(video_id):
    """Get audio URL using Invidious API (no JS runtime needed)"""
    try:
        # Use public Invidious instance
        invidious_url = f"https://invidious.fdn.fr/api/v1/videos/{video_id}"
        with urllib.request.urlopen(invidious_url, timeout=10) as response:
            data = json.loads(response.read().decode())
            if 'adaptiveFormats' in data:
                # Find audio-only format
                for fmt in data['adaptiveFormats']:
                    if fmt.get('type', '').startswith('audio/') and 'url' in fmt:
                        return fmt['url']
            # Also check regular formats
            if 'formats' in data:
                for fmt in data['formats']:
                    if fmt.get('type', '').startswith('audio/') and 'url' in fmt:
                        return fmt['url']
    except Exception as e:
        print(f"Invidious API failed: {e}")
    return None

def get_audio_url(video_url):
    """Return YouTube audio-only embed URL for audio-only playback."""
    import re
    match = re.search(r'(?:v=|/v/|youtu\.be/)([a-zA-Z0-9_-]{11})', video_url)
    if not match:
        return None
    video_id = match.group(1)
    # Use YouTube embed - autoplay is controlled by JS, not in URL
    return f"https://www.youtube.com/embed/{video_id}?loop=1&controls=1&disablekb=1&modestbranding=1&showinfo=0"
# ===============================
# Routes
# ===============================
@app.route('/')
def index():
    return app.send_static_file('index.html')
@app.route('/api/search')
def search():
    query = request.args.get('q')
    return jsonify(search_all_platforms(query)) if query else jsonify([])
@app.route('/api/play')
def play():
    video_url = request.args.get('url')
    platform = request.args.get('platform', 'YouTube')
    
    if not video_url:
        print('/api/play: missing url parameter', flush=True)
        return jsonify({'error': 'No URL provided'}), 400
    
    # Skip placeholder URLs
    if video_url == '#':
        return jsonify({'error': 'Platform not supported yet. Please use YouTube or upload a local file.'}), 400
    
    # Handle different platforms
    if platform == 'YouTube' or 'youtube.com' in video_url or 'youtu.be' in video_url:
        print('/api/play: resolving', video_url, flush=True)
        audio_url = get_audio_url(video_url)
        print('/api/play: resolved audio_url:', audio_url, flush=True)
        if audio_url:
            return jsonify({'url': audio_url})
        else:
            return jsonify({'error': 'Failed to resolve YouTube audio URL'}), 500
    
    elif platform == 'JioSaavn' or 'jiosaavn.com' in video_url:
        # JioSaavn streaming - would need their API
        return jsonify({'error': 'JioSaavn streaming requires API key. Please use YouTube or upload local file.'}), 500
    
    elif platform == 'Gaana' or 'gaana.com' in video_url:
        return jsonify({'error': 'Gaana streaming requires API key. Please use YouTube or upload local file.'}), 500
    
    elif platform == 'Spotify' or 'spotify.com' in video_url:
        return jsonify({'error': 'Spotify streaming requires OAuth. Please use YouTube or upload local file.'}), 500
    
    else:
        return jsonify({'error': 'Unknown platform. Please use YouTube or upload local file.'}), 500
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
# Settings API (Supabase database)
# ===============================
@app.route('/api/settings/<key>', methods=['GET'])
def get_setting(key):
    """Get setting from database"""
    db = get_supabase()
    if not db:
        return jsonify({'error': 'Database not connected'}), 500
    try:
        result = db.table('settings').select('value').eq('key', key).execute()
        if result.data and len(result.data) > 0:
            return jsonify(result.data[0]['value'])
        return jsonify(None)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/settings/<key>', methods=['POST'])
def save_setting(key):
    """Save setting to database"""
    db = get_supabase()
    if not db:
        return jsonify({'error': 'Database not connected'}), 500
    try:
        value = request.json
        db.table('settings').upsert({'key': key, 'value': value}, on_conflict='key').execute()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/settings/<key>', methods=['DELETE'])
def delete_setting(key):
    """Delete setting from database"""
    db = get_supabase()
    if not db:
        return jsonify({'error': 'Database not connected'}), 500
    try:
        db.table('settings').delete().eq('key', key).execute()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ===============================
# Persistent Tracks API (stored in database)
# ===============================
@app.route('/api/tracks', methods=['GET'])
def get_tracks():
    """Get all saved tracks from database"""
    try:
        db = get_supabase()
        if not db:
            return jsonify({'error': 'Database not connected'}), 500
        result = db.table('settings').select('key, value').like('key', 'track_%').execute()
        tracks = {}
        for row in result.data:
            value = row['value']
            if isinstance(value, str):
                try:
                    value = json.loads(value)
                except:
                    pass
            tracks[row['key']] = value
        return jsonify(tracks)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/tracks/<track_type>', methods=['GET'])
def get_track(track_type):
    """Get a specific track (advt or prayer)"""
    try:
        db = get_supabase()
        if not db:
            return jsonify({'error': 'Database not connected'}), 500
        key = f'track_{track_type}'
        result = db.table('settings').select('value').eq('key', key).execute()
        if result.data and len(result.data) > 0:
            value = result.data[0]['value']
            # Parse if it's a JSON string
            if isinstance(value, str):
                try:
                    value = json.loads(value)
                except:
                    pass
            return jsonify(value)
        return jsonify(None)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/tracks/<track_type>', methods=['POST'])
def save_track(track_type):
    """Save a track (advt or prayer) to database"""
    try:
        db = get_supabase()
        if not db:
            return jsonify({'error': 'Database not connected. Please check Supabase configuration.'}), 500
        track_data = request.json
        key = f'track_{track_type}'
        # Store as JSON string
        value_json = json.dumps(track_data)
        db.table('settings').upsert({'key': key, 'value': value_json}, on_conflict='key').execute()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/tracks/<track_type>', methods=['DELETE'])
def delete_track(track_type):
    """Delete a track from database"""
    db = get_supabase()
    if not db:
        return jsonify({'error': 'Database not connected'}), 500
    try:
        key = f'track_{track_type}'
        db.table('settings').delete().eq('key', key).execute()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ===============================
# App start
# ===============================
# Vercel uses the app object directly, only run locally
if __name__ == '__main__':
    # Don't auto-open browser in production-like environments
    import os
    if os.environ.get('VERCEL') != '1':
        from threading import Timer
        Timer(1, open_browser).start()
    app.run(host='127.0.0.1', port=5000)

# For Vercel serverless
app.debug = False
