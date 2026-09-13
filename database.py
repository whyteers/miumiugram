import sqlite3

DB_FILE = 'users.db'

def init_db():
    with sqlite3.connect(DB_FILE) as conn:
        cursor = conn.cursor()

        cursor.execute(
            '''CREATE TABLE IF NOT EXISTS users (username TEXT PRIMARY KEY, password TEXT, avatar TEXT, public_key TEXT)''')
        try:
            cursor.execute('''ALTER TABLE users ADD COLUMN encrypted_private_key TEXT''')
        except:
            pass

        cursor.execute(
            '''CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, name TEXT, owner TEXT, stream_url TEXT)''')
        cursor.execute(
            '''CREATE TABLE IF NOT EXISTS room_members (room_id TEXT, username TEXT, UNIQUE(room_id, username))''')

        cursor.execute(
            '''CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, room_id TEXT, username TEXT, text TEXT, encrypted_keys TEXT, media TEXT, time TEXT, reply_to_id TEXT, is_edited INTEGER DEFAULT 0)''')

        cursor.execute(
            '''CREATE TABLE IF NOT EXISTS reactions (msg_id TEXT, reaction TEXT, username TEXT, UNIQUE(msg_id, reaction, username))''')
        cursor.execute('''CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, type TEXT, url TEXT, owner TEXT)''')
        cursor.execute('''CREATE TABLE IF NOT EXISTS api_bots (username TEXT PRIMARY KEY, api_key TEXT, owner TEXT)''')

        conn.commit()

def get_db_connection():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn
