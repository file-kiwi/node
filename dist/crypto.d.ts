import { Keychain } from 'wormhole-crypto';
export declare function bufferToStream(buf: Buffer | Uint8Array): ReadableStream<Uint8Array>;
export declare function arrayToB64(array: Uint8Array): string;
export declare function b64ToArray(str: string): Uint8Array;
export declare function encryptFileStream(stream: ReadableStream<Uint8Array>, keyB64: string): Promise<ReadableStream<Uint8Array>>;
export { Keychain };
//# sourceMappingURL=crypto.d.ts.map