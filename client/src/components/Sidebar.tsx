import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import { useChatStore } from '../store/useChatStore';
import { CryptoE2E } from '../utils/crypto';
import SettingsModal from './SettingsModal';

function LastMessagePreview({ room, currentUser }: { room: any, currentUser: string }) {
    const [decryptedText, setDecryptedText] = useState<string | null>(null);

    useEffect(() => {
        let isMounted = true;
        const decrypt = async () => {
            const text = room.last_text || '';
            const media = room.last_media || '';
            if (!text || text.indexOf('|||') === -1) {
                if (isMounted) setDecryptedText(media ? "📷 Фотография" : (text || "Нет сообщений"));
                return;
            }
            try {
                const [cipherText, iv] = text.split('|||');
                if (!cipherText || !iv) {
                    if (isMounted) setDecryptedText("🔒 Ошибка шифрования");
                    return;
                }
                const result = await CryptoE2E.decryptForMe(currentUser, cipherText, iv, room.last_keys || '{}');
                if (isMounted) {
                    let plain = "";
                    let isMedia = media;
                    if (typeof result === 'object' && result !== null) {
                        plain = result.text || '';
                        isMedia = isMedia || result.media;
                    } else {
                        plain = result as string;
                    }
                    plain = plain.replace(/<[^>]*>?/gm, ' ');
                    if (isMedia) plain = "📷 " + plain;
                    setDecryptedText(plain || "Нет сообщений");
                }
            } catch (err) {
                if (isMounted) setDecryptedText("🔒 Ошибка шифрования");
            }
        };
        decrypt();
        return () => { isMounted = false; };
    }, [room.last_text, room.last_media, room.last_keys, currentUser]);

    return <>{decryptedText || "..."}</>;
}

export default function Sidebar() {
    const {
        currentUser,
        userAvatar,
        setUser,
        myRooms,
        setRooms,
        currentRoomId,
        setCurrentRoom
    } = useChatStore();

    const [isCollapsed, setIsCollapsed] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isCreateRoomOpen, setIsCreateRoomOpen] = useState(false);
    const [createRoomName, setCreateRoomName] = useState("");

    const loadRooms = async () => {
        try {
            if (!currentUser) return;
            const res = await api.getRooms(currentUser);
            if (res.ok) {
                const rooms = await res.json();
                setRooms(rooms);
            }
        } catch (e) {
            console.error("Ошибка загрузки чатов", e);
        }
    };

    useEffect(() => {
        loadRooms();
    }, [currentUser]);

    const handleCreateRoom = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        const name = createRoomName.trim();
        if (!name) return;
        try {
            const res = await api.createRoom({ name, owner: currentUser! });
            if (res.ok) {
                const data = await res.json();
                loadRooms();
                if (data.room) {
                    setCurrentRoom(data.room.id, data.room.name);
                }
                setIsCreateRoomOpen(false);
                setCreateRoomName("");
            }
        } catch (err) {
            console.error("Ошибка создания чата", err);
        }
    };

    const handleLogout = async () => {
        try {
            await api.logout();
        } catch (e) {
            console.error("Logout err", e);
        }
        localStorage.removeItem('savedUsername');
        setUser(null, null);
    };

    const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !currentUser) return;

        const formData = new FormData();
        formData.append('file', file);
        formData.append('username', currentUser);
        try {
            const res = await api.uploadAvatar(formData);
            if (res.ok) {
                const data = await res.json();
                if (data.avatar) {
                    const avatarUrlWithTs = `${data.avatar}?t=${Date.now()}`;
                    setUser(currentUser, avatarUrlWithTs);
                    useChatStore.getState().setRoomMembers(
                        useChatStore.getState().roomMembers.map(m => m.username === currentUser ? { ...m, avatar: avatarUrlWithTs } : m)
                    );
                    useChatStore.getState().setMessages(
                        useChatStore.getState().messages.map(m => m.username === currentUser ? { ...m, avatar: avatarUrlWithTs } : m)
                    );
                }
            } else {
                const errData = await res.json().catch(()=>({}));
                alert("Ошибка загрузки аватарки: " + (errData.error || "неизвестная ошибка"));
            }
        } catch (error) {
            console.error(error);
        }
    };

    return (
        <>
            <button
                className="toggle-sidebar-btn"
                onClick={() => setIsCollapsed(!isCollapsed)}
            >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
            </button>
            <div className={`sidebar ${isCollapsed ? 'collapsed' : ''}`} id="sidebar">
                <div className="sidebar-header">
                <span className="flex items-center gap-2">

                Goydagram
                </span>
                <button className="btn p-1.5 focus:outline-none bg-transparent hover:bg-white/10 border-transparent rounded-[8px]" title="Create Room" onClick={() => setIsCreateRoomOpen(true)}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                </button>
            </div>

            <div className="px-5 py-3 text-xs font-semibold text-white/40 flex justify-between items-center tracking-wider mt-2 border-b border-white/5 pb-4">
                <span className="flex items-center gap-2">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                    RECENT CHATS <span className="bg-white/10 px-2 py-0.5 rounded-full text-[10px] ml-1">{myRooms.length}</span>
                </span>
            </div>

            <div className="rooms-list flex-1 overflow-y-auto">
                {myRooms.map((room: any) => (
                    <div
                        key={room.id}
                        className={`room-item ${room.id === currentRoomId ? 'active' : ''}`}
                        onClick={() => setCurrentRoom(room.id, room.name)}
                    >
                        <div className="room-item-content">
                            <div className="room-name flex items-center justify-between w-full">
                                <span className="truncate">{room.name}</span>
                                <span className="text-[11px] font-normal text-white/30 shrink-0 ml-2">Open</span>
                            </div>
                            <div className="room-last-msg">
                                <LastMessagePreview room={room} currentUser={currentUser!} />
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            <div className="profile-panel">
                <label className="cursor-pointer relative group">
                    <img src={userAvatar || 'https://via.placeholder.com/40'} alt="Avatar" onError={(e) => { e.currentTarget.src = 'https://ui-avatars.com/api/?name=' + currentUser + '&background=222&color=fff'; }} />
                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 rounded-full transition-opacity">
                        <span className="text-[10px] text-white font-medium">Edit</span>
                    </div>
                    <input type="file" className="hidden" accept="image/*" onChange={handleAvatarUpload} />
                </label>
                <div className="profile-info flex-1 ml-2 truncate">
                    <span className="block truncate">{currentUser}</span>
                    <span className="text-white/40 text-[11px] font-medium flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]"></div> Online</span>
                </div>
                <button className="logout-btn hover:text-white" title="Settings" onClick={() => setIsSettingsOpen(true)}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                </button>
                <button className="logout-btn hover:text-red-400" title="Sign out" onClick={handleLogout}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
                </button>
            </div>

            {isSettingsOpen && <SettingsModal onClose={() => setIsSettingsOpen(false)} />}
        </div>

        {isCreateRoomOpen && (
            <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm transition-opacity" onClick={() => setIsCreateRoomOpen(false)}>
                <div className="bg-[rgba(25,25,30,1)] border border-white/10 text-white w-full max-w-sm rounded-2xl p-6 shadow-2xl relative" onClick={e => e.stopPropagation()}>
                    <h3 className="text-lg font-semibold mb-4">Create New Chat</h3>
                    <form onSubmit={handleCreateRoom}>
                        <input
                            autoFocus
                            type="text"
                            placeholder="Chat Name"
                            value={createRoomName}
                            onChange={(e) => setCreateRoomName(e.target.value)}
                            className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white mb-6 outline-none focus:border-white/30"
                        />
                        <div className="flex justify-end gap-3">
                            <button type="button" className="px-4 py-2 text-white/50 hover:text-white" onClick={() => setIsCreateRoomOpen(false)}>Cancel</button>
                            <button type="submit" className="px-4 py-2 bg-white text-black font-semibold rounded-xl hover:bg-gray-200">Create</button>
                        </div>
                    </form>
                </div>
            </div>
        )}
        </>
    );
}
