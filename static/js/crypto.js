const KeyDB = {
    async open() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open("CryptoE2E", 1);
            req.onupgradeneeded = e => e.target.result.createObjectStore("keys");
            req.onsuccess = e => resolve(e.target.result);
            req.onerror = e => reject(e);
        });
    },
    async saveKey(keyData) {
        const db = await this.open();
        return new Promise((resolve) => {
            const tx = db.transaction("keys", "readwrite");
            tx.objectStore("keys").put(keyData, "myPrivateKey");
            tx.oncomplete = () => resolve();
        });
    },
    async getKey() {
        const db = await this.open();
        return new Promise((resolve) => {
            const req = db.transaction("keys", "readonly").objectStore("keys").get("myPrivateKey");
            req.onsuccess = () => resolve(req.result);
        });
    }
};

const CryptoE2E = {
    ab2str(buf) { return String.fromCharCode.apply(null, new Uint8Array(buf)); },
    str2ab(str) { const buf = new ArrayBuffer(str.length); const bufView = new Uint8Array(buf); for (let i=0, strLen=str.length; i<strLen; i++) { bufView[i] = str.charCodeAt(i); } return buf; },
    toBase64(buf) { return btoa(this.ab2str(buf)); },
    fromBase64(base64) { return this.str2ab(atob(base64)); },

    async generateKeyPair() {
        const keyPair = await window.crypto.subtle.generateKey({ name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["encrypt", "decrypt"]);
        const exportedPublicKey = await window.crypto.subtle.exportKey("spki", keyPair.publicKey);
        const exportedPrivateKey = await window.crypto.subtle.exportKey("pkcs8", keyPair.privateKey);

        await KeyDB.saveKey(Array.from(new Uint8Array(exportedPrivateKey)));
        return this.toBase64(exportedPublicKey);
    },

    async importPublicKey(base64Key) {
        return await window.crypto.subtle.importKey("spki", this.fromBase64(base64Key), { name: "RSA-OAEP", hash: "SHA-256" }, true, ["encrypt"]);
    },

    async getMyPrivateKey() {
        const saved = await KeyDB.getKey();
        if (!saved) throw new Error("Ключ не найден!");
        return await window.crypto.subtle.importKey("pkcs8", new Uint8Array(saved).buffer, { name: "RSA-OAEP", hash: "SHA-256" }, true, ["decrypt"]);
    },

    async encryptForRoom(payloadObj, membersPublicKeys) {
        const encoder = new TextEncoder();
        const data = encoder.encode(JSON.stringify(payloadObj));

        const aesKey = await window.crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
        const iv = window.crypto.getRandomValues(new Uint8Array(12));

        const encryptedContent = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, aesKey, data);
        const rawAesKey = await window.crypto.subtle.exportKey("raw", aesKey);

        let encryptedKeysDict = {};
        for (const [username, pubKeyB64] of Object.entries(membersPublicKeys)) {
            if (!pubKeyB64) continue;
            const rsaPubKey = await this.importPublicKey(pubKeyB64);
            const encKey = await window.crypto.subtle.encrypt({ name: "RSA-OAEP" }, rsaPubKey, rawAesKey);
            encryptedKeysDict[username] = this.toBase64(encKey);
        }

        return { cipherText: this.toBase64(encryptedContent), iv: this.toBase64(iv), encryptedKeys: JSON.stringify(encryptedKeysDict) };
    },

    async decryptForMe(username, cipherTextB64, ivB64, encryptedKeysJson) {
        try {
            const keysDict = JSON.parse(encryptedKeysJson);
            const myEncryptedAesKeyB64 = keysDict[username];
            if (!myEncryptedAesKeyB64) return { text: "[Нет доступа]", media: null };

            const myPrivateKey = await this.getMyPrivateKey();
            const rawAesKey = await window.crypto.subtle.decrypt({ name: "RSA-OAEP" }, myPrivateKey, this.fromBase64(myEncryptedAesKeyB64));
            const aesKey = await window.crypto.subtle.importKey("raw", rawAesKey, { name: "AES-GCM" }, true, ["decrypt"]);

            const decryptedContent = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv: this.fromBase64(ivB64) }, aesKey, this.fromBase64(cipherTextB64));

            return JSON.parse(new TextDecoder().decode(decryptedContent));
        } catch (e) {
            return { text: "[Ошибка дешифровки]", media: null };
        }
    }
};
