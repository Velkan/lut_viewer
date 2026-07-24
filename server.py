#!/usr/bin/env python3
"""HTTP server for LUT Batch Preview with photo upload/persistence API."""
import http.server
import subprocess
import json
import os
import sys
import webbrowser
import base64
import uuid
from pathlib import Path
from urllib.parse import urlparse

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8723
DIR = Path(__file__).parent
STATE_FILE = DIR / '.lut_viewer_state.json'
UPLOAD_DIR = DIR / 'photo-uploads'
UPLOAD_DIR.mkdir(exist_ok=True)
LUT_UPLOAD_DIR = DIR / 'lut-uploads'
LUT_UPLOAD_DIR.mkdir(exist_ok=True)

def load_state():
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text())
    return {'photos': []}

def save_state(state):
    STATE_FILE.write_text(json.dumps(state, indent=2))

MIME_TYPES = {
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.cube': 'text/plain; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
}

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIR), **kwargs)

    def _send_json(self, data, status=200):
        body = json.dumps(data).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('Content-Length', len(body))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        length = int(self.headers.get('Content-Length', 0))
        return self.rfile.read(length) if length > 0 else b''

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == '/api/open-lut-dir':
            try:
                subprocess.Popen(['open', str(LUT_UPLOAD_DIR)])
                self._send_json({'ok': True})
                return
            except Exception as e:
                self._send_json({'ok': False, 'error': str(e)}, 500)
                return

        if parsed.path == '/api/photos':
            state = load_state()
            self._send_json(state)
            return
        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == '/api/upload-photo':
            try:
                body = json.loads(self._read_body())
                name = body.get('name', 'photo.jpg')
                data_b64 = body.get('data', '')
                raw = base64.b64decode(data_b64)
                ext = Path(name).suffix or '.jpg'
                fid = 'photo_' + uuid.uuid4().hex[:8] + ext
                fpath = UPLOAD_DIR / fid
                fpath.write_bytes(raw)
                state = load_state()
                state['photos'].append({'id': fid, 'name': name})
                save_state(state)
                self._send_json({'ok': True, 'id': fid})
                return
            except Exception as e:
                self._send_json({'ok': False, 'error': str(e)}, 500)
                return

        if parsed.path == '/api/upload-lut':
            try:
                body = json.loads(self._read_body())
                name = body.get('name', 'lut.cube')
                data_b64 = body.get('data', '')
                raw = base64.b64decode(data_b64)
                # Use original filename, store in date subdirectory
                date_str = body.get('date', '')
                save_dir = LUT_UPLOAD_DIR / date_str if date_str else LUT_UPLOAD_DIR
                save_dir.mkdir(exist_ok=True)
                fpath = save_dir / name
                fpath.write_bytes(raw)
                path_prefix = '/lut-uploads/' + date_str + '/' if date_str else '/lut-uploads/'
                self._send_json({'ok': True, 'path': path_prefix + name})
                return
            except Exception as e:
                self._send_json({'ok': False, 'error': str(e)}, 500)
                return

        if parsed.path == '/api/clear-photos':
            state = load_state()
            for p in state['photos']:
                f = UPLOAD_DIR / p['id']
                if f.exists(): f.unlink()
            state['photos'] = []
            save_state(state)
            self._send_json({'ok': True})
            return

        self.send_error(404)

    def do_DELETE(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith('/api/photo/'):
            fid = parsed.path.split('/')[-1]
            state = load_state()
            state['photos'] = [p for p in state['photos'] if p['id'] != fid]
            save_state(state)
            f = UPLOAD_DIR / fid
            if f.exists(): f.unlink()
            self._send_json({'ok': True})
            return
        self.send_error(404)

    def guess_type(self, path):
        ext = Path(path).suffix
        return MIME_TYPES.get(ext) or super().guess_type(path)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        super().end_headers()

if __name__ == '__main__':
    server = http.server.HTTPServer(('127.0.0.1', PORT), Handler)
    url = f'http://127.0.0.1:{PORT}'
    print(f'Serving LUT Batch Preview at {url}')
    webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nServer stopped.')
        server.server_close()
