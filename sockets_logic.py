import uuid
from datetime import datetime
from flask import request, session
from flask_socketio import emit, join_room
from database import get_db_connection

online_users = {}


# Хелпер для сокетов
def is_member(username, room_id):
    with get_db_connection() as conn:
        return bool(
            conn.execute('SELECT 1 FROM room_members WHERE room_id=? AND username=?', (room_id, username)).fetchone())


def init_sockets(socketio):
    # ==========================================
    # 🎙️ WEBRTC ГОЛОСОВЫЕ ЗВОНКИ
    # ==========================================
    @socketio.on('join_voice')
    def handle_join_voice(data):
        username = session.get('username')
        room_id = data.get('room_id')
        if username and is_member(username, room_id):
            # Сообщаем всем в комнате, что юзер зашел в голос
            emit('user_joined_voice', {'username': username, 'room_id': room_id}, to=room_id, include_self=False)

    @socketio.on('leave_voice')
    def handle_leave_voice(data):
        username = session.get('username')
        room_id = data.get('room_id')
        if username:
            # Сообщаем всем, что юзер вышел из голоса
            emit('user_left_voice', {'username': username, 'room_id': room_id}, to=room_id, include_self=False)

    @socketio.on('webrtc_signal')
    def handle_webrtc_signal(data):
        username = session.get('username')
        target = data.get('target')  # Кому адресован пакет
        if username and target:
            # Пересылаем P2P-сигнал строго в личный канал адресата
            emit('webrtc_signal', {
                'from': username,
                'signal': data.get('signal'),
                'room_id': data.get('room_id')
            }, to=f"user_{target}")


    @socketio.on('user_online')
    def handle_user_online(*args):  # *args позволяет принимать вызовы без данных
        username = session.get('username')
        if username:
            # 🛡️ Пользователь подписывается на ЛИЧНЫЙ канал уведомлений
            join_room(f"user_{username}")
            online_users[username] = online_users.get(username, 0) + 1
            emit('user_status', {'username': username, 'status': 'online'}, broadcast=True)
            emit('sync_online_users', list(online_users.keys()))

    @socketio.on('disconnect')
    def handle_disconnect():
        username = session.get('username')
        if username and username in online_users:
            online_users[username] -= 1
            if online_users[username] <= 0:
                del online_users[username]
                emit('user_status', {'username': username, 'status': 'offline'}, broadcast=True)

    @socketio.on('typing')
    def handle_typing(data):
        username = session.get('username')
        room_id = data.get('room_id')
        # 🛡️ БЕЗОПАСНОСТЬ: Только участник чата может посылать статус "Печатает..."
        if username and is_member(username, room_id):
            data['username'] = username
            emit('typing', data, to=room_id)

    @socketio.on('join room')
    def on_join(data):
        username = session.get('username')
        room_id = data.get('room_id')
        # 🛡️ БЕЗОПАСНОСТЬ: Не даем подключиться к прослушиванию чужого чата
        if username and is_member(username, room_id):
            join_room(room_id)

    @socketio.on('chat message')
    def handle_message(data):
        # 1. Проверка авторизации через сессию (защита от подделки имени)
        username = session.get('username')
        room_id = data.get('room_id')

        if not username or not is_member(username, room_id):
            return

        # 2. Получение данных из сообщения
        # Ожидаем, что фронтенд прислал медиа-URL (если файл загружен) и ключи шифрования
        encrypted_text = data.get('text', '')
        encrypted_keys = data.get('encrypted_keys', '{}')  # JSON строка с ключами для всех участников
        media_url = data.get('media', '')  # Сюда должен попасть URL после загрузки через /api/upload_media
        reply_to_id = data.get('reply_to_id')

        msg_id = str(uuid.uuid4())
        time_str = datetime.now().strftime("%H:%M")

        reply_info = None

        with get_db_connection() as conn:
            # 3. ОБРАБОТКА РЕПЛАЯ (Решение проблемы №3)
            # Нам нужно достать зашифрованные ключи ОРИГИНАЛЬНОГО сообщения,
            # чтобы получатель мог расшифровать цитату.
            if reply_to_id:
                r_msg = conn.execute('''
                    SELECT username, text, encrypted_keys, media, room_id 
                    FROM messages WHERE id = ?
                ''', (reply_to_id,)).fetchone()

                # Проверяем, что сообщение из этой же комнаты
                if r_msg and r_msg['room_id'] == room_id:
                    reply_info = {
                        'id': reply_to_id,
                        'username': r_msg['username'],
                        'text': r_msg['text'],
                        'encrypted_keys': r_msg['encrypted_keys'],  # ОБЯЗАТЕЛЬНО для расшифровки на клиенте
                        'media': r_msg['media']
                    }

            # 4. Получаем аватар автора (чтобы он был актуальным)
            user = conn.execute('SELECT avatar FROM users WHERE username = ?', (username,)).fetchone()
            avatar = user['avatar'] if user else ''

            # 5. СОХРАНЕНИЕ В БД (Решение проблемы №1 и №2)
            # Убеждаемся, что медиа и ключи сохраняются
            conn.execute('''
                INSERT INTO messages (id, room_id, username, text, encrypted_keys, media, time, reply_to_id, is_edited)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
            ''', (msg_id, room_id, username, encrypted_text, encrypted_keys, media_url, time_str, reply_to_id))
            conn.commit()

        # 6. РАССЫЛКА (Broadcasting)
        # Отправляем полный пакет данных всем в комнате
        emit('chat message', {
            'id': msg_id,
            'room_id': room_id,
            'username': username,
            'text': encrypted_text,
            'encrypted_keys': encrypted_keys,  # Ключи для текущего сообщения
            'media': media_url,
            'time': time_str,
            'avatar': avatar,
            'reply_to': reply_info,  # Информация о реплае + ключи для его расшифровки
            'is_edited': 0
        }, to=room_id)

    @socketio.on('edit message')
    def handle_edit(data):
        username = session.get('username')
        if not username: return

        msg_id, room_id = data['msg_id'], data['room_id']
        with get_db_connection() as conn:
            msg = conn.execute('SELECT username FROM messages WHERE id = ?', (msg_id,)).fetchone()
            # 🛡️ БЕЗОПАСНОСТЬ: Только владелец сообщения может его изменить
            if msg and msg['username'] == username:
                conn.execute('UPDATE messages SET text = ?, encrypted_keys = ?, is_edited = 1 WHERE id = ?',
                             (data['text'], data['encrypted_keys'], msg_id))
                conn.commit()
                emit('message edited',
                     {'msg_id': msg_id, 'text': data['text'], 'encrypted_keys': data['encrypted_keys']}, to=room_id)

    @socketio.on('delete message')
    def handle_delete(data):
        username = session.get('username')
        if not username: return

        msg_id, room_id = data['msg_id'], data['room_id']
        with get_db_connection() as conn:
            msg = conn.execute('SELECT username FROM messages WHERE id = ?', (msg_id,)).fetchone()
            # 🛡️ БЕЗОПАСНОСТЬ: Только владелец сообщения может его удалить
            if msg and msg['username'] == username:
                conn.execute('DELETE FROM messages WHERE id = ?', (msg_id,))
                conn.execute('DELETE FROM reactions WHERE msg_id = ?', (msg_id,))
                conn.commit()
                emit('message deleted', {'msg_id': msg_id}, to=room_id)

    @socketio.on('chat reaction')
    def handle_reaction(data):
        username = session.get('username')
        room_id = data.get('room_id')

        # 🛡️ БЕЗОПАСНОСТЬ: Ставить реакции могут только участники комнаты
        if not username or not is_member(username, room_id): return

        msg_id, reaction = data['msg_id'], data['reaction']
        with get_db_connection() as conn:
            exists = conn.execute('SELECT 1 FROM reactions WHERE msg_id = ? AND reaction = ? AND username = ?',
                                  (msg_id, reaction, username)).fetchone()
            if exists:
                conn.execute('DELETE FROM reactions WHERE msg_id = ? AND reaction = ? AND username = ?',
                             (msg_id, reaction, username))
            else:
                conn.execute('INSERT INTO reactions (msg_id, reaction, username) VALUES (?, ?, ?)',
                             (msg_id, reaction, username))
            conn.commit()
            all_reacts = conn.execute('SELECT reaction, username FROM reactions WHERE msg_id = ?', (msg_id,)).fetchall()

        current_reactions = {}
        for r in all_reacts:
            if r['reaction'] not in current_reactions: current_reactions[r['reaction']] = []
            current_reactions[r['reaction']].append(r['username'])
        emit('update reactions', {'msg_id': msg_id, 'reactions': current_reactions}, to=room_id)

    # 🛡️ БОТ АВТОРИЗАЦИЯ
    @socketio.on('bot_auth')
    def handle_bot_auth(data):
        api_key = data.get('api_key')
        with get_db_connection() as conn:
            bot = conn.execute('SELECT username FROM api_bots WHERE api_key = ?', (api_key,)).fetchone()
            if bot:
                bot_name = bot['username']
                rooms = conn.execute('SELECT room_id FROM room_members WHERE username = ?', (bot_name,)).fetchall()
                for r in rooms:
                    join_room(r['room_id'])
                online_users[bot_name] = 1
                emit('user_status', {'username': bot_name, 'status': 'online'}, broadcast=True)