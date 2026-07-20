import React, { useRef, useState, useEffect } from 'react';
import { useChatStore } from '../store/useChatStore';
import { Paperclip, Send, Reply, Pencil, Smile } from 'lucide-react';
import { api } from '../services/api';
import { CryptoE2E } from '../utils/crypto';
import { DecryptedReply } from './ChatArea';

export default function ChatInput() {
    const {
        socket,
        currentRoomId,
        currentUser,
        replyingTo,
        editingMsgId,
        editingMsgText,
        editingMsgMedia,
        clearInputState
    } = useChatStore();

    const [text, setText] = useState('');
    const [selectedMedia, setSelectedMedia] = useState<string | null>(null);
    const inputRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (editingMsgId) {
            if (editingMsgText !== null) {
                setText(editingMsgText);
                if (inputRef.current) {
                    inputRef.current.innerHTML = editingMsgText;
                    const range = document.createRange();
                    const sel = window.getSelection();
                    if (inputRef.current.childNodes.length > 0) {
                        range.setStartAfter(inputRef.current.lastChild as Node);
                    } else {
                        range.selectNodeContents(inputRef.current);
                    }
                    range.collapse(false);
                    sel?.removeAllRanges();
                    sel?.addRange(range);
                    inputRef.current.focus();
                }
            }
            if (editingMsgMedia) {
                setSelectedMedia(editingMsgMedia);
            }
        } else if (!editingMsgId && !replyingTo) {
            setText('');
            setSelectedMedia(null);
            if (inputRef.current) inputRef.current.innerHTML = '';
        }
    }, [editingMsgId, editingMsgText, editingMsgMedia]);

    const handleSend = async () => {
        let domText = inputRef.current?.innerHTML || '';

        // Strip out any tags except img
        // First convert breaks to newlines
        domText = domText.replace(/<div[^>]*>/gi, '\n');
        domText = domText.replace(/<p[^>]*>/gi, '\n');
        domText = domText.replace(/<br\s*\/?>/gi, '\n');
        // Remove closing div/p
        domText = domText.replace(/<\/div>|<\/p>/gi, '');
        // Strip all remaining tags except img
        domText = domText.replace(/<(?!img\s|\/?img>)[^>]+>/gi, '');

        const currentText = domText.trim() ? domText.trim() : text.trim();

        if (!currentText && !selectedMedia) return;

        let finalMediaPayload = selectedMedia || '';

        setText('');
        setSelectedMedia(null);
        clearInputState();
        if (inputRef.current) inputRef.current.innerHTML = '';
        socket?.emit('typing', { room_id: currentRoomId, username: currentUser, is_typing: false });

        let finalText = currentText;
        let encryptedKeys = "{}";

        try {
            const membersKeys = useChatStore.getState().roomKeys;
            const hasKeys = Object.keys(membersKeys).length > 0;
            if (hasKeys) {
                const enc = await CryptoE2E.encryptForRoom({ text: currentText, media: finalMediaPayload }, membersKeys as Record<string, string>);
                finalText = enc.cipherText + "|||" + enc.iv;
                finalMediaPayload = "";
                encryptedKeys = enc.encryptedKeys;
            }
        } catch (e) {
            console.error("Encryption error", e);
        }

        if (editingMsgId) {
            socket?.emit('edit message', {
                msg_id: editingMsgId,
                room_id: currentRoomId,
                username: currentUser,
                text: finalText,
                encrypted_keys: encryptedKeys
            });
        } else {
            socket?.emit('chat message', {
                username: currentUser,
                room_id: currentRoomId,
                text: finalText,
                media: finalMediaPayload,
                encrypted_keys: encryptedKeys,
                reply_to_id: replyingTo?.id
            });
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        } else {
            socket?.emit('typing', { room_id: currentRoomId, username: currentUser, is_typing: true });
        }
    };

    const handleInput = (e: React.FormEvent<HTMLDivElement>) => {
        setText(e.currentTarget.innerHTML);
    };

    const [showAssets, setShowAssets] = useState(false);
    const [assets, setAssets] = useState<{emojis: string[], stickers: string[]}>({emojis: [], stickers: []});

    const loadAssets = async () => {
        if (!currentUser) return;
        try {
            const [emRes, stRes] = await Promise.all([
                api.getAssets('emojis', currentUser),
                api.getAssets('stickers', currentUser)
            ]);
            let emojis = [], stickers = [];
            if (emRes.ok) emojis = await emRes.json();
            if (stRes.ok) stickers = await stRes.json();
            setAssets({ emojis, stickers });
        } catch (e) { console.error(e); }
    };

    const handleUploadAsset = async (type: string, e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !currentUser) return;
        const formData = new FormData();
        formData.append('file', file);
        formData.append('type', type);
        formData.append('username', currentUser);
        try {
            const res = await api.uploadAsset(formData);
            if (res.ok) {
                loadAssets();
            }
        } catch (error) { console.error(error); }
    };

    const insertAsset = (url: string, isSticker: boolean) => {
        if (isSticker) {
            const sendStickerAsync = async () => {
                let finalText = "";
                let finalMediaPayload = url;
                let encryptedKeys = "{}";
                try {
                    const membersKeys = useChatStore.getState().roomKeys;
                    if (Object.keys(membersKeys).length > 0) {
                        const enc = await CryptoE2E.encryptForRoom({ text: "", media: url }, membersKeys as Record<string, string>);
                        finalText = enc.cipherText + "|||" + enc.iv;
                        encryptedKeys = enc.encryptedKeys;
                        finalMediaPayload = "";
                    }
                } catch (e) { console.error(e); }

                socket?.emit('chat message', {
                    username: currentUser,
                    room_id: currentRoomId,
                    text: finalText,
                    media: finalMediaPayload,
                    encrypted_keys: encryptedKeys,
                    reply_to_id: replyingTo?.id
                });
            };
            sendStickerAsync();
            setShowAssets(false);
        } else {
            const isTextEmoji = !url.startsWith('data:') && !url.startsWith('http') && !url.startsWith('/');
            const imgHtml = isTextEmoji ? url : ` <img src="${url}" class="inline-emoji" alt="emoji"/> `;
            setText(prev => prev + imgHtml);
            if (inputRef.current) {
               inputRef.current.innerHTML += imgHtml;
               const range = document.createRange();
               const sel = window.getSelection();
               range.selectNodeContents(inputRef.current);
               range.collapse(false);
               sel?.removeAllRanges();
               sel?.addRange(range);
            }
        }
    };

    const handleMediaSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas'); const MAX_WIDTH = 1200; let scaleSize = 1;
                if (img.width > MAX_WIDTH) scaleSize = MAX_WIDTH / img.width;
                canvas.width = img.width * scaleSize; canvas.height = img.height * scaleSize;
                const ctx = canvas.getContext("2d");
                if (ctx) {
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    setSelectedMedia(canvas.toDataURL("image/jpeg", 0.7));
                }
            };
            img.src = ev.target?.result as string;
        };
        reader.readAsDataURL(file);
        e.target.value = '';
    };

    return (
        <div className="chat-input-container relative shrink-0">
            {(replyingTo || editingMsgId) && (
                <div className="reply-indicator flex bg-[#161618] shadow-sm border-l-4 border-l-blue-500 border border-white/5 rounded-lg mb-2 items-center px-3 py-2">
                    <div className="reply-indicator-content flex-1 max-w-full overflow-hidden">
                        <div className="rep-name flex items-center gap-1 text-sm text-white/80 font-semibold mb-[2px]">
                            {editingMsgId ? <><Pencil size={14}/> Редактирование</> : <><Reply size={14}/> Ответ {replyingTo?.username}</>}
                        </div>
                        <div className="rep-text text-sm text-white/50 truncate w-full">
                            {editingMsgId ? "Исправьте сообщение..." : (
                                replyingTo ? <DecryptedReply reply={replyingTo} currentUser={currentUser || ''} /> : "Медиа/Фрагмент"
                            )}
                        </div>
                    </div>
                    <div className="reply-cancel cursor-pointer text-white/40 hover:text-red-500 hover:bg-white/10 pt-0.5 pb-0.5 px-2 rounded-full font-bold ml-2 transition-colors" onClick={clearInputState}>✕</div>
                </div>
            )}

            {selectedMedia && (
                <div className="relative p-2 bg-[#161618] border border-white/5 rounded-lg mb-2 w-max shadow-md group">
                    <img src={selectedMedia} className="max-h-[120px] rounded-md object-contain" alt="Preview"/>
                    <div className="absolute top-1 right-1 sm:opacity-0 sm:group-hover:opacity-100 bg-black/80 text-white hover:text-red-400 p-1 rounded cursor-pointer transition-all" onClick={() => setSelectedMedia(null)}>✕</div>
                </div>
            )}

            {showAssets && (
                <div className="absolute bottom-full left-4 mb-2 w-80 bg-[#161618] border border-white/5 rounded-2xl shadow-2xl p-4 z-50 overflow-hidden animate-in fade-in slide-in-from-bottom-3 duration-200">
                    <div className="flex justify-between items-center mb-2 pb-2 border-b border-white/10">
                        <span className="text-white/80 text-[13px] font-semibold">Эмодзи</span>
                        <label className="text-[11px] bg-white/5 text-white/60 px-2 py-1 rounded cursor-pointer hover:bg-white/10 transition-colors">+ Добавить<input type="file" className="hidden" accept="image/*" onChange={(e) => handleUploadAsset('emojis', e)}/></label>
                    </div>
                    <div className="flex flex-wrap gap-3 mb-4 max-h-32 overflow-y-auto">
                        {['😀','😂','🥰','😎','😢','😡','👍','🔥','🎉','❤️','👀','🤡'].map(e => <span key={e} className="text-2xl cursor-pointer hover:scale-125 transition-transform" onClick={() => insertAsset(e, false)}>{e}</span>)}
                        {assets.emojis.map(e => <img src={e} key={e} className="w-8 h-8 object-contain cursor-pointer hover:scale-125 transition-transform" onClick={() => insertAsset(e, false)}/>)}
                    </div>

                    <div className="flex justify-between items-center mb-2 pb-2 border-b border-white/10">
                        <span className="text-white/80 text-[13px] font-semibold">Стикеры</span>
                        <label className="text-[11px] bg-white/5 text-white/60 px-2 py-1 rounded cursor-pointer hover:bg-white/10 transition-colors">+ Добавить<input type="file" className="hidden" accept="image/*" onChange={(e) => handleUploadAsset('stickers', e)}/></label>
                    </div>
                    <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
                        {assets.stickers.map(s => <img src={s} key={s} className="w-16 h-16 object-contain cursor-pointer hover:bg-white/5 p-1 rounded scale-100 hover:scale-105 transition-all" onClick={() => insertAsset(s, true)}/>)}
                        {assets.stickers.length === 0 && <span className="text-[11px] text-white/40 w-full text-center py-2">Стикеров пока нет</span>}
                    </div>
                </div>
            )}

            <div className="chat-input-row">
                <button className="text-white/40 hover:text-white/80 p-2 transition-colors rounded-full hover:bg-white/5 shrink-0" onClick={() => { setShowAssets(!showAssets); loadAssets(); }}>
                    <Smile size={20} className="opacity-70" />
                </button>
                <label className="text-white/40 hover:text-white/80 p-2 cursor-pointer transition-colors rounded-full hover:bg-white/5 shrink-0" title="Attach file">
                    <Paperclip size={20} className="opacity-70" />
                    <input type="file" style={{ display: 'none' }} accept="image/*" onChange={handleMediaSelect} />
                </label>

                <div
                    ref={inputRef}
                    contentEditable
                    onKeyDown={handleKeyDown}
                    onInput={handleInput}
                    data-placeholder="Type something..."
                    className="flex-1 bg-transparent border-none text-white outline-none min-h-[40px] max-h-[150px] overflow-y-auto px-3 py-[10px] text-base leading-snug cursor-text"
                />

                <button className="btn-send text-white/50 hover:bg-white/10 hover:text-white p-2 rounded-full cursor-pointer transition-colors" title="Send message" onClick={handleSend}>
                    <Send size={20} className="opacity-80 translate-x-[1px] translate-y-[-1px]" />
                </button>
            </div>
        </div>
    );
}
