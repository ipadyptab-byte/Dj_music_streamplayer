from flask import Flask, jsonify, send_from_directory
import os
import mimetypes
from flask import request

app = Flask(__name__, static_folder='static', static_url_path='')
app.config['UPLOAD_FOLDER'] = 'uploads'
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

@app.route('/')
def index():
    return app.send_static_file('index.html')

@app.route('/api/search')
def search():
    query = request.args.get('q')
    return jsonify([])

if __name__ == '__main__':
    app.run()
