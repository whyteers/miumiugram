import React, { useEffect, useState } from 'react';
import { useChatStore } from './store/useChatStore';
import { api } from './services/api';

import AuthScreen from './components/AuthScreen.tsx';
import MainChatLayout from './MainChatLayout.tsx';

export default function App() {
    const { currentUser, setUser, settings } = useChatStore();
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const root = document.documentElement;
        root.style.setProperty('--font-scale', settings.fontScale);
        root.style.setProperty('--msg-mine-bg', settings.mineColor);
        root.style.setProperty('--msg-other-bg', settings.otherColor);
        root.style.setProperty('--bg-blur', `${settings.bgBlur}px`);
        root.style.setProperty('--wallpaper-opacity', settings.wallOpacity);
        root.style.setProperty('--wallpaper-url', `url('${settings.wallpaperUrl}')`);
    }, [settings]);

    useEffect(() => {
        const checkAuth = async () => {
            const savedUser = localStorage.getItem('savedUsername');
            if (savedUser) {
                try {
                    const res = await api.getUser(savedUser);
                    if (res.ok) {
                        const data = await res.json();
                        setUser(data.username, data.avatar);
                    } else {
                        localStorage.removeItem('savedUsername');
                    }
                } catch (e) {
                    console.error("Сервер недоступен", e);
                }
            }
            setIsLoading(false);
        };
        checkAuth();
    }, [setUser]);

    if (isLoading) return <div style={{ color: 'white', padding: '20px' }}>Загрузка...</div>;

    return (
        <>
            {!currentUser ? <AuthScreen /> : <MainChatLayout />}
        </>
    );
}
