/// <reference types="vite/client" />

const fetchWithCreds = (url: string, options: RequestInit = {}) => {
    return fetch(url, { ...options, credentials: 'omit' });
};

export const api = {
    async getUser(username: string) {
        return fetch(`/api/get_user/${username}`);
    },
    async getRooms(username: string) {
        return fetch(`/api/rooms/${username}`);
    },
    async createRoom(data: { name: string, owner: string }) {
        return fetch('/api/create_room', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
    },
    async logout() {
        return fetch('/api/logout', { method: 'POST' });
    },
    async getHistory(roomId: string) {
        return fetch(`/api/history/${roomId}`);
    },
    async getRoomMembers(roomId: string) {
        return fetch(`/api/room_members/${roomId}`);
    },
    async getRoomKeys(roomId: string) {
        return fetch(`/api/room_keys/${roomId}`);
    },
    async getAssets(type: string, username: string) {
        return fetch(`/api/assets/${type}/${username}`);
    },
    async uploadAsset(formData: FormData) {
        return fetch('/api/upload_asset', {
            method: 'POST',
            body: formData
        });
    },
    async uploadMedia(formData: FormData) {
        return fetch('/api/upload_media', {
            method: 'POST',
            body: formData
        });
    },
    async uploadAvatar(formData: FormData) {
        return fetch('/api/upload_avatar', {
            method: 'POST',
            body: formData
        });
    },
    async setStream(roomId: string, url: string) {
        return fetch('/api/set_stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ room_id: roomId, stream_url: url })
        });
    },
    async deleteRoom(roomId: string) {
        return fetch('/api/delete_room', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ room_id: roomId })
        });
    },
    async leaveRoom(roomId: string) {
        return fetch('/api/leave_room', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ room_id: roomId })
        });
    },
    async invite(roomId: string, username: string) {
        return fetch('/api/invite', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ room_id: roomId, username })
        });
    }
};
