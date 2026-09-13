import React, { useRef } from 'react';
import { createPortal } from 'react-dom';
import { useChatStore } from '../store/useChatStore';
import { api } from '../services/api';

interface SettingsModalProps {
    onClose: () => void;
}

export default function SettingsModal({ onClose }: SettingsModalProps) {
    const { settings, updateSettings, currentUser } = useChatStore();
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        updateSettings({ [name]: value });
    };

    const handleWallpaperUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const formData = new FormData();
        formData.append('file', file);
        if (currentUser) formData.append('username', currentUser);
        try {
            const res = await api.uploadMedia(formData);
            if (res.ok) {
                const data = await res.json();
                if (data.media_url) {
                    updateSettings({ wallpaperUrl: data.media_url });
                }
            } else {
                alert("Ошибка загрузки");
            }
        } catch (err) {
            console.error("Ошибка загрузки обоев", err);
        }
    };

    const modalContent = (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-xl transition-opacity">
            <div className="bg-[rgba(25,25,30,0.85)] border border-white/10 text-white w-full h-full sm:w-[90%] sm:h-[90%] sm:max-w-4xl sm:rounded-[32px] flex flex-col relative shadow-[0_0_80px_rgba(0,0,0,0.8)] backdrop-blur-2xl">
                <div className="flex justify-between items-center border-b border-white/5 p-8">
                    <h2 className="text-white text-2xl font-semibold m-0 tracking-tight">Settings</h2>
                    <button onClick={onClose} className="bg-white/5 border border-white/10 hover:bg-white/10 text-white w-10 h-10 rounded-full flex items-center justify-center cursor-pointer transition-colors">&times;</button>
                </div>

                <div className="flex-1 flex flex-col items-center overflow-y-auto custom-scrollbar p-8">
                    <div className="w-full max-w-2xl flex flex-col gap-8">

                    <div className="flex flex-col gap-2">
                        <label className="text-white/70 text-sm font-medium flex justify-between">
                            Interface Scale
                            <span className="text-white/50">{settings.fontScale}</span>
                        </label>
                        <input
                            type="range"
                            name="fontScale"
                            min="0.5"
                            max="2"
                            step="0.05"
                            value={settings.fontScale}
                            onChange={handleChange}
                            className="w-full cursor-pointer accent-white"
                        />
                    </div>

                    <div className="flex flex-col gap-3">
                        <label className="text-white/70 text-sm font-medium flex justify-between">
                            Background Blur (px)
                            <span className="text-white/50">{settings.bgBlur}px</span>
                        </label>
                        <input
                            type="range"
                            name="bgBlur"
                            min="0"
                            max="40"
                            step="1"
                            value={settings.bgBlur}
                            onChange={handleChange}
                            className="w-full cursor-pointer accent-white"
                        />
                    </div>

                    <div className="flex flex-col gap-3">
                        <label className="text-white/70 text-sm font-medium">Wallpaper URL or File</label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                name="wallpaperUrl"
                                value={settings.wallpaperUrl}
                                onChange={handleChange}
                                placeholder="https://..."
                                className="form-input flex-1"
                            />
                            <button className="btn bg-white/10 border-white/20" onClick={() => fileInputRef.current?.click()}>
                                Upload File
                            </button>
                            <input type="file" className="hidden" ref={fileInputRef} accept="image/*" onChange={handleWallpaperUpload} />
                        </div>
                    </div>

                    <div className="flex flex-col gap-3">
                        <label className="text-white/70 text-sm font-medium flex justify-between">
                            Wallpaper Opacity
                            <span className="text-white/50">{settings.wallOpacity}</span>
                        </label>
                        <input
                            type="range"
                            name="wallOpacity"
                            min="0"
                            max="1"
                            step="0.05"
                            value={settings.wallOpacity}
                            onChange={handleChange}
                            className="w-full cursor-pointer accent-white"
                        />
                    </div>

                    <div className="flex flex-col gap-4 pt-4 border-t border-white/5">
                        <label className="text-white/70 text-sm font-medium">Message Bubbles Colors</label>

                        <div className="flex items-center justify-between bg-white/5 border border-white/5 p-4 rounded-2xl">
                            <span className="text-white/90 text-sm font-medium">My messages</span>
                            <div className="flex items-center gap-2">
                                <input
                                    type="color"
                                    name="mineColor"
                                    value={settings.mineColor.startsWith('#') ? settings.mineColor : '#3a3a3c'}
                                    onChange={handleChange}
                                    className="w-10 h-10 rounded cursor-pointer p-0 bg-transparent border-none"
                                />
                            </div>
                        </div>

                        <div className="flex items-center justify-between bg-white/5 border border-white/5 p-4 rounded-2xl">
                            <span className="text-white/90 text-sm font-medium">Others messages</span>
                            <div className="flex items-center gap-2">
                                <input
                                    type="color"
                                    name="otherColor"
                                    value={settings.otherColor.startsWith('#') ? settings.otherColor.slice(0, 7) : '#2c2c2e'}
                                    onChange={handleChange}
                                    className="w-10 h-10 rounded cursor-pointer p-0 bg-transparent border-none"
                                />
                            </div>
                        </div>
                    </div>
                </div>
                </div>

                <div className="flex justify-end p-6 border-t border-white/5 bg-black/20 rounded-b-[32px]">
                    <button onClick={onClose} className="btn-primary px-8 py-3 text-[15px] rounded-2xl">Done</button>
                </div>
            </div>
        </div>
    );

    return createPortal(modalContent, document.body);
}
