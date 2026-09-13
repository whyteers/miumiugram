import socketio
import requests
from openai import OpenAI

SERVER_URL = "http://127.0.0.1:3000"
BOT_TOKEN = "a837263f9bb274abdd0089a1f33bf4408a3d79968472732a"

lm_client = OpenAI(
    base_url="https://localhost:1234/v1",
    api_key="lm-studio"
)

SYSTEM_PROMPT = """Ты — умный, саркастичный и полезный ИИ-помощник в приватном чате.
Отвечай на русском языке, старайся быть кратким, но информативным."""

sio = socketio.Client()

def send_message(room_id, text):

    headers = {"Authorization": BOT_TOKEN, "Content-Type": "application/json"}
    payload = {"room_id": room_id, "text": text}
    try:
        requests.post(f"{SERVER_URL}/api/bot/send_message", headers=headers, json=payload)
    except Exception as e:
        print(f"[Ошибка отправки] {e}")

@sio.event
def connect():
    print("✅ ИИ-Бот подключен к серверу чата!")
    sio.emit('bot_auth', {'api_key': BOT_TOKEN})

@sio.on('chat message')
def handle_incoming_message(data):
    room_id = data['room_id']
    username = data['username']
    text = data.get('text', '')

    if 'bot' in username.lower():
        return

    if text.lower().startswith('/ai '):

        question = text[4:].strip()
        print(f"🧠 Думаю над вопросом от {username}: {question}")

        try:

            completion = lm_client.chat.completions.create(
                model="local-model",
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": f"Вопрос от пользователя {username}: {question}"}
                ],
                temperature=1,
            )

            answer = completion.choices[0].message.content
            print(f"💡 Ответ готов. Отправляю...")

            send_message(room_id, answer)

        except Exception as e:
            print(f"❌ Ошибка нейросети: {e}")
            send_message(room_id, "Ой, моя нейросеть сейчас недоступна или перегружена. Проверь LM Studio! 🛠️")

if __name__ == '__main__':
    print("⏳ Запускаю нейро-бота...")
    sio.connect(SERVER_URL)
    sio.wait()
