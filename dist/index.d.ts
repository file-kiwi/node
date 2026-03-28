import type { WebFolder, CreateWebFolderOptions, StartUploadOptions, GenerateKeysResult } from './types.js';
export type { WebFolder, WebFolderFile, UploadUrls, CreateWebFolderOptions, StartUploadOptions, GenerateKeysResult, } from './types.js';
export declare function createWebFolder(options: CreateWebFolderOptions): Promise<WebFolder>;
export declare function startUpload(webfolder: WebFolder, options?: StartUploadOptions): Promise<void>;
export declare function encryptChunk(chunk: Buffer | Uint8Array, secretKey: string): Promise<Uint8Array>;
export declare function generateKeys(): Promise<GenerateKeysResult>;
//# sourceMappingURL=index.d.ts.map