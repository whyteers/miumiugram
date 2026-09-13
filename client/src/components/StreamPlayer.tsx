import React, { useEffect, useRef } from 'react';
import flvjs from 'flv.js';
import Hls from 'hls.js';

interface StreamPlayerProps {
    url: string;
    className?: string;
    style?: React.CSSProperties;
}

export const StreamPlayer: React.FC<StreamPlayerProps> = ({ url, className, style }) => {
    const videoRef = useRef<HTMLVideoElement>(null);

    const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

    useEffect(() => {
        let flvPlayer: flvjs.Player | null = null;
        let hlsPlayer: Hls | null = null;

        setErrorMsg(null);
        const video = videoRef.current;
        if (!video || !url) return;

        if (url.startsWith('rtmp://')) {
            setErrorMsg('Браузеры не поддерживают протокол RTMP напрямую без Flash Player. Пожалуйста, используйте HLS (m3u8), HTTP-FLV (.flv) или WebRTC ссылки (например, если вы используете MediaMTX, то ссылка HLS обычно имеет вид http://localhost:8888/stream_name/index.m3u8).');
            return;
        }

        const cleanup = () => {
            if (flvPlayer) {
                flvPlayer.pause();
                flvPlayer.unload();
                flvPlayer.detachMediaElement();
                flvPlayer.destroy();
                flvPlayer = null;
            }
            if (hlsPlayer) {
                hlsPlayer.destroy();
                hlsPlayer = null;
            }
        };

        cleanup();

        try {
            if (url.includes('.flv')) {
                if (flvjs.isSupported()) {
                    flvPlayer = flvjs.createPlayer({
                        type: 'flv',
                        url: url,
                        isLive: true,
                        cors: true,
                    }, {
                        enableWorker: true,
                        enableStashBuffer: false,
                        stashInitialSize: 128,
                    });
                    flvPlayer.attachMediaElement(video);
                    flvPlayer.load();
                    flvPlayer.play().catch(e => console.log('Auto-play prevented', e));
                }
            } else if (url.includes('.m3u8')) {
                if (Hls.isSupported()) {
                    hlsPlayer = new Hls({
                        enableWorker: true,
                        lowLatencyMode: true,
                    });
                    hlsPlayer.loadSource(url);
                    hlsPlayer.attachMediaElement(video);
                    hlsPlayer.on(Hls.Events.MANIFEST_PARSED, () => {
                        video.play().catch(e => console.log('Auto-play prevented', e));
                    });
                } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                    video.src = url;
                    video.addEventListener('loadedmetadata', () => {
                        video.play().catch(e => console.log('Auto-play prevented', e));
                    });
                }
            } else {

                video.src = url;
            }
        } catch (e) {
            console.error("Error setting up stream player:", e);
        }

        return cleanup;
    }, [url]);

    return (
        <div className={`relative ${className}`} style={style}>
            {errorMsg ? (
                <div className="absolute inset-0 flex items-center justify-center bg-black text-white p-4 text-center">
                    <p className="bg-red-500/20 text-red-100 p-4 rounded-xl border border-red-500/50">
                        {errorMsg}
                    </p>
                </div>
            ) : (
                <video
                    ref={videoRef}
                    className="w-full h-full object-contain"
                    controls
                    autoPlay
                    playsInline
                />
            )}
        </div>
    );
};
