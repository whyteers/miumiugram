import { create } from 'zustand';

interface ChatState {
    socket: any;
    setSocket: (socketInstance: any) => void;

    currentUser: string | null;
    userAvatar: string | null;
    setUser: (username: string | null, avatar: string | null) => void;
    logout: () => void;

    myRooms: any[];
    currentRoomId: string | null;
    currentRoomName: string | null;
    roomMembers: any[];
    roomKeys: Record<string, string>;
    onlineUsers: Set<string>;

    setRooms: (rooms: any[]) => void;
    setCurrentRoom: (id: string | null, name: string | null) => void;
    setRoomMembers: (members: any[]) => void;
    setRoomKeys: (keys: Record<string, string>) => void;
    setOnlineUsers: (usersArray: string[]) => void;

    messages: any[];
    typingUsers: Set<string>;
    replyingTo: any | null;
    editingMsgId: string | null;
    editingMsgText: string | null;
    editingMsgMedia: string | null;

    setMessages: (msgs: any[]) => void;
    setTypingUsers: (users: Set<string>) => void;
    setUserTyping: (username: string, isTyping: boolean) => void;

    addMessage: (msg: any) => void;
    setReplyingTo: (msg: any | null) => void;
    setEditingMsg: (msgId: string | null, text?: string | null, media?: string | null) => void;
    clearInputState: () => void;

    updateMessage: (msgId: string, newProps: any) => void;
    deleteMessage: (msgId: string) => void;

    settings: {
        wallOpacity: string;
        bgBlur: string;
        fontScale: string;
        mineColor: string;
        otherColor: string;
        wallpaperUrl: string;
    };
    updateSettings: (newSettings: any) => void;
}

export const useChatStore = create<ChatState>((set) => ({
    socket: null,
    setSocket: (socketInstance) => set({ socket: socketInstance }),

    currentUser: null,
    userAvatar: null,
    setUser: (username, avatar) => set({ currentUser: username, userAvatar: avatar }),
    logout: () => set({ currentUser: null, userAvatar: null, currentRoomId: null, socket: null }),

    myRooms: [],
    currentRoomId: null,
    currentRoomName: null,
    roomMembers: [],
    roomKeys: {},
    onlineUsers: new Set(),

    setRooms: (rooms) => set({ myRooms: rooms }),
    setCurrentRoom: (id, name) => set({ currentRoomId: id, currentRoomName: name }),
    setRoomMembers: (members) => set({ roomMembers: members }),
    setRoomKeys: (keys) => set({ roomKeys: keys }),
    setOnlineUsers: (usersArray) => set({ onlineUsers: new Set(usersArray) }),

    messages: [],
    typingUsers: new Set(),
    replyingTo: null,
    editingMsgId: null,
    editingMsgText: null,
    editingMsgMedia: null,

    setMessages: (msgs) => set({ messages: msgs }),
    setTypingUsers: (users) => set({ typingUsers: new Set(users) }),
    setUserTyping: (username, isTyping) => set((state) => {
        const newSet = new Set(state.typingUsers);
        if (isTyping) newSet.add(username);
        else newSet.delete(username);
        return { typingUsers: newSet };
    }),
    addMessage: (msg) => set((state) => ({ messages: [...state.messages, msg] })),
    setReplyingTo: (msg) => set({ replyingTo: msg, editingMsgId: null, editingMsgText: null, editingMsgMedia: null }),
    setEditingMsg: (msgId, text, media) => set({ editingMsgId: msgId, editingMsgText: text !== undefined ? text : null, editingMsgMedia: media || null, replyingTo: null }),
    clearInputState: () => set({ replyingTo: null, editingMsgId: null, editingMsgText: null, editingMsgMedia: null }),

    updateMessage: (msgId, newProps) => set((state) => ({
        messages: state.messages.map(m => m.id === msgId ? { ...m, ...newProps } : m)
    })),
    deleteMessage: (msgId) => set((state) => ({
        messages: state.messages.filter(m => m.id !== msgId)
    })),

    settings: {
        wallOpacity: localStorage.getItem('wall_op') || '1',
        bgBlur: localStorage.getItem('blur') || '20',
        fontScale: localStorage.getItem('scale') || '1',
        mineColor: localStorage.getItem('mine_color') || 'rgba(255, 255, 255, 0.15)',
        otherColor: localStorage.getItem('other_color') || 'rgba(255, 255, 255, 0.08)',
        wallpaperUrl: localStorage.getItem('wallpaper_url') || 'https://images.unsplash.com/photo-1557682250-33bd709cbe85',
    },
    updateSettings: (newSettings) => set((state) => {
        const updated = { ...state.settings, ...newSettings };
        localStorage.setItem('wall_op', updated.wallOpacity);
        localStorage.setItem('blur', updated.bgBlur);
        localStorage.setItem('scale', updated.fontScale);
        localStorage.setItem('mine_color', updated.mineColor);
        localStorage.setItem('other_color', updated.otherColor);
        localStorage.setItem('wallpaper_url', updated.wallpaperUrl);
        return { settings: updated };
    }),
}));
