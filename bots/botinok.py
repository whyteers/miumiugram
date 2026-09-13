import socketio
import requests

SERVER_URL = "http://127.0.0.1:3000"
BOT_TOKEN = "ea3d79bf685cde328a3bd8934ffd5cdb41d6a166581fd184"

sio = socketio.Client()

def send_message(room_id, text):

    headers = {"Authorization": BOT_TOKEN, "Content-Type": "application/json"}
    payload = {"room_id": room_id, "text": text}

    try:
        res = requests.post(f"{SERVER_URL}/api/bot/send_message", headers=headers, json=payload)
        if res.status_code == 200:
            print(f"[Успех] Ответ отправлен в чат!")
        else:
            print(f"[Ошибка] Сервер ответил: {res.text}")
    except Exception as e:
        print(f"[Ошибка подключения] {e}")

@sio.event
def connect():
    print("✅ Подключено к серверу! Авторизуемся...")
    sio.emit('bot_auth', {'api_key': BOT_TOKEN})

@sio.on('chat message')
def handle_incoming_message(data):
    room_id = data['room_id']
    username = data['username']
    text = data.get('text', '').lower()

    if 'bot' in username.lower():
        return

    print(f"📩 [{username}]: {text}")

    if text == "/ping":
        print("🤖 Реагирую на /ping...")
        send_message(room_id, f"@{username} Pong! Я тут, я работаю!")

    elif text == "/cat":
        print("🤖 Реагирую на /cat...")
        headers = {"Authorization": BOT_TOKEN, "Content-Type": "application/json"}
        payload = {"room_id": room_id, "text": "Держи котика! 🐈", "media": "https://cataas.com/cat"}
        requests.post(f"{SERVER_URL}/api/bot/send_message", headers=headers, json=payload)

if __name__ == '__main__':
    print("⏳ Запускаю бота...")
    sio.connect(SERVER_URL)
    sio.wait()
