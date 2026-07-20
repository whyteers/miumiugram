import React from 'react';
import Sidebar from './components/Sidebar.tsx';
import ChatArea from './components/ChatArea.tsx';
import { useSocketInit } from './hooks/useSocketInit.ts';
import { useChatStore } from './store/useChatStore.ts';

export default function MainChatLayout() {
    useSocketInit();
    const currentRoomId = useChatStore(state => state.currentRoomId);

    return (
        <div id="main-app" className={`${currentRoomId ? 'room-active' : ''}`}>
            <Sidebar />

            {!currentRoomId ? (
                <div id="placeholder-screen" className="flex-1 w-full relative flex items-center justify-center bg-black">
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-lg z-[1]"></div>
                    <div className="relative z-[2] text-white/50 font-medium py-4 px-8 rounded-[24px] border border-white/5 shadow-2xl bg-white/5 backdrop-blur-md flex flex-col items-center gap-3">
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                        Select a chat to start messaging
                    </div>
                </div>
            ) : (
                <div className="main-area">
                    <ChatArea />
                </div>
            )}
        </div>
    );
}
