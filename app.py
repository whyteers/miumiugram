from gevent import monkey

monkey.patch_all()

import os
import sqlite3
import uuid
import secrets
from datetime import datetime

from flask import Flask, send_from_directory, request, jsonify, session
from flask_socketio import SocketIO
from werkzeug.utils import secure_filename
from werkzeug.security import generate_password_hash, check_password_hash

from PIL import Image

Image.MAX_IMAGE_PIXELS = 20_000_000

from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

from database import init_db, get_db_connection
from sockets_logic import init_sockets

app = Flask(__name__, static_folder='dist', static_url_path='/')

SECRET_FILE = 'secret.key'
if not os.path.exists(SECRET_FILE):
    with open(SECRET_FILE, 'w') as f:
        f.write(secrets.token_hex(32))
with open(SECRET_FILE, 'r') as f:
    app.config['SECRET_KEY'] = f.read().strip()

app.config['SESSION_COOKIE_SECURE'] = False
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024

limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=["2000 per day", "500 per hour"],
    storage_uri="memory://"
)

socketio = SocketIO(app, async_mode='gevent', cors_allowed_origins="*")

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def process_and_save_image(file_stream, filepath):

    try:
        img = Image.open(file_stream)
        img.verify()
        file_stream.seek(0)
        img = Image.open(file_stream)

        if img.mode in ("RGBA", "P") and filepath.lower().endswith(('.jpg', '.jpeg')):
            img = img.convert("RGB")

        if img.format == 'GIF':
            img.save(filepath, save_all=True)
        else:
            img.save(filepath)
        return True
    except Exception as e:
        print(f"[Безопасность] Заблокирован битый файл: {e}")
        return False

for folder in ['static/avatars', 'static/media', 'static/images', 'static/stickers', 'static/emojis',
               'static/reactions']:
    os.makedirs(folder, exist_ok=True)
app.config['UPLOAD_FOLDER'] = 'static/avatars'
app.config['MEDIA_FOLDER'] = 'static/media'

init_db()
init_sockets(socketio)

def is_member(username, room_id):
    with get_db_connection() as conn:
        return bool(
            conn.execute('SELECT 1 FROM room_members WHERE room_id=? AND username=?', (room_id, username)).fetchone())

def is_owner(username, room_id):
    with get_db_connection() as conn:
        return bool(conn.execute('SELECT 1 FROM rooms WHERE id=? AND owner=?', (room_id, username)).fetchone())

@app.route('/')
def index():

    return send_from_directory(app.static_folder, 'index.html')

@app.route('/<path:path>')
def serve_react_app(path):

    if path != "" and os.path.exists(os.path.join(app.static_folder, path)):
        return send_from_directory(app.static_folder, path)
    else:

        return send_from_directory(app.static_folder, 'index.html')

@app.route('/static/<path:filename>')
def serve_static_files(filename):
    return send_from_directory('static', filename)

@app.route('/api/static/<path:filename>')
def serve_api_static(filename):
    return send_from_directory('static', filename)

@app.route('/api/register', methods=['POST'])
@limiter.limit("5 per minute")
def register():
    data = request.get_json()
    username, password, public_key = data.get('username'), data.get('password'), data.get('public_key')
    encrypted_private_key = data.get('encrypted_private_key')
    if not username or not password or not public_key:
        return jsonify({'error': 'Заполните все поля'}), 400

    with get_db_connection() as conn:
        if conn.execute('SELECT username FROM users WHERE username = ?', (username,)).fetchone():
            return jsonify({'error': 'Пользователь существует'}), 400

        hashed_pw = generate_password_hash(password)
        default_avatar = f"https://ui-avatars.com/api/?name={username}&background=222&color=fff"
        conn.execute(
            'INSERT INTO users (username, password, avatar, public_key, encrypted_private_key) VALUES (?, ?, ?, ?, ?)',
            (username, hashed_pw, default_avatar, public_key, encrypted_private_key))
        conn.commit()
    return jsonify({'success': True})

@app.route('/api/login', methods=['POST'])
@limiter.limit("10 per minute")
def login():
    data = request.get_json()
    username, password = data.get('username'), data.get('password')
    public_key = data.get('public_key')
    encrypted_private_key = data.get('encrypted_private_key')

    with get_db_connection() as conn:
        user = conn.execute('SELECT * FROM users WHERE username = ?', (username,)).fetchone()

        if user and check_password_hash(user['password'], password):
            session.clear()
            session['username'] = user['username']

            returned_epk = dict(user).get('encrypted_private_key')

            if encrypted_private_key:
                if public_key and public_key != "no_crypto":
                    conn.execute('UPDATE users SET public_key = ?, encrypted_private_key = ? WHERE username = ?',
                                 (public_key, encrypted_private_key, username))
                else:
                    conn.execute('UPDATE users SET encrypted_private_key = ? WHERE username = ?',
                                 (encrypted_private_key, username))
                conn.commit()
                returned_epk = encrypted_private_key

            return jsonify({'success': True, 'username': user['username'], 'avatar': user['avatar'],
                            'encrypted_private_key': returned_epk})

        return jsonify({'error': 'Неверный логин или пароль'}), 401

@app.route('/api/logout', methods=['POST'])
def logout():
    session.pop('username', None)
    return jsonify({'success': True})

@app.route('/api/get_user/<username>', methods=['GET'])
def get_user(username):
    if session.get('username') != username: return jsonify({'error': 'Не авторизован'}), 401
    with get_db_connection() as conn:
        user = conn.execute('SELECT username, avatar FROM users WHERE username = ?', (username,)).fetchone()
        return jsonify({'success': True, 'username': user['username'], 'avatar': user['avatar']}) if user else (
            jsonify({'error': 'Не найден'}), 404)

@app.route('/api/rooms/<username>', methods=['GET'])
def get_rooms(username):
    if session.get('username') != username: return jsonify({'error': 'Доступ запрещен'}), 403

    with get_db_connection() as conn:
        rooms = conn.execute('''
            SELECT r.id, r.name, r.owner, r.stream_url,
                (SELECT text FROM messages WHERE room_id = r.id ORDER BY rowid DESC LIMIT 1) as last_text,
                (SELECT encrypted_keys FROM messages WHERE room_id = r.id ORDER BY rowid DESC LIMIT 1) as last_keys,
                (SELECT media FROM messages WHERE room_id = r.id ORDER BY rowid DESC LIMIT 1) as last_media
            FROM rooms r
            JOIN room_members rm ON r.id = rm.room_id
            WHERE rm.username = ?
        ''', (username,)).fetchall()
        return jsonify([dict(r) for r in rooms])

@app.route('/api/room_keys/<room_id>', methods=['GET'])
def get_room_keys(room_id):
    username = session.get('username')
    if not username or not is_member(username, room_id): return jsonify({'error': 'Доступ запрещен'}), 403
    with get_db_connection() as conn:
        users = conn.execute(
            'SELECT u.username, u.public_key FROM room_members rm JOIN users u ON rm.username = u.username WHERE rm.room_id = ?',
            (room_id,)).fetchall()
        return jsonify({u['username']: u['public_key'] for u in users})

@app.route('/api/room_members/<room_id>', methods=['GET'])
def get_room_members(room_id):
    username = session.get('username')
    if not username or not is_member(username, room_id): return jsonify({'error': 'Доступ запрещен'}), 403
    with get_db_connection() as conn:
        members = conn.execute(
            'SELECT u.username, u.avatar FROM room_members rm JOIN users u ON rm.username = u.username WHERE rm.room_id = ?',
            (room_id,)).fetchall()
        return jsonify([dict(m) for m in members])

@app.route('/api/create_room', methods=['POST'])
@limiter.limit("10 per minute")
def create_room():
    username = session.get('username')
    if not username: return jsonify({'error': 'Не авторизован'}), 401
    data = request.get_json()
    room_id = str(uuid.uuid4())
    with get_db_connection() as conn:
        conn.execute('INSERT INTO rooms (id, name, owner, stream_url) VALUES (?, ?, ?, ?)',
                     (room_id, data.get('name'), username, ""))
        conn.execute('INSERT INTO room_members (room_id, username) VALUES (?, ?)', (room_id, username))
        conn.commit()
    return jsonify({'success': True, 'room': {'id': room_id, 'name': data.get('name'), 'owner': username}})

@app.route('/api/invite', methods=['POST'])
def invite_user():
    username = session.get('username')
    data = request.get_json()
    room_id = data.get('room_id')
    if not username or not is_owner(username, room_id): return jsonify(
        {'error': 'Только создатель чата может приглашать людей'}), 403
    with get_db_connection() as conn:
        user = conn.execute('SELECT username, avatar FROM users WHERE username = ?', (data.get('username'),)).fetchone()
        if not user: return jsonify({'error': 'Не найден'}), 404
        try:
            conn.execute('INSERT INTO room_members (room_id, username) VALUES (?, ?)', (room_id, data.get('username')))
            conn.commit()
            socketio.emit('member_added',
                          {'room_id': room_id, 'username': data.get('username'), 'avatar': user['avatar']}, to=room_id)
            socketio.emit('you_were_invited', {}, to=f"user_{data.get('username')}")
            return jsonify({'success': True, 'message': 'Добавлен!'})
        except sqlite3.IntegrityError:
            return jsonify({'error': 'Уже в чате'}), 400

@app.route('/api/leave_room', methods=['POST'])
def leave_chat_room():
    username = session.get('username')
    if not username: return jsonify({'error': 'Не авторизован'}), 401
    with get_db_connection() as conn:
        conn.execute('DELETE FROM room_members WHERE room_id = ? AND username = ?',
                     (request.get_json().get('room_id'), username))
        conn.commit()
    return jsonify({'success': True})

@app.route('/api/delete_room', methods=['POST'])
def delete_chat_room():
    username = session.get('username')
    room_id = request.get_json().get('room_id')
    if not username or not is_owner(username, room_id): return jsonify(
        {'error': 'Только создатель может удалить чат'}), 403
    with get_db_connection() as conn:
        conn.execute('DELETE FROM rooms WHERE id = ?', (room_id,))
        conn.execute('DELETE FROM room_members WHERE room_id = ?', (room_id,))
        conn.execute('DELETE FROM messages WHERE room_id = ?', (room_id,))
        conn.commit()
    return jsonify({'success': True})

@app.route('/api/set_stream', methods=['POST'])
def set_stream():
    username = session.get('username')
    data = request.get_json()
    room_id = data.get('room_id')
    stream_url = data.get('stream_url', '').strip()

    if not username or not is_owner(username, room_id): return jsonify({'error': 'Доступ запрещен'}), 403
    if stream_url and not stream_url.startswith(('http://', 'https://')): return jsonify(
        {'error': 'Недопустимый URL'}), 400

    with get_db_connection() as conn:
        conn.execute('UPDATE rooms SET stream_url = ? WHERE id = ?', (stream_url, room_id))
        conn.commit()
    socketio.emit('stream updated', {'room_id': room_id, 'stream_url': stream_url}, to=room_id)
    return jsonify({'success': True})

@app.route('/api/history/<room_id>', methods=['GET'])
def get_history(room_id):
    username = session.get('username')
    if not username or not is_member(username, room_id): return jsonify({'error': 'Доступ запрещен'}), 403
    with get_db_connection() as conn:
        msgs = conn.execute('''
            SELECT m.id, m.username, m.text, m.encrypted_keys, m.media, m.time, m.reply_to_id, m.is_edited, u.avatar,
                   rm.username as reply_username, rm.text as reply_text, rm.media as reply_media, rm.encrypted_keys as reply_encrypted_keys
            FROM messages m LEFT JOIN users u ON m.username = u.username LEFT JOIN messages rm ON m.reply_to_id = rm.id
            WHERE m.room_id = ? ORDER BY m.rowid ASC
        ''', (room_id,)).fetchall()

        reactions_db = conn.execute(
            'SELECT r.msg_id, r.reaction, r.username FROM reactions r JOIN messages m ON r.msg_id = m.id WHERE m.room_id = ?',
            (room_id,)).fetchall()
        reacts = {}
        for r in reactions_db:
            if r['msg_id'] not in reacts: reacts[r['msg_id']] = {}
            if r['reaction'] not in reacts[r['msg_id']]: reacts[r['msg_id']][r['reaction']] = []
            reacts[r['msg_id']][r['reaction']].append(r['username'])

        history = []
        for m in msgs:
            msg_obj = {
                'id': m['id'], 'username': m['username'], 'text': m['text'], 'encrypted_keys': m['encrypted_keys'],
                'media': m['media'], 'time': m['time'], 'is_edited': m['is_edited'], 'avatar': m['avatar'],
                'reactions': reacts.get(m['id'], {})
            }
            if m['reply_to_id']:
                msg_obj['reply_to'] = {'id': m['reply_to_id'], 'username': m['reply_username'], 'text': m['reply_text'],
                                       'encrypted_keys': m['reply_encrypted_keys'], 'media': m['reply_media']}
            history.append(msg_obj)
        return jsonify(history)

@app.route('/api/upload_avatar', methods=['POST'])
@limiter.limit("10 per minute")
def upload_avatar():
    username = session.get('username') or request.form.get('username')
    file = request.files.get('file')
    if file and username and allowed_file(file.filename):
        filename = secure_filename(f"avatar_{username}_{file.filename}")
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        if process_and_save_image(file, filepath):
            url = f"/{filepath}".replace("\\", "/")
            with get_db_connection() as conn:
                conn.execute('UPDATE users SET avatar = ? WHERE username = ?', (url, username))
                conn.commit()
            return jsonify({'success': True, 'avatar': url})
    return jsonify({'error': 'Неверный формат или битый файл'}), 400

@app.route('/api/upload_media', methods=['POST'])
@limiter.limit("20 per minute")
def upload_media():
    username = session.get('username') or request.form.get('username')
    if not username: return jsonify({'error': 'Не авторизован'}), 401
    file = request.files.get('file')
    if file and allowed_file(file.filename):
        filename = secure_filename(f"media_{uuid.uuid4().hex[:8]}_{file.filename}")
        filepath = os.path.join(app.config['MEDIA_FOLDER'], filename)
        if process_and_save_image(file, filepath):
            return jsonify({'success': True, 'media_url': f"/{filepath}".replace("\\", "/")})
    return jsonify({'error': 'Неверный формат файла'}), 400

@app.route('/api/assets/<asset_type>/<username>', methods=['GET'])
def get_assets(asset_type, username):
    if not session.get('username'): return jsonify({'error': 'Не авторизован'}), 401
    if asset_type not in ['stickers', 'emojis', 'reactions']: return jsonify([])
    with get_db_connection() as conn:
        assets = conn.execute('SELECT url FROM assets WHERE type = ? AND owner = ?', (asset_type, username)).fetchall()
        return jsonify([a['url'] for a in assets])

@app.route('/api/upload_asset', methods=['POST'])
@limiter.limit("30 per minute")
def upload_asset():
    username = session.get('username') or request.form.get('username')
    if not username: return jsonify({'error': 'Не авторизован'}), 401
    file = request.files.get('file')
    asset_type = request.form.get('type')

    if file and allowed_file(file.filename) and asset_type in ['stickers', 'emojis', 'reactions']:
        filename = secure_filename(f"{uuid.uuid4().hex[:6]}_{file.filename}")
        filepath = os.path.join(f'static/{asset_type}', filename)
        if process_and_save_image(file, filepath):
            url = f"/{filepath}".replace("\\", "/")
            with get_db_connection() as conn:
                conn.execute('INSERT INTO assets (id, type, url, owner) VALUES (?, ?, ?, ?)',
                             (str(uuid.uuid4()), asset_type, url, username))
                conn.commit()
            socketio.emit('asset_added', {'type': asset_type, 'url': url})
            return jsonify({'success': True, 'url': url})
    return jsonify({'error': 'Ошибка загрузки (неверный формат)'}), 400

if __name__ == '__main__':
    print("=====================================================")
    print("🚀 СЕРВЕР ЗАПУЩЕН для работы с REACT SPA (Eventlet/Gevent)")
    print("=====================================================")
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)
