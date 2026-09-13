import React, { useEffect, useRef, useState } from 'react';
import { Reply, Pencil, Trash, SmilePlus, X, Mic, MicOff, Phone, PhoneOff } from 'lucide-react';
import { CryptoE2E } from '../utils/crypto';
import { useChatStore } from '../store/useChatStore';
import { api } from '../services/api';
import ChatInput from './ChatInput';
import { StreamPlayer } from './StreamPlayer';
import { useVoiceChat } from '../hooks/useVoiceChat';

export function DecryptedReply({ reply, currentUser }: { reply: any, currentUser: string }) {
    const [decMsg, setDecMsg] = useState<{text?: string, media?: string|null} | null>(null);

    useEffect(() => {
        let isMounted = true;
        const decrypt = async () => {
            const text = reply.text || '';
            const media = reply.media || '';

            if (!text || text.indexOf('|||') === -1) {
                if (isMounted) setDecMsg({ text, media });
                return;
            }
            try {
                const [cipherText, iv] = text.split('|||');
                if (!cipherText || !iv) {
                    if (isMounted) setDecMsg({ text, media });
                    return;
                }
                const result = await CryptoE2E.decryptForMe(currentUser, cipherText, iv, reply.encrypted_keys || '{}');
                if (typeof result === 'object' && result !== null) {
                    if (isMounted) setDecMsg(result);
                } else {
                    if (isMounted) setDecMsg({ text: result as string, media });
                }
            } catch (err) {
                if (isMounted) setDecMsg({ text: "[Ошибка дешифровки]", media });
            }
        };
        decrypt();
        return () => { isMounted = false; };
    }, [reply, currentUser]);

    if (!decMsg) return <span>...</span>;

    const isMedia = !!decMsg.media;
    let txt = decMsg.text || '';
    txt = txt.replace(/<img[^>]*src="([^"]+)"[^>]*>/g, ' $1 ');
    txt = txt.replace(/<[^>]*>?/gm, ' ');
    if (isMedia) txt = "📷 Медиа " + txt;

    return <>{txt}</>;
}

export function MessageContent({ m, currentUser }: { m: any, currentUser: string }) {
    const [decryptedMsg, setDecryptedMsg] = useState<{text?: string, media?: string|null} | null>(null);

    useEffect(() => {
        let isMounted = true;
        const decrypt = async () => {
            const text = m.text || '';
            const media = m.media || '';

            if (!text || text.indexOf('|||') === -1) {
                if (isMounted) setDecryptedMsg({ text, media });
                return;
            }
            try {
                const [cipherText, iv] = text.split('|||');
                if (!cipherText || !iv) {
                    if (isMounted) setDecryptedMsg({ text, media });
                    return;
                }
                const result = await CryptoE2E.decryptForMe(currentUser, cipherText, iv, m.encrypted_keys || '{}');
                if (typeof result === 'object' && result !== null) {
                    if (isMounted) setDecryptedMsg(result);
                } else {
                    if (isMounted) setDecryptedMsg({ text: result as string, media });
                }
            } catch (err) {
                if (isMounted) setDecryptedMsg({ text: "[Ошибка дешифровки]", media });
            }
        };
        decrypt();
        return () => { isMounted = false; };
    }, [m.text, m.encrypted_keys, m.media, currentUser]);

    if (!decryptedMsg) return <span className="opacity-50">...</span>;

    const hasHtml = decryptedMsg.text && decryptedMsg.text.includes('<img');

    let cleanText = decryptedMsg.text || '';
    if (!hasHtml) {
        cleanText = cleanText.replace(/<(?!img\s|\/?img>)[^>]+>/gi, '');
    }

    const renderText = !hasHtml && cleanText
        ? cleanText.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/<br\s*\/?>/gi, '\n')
        : cleanText;

    return <>
        {decryptedMsg.media && <img src={decryptedMsg.media} className="chat-media" alt="media" />}
        {decryptedMsg.text && (
            <div className={`msg-text break-words whitespace-pre-wrap max-w-full overflow-hidden ${!decryptedMsg.media ? 'mt-1' : 'mt-2'}`}
                 dangerouslySetInnerHTML={hasHtml ? { __html: decryptedMsg.text } : undefined}>
                {!hasHtml ? renderText : null}
            </div>
        )}
    </>;
}

export default function ChatArea() {
    const {
        socket,
        currentUser,
        currentRoomId,
        currentRoomName,
        messages,
        setMessages,
        addMessage,
        updateMessage,
        deleteMessage,
        roomMembers,
        setRoomMembers,
        onlineUsers,
        myRooms,
        typingUsers
    } = useChatStore();

    const voiceChat = useVoiceChat();
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const reactFileRef = useRef<HTMLInputElement>(null);
    const [streamUrl, setStreamUrl] = useState<string>('');
    const [customReacts, setCustomReacts] = useState<string[]>([]);
    const [reactingToMsgId, setReactingToMsgId] = useState<string | null>(null);
    const [activeMsgId, setActiveMsgId] = useState<string | null>(null);

    useEffect(() => {
        const handleClick = () => {
            setReactingToMsgId(null);
            setActiveMsgId(null);
        };
        window.addEventListener('click', handleClick);
        return () => window.removeEventListener('click', handleClick);
    }, []);

    const [streamWidth, setStreamWidth] = useState(50);
    const [isDragging, setIsDragging] = useState(false);

    const [isInviteOpen, setIsInviteOpen] = useState(false);
    const [inviteUsername, setInviteUsername] = useState("");
    const [isStreamOpen, setIsStreamOpen] = useState(false);
    const [streamInputUrl, setStreamInputUrl] = useState("");

    const handleUploadReaction = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const formData = new FormData();
        formData.append('file', file);
        formData.append('type', 'reactions');
        if (currentUser) formData.append('username', currentUser);
        try {
            const res = await api.uploadAsset(formData);
            if (res.ok) {
                const data = await res.json();
                if (data.success && data.url) {
                    setCustomReacts(prev => [...prev, data.url]);
                } else {
                    alert(data.error || "Ошибка загрузки");
                }
            }
        } catch (err) {
            console.error("Reaction upload failed", err);
        }
    };

    useEffect(() => {
        if (!currentUser) return;
        api.getAssets('reactions', currentUser).then(r => r.json()).then(res => setCustomReacts(res)).catch(()=>null);
    }, [currentUser]);

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isDragging) return;
            const newWidth = (e.clientX / window.innerWidth) * 100;
            if (newWidth > 20 && newWidth < 80) {
                setStreamWidth(newWidth);
            }
        };
        const handleMouseUp = () => setIsDragging(false);

        if (isDragging) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
            document.body.style.userSelect = 'none';
            document.body.style.cursor = 'col-resize';
        } else {
            document.body.style.userSelect = '';
            document.body.style.cursor = '';
        }

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging]);

    useEffect(() => {
        if (!currentRoomId) return;

        if (socket) {
            socket.emit('join room', { room_id: currentRoomId });
        }

        const loadHistoryAndMembers = async () => {
            try {
                const pHistory = api.getHistory(currentRoomId);
                const pMembers = api.getRoomMembers(currentRoomId);
                const pKeys = api.getRoomKeys(currentRoomId);

                const [resHistory, resMembers, resKeys] = await Promise.all([pHistory, pMembers, pKeys]);

                if (resHistory.ok) setMessages(await resHistory.json());
                if (resMembers.ok) setRoomMembers(await resMembers.json());
                if (resKeys.ok) useChatStore.getState().setRoomKeys(await resKeys.json());
            } catch (err) {
                console.error("Fetch err", err);
            }
        };

        setMessages([]);
        const currentRoom = useChatStore.getState().myRooms.find(r => r.id === currentRoomId);
        setStreamUrl(currentRoom?.stream_url || '');
        loadHistoryAndMembers();
    }, [currentRoomId, setMessages, setRoomMembers]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    useEffect(() => {
        if (!socket) return;

        const handleMsg = (msg: any) => {
            if (msg.room_id !== currentRoomId) return;
            addMessage(msg);
        };
        const handleDeleted = (data: any) => deleteMessage(data.msg_id);
        const handleEdited = (data: any) => updateMessage(data.msg_id, { text: data.text, encrypted_keys: data.encrypted_keys, is_edited: 1 });
        const handleStream = (data: any) => {
            if (data.room_id === currentRoomId) setStreamUrl(data.stream_url);
        };
        const handleReaction = (data: any) => {
            setMessages(useChatStore.getState().messages.map(m => {
                if (m.id === data.msg_id) {
                    return { ...m, reactions: data.reactions };
                }
                return m;
            }));
        };
        const handleMemberAdded = async (data: any) => {
            if (data.room_id === currentRoomId) {
                const members = useChatStore.getState().roomMembers;
                if (!members.find(m => m.username === data.username)) {
                    setRoomMembers([...members, { username: data.username, avatar: data.avatar }]);
                    try {
                        const resKeys = await api.getRoomKeys(currentRoomId);
                        if (resKeys.ok) {
                            useChatStore.getState().setRoomKeys(await resKeys.json());
                        }
                    } catch (e) {
                        console.error("Key fetch err", e);
                    }
                }
            }
        };

        socket.on('chat message', handleMsg);
        socket.on('message deleted', handleDeleted);
        socket.on('message edited', handleEdited);
        socket.on('stream updated', handleStream);
        socket.on('update reactions', handleReaction);
        socket.on('member_added', handleMemberAdded);

        return () => {
            socket.off('chat message', handleMsg);
            socket.off('message deleted', handleDeleted);
            socket.off('message edited', handleEdited);
            socket.off('stream updated', handleStream);
            socket.off('update reactions', handleReaction);
            socket.off('member_added', handleMemberAdded);
        };
    }, [socket, currentRoomId, addMessage, deleteMessage, updateMessage, setRoomMembers]);

    const handleLeave = async () => {
        if (confirm("Выйти?")) {
            try {
                const res = await api.leaveRoom(currentRoomId!);
                if (res.ok) {
                    useChatStore.getState().setRooms(useChatStore.getState().myRooms.filter(r => r.id !== currentRoomId));
                    useChatStore.getState().setCurrentRoom(null, null);
                }
            } catch (e) {
                alert("Ошибка");
            }
        }
    };

    const handleDeleteRoom = async () => {
        if (confirm("Удалить чат?")) {
            try {
                const res = await api.deleteRoom(currentRoomId!);
                if (res.ok) {
                    const data = await res.json();
                    if (data.error) {
                        alert(data.error);
                        return;
                    }
                    useChatStore.getState().setRooms(useChatStore.getState().myRooms.filter(r => r.id !== currentRoomId));
                    useChatStore.getState().setCurrentRoom(null, null);
                } else {
                    const data = await res.json().catch(()=>({}));
                    alert(data.error || "Ошибка удаления");
                }
            } catch (e) {
                alert("Ошибка соединения");
            }
        }
    };

    const handleInvite = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        const username = inviteUsername.trim();
        if (!username) return;
        try {
            const res = await api.invite(currentRoomId!, username);
            const data = await res.json();
            if (!res.ok || data.error) {
                alert(data.error || "Ошибка при добавлении");
            } else {
                alert("Пользователь добавлен!");
                setIsInviteOpen(false);
                setInviteUsername("");
            }
        } catch (e) {
            alert("Ошибка соединения");
        }
    };

    const toggleStream = async () => {
        if (streamUrl) {
            if (confirm("Остановить?")) {
                const res = await api.setStream(currentRoomId!, '');
                const data = await res.json().catch(()=>({}));
                if (data.error) alert(data.error);
            }
        } else {
            setIsStreamOpen(true);
        }
    };

    const handleSetStream = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        const url = streamInputUrl.trim();
        if (url) {
            const res = await api.setStream(currentRoomId!, url);
            const data = await res.json().catch(()=>({}));
            if (data.error) {
                alert(data.error);
            } else {
                setIsStreamOpen(false);
                setStreamInputUrl("");
            }
        }
    };

    const scrollToMsg = (msgId: string) => {
        const el = document.getElementById(`msg-${msgId}`);
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.style.background = 'rgba(255, 255, 255, 0.1)';
            setTimeout(() => el.style.background = 'transparent', 500);
        }
    };

    const renderMembers = () => {
        const sorted = [...roomMembers].sort((a, b) => {
            const aO = onlineUsers.has(a.username);
            const bO = onlineUsers.has(b.username);
            if (aO && !bO) return -1;
            if (!aO && bO) return 1;
            return a.username.localeCompare(b.username);
        });

        return sorted.map(m => (
            <div key={m.username} className="member-item">
                <img src={m.avatar || 'https://via.placeholder.com/30'} alt={m.username} onError={(e) => { e.currentTarget.src = 'https://ui-avatars.com/api/?name=' + m.username + '&background=222&color=fff'; }} />
                <div className="name">{m.username}</div>
                <div className={`status-dot ${onlineUsers.has(m.username) ? 'online' : ''}`}></div>
            </div>
        ));
    };

    const defaultReacts = ['👍','❤️','😂','🔥','😢','👏','🤡','👀'];

    return (
        <div className="chat-panel">
            <input type="file" ref={reactFileRef} className="hidden" accept="image/*" onChange={handleUploadReaction} />
            <div className="chat-wallpaper"></div>

            <div className="chat-body-wrapper flex-row w-full flex-1 h-full overflow-hidden relative z-10">
                {streamUrl && (
                    <>
                        <div className="stream-panel bg-black relative flex-shrink-0 animate-in fade-in zoom-in-95 duration-300" style={{ width: `${streamWidth}%` }}>
                            <button className="absolute top-2 left-2 w-8 h-8 flex items-center justify-center bg-black/50 hover:bg-red-500 rounded-full text-white z-10 transition-colors" onClick={() => setStreamUrl('')}><X size={16}/></button>
                            {streamUrl.endsWith('.m3u8') || streamUrl.endsWith('.flv') || streamUrl.endsWith('.mp4') || streamUrl.startsWith('rtmp://') ? (
                                <StreamPlayer url={streamUrl} className="w-full h-full object-contain pointer-events-auto" style={{ pointerEvents: isDragging ? 'none' : 'auto' }} />
                            ) : (
                                <iframe src={streamUrl} allow="camera; microphone; fullscreen; display-capture; autoplay; encrypted-media; picture-in-picture" className="w-full h-full border-none pointer-events-none" style={{ pointerEvents: isDragging ? 'none' : 'auto' }} />
                            )}
                        </div>
                        <div
                            className="w-1 cursor-col-resize hover:bg-white/20 active:bg-white/40 bg-white/5 transition-colors z-20 flex-shrink-0"
                            onMouseDown={() => setIsDragging(true)}
                        />
                    </>
                )}

                <div className="flex-1 flex flex-col min-w-0 min-h-0">
                    <div className="chat-main">
                        <div className="chat-header">
                            <div className="chat-title text-white/90">
                                <button className="md:hidden mr-3 p-2 -ml-2 text-white/50 hover:text-white transition-colors active:bg-white/10 rounded-full" onClick={() => useChatStore.getState().setCurrentRoom(null, null)}>
                                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
                                </button>
                                <span className="text-white/40 font-normal mr-1 hidden sm:inline">To:</span> <span className="truncate max-w-[150px] sm:max-w-none block">{currentRoomName}</span>
                            </div>
                            <div className="chat-actions">
                                <button className="header-btn md:hidden flex items-center gap-1" onClick={() => {
                                    const sidebar = document.querySelector('.members-sidebar');
                                    sidebar?.classList.toggle('mobile-open');
                                }}>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                                </button>
                                <button className={`header-btn flex items-center gap-2 ${voiceChat.isInVoice ? 'bg-green-500/20 text-green-400 border-green-500/30' : ''}`} onClick={voiceChat.isInVoice ? voiceChat.leaveVoice : voiceChat.joinVoice} title="Voice Chat">
                                    {voiceChat.isInVoice ? <PhoneOff size={16} /> : <Phone size={16} />}
                                    <span className="hidden sm:inline">{voiceChat.isInVoice ? "Leave Voice" : "Join Voice"}</span>
                                </button>
                                <button className="header-btn btn-stream flex items-center gap-2" onClick={toggleStream}>
                                    {streamUrl ? (
                                        <>
                                            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
                                            Stop
                                        </>
                                    ) : (
                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>
                                    )}
                                </button>
                                <button className="header-btn flex items-center gap-1" onClick={handleLeave} title="Leave">
                                    <svg className="md:hidden" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
                                    <span className="hidden md:inline">Leave</span>
                                </button>
                                <button className="header-btn btn-delete text-red-400 bg-red-400/10 border-red-400/20 hover:bg-red-400/20 flex items-center gap-1" onClick={handleDeleteRoom} title="Delete">
                                    <svg className="md:hidden" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                                    <span className="hidden md:inline">Delete</span>
                                </button>
                            </div>
                        </div>

                    <div className="messages" id="messages">
                        {messages.map((m, idx) => {
                            const isMine = m.username === currentUser;
                            const prev = messages[idx - 1];
                            const isGrouped = prev && prev.username === m.username && !m.reply_to;

                            return (
                                <div
                                    id={`msg-${m.id}`}
                                    key={m.id}
                                    className={`message-row group transition-colors duration-500 ${isMine ? 'mine' : ''} ${isGrouped ? 'grouped' : ''} ${activeMsgId === m.id ? 'active' : ''}`}
                                    onClick={(e) => { e.stopPropagation(); setActiveMsgId(m.id); }}
                                >
                                    <img src={m.avatar || 'https://via.placeholder.com/40'} className="avatar" alt={m.username} onError={(e) => { e.currentTarget.src = 'https://ui-avatars.com/api/?name=' + m.username + '&background=222&color=fff'; }} />
                                    <div className="message-column">
                                        <div className="message-content">
                                            {m.reply_to && (
                                                <div className="replied-message opacity-70 border-l-2 pl-2 mb-2 border-gray-300 text-sm overflow-hidden cursor-pointer hover:opacity-100" onClick={() => scrollToMsg(m.reply_to.id)}>
                                                    <div className="rep-name font-semibold">{m.reply_to.username}</div>
                                                    <div className="rep-text truncate">
                                                        <DecryptedReply reply={m.reply_to} currentUser={currentUser || ''} />
                                                    </div>
                                                </div>
                                            )}
                                            <div className="meta">
                                                <span className="username">{m.username}</span>
                                                <span className="text-[10px] opacity-70">{m.time}</span>
                                            </div>

                                            <MessageContent m={m} currentUser={currentUser || ''} />
                                            {m.is_edited ? <span className="edited-tag ml-2 text-[10px] italic opacity-50">(изменено)</span> : null}

                                            <div className="msg-actions">
                                                <div className="msg-action-btn" title="Ответить" onClick={() => useChatStore.getState().setReplyingTo(m)}>
                                                    <Reply size={14} />
                                                </div>
                                                {isMine && <div className="msg-action-btn" title="Изменить" onClick={async () => {
                                                    let plainText = m.text;
                                                    let mediaObj: string | null = m.media || null;
                                                    if (m.text && m.text.includes('|||')) {
                                                        try {
                                                            const [cipherText, iv] = m.text.split('|||');
                                                            const res = await CryptoE2E.decryptForMe(currentUser || '', cipherText, iv, m.encrypted_keys || '{}');
                                                            if (typeof res === 'object' && res !== null) {
                                                                plainText = res.text || '';
                                                                mediaObj = res.media || null;
                                                            } else {
                                                                plainText = res as string;
                                                            }
                                                        } catch (e) {}
                                                    }
                                                    useChatStore.getState().setEditingMsg(m.id, plainText, mediaObj);
                                                }}>
                                                    <Pencil size={14} />
                                                </div>}
                                                {isMine && <div className="msg-action-btn text-red-500 hover:text-red-700" title="Удалить" onClick={() => {
                                                    socket?.emit('delete message', { msg_id: m.id, room_id: currentRoomId });
                                                }}>
                                                    <Trash size={14} />
                                                </div>}
                                                <div
                                                    className="msg-action-btn relative"
                                                    title="Реакция"
                                                    onClick={(e) => { e.stopPropagation(); setReactingToMsgId(reactingToMsgId === m.id ? null : m.id); }}
                                                >
                                                    <SmilePlus size={14} />
                                                    {reactingToMsgId === m.id && (
                                                        <div className="absolute bottom-full right-0 pb-2 z-50 animate-in fade-in slide-in-from-bottom-2">
                                                            <div className="bg-[#161618] border border-white/5 shadow-xl p-2 rounded-xl flex flex-wrap gap-1 w-48 transition-all relative z-[60]">
                                                                {defaultReacts.map(e => (
                                                                    <span key={e} className="cursor-pointer hover:scale-125 transition-transform text-lg" onClick={(ev) => { ev.stopPropagation(); socket?.emit('chat reaction', { msg_id: m.id, room_id: currentRoomId, reaction: e, username: currentUser }); setReactingToMsgId(null); }}>{e}</span>
                                                                ))}
                                                                {customReacts.map(e => (
                                                                    <img key={e} src={e} className="cursor-pointer hover:scale-110 transition-transform w-5 h-5 object-contain" onClick={(ev) => { ev.stopPropagation(); socket?.emit('chat reaction', { msg_id: m.id, room_id: currentRoomId, reaction: e, username: currentUser }); setReactingToMsgId(null); }} />
                                                                ))}
                                                                <div
                                                                    className="cursor-pointer hover:scale-110 transition-transform w-5 h-5 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-full text-white/60 text-xs font-bold shadow-sm"
                                                                    title="Добавить свою"
                                                                    onClick={(ev) => { ev.stopPropagation(); setReactingToMsgId(null); reactFileRef.current?.click(); }}
                                                                >
                                                                    +
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        {m.reactions && Object.keys(m.reactions).length > 0 && (
                                            <div className="reactions flex flex-wrap gap-1 mt-1">
                                                {Object.entries(m.reactions).map(([reaction, users]: [string, any]) => {
                                                    if (users.length === 0) return null;
                                                    const rIcon = reaction.startsWith('/') ? <img src={reaction} className="inline-emoji" alt="reaction" /> : reaction;
                                                    const reactedByMe = users.includes(currentUser);
                                                    return (
                                                        <span key={reaction} onClick={() => socket?.emit('chat reaction', { msg_id: m.id, room_id: currentRoomId, reaction, username: currentUser })}
                                                              className={`reaction-badge ${reactedByMe ? 'bg-blue-500/20 border-blue-500/30 text-blue-400' : 'bg-[#161618] text-white/70 border-white/5 hover:bg-white/5'} border text-[11px] px-2 py-0.5 rounded-full cursor-pointer hover:bg-white/10 transition-colors flex items-center gap-1 shadow-sm`} title={users.join(', ')}>
                                                            {rIcon} <span>{users.length}</span>
                                                        </span>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                        <div ref={messagesEndRef} />
                    </div>

                    {typingUsers.size > 0 && Array.from(typingUsers).filter(u => u !== currentUser).length > 0 && (
                        <div className="px-8 pb-3 pt-1 text-white/40 text-[12px] italic animate-pulse">
                            {Array.from(typingUsers).filter(u => u !== currentUser).join(', ')} печатает...
                        </div>
                    )}
                    <ChatInput />
                </div>
                </div>

                {!streamUrl && (
                    <div className="members-sidebar flex flex-col">
                        <div className="members-header flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <span>Members</span>
                                <button className="md:hidden text-white/40 hover:text-white" onClick={() => document.querySelector('.members-sidebar')?.classList.remove('mobile-open')}>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                </button>
                            </div>
                            {myRooms.find(r => r.id === currentRoomId)?.owner === currentUser && (
                                <button
                                    className="bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 shadow-sm text-xs px-2 py-1 rounded-md transition-colors"
                                    title="Add Member"
                                    onClick={() => setIsInviteOpen(true)}
                                >
                                    +
                                </button>
                            )}
                        </div>
                        <div className="members-list flex-1 overflow-y-auto">
                            {renderMembers()}
                        </div>

                        <div className="border-t border-white/5 p-4 flex flex-col gap-3">
                            <div className="flex items-center justify-between text-white/70 text-sm font-semibold uppercase tracking-wider">
                                <div className="flex items-center gap-2">
                                    <Phone size={14} /> Voice Channel
                                </div>
                                {voiceChat.voiceMembers.size > 0 && <span>{voiceChat.voiceMembers.size}</span>}
                            </div>

                            <div className="flex flex-col gap-2 max-h-40 overflow-y-auto">
                                {Array.from(voiceChat.voiceMembers).map(u => (
                                    <div key={u} className="flex items-center gap-2 text-sm text-white/80">
                                        <div className="w-6 h-6 rounded-full bg-white/10 overflow-hidden flex-shrink-0 flex items-center justify-center">
                                            {roomMembers.find(m => m.username === u)?.avatar ? (
                                                <img src={roomMembers.find(m => m.username === u)?.avatar} alt={u} className="w-full h-full object-cover" />
                                            ) : (
                                                <span className="text-[10px]">{u.charAt(0).toUpperCase()}</span>
                                            )}
                                        </div>
                                        <span className="truncate flex-1">{u}</span>
                                        {u === currentUser && voiceChat.isMuted && <MicOff size={14} className="text-red-400" />}
                                    </div>
                                ))}
                            </div>

                            {voiceChat.isInVoice && (
                                <div className="flex items-center gap-2 mt-2">
                                    <button
                                        className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-sm transition-colors ${voiceChat.isMuted ? 'bg-red-500/20 text-red-400' : 'bg-white/10 text-white'}`}
                                        onClick={voiceChat.toggleMute}
                                    >
                                        {voiceChat.isMuted ? <MicOff size={16} /> : <Mic size={16} />}
                                    </button>
                                    <button
                                        className="flex-[2] flex items-center justify-center gap-2 py-2 rounded-xl text-sm bg-red-500 hover:bg-red-600 text-white transition-colors font-medium"
                                        onClick={voiceChat.leaveVoice}
                                    >
                                        <PhoneOff size={16} /> Disconnect
                                    </button>
                                </div>
                            )}

                            {!voiceChat.isInVoice && (
                                <button
                                    className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-sm bg-green-500/20 hover:bg-green-500/30 text-green-400 transition-colors font-medium mt-2 border border-green-500/20"
                                    onClick={voiceChat.joinVoice}
                                >
                                    <Phone size={16} /> Join Voice
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {isInviteOpen && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm transition-opacity" onClick={() => setIsInviteOpen(false)}>
                    <div className="bg-[rgba(25,25,30,1)] border border-white/10 text-white w-full max-w-sm rounded-2xl p-6 shadow-2xl relative" onClick={e => e.stopPropagation()}>
                        <h3 className="text-lg font-semibold mb-4">Invite User</h3>
                        <form onSubmit={handleInvite}>
                            <input
                                autoFocus
                                type="text"
                                placeholder="Username to invite"
                                value={inviteUsername}
                                onChange={(e) => setInviteUsername(e.target.value)}
                                className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white mb-6 outline-none focus:border-white/30"
                            />
                            <div className="flex justify-end gap-3">
                                <button type="button" className="px-4 py-2 text-white/50 hover:text-white" onClick={() => setIsInviteOpen(false)}>Cancel</button>
                                <button type="submit" className="px-4 py-2 bg-white text-black font-semibold rounded-xl hover:bg-gray-200">Invite</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {isStreamOpen && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm transition-opacity" onClick={() => setIsStreamOpen(false)}>
                    <div className="bg-[rgba(25,25,30,1)] border border-white/10 text-white w-full max-w-sm rounded-2xl p-6 shadow-2xl relative" onClick={e => e.stopPropagation()}>
                        <h3 className="text-lg font-semibold mb-4">Start Stream</h3>
                        <form onSubmit={handleSetStream}>
                            <input
                                autoFocus
                                type="text"
                                placeholder="Stream URL (rtmp, m3u8, flv...)"
                                value={streamInputUrl}
                                onChange={(e) => setStreamInputUrl(e.target.value)}
                                className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white mb-6 outline-none focus:border-white/30"
                            />
                            <div className="flex justify-end gap-3">
                                <button type="button" className="px-4 py-2 text-white/50 hover:text-white" onClick={() => setIsStreamOpen(false)}>Cancel</button>
                                <button type="submit" className="px-4 py-2 bg-white text-black font-semibold rounded-xl hover:bg-gray-200">Start</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
