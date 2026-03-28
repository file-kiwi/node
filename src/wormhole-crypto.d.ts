declare module 'wormhole-crypto' {
  export class Keychain {
    constructor(key: Uint8Array | null, salt: Uint8Array | null);
    keyB64: string;
    saltB64: string;
    encryptStream(stream: ReadableStream<Uint8Array>): Promise<ReadableStream<Uint8Array>>;
    decryptStream(stream: ReadableStream<Uint8Array>): Promise<ReadableStream<Uint8Array>>;
  }
}

declare module 'wormhole-crypto/lib/ece.js' {
  export function encryptStream(
    stream: ReadableStream<Uint8Array>,
    key: CryptoKey,
  ): ReadableStream<Uint8Array>;
}
