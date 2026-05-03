from flask import Flask, request, jsonify, send_from_directory
from werkzeug.utils import secure_filename
import yt_dlp
import os
import sys
import webbrowser
from threading import Timer
try:
    import pytube
except ImportError:
    pytube = None

# Debug: Print environment on startup
print("FLASK_ENV:", os.environ.get('FLASK_ENV'))
print("VERCEL:", os.environ.get('VERCEL'))
print("DATABASE_URL:", os.environ.get('DATABASE_URL', '')[:20] if os.environ.get('DATABASE_URL') else 'not set')

# ===============================
# Database support for Vercel
# ===============================
import sqlite3
import json as json_lib

# Database path - use local file for SQLite
DB_PATH = None  # Will be set lazily

def _get_db_path():
    """Get DB path."""
    global DB_PATH
    if DB_PATH is None:
        db_url = os.environ.get('DATABASE_URL', '')
        if db_url.startswith('postgres'):
            DB_PATH = db_url
        else:
            DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'player.db')
    return DB_PATH

def get_db_connection():
    """Get a database connection using Supabase Postgres."""
    db_url = os.environ.get('DATABASE_URL') or os.environ.get('POSTGRES_URL') or os.environ.get('POSTGRES_URL_NON_POOLING', '')
    
    if db_url and db_url.startswith('postgres'):
        try:
            import psycopg2
            return psycopg2.connect(db_url)
        except ImportError as e:
            print(f"psycopg2 error: {e}")
        except Exception as e:
            print(f"DB connection error: {e}")
    
    # Fallback to local SQLite
    try:
        db_path = _get_db_path()
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        return conn
    except Exception as e:
        print(f"SQLite connection error: {e}")
        return None

# ===============================
# Supabase REST API for track storage
# ===============================
import urllib.request
import urllib.parse
import json

def get_supabase_url():
    """Get Supabase REST URL."""
    return os.environ.get('NEXT_PUBLIC_SUPABASE_URL') or os.environ.get('SUPABASE_URL', '')

def get_supabase_key():
    """Get Supabase anon key."""
    return os.environ.get('NEXT_PUBLIC_SUPABASE_ANON_KEY') or os.environ.get('SUPABASE_ANON_KEY', '')

def save_track_to_supabase(track_type: str, filename: str, filepath: str = '', duration_sec: int = 0):
    """Save track info via Supabase REST API."""
    try:
        supabase_url = get_supabase_url()
        supabase_key = get_supabase_key()
        
        if not supabase_url or not supabase_key:
            print("No Supabase URL or key")
            return False
        
        url = f"{supabase_url}/rest/v1/tracks"
        
        # Use PUT for upsert with track_type as unique constraint
        data = json.dumps({
            "track_type": track_type,
            "filename": filename,
            "filepath": filepath,
            "duration_sec": duration_sec
        }).encode()
        
        req = urllib.request.Request(url, data=data, headers={
            'Content-Type': 'application/json',
            'apikey': supabase_key,
            'Authorization': f'Bearer {supabase_key}',
            'Prefer': 'return=minimal,resolution=merge-duplicates'
        }, method='POST')
        
        with urllib.request.urlopen(req) as resp:
            status = resp.getcode()
            print(f"Supabase save status: {status}")
            return status in (200, 201)
    except urllib.error.HTTPError as e:
        print(f"HTTP Error: {e.code} - {e.reason}")
        # If 406, table doesn't exist or RLS issue
        return False
    except Exception as e:
        print(f"Supabase save error: {e}")
        return False

def get_track_from_supabase(track_type: str):
    """Get track info via Supabase REST API."""
    try:
        supabase_url = get_supabase_url()
        supabase_key = get_supabase_key()
        
        if not supabase_url or not supabase_key:
            return None
        
        url = f"{supabase_url}/rest/v1/tracks?track_type=eq.{urllib.parse.quote(track_type)}&limit=1"
        
        req = urllib.request.Request(url, headers={
            'apikey': supabase_key,
            'Authorization': f'Bearer {supabase_key}'
        })
        
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read())
            return data[0] if data else None
    except Exception as e:
        print(f"Supabase get error: {e}")
        return None

def is_db_available() -> bool:
    """Check if database is available."""
    return get_db_connection() is not None

def init_db():
    """Initialize database tables."""
    db_url = os.environ.get('DATABASE_URL') or os.environ.get('POSTGRES_URL') or ''
    
    try:
        conn = get_db_connection()
        if conn is None:
            print("No DB connection")
            return
        
        cursor = conn.cursor()
        
        if db_url.startswith('postgres'):
            # PostgreSQL (Supabase)
            cursor.execute('''CREATE TABLE IF NOT EXISTS tracks (id SERIAL PRIMARY KEY, track_type TEXT NOT NULL UNIQUE, filename TEXT NOT NULL, filepath TEXT, duration_sec REAL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
            cursor.execute('''CREATE TABLE IF NOT EXISTS play_events (id SERIAL PRIMARY KEY, track_id INTEGER, track_type TEXT NOT NULL, started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, ended_at TIMESTAMP, duration_sec REAL, completed BOOLEAN DEFAULT TRUE)''')
        else:
            # SQLite
            cursor.execute('''CREATE TABLE IF NOT EXISTS tracks (id INTEGER PRIMARY KEY AUTOINCREMENT, track_type TEXT NOT NULL, filename TEXT NOT NULL, filepath TEXT, duration_sec REAL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
            cursor.execute('''CREATE TABLE IF NOT EXISTS play_events (id INTEGER PRIMARY KEY AUTOINCREMENT, track_id INTEGER, track_type TEXT NOT NULL, started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, ended_at TIMESTAMP, duration_sec REAL, completed BOOLEAN DEFAULT 1)''')
        
        conn.commit()
        conn.close()
        print("DB initialized")
    except Exception as e:
        print(f"Init DB error: {e}")

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
    """Upload a file - saves track info only (not file) for Vercel."""
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'No file part'}), 400
        file = request.files['file']
        if file.filename == '':
            return jsonify({'error': 'No selected file'}), 400
        
        track_type = request.form.get('track_type')
        filename = secure_filename(file.filename)
        
        # On Vercel, we can't save files - just save track info to DB
        result = {'url': '', 'title': filename}
        result['note'] = 'File will be re-uploaded each session. Track info saved to database.'
        
        # Save track info to Supabase
        if track_type:
            try:
                if save_track_to_supabase(track_type, filename, '', 0):
                    result['track_type'] = track_type
                    result['saved_to_db'] = True
                    print(f"Saved to Supabase: {track_type}")
                else:
                    result['saved_to_db'] = False
            except Exception as e:
                print(f"Supabase save error: {e}")
                result['saved_to_db'] = False
        
        return jsonify(result)
    except Exception as e:
        print(f"Upload error: {e}")
        return jsonify({'error': str(e)}), 500
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
# Vercel uses the app object directly, only run locally
if __name__ == '__main__':
    # Don't auto-open browser in production-like environments
    import os
    if os.environ.get('VERCEL') != '1':
        Timer(1, open_browser).start()
    app.run(host='127.0.0.1', port=5000)

# ===============================
# Database API Endpoints
# ===============================

@app.route('/api/tracks', methods=['GET'])
def get_tracks():
    """Get all tracks from database"""
    track_type = request.args.get('type')
    conn = get_db_connection()
    if conn is None:
        return jsonify([])
    
    cursor = conn.cursor()
    
    if track_type:
        cursor.execute('SELECT * FROM tracks WHERE track_type = %s ORDER BY updated_at DESC', (track_type,))
    else:
        cursor.execute('SELECT * FROM tracks ORDER BY updated_at DESC')
    
    rows = cursor.fetchall()
    conn.close()
    
    tracks = [dict(row) for row in rows]
    return jsonify(tracks)

@app.route('/api/tracks', methods=['POST'])
def save_track():
    """Save track info to database"""
    data = request.json
    if not data:
        return jsonify({'error': 'No data provided'}), 400
    
    track_type = data.get('track_type')
    filename = data.get('filename')
    filepath = data.get('filepath')
    duration_sec = data.get('duration_sec')
    
    if not track_type or not filename:
        return jsonify({'error': 'track_type and filename are required'}), 400
    
    conn = get_db_connection()
    if conn is None:
        return jsonify({'error': 'No database'}), 400
    
    cursor = conn.cursor()
    
    # Check if track already exists
    cursor.execute('SELECT id FROM tracks WHERE track_type = %s', (track_type,))
    existing = cursor.fetchone()
    
    if existing:
        cursor.execute('''UPDATE tracks SET filename = %s, filepath = %s, duration_sec = %s, updated_at = CURRENT_TIMESTAMP WHERE track_type = %s''', (filename, filepath, duration_sec, track_type))
        track_id = existing[0] if isinstance(existing, tuple) else existing['id']
    else:
        cursor.execute('''INSERT INTO tracks (track_type, filename, filepath, duration_sec) VALUES (%s, %s, %s, %s)''', (track_type, filename, filepath, duration_sec))
        cursor.execute('SELECT lastval()')
        track_id = cursor.fetchone()[0]
    
    conn.commit()
    conn.close()
    
    return jsonify({'success': True, 'track_id': track_id})

@app.route('/api/play_events', methods=['GET'])
def get_play_events():
    """Get play events from database"""
    track_type = request.args.get('type')
    limit = request.args.get('limit', 50, type=int)
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    if track_type:
        cursor.execute('''
            SELECT pe.*, t.filename, t.track_type 
            FROM play_events pe 
            LEFT JOIN tracks t ON pe.track_id = t.id 
            WHERE pe.track_type = ?
            ORDER BY pe.started_at DESC 
            LIMIT ?
        ''', (track_type, limit))
    else:
        cursor.execute('''
            SELECT pe.*, t.filename, t.track_type 
            FROM play_events pe 
            LEFT JOIN tracks t ON pe.track_id = t.id 
            ORDER BY pe.started_at DESC 
            LIMIT ?
        ''', (limit,))
    
    rows = cursor.fetchall()
    conn.close()
    
    events = [dict(row) for row in rows]
    return jsonify(events)

@app.route('/api/play_events', methods=['POST'])
def save_play_event():
    """Save a play event to database"""
    data = request.json
    if not data:
        return jsonify({'error': 'No data provided'}), 400
    
    track_type = data.get('track_type')
    track_id = data.get('track_id')
    ended_at = data.get('ended_at')
    duration_sec = data.get('duration_sec')
    completed = data.get('completed', True)
    
    if not track_type:
        return jsonify({'error': 'track_type is required'}), 400
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute('''
        INSERT INTO play_events (track_id, track_type, ended_at, duration_sec, completed)
        VALUES (?, ?, ?, ?, ?)
    ''', (track_id, track_type, ended_at, duration_sec, completed))
    
    event_id = cursor.lastrowid
    conn.commit()
    conn.close()
    
    return jsonify({'success': True, 'event_id': event_id})

# For Vercel serverless
app.debug = False

# ===============================
# Settings API (save/load all settings)
# ===============================

@app.route('/api/settings', methods=['GET'])
def get_settings():
    """Get all settings from database."""
    conn = get_db_connection()
    if conn is None:
        return jsonify({'tracks': {}, 'play_events': []})
    
    cursor = conn.cursor()
    
    # Get tracks
    cursor.execute('SELECT track_type, filename, filepath, duration_sec FROM tracks')
    tracks = {row['track_type']: dict(row) for row in cursor.fetchall()}
    
    # Get play events (last 10 of each type)
    cursor.execute('''
        SELECT track_type, started_at, duration_sec 
        FROM play_events 
        ORDER BY started_at DESC 
        LIMIT 20
    ''')
    play_events = [dict(row) for row in cursor.fetchall()]
    
    conn.close()
    
    return jsonify({
        'tracks': tracks,
        'play_events': play_events
    })

@app.route('/api/track_info/<track_type>', methods=['GET'])
def get_track_info(track_type):
    """Get track info (filename, url) for frontend."""
    # Try Supabase REST API first
    try:
        track = get_track_from_supabase(track_type)
        if track:
            return jsonify({
                'found': True,
                'filename': track.get('filename'),
                'filepath': track.get('filepath'),
                'duration_sec': track.get('duration_sec', 0),
                'url': '/api/uploads/' + str(track.get('filename'))
            })
    except Exception as e:
        print(f"Supabase get error: {e}")
    
    # Fallback to database connection
    conn = get_db_connection()
    if conn is None:
        return jsonify({'found': False})
    
    cursor = conn.cursor()
    db_url = os.environ.get('POSTGRES_URL', '')
    
    if db_url.startswith('postgres'):
        cursor.execute('SELECT filename, filepath, duration_sec FROM tracks WHERE track_type = %s', (track_type,))
    else:
        cursor.execute('SELECT filename, filepath, duration_sec FROM tracks WHERE track_type = %s', (track_type,))
    
    row = cursor.fetchone()
    conn.close()
    
    if row is None:
        return jsonify({'found': False})
    
    filename = row[0] if isinstance(row, tuple) else row['filename']
    filepath = row[1] if isinstance(row, tuple) else row['filepath']
    duration_sec = row[2] if isinstance(row, tuple) else row['duration_sec']
    
    return jsonify({
        'found': True,
        'filename': filename,
        'filepath': filepath,
        'duration_sec': duration_sec,
        'url': '/api/uploads/' + str(filename)
    })

@app.route('/api/settings/ad', methods=['POST'])
def save_ad_settings():
    """Save ad interval and duration to database."""
    data = request.json
    if not data:
        return jsonify({'error': 'No data provided'}), 400
    
    interval_sec = data.get('interval_sec', 180)
    play_duration_sec = data.get('play_duration_sec', 30)
    
    conn = get_db_connection()
    if conn is None:
        return jsonify({'success': False, 'error': 'No database'}), 400
    
    cursor = conn.cursor()
    
    # Update ad track with duration_sec = play_duration_sec
    cursor.execute('''
        UPDATE tracks 
        SET duration_sec = ?, updated_at = CURRENT_TIMESTAMP
        WHERE track_type = 'ad'
    ''', (play_duration_sec,))
    
    # Save interval to a settings row
    cursor.execute('''
        INSERT OR REPLACE INTO tracks (track_type, filename, filepath, duration_sec, updated_at)
        VALUES ('ad_interval', 'interval', 'interval', ?, CURRENT_TIMESTAMP)
    ''', (interval_sec,))
    
    conn.commit()
    conn.close()
    
    return jsonify({'success': True, 'interval': interval_sec, 'duration': play_duration_sec})

@app.route('/api/settings/ad', methods=['GET'])
def get_ad_settings():
    """Get ad interval and duration from database."""
    conn = get_db_connection()
    if conn is None:
        return jsonify({'interval': 180, 'duration': 30})
    
    cursor = conn.cursor()
    
    # Get interval
    cursor.execute("SELECT duration_sec FROM tracks WHERE track_type = 'ad_interval'")
    row = cursor.fetchone()
    interval = row['duration_sec'] if row else 180
    
    # Get play duration from ad track
    cursor.execute("SELECT duration_sec FROM tracks WHERE track_type = 'ad'")
    row = cursor.fetchone()
    duration = row['duration_sec'] if row else 30
    
    conn.close()
    
    return jsonify({'interval': interval, 'duration': duration})

@app.route('/api/settings', methods=['POST'])
def save_settings():
    """Save all settings to database."""
    data = request.json
    if not data:
        return jsonify({'error': 'No data provided'}), 400
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Save advertisement settings
    if 'ad' in data:
        ad_data = data['ad']
        filename = ad_data.get('filename')
        filepath = ad_data.get('filepath')
        interval_sec = ad_data.get('interval_sec', 180)
        play_duration_sec = ad_data.get('play_duration_sec', 30)
        
        cursor.execute('SELECT id FROM tracks WHERE track_type = ?', ('ad',))
        existing = cursor.fetchone()
        
        if existing:
            cursor.execute('''
                UPDATE tracks 
                SET filename = ?, filepath = ?, duration_sec = ?, updated_at = CURRENT_TIMESTAMP
                WHERE track_type = ?
            ''', (filename, filepath, play_duration_sec, 'ad'))
        else:
            cursor.execute('''
                INSERT INTO tracks (track_type, filename, filepath, duration_sec)
                VALUES (?, ?, ?, ?)
            ''', ('ad', filename, filepath, play_duration_sec))
    
    # Save prayer settings
    if 'prayer' in data:
        prayer_data = data['prayer']
        filename = prayer_data.get('filename')
        filepath = prayer_data.get('filepath')
        times = prayer_data.get('times', [])
        duration_sec = prayer_data.get('duration_sec')
        
        cursor.execute('SELECT id FROM tracks WHERE track_type = ?', ('prayer',))
        existing = cursor.fetchone()
        
        if existing:
            cursor.execute('''
                UPDATE tracks 
                SET filename = ?, filepath = ?, duration_sec = ?, updated_at = CURRENT_TIMESTAMP
                WHERE track_type = ?
            ''', (filename, filepath, duration_sec, 'prayer'))
        else:
            cursor.execute('''
                INSERT INTO tracks (track_type, filename, filepath, duration_sec)
                VALUES (?, ?, ?, ?)
            ''', (filename, filepath, duration_sec, 'prayer'))
        
        # Store prayer times in a separate table or as JSON
        # For now, save to play_events as metadata
        for prayer_time in times:
            cursor.execute('''
                INSERT INTO play_events (track_type, started_at, duration_sec, completed)
                VALUES (?, ?, ?, ?)
            ''', (f'prayer_time_{prayer_time}', prayer_time, 0, True))
    
    conn.commit()
    conn.close()
    
    return jsonify({'success': True})
