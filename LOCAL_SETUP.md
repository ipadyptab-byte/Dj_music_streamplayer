# How to run this Music Player locally

1. **Install Python**: Make sure you have Python 3.11+ installed on your machine.
2. **Install Dependencies**: Open your terminal and run:
   ```bash
   pip install flask "yt-dlp[default]"
   ```
3. **Install a JS runtime for YouTube support (required)**:
   - Recommended: install **Deno** (>=2.0.0) and ensure `deno` is on your PATH
   - Alternative: install **Node.js** (>=20) and ensure `node` is on your PATH

   See: https://github.com/yt-dlp/yt-dlp/wiki/EJS
4. **Copy Files**: Download or copy `main.py` and the `static/` folder (including `index.html`) to a directory on your computer.
5. **Run the Server**: In your terminal, navigate to that directory and run:
   ```bash
   python main.py
   ```
6. **Open in Browser**: Visit `http://127.0.0.1:5000` in your web browser.

Note: Ensure you have a stable internet connection for YouTube search and playback to work.