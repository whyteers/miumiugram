const DEFAULT_EMOJIS = ['😀','😂','🥰','😎','😢','😡','👍','🔥','🎉','❤️','👀','🤡'];
const DEFAULT_REACTIONS = ['👍','❤️','😂','🔥','😢','👏','🤡','👀'];

let CUSTOM_EMOJIS = [], CUSTOM_STICKERS = [], CUSTOM_REACTIONS = [];
let currentUser = null, socket = null, lastSender = null;
let currentRoomId = null, currentRoomName = null, myRooms = [];
let globalOnlineUsers = new Set(), currentRoomMembers = [];
let typingTimeout, currentlyTyping = new Set(), replyingToId = null, editingMsgId = null;
let selectedMediaBase64 = null;
const isCryptoAvailable = !!(window.crypto && window.crypto.subtle);

// ЗВОНКИ
let inVoiceChat = false;
let localAudioStream = null;
let peerConnections = {};
let voiceUsersInRoom = new Set(); // Храним тех, кто сейчас в звонке
const WEBRTC_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

// Перехватчик Fetch для CSRF
const originalFetch = window.fetch;
window.fetch = async function() {
    let [resource, config] = arguments;
    if (config && (config.method === 'POST' || config.method === 'PUT' || config.method === 'DELETE')) {
        config.headers = { ...config.headers, 'X-Requested-With': 'XMLHttpRequest' };
    }
    return originalFetch(resource, config);
};

function applyVisualSettings() {
    const root = document.querySelector(':root');
    root.style.setProperty('--wallpaper-opacity', localStorage.getItem('wall_op') || '0.3');
    root.style.setProperty('--bg-blur', (localStorage.getItem('blur') || '5') + 'px');
    root.style.setProperty('--font-scale', localStorage.getItem('scale') || '1');
    root.style.setProperty('--msg-mine-bg', localStorage.getItem('mine_color') || '#1e3a2f');
}
applyVisualSettings();

function openSettings() { document.getElementById('set-opacity').value = localStorage.getItem('wall_op') || '0.3'; document.getElementById('set-blur').value = localStorage.getItem('blur') || '5'; document.getElementById('set-scale').value = localStorage.getItem('scale') || '1'; document.getElementById('set-color').value = localStorage.getItem('mine_color') || '#1e3a2f'; document.getElementById('settings-modal').style.display = 'flex'; }
function previewSettings() { const root = document.querySelector(':root'); root.style.setProperty('--wallpaper-opacity', document.getElementById('set-opacity').value); root.style.setProperty('--bg-blur', document.getElementById('set-blur').value + 'px'); root.style.setProperty('--font-scale', document.getElementById('set-scale').value); root.style.setProperty('--msg-mine-bg', document.getElementById('set-color').value); }
function saveSettings() { localStorage.setItem('wall_op', document.getElementById('set-opacity').value); localStorage.setItem('blur', document.getElementById('set-blur').value); localStorage.setItem('scale', document.getElementById('set-scale').value); localStorage.setItem('mine_color', document.getElementById('set-color').value); document.getElementById('settings-modal').style.display = 'none'; }

// УПРАВЛЕНИЕ МЕНЮ И СТРИМОМ
function toggleDropdown(e) {
    e.stopPropagation();
    document.getElementById("chat-menu").classList.toggle("show");
}

function closeLocalStream() {
    document.getElementById('stream-panel').style.display = 'none';
    document.getElementById('chat-panel').style.flex = '1';
    document.getElementById('chat-panel').style.width = 'auto';
    document.getElementById('chat-panel').style.borderLeft = 'none';
    if(document.getElementById('members-sidebar')) document.getElementById('members-sidebar').style.display = 'flex';
}

function updateStreamUI(url) {
    const sp = document.getElementById('stream-panel'), cp = document.getElementById('chat-panel'), ifr = document.getElementById('stream-iframe'), btn = document.getElementById('menu-stream'), ms = document.getElementById('members-sidebar');
    if (url && url.trim() !== "") {
        sp.style.display = 'block'; cp.style.flex = 'none'; cp.style.width = '420px'; cp.style.borderLeft = '1px solid #222';
        if(ms) ms.style.display = 'none';
        ifr.src = url; btn.innerText = '⏹ Остановить трансляцию'; btn.style.color = '#ff4c4c';
    } else {
        sp.style.display = 'none'; cp.style.flex = '1'; cp.style.width = 'auto'; cp.style.borderLeft = 'none';
        if(ms) ms.style.display = 'flex';
        ifr.src = ''; btn.innerText = '🎥 Начать трансляцию'; btn.style.color = '#e0e0e0';
    }
}

// ПРЕДПРОСМОТР КАРТИНОК И СТИКЕРЫ
function previewMedia() {
    const file = document.getElementById('media-input').files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement('canvas'); const MAX_WIDTH = 1200; let scaleSize = 1;
            if (img.width > MAX_WIDTH) scaleSize = MAX_WIDTH / img.width;
            canvas.width = img.width * scaleSize; canvas.height = img.height * scaleSize;
            canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
            selectedMediaBase64 = canvas.toDataURL("image/jpeg", 0.7);
            document.getElementById('media-preview-img').src = selectedMediaBase64;
            const pc = document.getElementById('media-preview-container'); if(pc) pc.style.display = 'block';
            document.getElementById('chat-text').focus();
        }
        img.src = e.target.result;
    }
    reader.readAsDataURL(file);
}

function cancelMedia() { selectedMediaBase64 = null; const pc = document.getElementById('media-preview-container'); if(pc) pc.style.display = 'none'; document.getElementById('media-input').value = ''; }

async function fetchAssets() {
    if (!currentUser) return;
    try {
        const [eRes, sRes, rRes] = await Promise.all([ fetch('/api/assets/emojis/' + currentUser), fetch('/api/assets/stickers/' + currentUser), fetch('/api/assets/reactions/' + currentUser) ]);
        CUSTOM_EMOJIS = await eRes.json(); CUSTOM_STICKERS = await sRes.json(); CUSTOM_REACTIONS = await rRes.json();
    } catch(e) { console.error("Ошибка ассетов", e); }
}

async function uploadAsset(inputEl, type) {
    const file = inputEl.files[0]; if (!file) return;
    const formData = new FormData(); formData.append('file', file); formData.append('type', type); formData.append('username', currentUser);
    await fetch('/api/upload_asset', { method: 'POST', body: formData });
    inputEl.value = ''; await fetchAssets();
    if(type === 'emojis' || type === 'stickers') { document.getElementById('stickers-panel').style.display = 'none'; toggleEmojiPanel(); }
}

async function toggleEmojiPanel() {
    const panel = document.getElementById('stickers-panel');
    if(panel.style.display === 'flex') { panel.style.display = 'none'; return; }
    await fetchAssets();
    panel.innerHTML = `
        <div class="asset-section-title">Эмодзи <label class="add-asset-btn">+<input type="file" accept="image/*" onchange="uploadAsset(this, 'emojis')"></label></div>
        <div class="asset-grid">${DEFAULT_EMOJIS.map(e => `<span onclick="insertEmoji('${e}')">${e}</span>`).join('')}${CUSTOM_EMOJIS.map(src => `<img src="${src}" class="emoji-img" onclick="insertEmojiHtml('${src}')">`).join('')}</div>
        <div class="asset-section-title">Стикеры <label class="add-asset-btn">+<input type="file" accept="image/*" onchange="uploadAsset(this, 'stickers')"></label></div>
        <div class="asset-grid">${CUSTOM_STICKERS.map(src => `<img src="${src}" class="sticker-img" onclick="sendSticker('${src}')">`).join('')}</div>
    `;
    panel.style.display = 'flex';
}

function insertEmoji(text) { const ci = document.getElementById('chat-text'); ci.focus(); document.execCommand('insertText', false, text); }
function insertEmojiHtml(src) { const ci = document.getElementById('chat-text'); ci.focus(); document.execCommand('insertImage', false, src); }
function sendSticker(src) { sendEncryptedPayload('', src); document.getElementById('stickers-panel').style.display = 'none'; }

// АВТОРИЗАЦИЯ
window.onload = async function() {
    const savedUser = localStorage.getItem('savedUsername');
    if (savedUser) {
        const res = await fetch(`/api/get_user/${savedUser}`);
        if (res.ok) {
            const data = await res.json(); currentUser = data.username;
            document.getElementById('my-avatar').src = data.avatar; document.getElementById('display-name').innerText = currentUser;
            startApp();
        } else localStorage.removeItem('savedUsername');
    }
    if (!isCryptoAvailable) console.warn("E2EE отключено.");
};

async function auth(endpoint) {
    const user = document.getElementById('username').value.trim(), pass = document.getElementById('password').value.trim(), errorDiv = document.getElementById('auth-error');
    if (!isCryptoAvailable || typeof CryptoE2E === 'undefined') { errorDiv.style.display = "block"; errorDiv.innerHTML = "<b>Ошибка:</b> E2EE недоступен. Используйте HTTPS."; return; }
    if (!user || !pass) return errorDiv.style.display = "block", errorDiv.innerText = "Заполните поля";

    let payload = { username: user, password: pass, public_key: "no_crypto" };

    if (endpoint === 'register') { errorDiv.innerText = "Генерация ключей..."; errorDiv.style.display = "block"; payload.public_key = await CryptoE2E.generateKeyPair(); }
     if (isCryptoAvailable && typeof CryptoE2E !== 'undefined') {
        const hasKey = await KeyDB.getKey(); // Проверяем, есть ли уже ключ на этом устройстве
        if (endpoint === 'register' || !hasKey) {
            errorDiv.innerText = "Генерация ключей шифрования..."; errorDiv.style.display = "block";
            payload.public_key = await CryptoE2E.generateKeyPair();
        }
    }
    const res = await fetch(`/api/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await res.json();
    if (res.ok) {
        if(endpoint === 'register') return alert('Успешно!');
        currentUser = data.username; localStorage.setItem('savedUsername', currentUser);
        document.getElementById('my-avatar').src = data.avatar; document.getElementById('display-name').innerText = currentUser;
        startApp();
    } else { errorDiv.innerText = data.error; errorDiv.style.display = "block"; }
}

function login() { auth('login'); } function register() { auth('register'); } function logout() { localStorage.removeItem('savedUsername'); location.reload(); }
function toggleSidebar() { document.getElementById('sidebar').classList.toggle('collapsed'); }

async function uploadAvatar() { const file = document.getElementById('avatar-input').files[0]; if (!file) return; const formData = new FormData(); formData.append('file', file); formData.append('username', currentUser); const res = await fetch('/api/upload_avatar', { method: 'POST', body: formData }); if (res.ok) document.getElementById('my-avatar').src = (await res.json()).avatar; }

// КОМНАТЫ И СТРИМ
async function loadRooms(forceRoomId = null) {
    const res = await fetch(`/api/rooms/${currentUser}`); myRooms = await res.json();
    const list = document.getElementById('rooms-list'); list.innerHTML = '';

    for (const room of myRooms) {
        // Дешифровка последнего сообщения для списка чатов
        let lastMsgTxt = "Нет сообщений";
        if (room.last_media) lastMsgTxt = "📷 Фотография";
        else if (room.last_text) {
            if (room.last_text.includes('|||') && isCryptoAvailable && typeof CryptoE2E !== 'undefined') {
                try {
                    const parts = room.last_text.split('|||');
                    const dec = await CryptoE2E.decryptForMe(currentUser, parts[0], parts[1], room.last_keys);
                    lastMsgTxt = typeof dec === 'object' ? dec.text : dec;
                } catch(e) { lastMsgTxt = "Зашифровано"; }
            } else { lastMsgTxt = room.last_text; }
        }

        const div = document.createElement('div');
        div.className = `room-item ${room.id === currentRoomId ? 'active' : ''}`;
        div.innerHTML = `<div class="room-item-content"><div class="room-name">${room.name}</div><div class="room-last-msg">${lastMsgTxt}</div></div>`;
        div.onclick = () => switchRoom(room.id, room.name, room.stream_url);
        list.appendChild(div);
    }

    if (forceRoomId) { const room = myRooms.find(r => r.id === forceRoomId); if(room) switchRoom(room.id, room.name, room.stream_url); }
}

async function createRoom() { const n = prompt("Название:"); if(n) { const r = await fetch('/api/create_room', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: n, owner: currentUser }) }); if(r.ok) loadRooms((await r.json()).room.id); } }
async function inviteUser() { const u = prompt(`Логин:`); if(u) { const r = await fetch('/api/invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room_id: currentRoomId, username: u }) }); alert((await r.json()).success ? "Добавлен!" : "Ошибка."); } document.getElementById("chat-menu").classList.remove("show");}
async function leaveRoom() { if(confirm("Выйти?")) { const r = await fetch('/api/leave_room', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ room_id: currentRoomId, username: currentUser }) }); if(r.ok) resetChatView(); } }
async function deleteRoom() { if(confirm("Удалить?")) { const r = await fetch('/api/delete_room', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ room_id: currentRoomId, username: currentUser }) }); if(r.ok) resetChatView(); } }
function resetChatView() { currentRoomId = null; document.getElementById('chat-interface').style.display = 'none'; document.getElementById('placeholder-screen').style.display = 'flex'; loadRooms(); }

function toggleStreamPrompt() {
    document.getElementById("chat-menu").classList.remove("show");
    const b = document.getElementById('menu-stream');
    if (b.innerText.includes('Остановить')) { if(confirm("Остановить для всех?")) setStream(""); }
    else { const u = prompt("Ссылка (MediaMTX):"); if (u) setStream(u); }
}
async function setStream(url) { await fetch('/api/set_stream', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room_id: currentRoomId, stream_url: url }) }); }

function renderMembers() {
    if(!currentRoomId) return; const list = document.getElementById('members-list'); list.innerHTML = '';
    currentRoomMembers.sort((a, b) => { const aO = globalOnlineUsers.has(a.username), bO = globalOnlineUsers.has(b.username); if (aO && !bO) return -1; if (!aO && bO) return 1; return a.username.localeCompare(b.username); });
    currentRoomMembers.forEach(m => { const o = globalOnlineUsers.has(m.username); list.innerHTML += `<div class="member-item" onclick="insertMention('${m.username}')"><img src="${m.avatar}"><div class="name">${m.username}</div><div class="status-dot ${o ? 'online' : ''}"></div></div>`; });
}

async function switchRoom(roomId, roomName, streamUrl) {
    if (inVoiceChat) leaveVoice();
    currentRoomId = roomId; currentRoomName = roomName; lastSender = null; cancelReply(); cancelEdit(); currentlyTyping.clear(); updateTypingUI(); cancelMedia();
    document.getElementById('placeholder-screen').style.display = 'none'; document.getElementById('chat-interface').style.display = 'flex'; document.getElementById('current-room-name').innerText = roomName;
    const rData = myRooms.find(r => r.id === roomId), bL = document.getElementById('btn-leave-room'), bD = document.getElementById('btn-delete-room');
    if (rData && rData.owner === currentUser) { bD.style.display = 'block'; bL.style.display = 'none'; } else { bD.style.display = 'none'; bL.style.display = 'block'; }
    document.querySelectorAll('.room-item').forEach(el => el.classList.remove('active')); Array.from(document.querySelectorAll('.room-item')).find(el => el.innerText === roomName)?.classList.add('active');
    updateStreamUI(streamUrl); document.getElementById('messages').innerHTML = '';

    await fetchAssets();
    if (socket) socket.emit('join room', { room_id: roomId });
    const res = await fetch(`/api/history/${roomId}`); if(res.ok) { const history = await res.json(); for (const msg of history) { await renderMessage(msg, true); } const c = document.getElementById('messages'); c.scrollTop = c.scrollHeight; }
    const mRes = await fetch(`/api/room_members/${roomId}`); if(mRes.ok) { currentRoomMembers = await mRes.json(); renderMembers(); }
}


// ==========================================
// 🎙️ ГОЛОСОВЫЕ ЗВОНКИ И UI АВАТАРОВ
// ==========================================
function updateVoiceParticipantsUI() {
    const panel = document.getElementById('voice-participants-panel');
    const container = document.getElementById('voice-avatars');
    container.innerHTML = '';

    if (voiceUsersInRoom.size === 0) {
        panel.style.display = 'none';
    } else {
        panel.style.display = 'flex';
        // Берем аватарки из списка участников комнаты
        voiceUsersInRoom.forEach(uname => {
            const member = currentRoomMembers.find(m => m.username === uname);
            if (member) {
                container.innerHTML += `<img src="${member.avatar}" class="voice-avatar" title="${uname}">`;
            }
        });
    }
}

async function toggleVoice() {
    if (inVoiceChat) leaveVoice(); else await joinVoice();
}

async function joinVoice() {
    try {
        localAudioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        inVoiceChat = true;
        const btn = document.getElementById('btn-voice');
        btn.classList.add('active');

        voiceUsersInRoom.add(currentUser);
        updateVoiceParticipantsUI();

        socket.emit('join_voice', { room_id: currentRoomId });
    } catch (e) { alert("Ошибка доступа к микрофону!"); }
}

function leaveVoice() {
    inVoiceChat = false;
    if (localAudioStream) { localAudioStream.getTracks().forEach(t => t.stop()); localAudioStream = null; }
    for (let user in peerConnections) { peerConnections[user].close(); delete peerConnections[user]; }
    document.getElementById('voice-container').innerHTML = '';

    const btn = document.getElementById('btn-voice');
    btn.classList.remove('active');

    voiceUsersInRoom.delete(currentUser);
    updateVoiceParticipantsUI();

    if (socket) socket.emit('leave_voice', { room_id: currentRoomId });
}

function createPeerConnection(peerUsername) {
    const pc = new RTCPeerConnection(WEBRTC_CONFIG);
    peerConnections[peerUsername] = pc;
    pc.onicecandidate = event => { if (event.candidate) socket.emit('webrtc_signal', { target: peerUsername, room_id: currentRoomId, signal: { candidate: event.candidate } }); };
    pc.ontrack = event => {
        let audioEl = document.getElementById(`audio-${peerUsername}`);
        if (!audioEl) { audioEl = document.createElement('audio'); audioEl.id = `audio-${peerUsername}`; audioEl.autoplay = true; document.getElementById('voice-container').appendChild(audioEl); }
        audioEl.srcObject = event.streams[0];
    };
    return pc;
}


// ==========================================
// УПОМИНАНИЯ, РЕДАКТИРОВАНИЕ, УДАЛЕНИЕ
// ==========================================
function insertMention(username) { const ci = document.getElementById('chat-text'); ci.focus(); document.execCommand('insertText', false, `@${username} `); }
function parseMentions(text) { return text.replace(/@([a-zA-Z0-9_А-Яа-я]+)/g, '<span class="mention">@$1</span>'); }

function initReply(msgId, username) {
    cancelEdit(); replyingToId = msgId; document.getElementById('reply-name').innerText = username;
    const msgEl = document.getElementById(`msg-${msgId}`); let txt = '';
    if (msgEl) { const textDiv = msgEl.querySelector('.msg-text'), mediaImg = msgEl.querySelector('.chat-media'); if (textDiv) txt = textDiv.innerHTML; if (mediaImg) txt = '📷 Медиа ' + txt; }
    document.getElementById('reply-text').innerHTML = txt || 'Сообщение'; document.getElementById('reply-indicator').style.display = 'flex'; document.getElementById('chat-text').focus();
}
function cancelReply() { replyingToId = null; document.getElementById('reply-indicator').style.display = 'none'; }
function scrollToMsg(msgId) { const el = document.getElementById(`msg-${msgId}`); if (el) { el.scrollIntoView({behavior: 'smooth', block: 'center'}); el.style.background = 'rgba(255, 255, 255, 0.1)'; setTimeout(() => el.style.background = 'transparent', 500); } }

function initEdit(msgId) {
    cancelReply(); editingMsgId = msgId;
    const textHtml = document.getElementById(`msg-text-${msgId}`).innerHTML;
    const input = document.getElementById('chat-text'); input.innerHTML = textHtml; input.focus();
    document.getElementById('reply-name').innerText = "Редактирование"; document.getElementById('reply-text').innerHTML = "Исправьте сообщение и нажмите Отправить";
    document.getElementById('reply-indicator').style.display = 'flex'; document.querySelector('.chat-input-wrapper').classList.add('editing');
}
function cancelEdit() { editingMsgId = null; document.getElementById('reply-indicator').style.display = 'none'; document.querySelector('.chat-input-wrapper').classList.remove('editing'); document.getElementById('chat-text').innerHTML = ''; }
function deleteMsg(msgId) { if(confirm('Удалить сообщение?')) socket.emit('delete message', { msg_id: msgId, room_id: currentRoomId, username: currentUser }); }

function toggleReactionPicker(msgId) {
    const p = document.getElementById(`picker-${msgId}`); const row = document.getElementById(`msg-${msgId}`); const isVisible = p.style.display === 'flex';
    document.querySelectorAll('.reaction-picker').forEach(el => el.style.display = 'none'); document.querySelectorAll('.message-row').forEach(el => el.classList.remove('picker-open'));
    if (!isVisible) {
        p.innerHTML = `
            <div class="asset-section-title">Реакции <label class="add-asset-btn" title="Добавить">+<input type="file" accept="image/*" onchange="uploadAsset(this, 'reactions'); setTimeout(()=>toggleReactionPicker('${msgId}'), 500);"></label></div>
            <div class="asset-grid" style="border-bottom: 1px solid #333; padding-bottom: 5px; margin-bottom: 5px;">${DEFAULT_REACTIONS.map(e => `<span onclick="sendReaction('${msgId}', '${e}')">${e}</span>`).join('')}</div>
            <div class="asset-grid">${CUSTOM_REACTIONS.map(e => `<img class="emoji-img" src="${e}" onclick="sendReaction('${msgId}', '${e}')">`).join('')}</div>
        `;
        p.style.display = 'flex'; if(row) row.classList.add('picker-open');
    }
}
function sendReaction(msgId, emoji) { socket.emit('chat reaction', { msg_id: msgId, room_id: currentRoomId, reaction: emoji, username: currentUser }); document.getElementById(`picker-${msgId}`).style.display = 'none'; document.getElementById(`msg-${msgId}`).classList.remove('picker-open'); }

// ==========================================
// РЕНДЕР СООБЩЕНИЙ С E2EE ДЕШИФРОВКОЙ
// ==========================================
async function renderMessage(msg, isHistory = false) {
    if (!isHistory && msg.room_id !== currentRoomId) return;
    const isMine = msg.username === currentUser;
    const isGrouped = (msg.username === lastSender) && !msg.reply_to; lastSender = msg.username;

    let decryptedText = msg.text || '';
    let decryptedMedia = msg.media || '';

    if (decryptedText.includes('|||') && isCryptoAvailable && typeof CryptoE2E !== 'undefined') {
        try {
            const parts = decryptedText.split('|||');
            const decryptedObj = await CryptoE2E.decryptForMe(currentUser, parts[0], parts[1], msg.encrypted_keys);
            if(typeof decryptedObj === 'object' && decryptedObj !== null) {
                decryptedText = decryptedObj.text || ''; decryptedMedia = decryptedObj.media || '';
            } else { decryptedText = decryptedObj; }
        } catch (e) { decryptedText = "[Ошибка дешифровки]"; }
    }

    const msgDiv = document.createElement('div');
    msgDiv.className = `message-row ${isMine ? 'mine' : ''} ${isGrouped ? 'grouped' : ''}`;
    msgDiv.id = `msg-${msg.id}`;

    const renderReactionIcon = (reaction) => reaction.startsWith('/') ? `<img src="${reaction}">` : reaction;

    let replyHtml = '';
    if (msg.reply_to) {
        let replyDecryptedText = msg.reply_to.text || '';
        let replyDecryptedMedia = msg.reply_to.media || '';

        if (replyDecryptedText.includes('|||') && typeof isCryptoAvailable !== 'undefined' && isCryptoAvailable && typeof CryptoE2E !== 'undefined') {
            try {
                const parts = replyDecryptedText.split('|||');
                const replyObj = await CryptoE2E.decryptForMe(currentUser, parts[0], parts[1], msg.reply_to.encrypted_keys);
                if(typeof replyObj === 'object' && replyObj !== null) {
                    replyDecryptedText = replyObj.text || ''; replyDecryptedMedia = replyObj.media || '';
                } else { replyDecryptedText = replyObj; }
            } catch (e) { replyDecryptedText = "[Ошибка дешифровки]"; }
        }

        let rTxt = replyDecryptedText; if (replyDecryptedMedia) rTxt = '📷 Медиа ' + rTxt;
        replyHtml = `<div class="replied-message" onclick="scrollToMsg('${msg.reply_to.id}')"><div class="rep-name">${msg.reply_to.username}</div><div class="rep-text">${rTxt}</div></div>`;
    }

    let mediaHtml = decryptedMedia ? `<img src="${decryptedMedia}" class="chat-media">` : '';

    let parsedText = parseMentions(decryptedText);
    if (parsedText && typeof marked !== 'undefined') { marked.setOptions({ breaks: true }); parsedText = marked.parse(parsedText); }

    let editedHtml = msg.is_edited ? `<span class="edited-tag" id="edited-${msg.id}">(изменено)</span>` : `<span class="edited-tag" id="edited-${msg.id}" style="display:none;">(изменено)</span>`;
    let textHtml = decryptedText ? `<div class="msg-text" id="msg-text-${msg.id}">${parsedText}</div>${editedHtml}` : editedHtml;

    let reactionsHtml = '';
    if (msg.reactions) {
        for (const [e, users] of Object.entries(msg.reactions)) {
            if (users.length === 0) continue; const isMe = users.includes(currentUser);
            reactionsHtml += `<div class="reaction-badge ${isMe ? 'reacted-by-me' : ''}" onclick="sendReaction('${msg.id}', '${e}')">${renderReactionIcon(e)} ${users.length}</div>`;
        }
    }

    let extraActions = isMine ? `<div class="msg-action-btn" onclick="initEdit('${msg.id}')" title="Редактировать">✏️</div><div class="msg-action-btn" onclick="deleteMsg('${msg.id}')" title="Удалить" style="color: #ff6b6b;">🗑</div>` : '';

    msgDiv.innerHTML = `
        <img src="${msg.avatar}" class="avatar">
        <div class="message-column">
            <div class="message-content">
                ${replyHtml}
                <div class="meta"><span class="username" onclick="insertMention('${msg.username}')">${msg.username}</span> <span>${msg.time}</span></div>
                ${mediaHtml}
                ${textHtml}
                <div class="msg-actions">${extraActions}<div class="msg-action-btn" onclick="initReply('${msg.id}', '${msg.username}')">↩</div><div class="msg-action-btn" onclick="toggleReactionPicker('${msg.id}')">☻</div></div>
                <div class="reaction-picker" id="picker-${msg.id}"></div>
            </div>
            <div class="reactions-list" id="reactions-${msg.id}">${reactionsHtml}</div>
        </div>
    `;
    const c = document.getElementById('messages'); c.appendChild(msgDiv); if(!isHistory) c.scrollTop = c.scrollHeight;

    const textElement = document.getElementById(`msg-text-${msg.id}`);
    if (textElement && window.renderMathInElement) { renderMathInElement(textElement, { delimiters: [ {left: '$$', right: '$$', display: true}, {left: '$', right: '$', display: false} ], throwOnError: false }); }
}

function onInputTyping() {
    if (!socket || !currentRoomId) return; socket.emit('typing', { room_id: currentRoomId, username: currentUser, is_typing: true });
    clearTimeout(typingTimeout); typingTimeout = setTimeout(() => { socket.emit('typing', { room_id: currentRoomId, username: currentUser, is_typing: false }); }, 2000);
}
function updateTypingUI() { const ti = document.getElementById('typing-indicator'); if (currentlyTyping.size === 0) ti.style.display = 'none'; else { ti.innerText = `${Array.from(currentlyTyping).join(', ')} печатает...`; ti.style.display = 'block'; } }
document.getElementById('chat-text').addEventListener('input', onInputTyping);

// ==========================================
// ИНИЦИАЛИЗАЦИЯ СОКЕТОВ
// ==========================================
async function startApp() {
    document.getElementById('auth-screen').style.display = 'none'; document.getElementById('main-app').style.display = 'flex';
    if (!socket) {
        socket = io();
        socket.on('connect', () => {
            socket.emit('user_online');
            if (currentRoomId) socket.emit('join room', { room_id: currentRoomId });
        });

        socket.on('sync_online_users', (l) => { globalOnlineUsers = new Set(l); renderMembers(); });
        socket.on('user_status', (d) => { if (d.status === 'online') globalOnlineUsers.add(d.username); else globalOnlineUsers.delete(d.username); renderMembers(); });
        socket.on('typing', (d) => { if (d.room_id !== currentRoomId || d.username === currentUser) return; if (d.is_typing) currentlyTyping.add(d.username); else currentlyTyping.delete(d.username); updateTypingUI(); });
        socket.on('member_added', (m) => { if(m.room_id === currentRoomId) { currentRoomMembers.push(m); renderMembers(); } });
        socket.on('you_were_invited', () => { loadRooms(); });

        socket.on('chat message', async (msg) => {
            await renderMessage(msg);
            currentlyTyping.delete(msg.username); updateTypingUI();
            loadRooms(); // Обновляем левое меню (чтобы обновилось "последнее сообщение")
        });

        socket.on('stream updated', (d) => { if (d.room_id === currentRoomId) updateStreamUI(d.stream_url); });
        socket.on('asset_added', async (data) => { await fetchAssets(); const p = document.getElementById('stickers-panel'); if (p && p.style.display === 'flex') { p.style.display = 'none'; toggleEmojiPanel(); } });
        socket.on('message deleted', (data) => { const el = document.getElementById(`msg-${data.msg_id}`); if (el) el.remove(); loadRooms(); });

        socket.on('message edited', async (data) => {
            const textEl = document.getElementById(`msg-text-${data.msg_id}`); const tagEl = document.getElementById(`edited-${data.msg_id}`);
            if (textEl) {
                let decryptedText = data.text || '';
                if (decryptedText.includes('|||') && isCryptoAvailable && typeof CryptoE2E !== 'undefined') {
                    try { const parts = decryptedText.split('|||'); const decryptedObj = await CryptoE2E.decryptForMe(currentUser, parts[0], parts[1], data.encrypted_keys); if(typeof decryptedObj === 'object' && decryptedObj !== null) { decryptedText = decryptedObj.text || ''; } else { decryptedText = decryptedObj; } } catch (e) { decryptedText = "[Ошибка дешифровки]"; }
                }
                let p = parseMentions(decryptedText); if(typeof marked !== 'undefined'){ marked.setOptions({ breaks: true }); p = marked.parse(p); } textEl.innerHTML = p;
                if (window.renderMathInElement) { renderMathInElement(textEl, { delimiters: [ {left: '$$', right: '$$', display: true}, {left: '$', right: '$', display: false} ], throwOnError: false }); }
            }
            if (tagEl) tagEl.style.display = 'inline';
            loadRooms();
        });

        socket.on('update reactions', (d) => {
            const c = document.getElementById(`reactions-${d.msg_id}`); if (!c) return; c.innerHTML = '';
            const renderReactionIcon = (reaction) => reaction.startsWith('/') ? `<img src="${reaction}">` : reaction;
            for (const [e, users] of Object.entries(d.reactions)) {
                if(users.length === 0) continue; const isMe = users.includes(currentUser);
                const badge = document.createElement('div'); badge.className = `reaction-badge ${isMe ? 'reacted-by-me' : ''}`;
                badge.innerHTML = `${renderReactionIcon(e)} ${users.length}`; badge.onclick = () => sendReaction(d.msg_id, e); c.appendChild(badge);
            }
        });

        // WEBRTC ЗВОНКИ
        socket.on('user_joined_voice', async (data) => {
            if (!inVoiceChat || data.room_id !== currentRoomId) return;
            const peerUsername = data.username;

            voiceUsersInRoom.add(peerUsername);
            updateVoiceParticipantsUI();

            const pc = createPeerConnection(peerUsername);
            localAudioStream.getTracks().forEach(t => pc.addTrack(t, localAudioStream));
            const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
            socket.emit('webrtc_signal', { target: peerUsername, room_id: currentRoomId, signal: { type: 'offer', sdp: offer } });
        });

        socket.on('user_left_voice', (data) => {
            const peerUsername = data.username;
            if (peerConnections[peerUsername]) { peerConnections[peerUsername].close(); delete peerConnections[peerUsername]; }
            const audioEl = document.getElementById(`audio-${peerUsername}`); if (audioEl) audioEl.remove();

            voiceUsersInRoom.delete(peerUsername);
            updateVoiceParticipantsUI();
        });

        socket.on('webrtc_signal', async (data) => {
            if (!inVoiceChat || data.room_id !== currentRoomId) return;
            const peerUsername = data.from; const signal = data.signal;
            let pc = peerConnections[peerUsername];
            if (signal.type === 'offer') {
                if (!pc) { pc = createPeerConnection(peerUsername); localAudioStream.getTracks().forEach(t => pc.addTrack(t, localAudioStream)); }
                await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
                const answer = await pc.createAnswer(); await pc.setLocalDescription(answer);
                socket.emit('webrtc_signal', { target: peerUsername, room_id: currentRoomId, signal: { type: 'answer', sdp: answer } });
                voiceUsersInRoom.add(peerUsername); updateVoiceParticipantsUI();
            } else if (signal.type === 'answer') { if (pc) await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
            } else if (signal.candidate) { if (pc) await pc.addIceCandidate(new RTCIceCandidate(signal.candidate)); }
        });
    }
    await loadRooms();
}

async function sendEncryptedPayload(textHtml, mediaContent) {
    if (!socket || !currentRoomId) return;

    let finalPayloadText = textHtml;
    let finalPayloadMedia = mediaContent || '';
    let encryptedKeys = "{}";

    if (isCryptoAvailable && typeof CryptoE2E !== 'undefined') {
        try {
            const keysRes = await fetch(`/api/room_keys/${currentRoomId}`);
            const membersPublicKeys = await keysRes.json();
            const payloadObj = { text: textHtml, media: finalPayloadMedia };
            const encryptedData = await CryptoE2E.encryptForRoom(payloadObj, membersPublicKeys);
            finalPayloadText = encryptedData.cipherText + "|||" + encryptedData.iv;
            finalPayloadMedia = "";
            encryptedKeys = encryptedData.encryptedKeys;
        } catch(e) { console.error("E2EE Ошибка", e); }
    }

    if (editingMsgId) {
        socket.emit('edit message', { msg_id: editingMsgId, room_id: currentRoomId, username: currentUser, text: finalPayloadText, encrypted_keys: encryptedKeys });
        cancelEdit();
    } else {
        socket.emit('chat message', { username: currentUser, room_id: currentRoomId, text: finalPayloadText, media: finalPayloadMedia, encrypted_keys: encryptedKeys, reply_to_id: replyingToId });
        cancelReply();
    }
    socket.emit('typing', { room_id: currentRoomId, username: currentUser, is_typing: false });
}

async function sendMessage() {
    const input = document.getElementById('chat-text');
    let textHtml = input.innerHTML.trim();
    if (textHtml === '<br>' || textHtml === '<div><br></div>' || textHtml === '&nbsp;') textHtml = '';

    if (textHtml !== '' || selectedMediaBase64 !== null) {
        await sendEncryptedPayload(textHtml, selectedMediaBase64);
        input.innerHTML = '';
        cancelMedia();
    }
}

document.getElementById('chat-text').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); setTimeout(() => { sendMessage(); }, 10); }
});

document.addEventListener('click', e => {
    if (!e.target.closest('.msg-actions') && !e.target.closest('.reaction-picker') && !e.target.closest('.reaction-badge')) { document.querySelectorAll('.reaction-picker').forEach(el => el.style.display = 'none'); document.querySelectorAll('.message-row').forEach(el => el.classList.remove('picker-open')); }
    if (!e.target.closest('.stickers-panel') && !e.target.closest('.attach-btn')) { const p = document.getElementById('stickers-panel'); if(p) p.style.display = 'none'; }
    if (!e.target.closest('.dropdown') && !e.target.closest('.icon-btn')) { const m = document.getElementById('chat-menu'); if(m) m.classList.remove('show'); }
});