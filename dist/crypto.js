import { Keychain } from 'wormhole-crypto';
// @ts-ignore — no types for wormhole-crypto/lib/ece.js
import { encryptStream } from 'wormhole-crypto/lib/ece.js';
export function bufferToStream(buf) {
    return new ReadableStream({
        start(controller) {
            controller.enqueue(new Uint8Array(buf));
            controller.close();
        },
    });
}
export function arrayToB64(array) {
    let binary = '';
    for (let i = 0; i < array.length; i++)
        binary += String.fromCharCode(array[i]);
    return btoa(binary);
}
export function b64ToArray(str) {
    const padded = str + '==='.slice((str.length + 3) % 4);
    const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++)
        bytes[i] = binary.charCodeAt(i);
    return bytes;
}
export async function encryptFileStream(stream, keyB64) {
    const keyBytes = b64ToArray(keyB64);
    const mainKey = await crypto.subtle.importKey('raw', keyBytes.buffer, 'HKDF', false, ['deriveBits', 'deriveKey']);
    return encryptStream(stream, mainKey);
}
export { Keychain };
//# sourceMappingURL=crypto.js.map