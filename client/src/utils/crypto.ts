export const KeyDB = {
    async open() {
        return new Promise<IDBDatabase>((resolve, reject) => {
            const req = indexedDB.open("CryptoE2E", 1);
            req.onupgradeneeded = (e: any) => e.target.result.createObjectStore("keys");
            req.onsuccess = (e: any) => resolve(e.target.result);
            req.onerror = (e) => reject(e);
        });
    },
    async saveKey(keyData: number[]) {
        const db = await this.open();
        return new Promise<void>((resolve) => {
            const tx = db.transaction("keys", "readwrite");
            tx.objectStore("keys").put(keyData, "myPrivateKey");
            tx.oncomplete = () => resolve();
        });
    },
    async getKey() {
        const db = await this.open();
        return new Promise<any>((resolve) => {
            const req = db.transaction("keys", "readonly").objectStore("keys").get("myPrivateKey");
            req.onsuccess = () => resolve(req.result);
        });
    }
};

export const CryptoE2E = {
    ab2str(buf: ArrayBuffer) {
        return String.fromCharCode.apply(null, Array.from(new Uint8Array(buf)));
    },
    str2ab(str: string) {
        const buf = new ArrayBuffer(str.length);
        const bufView = new Uint8Array(buf);
        for (let i=0, strLen=str.length; i<strLen; i++) {
            bufView[i] = str.charCodeAt(i);
        }
        return buf;
    },
    toBase64(buf: ArrayBuffer) {
        return btoa(this.ab2str(buf));
    },
    fromBase64(base64: string) {
        return this.str2ab(atob(base64));
    },

    async generateKeyPair(password?: string) {
        const keyPair = await window.crypto.subtle.generateKey(
            { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
            true,
            ["encrypt", "decrypt"]
        );
        const exportedPublicKey = await window.crypto.subtle.exportKey("spki", keyPair.publicKey);
        const exportedPrivateKey = await window.crypto.subtle.exportKey("pkcs8", keyPair.privateKey);

        await KeyDB.saveKey(Array.from(new Uint8Array(exportedPrivateKey)));

        let encryptedPrivateKey = null;
        if (password) {
            encryptedPrivateKey = await this.encryptPrivateKeyWithPassword(exportedPrivateKey, password);
        }

        return {
            publicKey: this.toBase64(exportedPublicKey),
            encryptedPrivateKey: encryptedPrivateKey
        };
    },

    async importPublicKey(base64Key: string) {
        return await window.crypto.subtle.importKey(
            "spki",
            this.fromBase64(base64Key),
            { name: "RSA-OAEP", hash: "SHA-256" },
            true,
            ["encrypt"]
        );
    },

    async getMyPrivateKey() {
        const saved = await KeyDB.getKey();
        if (!saved) throw new Error("Ключ не найден!");
        return await window.crypto.subtle.importKey(
            "pkcs8",
            new Uint8Array(saved).buffer,
            { name: "RSA-OAEP", hash: "SHA-256" },
            true,
            ["decrypt"]
        );
    },

    async derivePasswordKey(password: string, salt: Uint8Array) {
        const enc = new TextEncoder();
        const keyMaterial = await window.crypto.subtle.importKey(
            "raw",
            enc.encode(password),
            { name: "PBKDF2" },
            false,
            ["deriveBits", "deriveKey"]
        );
        return await window.crypto.subtle.deriveKey(
            {
                name: "PBKDF2",
                salt: salt,
                iterations: 100000,
                hash: "SHA-256"
            },
            keyMaterial,
            { name: "AES-GCM", length: 256 },
            true,
            ["encrypt", "decrypt"]
        );
    },

    async encryptPrivateKeyWithPassword(privateKeyBuffer: ArrayBuffer, password: string) {
        const salt = window.crypto.getRandomValues(new Uint8Array(16));
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const aesKey = await this.derivePasswordKey(password, salt);

        const encrypted = await window.crypto.subtle.encrypt(
            { name: "AES-GCM", iv: iv },
            aesKey,
            privateKeyBuffer
        );

        const payload = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
        payload.set(salt, 0);
        payload.set(iv, salt.length);
        payload.set(new Uint8Array(encrypted), salt.length + iv.length);

        return this.toBase64(payload.buffer);
    },

    async decryptPrivateKeyWithPassword(encryptedPayloadBase64: string, password: string) {
        const payload = new Uint8Array(this.fromBase64(encryptedPayloadBase64));
        const salt = payload.slice(0, 16);
        const iv = payload.slice(16, 28);
        const encrypted = payload.slice(28);

        const aesKey = await this.derivePasswordKey(password, salt);
        const decrypted = await window.crypto.subtle.decrypt(
            { name: "AES-GCM", iv: iv },
            aesKey,
            encrypted
        );
        return decrypted;
    },

    async encryptForRoom(payloadObj: any, membersPublicKeys: Record<string, string>) {
        const encoder = new TextEncoder();
        const data = encoder.encode(JSON.stringify(payloadObj));

        const aesKey = await window.crypto.subtle.generateKey(
            { name: "AES-GCM", length: 256 },
            true,
            ["encrypt", "decrypt"]
        );
        const iv = window.crypto.getRandomValues(new Uint8Array(12));

        const encryptedContent = await window.crypto.subtle.encrypt(
            { name: "AES-GCM", iv: iv },
            aesKey,
            data
        );
        const rawAesKey = await window.crypto.subtle.exportKey("raw", aesKey);

        let encryptedKeysDict: Record<string, string> = {};
        for (const [username, pubKeyB64] of Object.entries(membersPublicKeys)) {
            if (!pubKeyB64) continue;
            const rsaPubKey = await this.importPublicKey(pubKeyB64);
            const encKey = await window.crypto.subtle.encrypt(
                { name: "RSA-OAEP" },
                rsaPubKey,
                rawAesKey
            );
            encryptedKeysDict[username] = this.toBase64(encKey);
        }

        return {
            cipherText: this.toBase64(encryptedContent),
            iv: this.toBase64(iv),
            encryptedKeys: JSON.stringify(encryptedKeysDict)
        };
    },

    async decryptForMe(username: string, cipherTextB64: string, ivB64: string, encryptedKeysJson: string) {
        try {
            const keysDict = JSON.parse(encryptedKeysJson);
            const myEncryptedAesKeyB64 = keysDict[username];
            if (!myEncryptedAesKeyB64) return { text: "[Нет доступа]", media: null };

            const myPrivateKey = await this.getMyPrivateKey();
            const rawAesKey = await window.crypto.subtle.decrypt(
                { name: "RSA-OAEP" },
                myPrivateKey,
                this.fromBase64(myEncryptedAesKeyB64)
            );
            const aesKey = await window.crypto.subtle.importKey(
                "raw",
                rawAesKey,
                { name: "AES-GCM" },
                true,
                ["decrypt"]
            );

            const decryptedContent = await window.crypto.subtle.decrypt(
                { name: "AES-GCM", iv: this.fromBase64(ivB64) },
                aesKey,
                this.fromBase64(cipherTextB64)
            );

            return JSON.parse(new TextDecoder().decode(decryptedContent));
        } catch (e) {
            return { text: "[Ошибка дешифровки (ключ изменился?)]", media: null };
        }
    }
};
