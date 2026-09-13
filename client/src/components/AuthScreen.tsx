import React, { useState } from 'react';
import { useChatStore } from '../store/useChatStore';
import { api } from '../services/api';

export default function AuthScreen() {
    const { setUser } = useChatStore();
    const [isRegister, setIsRegister] = useState(false);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (!username || !password) {
            setError('Заполните поля');
            return;
        }

        setLoading(true);
        try {
            let pubKey = 'no_crypto';
            let encPrivKey = null;
            const isCryptoAvailable = !!(window.crypto && window.crypto.subtle);

            if (isCryptoAvailable) {
                const { CryptoE2E, KeyDB } = await import('../utils/crypto');

                const endpoint = isRegister ? 'register' : 'login';

                if (isRegister) {
                    setError('Генерация ключей шифрования...');
                    const keys = await CryptoE2E.generateKeyPair(password);
                    pubKey = keys.publicKey;
                    encPrivKey = keys.encryptedPrivateKey;
                } else {

                    const hasKey = await KeyDB.getKey();
                    if (!hasKey) {

                    }
                }

                const reqBody: any = { username, password };
                if (pubKey !== 'no_crypto') {
                    reqBody.public_key = pubKey;
                }
                if (encPrivKey) {
                    reqBody.encrypted_private_key = encPrivKey;
                }

                const res = await fetch(`/api/${endpoint}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(reqBody)
                });

                const data = await res.json();

                if (res.ok) {
                    if (isRegister) {
                        alert('Регистрация успешна!');
                        setIsRegister(false);
                    } else {

                        if (data.encrypted_private_key) {
                            const hasKey = await KeyDB.getKey();
                            if (!hasKey) {
                                try {
                                    const privKeyBuffer = await CryptoE2E.decryptPrivateKeyWithPassword(data.encrypted_private_key, password);
                                    await KeyDB.saveKey(Array.from(new Uint8Array(privKeyBuffer)));
                                } catch (err) {
                                    console.error("Failed to decrypt private key", err);

                                    const keys = await CryptoE2E.generateKeyPair(password);

                                    await fetch(`/api/login`, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                            username,
                                            password,
                                            public_key: keys.publicKey,
                                            encrypted_private_key: keys.encryptedPrivateKey
                                        })
                                    });
                                }
                            }
                        } else {

                            const hasKey = await KeyDB.getKey();
                            if (!hasKey) {
                                const keys = await CryptoE2E.generateKeyPair(password);
                                await fetch(`/api/login`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        username,
                                        password,
                                        public_key: keys.publicKey,
                                        encrypted_private_key: keys.encryptedPrivateKey
                                    })
                                });
                            } else {

                                const privKeyBuffer = new Uint8Array(hasKey).buffer;
                                const encPrivKey = await CryptoE2E.encryptPrivateKeyWithPassword(privKeyBuffer, password);
                                await fetch(`/api/login`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        username,
                                        password,
                                        public_key: pubKey !== 'no_crypto' ? pubKey : undefined,
                                        encrypted_private_key: encPrivKey
                                    })
                                });
                            }
                        }

                        localStorage.setItem('savedUsername', data.username);
                        setUser(data.username, data.avatar);
                    }
                } else {
                    setError(data.error || 'Ошибка авторизации');
                }
            } else {

                const endpoint = isRegister ? 'register' : 'login';
                const res = await fetch(`/api/${endpoint}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password, public_key: 'no_crypto' })
                });

                const data = await res.json();

                if (res.ok) {
                    if (isRegister) {
                        alert('Регистрация успешна!');
                        setIsRegister(false);
                    } else {
                        localStorage.setItem('savedUsername', data.username);
                        setUser(data.username, data.avatar);
                    }
                } else {
                    setError(data.error || 'Ошибка авторизации');
                }
            }
        } catch (err) {
            console.error('Auth error', err);
            setError('Ошибка сети или сервер недоступен');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div id="auth-screen">
            <div className="auth-box bg-[rgba(20,20,25,0.6)] backdrop-blur-2xl p-12 rounded-[32px] w-[380px] text-center shadow-2xl border border-white/10 z-10">
                <div className="mx-auto w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mb-6 shadow-inner border border-white/10">
                    <div className="w-8 h-8 rounded-full border-[4px] border-dashed border-white/60 animate-[spin_10s_linear_infinite]"></div>
                </div>
                <h2 className="mt-0 font-semibold text-white mb-2 text-3xl tracking-tight">
                    {isRegister ? 'Create Account' : 'Welcome back!'}
                </h2>
                <p className="text-white/50 text-sm mb-8 font-medium">
                    {isRegister ? 'Join the network' : 'First time here? '}
                    {isRegister ? '' : <span className="text-white font-semibold cursor-pointer hover:underline" onClick={() => setIsRegister(true)}>Sign up for free</span>}
                </p>
                <form onSubmit={handleSubmit} className="flex flex-col gap-3">
                    <div className="flex flex-col gap-2 relative">
                        <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                        <input
                            type="text"
                            placeholder="Your username"
                            value={username}
                            onChange={e => setUsername(e.target.value)}
                            className="form-input w-full box-border !pl-10"
                        />
                    </div>
                    <div className="flex flex-col gap-2 relative mt-2">
                        <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                        <input
                            type="password"
                            placeholder="••••••••"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            className="form-input w-full box-border !pl-10 tracking-widest"
                        />
                    </div>

                    {error && (
                        <div className="text-[#ff6b6b] text-[13px] mt-2 font-medium bg-red-500/10 py-2 rounded-lg border border-red-500/20">{error}</div>
                    )}

                    <button
                        type="submit"
                        disabled={loading}
                        className="btn-primary w-full mt-4 text-[15px]"
                    >
                        {loading ? 'Please wait...' : (isRegister ? 'Sign up' : 'Sign in')}
                    </button>

                    {!isRegister && (
                        <button
                            type="button"
                            className="text-white/60 hover:text-white text-sm font-medium transition-colors mt-2"
                        >
                            Sign in using magic link
                        </button>
                    )}

                    <div className="flex items-center gap-4 my-4 opacity-50">
                        <div className="flex-1 h-[1px] bg-white/20"></div>
                        <span className="text-xs text-white uppercase tracking-widest">or</span>
                        <div className="flex-1 h-[1px] bg-white/20"></div>
                    </div>

                    <button
                        type="button"
                        className="btn w-full p-3 font-semibold rounded-[20px] justify-center text-white/70"
                        onClick={() => setIsRegister(!isRegister)}
                    >
                        {isRegister ? 'Single sign-on (SSO)' : 'Single sign-on (SSO)'}
                    </button>

                    <p className="text-[11px] text-white/40 mt-6 leading-relaxed px-4">
                        You acknowledge that you read, and agree, to our <br/>
                        <span className="underline cursor-pointer">Terms of Service</span> and our <span className="underline cursor-pointer">Privacy Policy</span>.
                    </p>
                </form>
            </div>
        </div>
    );
}
