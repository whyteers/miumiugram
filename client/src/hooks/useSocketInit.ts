import { useEffect } from 'react';
import { io } from 'socket.io-client';
import { useChatStore } from '../store/useChatStore';

export const useSocketInit = () => {
    const { currentUser, setSocket, setOnlineUsers } = useChatStore();

    useEffect(() => {

        if (!currentUser) return;

        const newSocket = io();

        newSocket.on('connect', () => {
            console.log("🟢 Сокеты подключены!");
            newSocket.emit('user_online');
        });

        newSocket.on('sync_online_users', (usersList: string[]) => {
            setOnlineUsers(usersList);
        });

        newSocket.on('user_status', (data: { username: string; status: string }) => {
            console.log(`Статус пользователя ${data.username}: ${data.status}`);
            const state = useChatStore.getState();
            const newSet = new Set(state.onlineUsers);
            if (data.status === 'online') {
                newSet.add(data.username);
            } else {
                newSet.delete(data.username);
            }
            setOnlineUsers(Array.from(newSet));
        });

        newSocket.on('you_were_invited', () => {
            import('../services/api').then(({ api }) => {
                const currentUser = useChatStore.getState().currentUser;
                if (!currentUser) return;
                api.getRooms(currentUser).then(r => r.json()).then(rooms => {
                    useChatStore.getState().setRooms(rooms);
                }).catch(e => console.error(e));
            });
        });

        newSocket.on('chat message', (msg: any) => {
            const state = useChatStore.getState();
            state.setUserTyping(msg.username, false);
            const updatedRooms = state.myRooms.map(r => {
                if (r.id === msg.room_id) {
                    return {
                        ...r,
                        last_text: msg.text,
                        last_media: msg.media,
                        last_keys: msg.encrypted_keys
                    };
                }
                return r;
            });
            state.setRooms(updatedRooms);
        });

        newSocket.on('typing', (data: { username: string; room_id: string; is_typing: boolean }) => {
            const state = useChatStore.getState();
            if (state.currentRoomId === data.room_id) {
                state.setUserTyping(data.username, data.is_typing);
            }
        });

        setSocket(newSocket);

        return () => {
            newSocket.disconnect();
            setSocket(null);
            console.log("🔴 Сокеты отключены");
        };
    }, [currentUser, setSocket, setOnlineUsers]);
};
