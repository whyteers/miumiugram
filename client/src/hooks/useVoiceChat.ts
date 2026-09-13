import { useState, useEffect, useRef, useCallback } from 'react';
import { useChatStore } from '../store/useChatStore';

export function useVoiceChat() {
    const { socket, currentUser, currentRoomId } = useChatStore();
    const [isInVoice, setIsInVoice] = useState(false);
    const [voiceMembers, setVoiceMembers] = useState<Set<string>>(new Set());
    const [isMuted, setIsMuted] = useState(false);

    const localStreamRef = useRef<MediaStream | null>(null);
    const peersRef = useRef<{ [username: string]: RTCPeerConnection }>({});
    const audioElementsRef = useRef<{ [username: string]: HTMLAudioElement }>({});

    const createPeer = useCallback((targetUser: string, initiator: boolean, stream: MediaStream) => {
        if (!socket || !currentRoomId) return null;

        const peer = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:global.stun.twilio.com:3478' }
            ]
        });

        stream.getTracks().forEach(track => {
            peer.addTrack(track, stream);
        });

        peer.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('webrtc_signal', {
                    target: targetUser,
                    room_id: currentRoomId,
                    signal: { type: 'candidate', candidate: event.candidate }
                });
            }
        };

        peer.ontrack = (event) => {
            if (event.streams && event.streams[0]) {
                if (!audioElementsRef.current[targetUser]) {
                    const audio = new Audio();
                    audio.autoplay = true;
                    audioElementsRef.current[targetUser] = audio;
                }
                audioElementsRef.current[targetUser].srcObject = event.streams[0];
            }
        };

        peer.onconnectionstatechange = () => {
            if (peer.connectionState === 'disconnected' || peer.connectionState === 'failed') {
                cleanupPeer(targetUser);
            }
        };

        if (initiator) {
            peer.createOffer().then(offer => {
                peer.setLocalDescription(offer);
                socket.emit('webrtc_signal', {
                    target: targetUser,
                    room_id: currentRoomId,
                    signal: offer
                });
            }).catch(console.error);
        }

        peersRef.current[targetUser] = peer;
        return peer;
    }, [socket, currentRoomId]);

    const cleanupPeer = (username: string) => {
        if (peersRef.current[username]) {
            peersRef.current[username].close();
            delete peersRef.current[username];
        }
        if (audioElementsRef.current[username]) {
            const audio = audioElementsRef.current[username];
            audio.srcObject = null;
            audio.remove();
            delete audioElementsRef.current[username];
        }
        setVoiceMembers(prev => {
            const next = new Set(prev);
            next.delete(username);
            return next;
        });
    };

    const cleanupAll = () => {
        Object.keys(peersRef.current).forEach(cleanupPeer);
        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(t => t.stop());
            localStreamRef.current = null;
        }
        setVoiceMembers(new Set());
        setIsInVoice(false);
    };

    const joinVoice = async () => {
        if (!socket || !currentRoomId || isInVoice) return;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            localStreamRef.current = stream;

            if (isMuted) {
                stream.getAudioTracks().forEach(t => t.enabled = false);
            }

            setIsInVoice(true);
            socket.emit('join_voice', { room_id: currentRoomId });
            setVoiceMembers(prev => new Set(prev).add(currentUser || ''));
        } catch (err) {
            console.error("Failed to get local audio", err);
            alert("Не удалось получить доступ к микрофону");
        }
    };

    const leaveVoice = () => {
        if (!socket || !currentRoomId) return;
        socket.emit('leave_voice', { room_id: currentRoomId });
        cleanupAll();
    };

    const toggleMute = () => {
        if (localStreamRef.current) {
            const audioTrack = localStreamRef.current.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled;
                setIsMuted(!audioTrack.enabled);
            }
        }
    };

    useEffect(() => {
        if (!socket || !currentUser) return;

        const handleUserJoined = (data: { username: string, room_id: string }) => {
            if (data.room_id !== currentRoomId || data.username === currentUser) return;
            setVoiceMembers(prev => new Set(prev).add(data.username));

            if (localStreamRef.current && isInVoice) {
                createPeer(data.username, true, localStreamRef.current);
            }
        };

        const handleUserLeft = (data: { username: string, room_id: string }) => {
            if (data.room_id !== currentRoomId) return;
            cleanupPeer(data.username);
        };

        const handleSignal = async (data: { from: string, signal: any, room_id: string }) => {
            if (data.room_id !== currentRoomId) return;
            const targetUser = data.from;
            const signal = data.signal;

            if (!localStreamRef.current) return;

            setVoiceMembers(prev => new Set(prev).add(targetUser));

            let peer = peersRef.current[targetUser];
            if (!peer && signal.type === 'offer') {
                peer = createPeer(targetUser, false, localStreamRef.current);
            }

            if (peer) {
                if (signal.type === 'offer') {
                    await peer.setRemoteDescription(new RTCSessionDescription(signal));
                    const answer = await peer.createAnswer();
                    await peer.setLocalDescription(answer);
                    socket.emit('webrtc_signal', {
                        target: targetUser,
                        room_id: currentRoomId,
                        signal: answer
                    });
                } else if (signal.type === 'answer') {
                    await peer.setRemoteDescription(new RTCSessionDescription(signal));
                } else if (signal.type === 'candidate' && signal.candidate) {
                    await peer.addIceCandidate(new RTCIceCandidate(signal.candidate)).catch(console.error);
                }
            }
        };

        socket.on('user_joined_voice', handleUserJoined);
        socket.on('user_left_voice', handleUserLeft);
        socket.on('webrtc_signal', handleSignal);

        return () => {
            socket.off('user_joined_voice', handleUserJoined);
            socket.off('user_left_voice', handleUserLeft);
            socket.off('webrtc_signal', handleSignal);
        };
    }, [socket, currentRoomId, currentUser, isInVoice, createPeer]);

    useEffect(() => {
        return () => {
            if (isInVoice) {
                leaveVoice();
            }
        };
    }, [currentRoomId]);

    return { joinVoice, leaveVoice, isInVoice, voiceMembers, isMuted, toggleMute };
}
