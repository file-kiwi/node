import fs from 'fs';
import path from 'path';
import {
  Keychain, bufferToStream, arrayToB64, encryptFileStream,
} from './crypto.js';
import type {
  WebFolder, WebFolderFile, CreateWebFolderOptions,
  StartUploadOptions, GenerateKeysResult,
} from './types.js';

export type {
  WebFolder, WebFolderFile, UploadUrls,
  CreateWebFolderOptions, StartUploadOptions, GenerateKeysResult,
} from './types.js';

const API_BASE = process.env.FILEKIWI_API || 'https://api.file.kiwi';

// --- Helpers ---

function buildChunkOrder(total: number): number[] {
  if (total <= 1) return [0];
  const order = [0, total - 1];
  for (let i = 1; i < total - 1; i++) order.push(i);
  return order;
}

// --- Public API ---

export async function createWebFolder(options: CreateWebFolderOptions): Promise<WebFolder> {
  const fileEntries: Array<{ filepath: string; filename: string; filesize: number }> = [];
  for (const fp of options.files) {
    const filepath = typeof fp === 'string' ? fp : fp.filepath;
    const resolved = path.resolve(filepath);
    if (!fs.existsSync(resolved)) throw new Error(`File not found: ${filepath}`);
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) throw new Error(`Not a file: ${filepath}`);
    fileEntries.push({
      filepath: resolved,
      filename: path.basename(resolved),
      filesize: stat.size,
    });
  }

  let title = options.title;
  if (!title) {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate());
    title = `${mm}/${dd} WebFolder`;
  }

  // Generate encryption key
  const keychain = new Keychain(null, null);
  const secretKey: string = keychain.keyB64;

  const secretKeyBytes = new TextEncoder().encode(secretKey);
  const skeStream = await keychain.encryptStream(bufferToStream(Buffer.from(secretKeyBytes)));
  const skeBuffer = new Uint8Array(await new Response(skeStream).arrayBuffer());
  const ske = arrayToB64(skeBuffer);

  // Encrypt filenames
  const encryptedFilenames: string[] = [];
  for (const entry of fileEntries) {
    const nameBytes = new TextEncoder().encode(entry.filename);
    const encStream = await keychain.encryptStream(bufferToStream(Buffer.from(nameBytes)));
    const encBuf = new Uint8Array(await new Response(encStream).arrayBuffer());
    encryptedFilenames.push(arrayToB64(encBuf));
  }

  // Create webfolder via API
  const res = await fetch(`${API_BASE}/v1/delivery-webfolder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      ske,
      files: fileEntries.map((f, idx) => ({
        filename: encryptedFilenames[idx],
        filesize: f.filesize,
      })),
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as any);
    throw new Error(body.error || `API returned ${res.status}`);
  }

  const data = await res.json() as any;

  const webfolder: WebFolder = {
    webfolderId: data.webfolderId,
    webfolderUrl: `${data.webfolderUrl}#${secretKey}`,
    secretKey,
    apiAuth: data.apiAuth,
    retentionHours: data.retentionHours || 90,
    files: data.files.map((meta: any, i: number) => {
      const { filename: _enc, ...rest } = meta;
      return {
        ...rest,
        filepath: fileEntries[i].filepath,
        filesize: fileEntries[i].filesize,
      };
    }),
  };

  return webfolder;
}

export async function startUpload(webfolder: WebFolder, options: StartUploadOptions = {}): Promise<void> {
  const { resume = false, onProgress, onFileComplete, onError } = options;

  // If resume, query API for each file's status
  const skipChunks: Array<'complete' | Set<number>> = [];
  if (resume) {
    for (const file of webfolder.files) {
      const checkUrl = `${API_BASE}/v1/upload/check/${file.fid}?webfolderId=${webfolder.webfolderId}`;
      const checkRes = await fetch(checkUrl);
      const checkData = await checkRes.json() as { complete: boolean; missing: number[] };

      if (checkData.complete) {
        skipChunks.push('complete');
        continue;
      }

      const missingSet = new Set(checkData.missing);
      const uploaded = new Set<number>();
      for (let c = 1; c <= file.chunks; c++) {
        if (!missingSet.has(c)) uploaded.add(c);
      }
      skipChunks.push(uploaded);
    }
  }

  for (let i = 0; i < webfolder.files.length; i++) {
    const meta = webfolder.files[i];

    if (skipChunks[i] === 'complete') {
      onProgress?.(meta, meta.chunks, meta.chunks);
      onFileComplete?.(meta);
      continue;
    }

    let fileBuffer: Buffer;
    try {
      fileBuffer = fs.readFileSync(meta.filepath);
    } catch {
      const err = new Error(`Cannot read file: ${meta.filepath}`);
      if (onError) { onError(meta, err); continue; }
      throw err;
    }
    const allChunks = buildChunkOrder(meta.chunks);

    const skip = skipChunks[i] || new Set<number>();
    const remaining = typeof skip === 'string' ? [] : allChunks.filter((c) => !skip.has(c + 1));
    let uploaded = typeof skip === 'object' ? skip.size : 0;

    for (const c of remaining) {
      const start = c * meta.chunkSize;
      const end = Math.min(start + meta.chunkSize, fileBuffer.length);
      const plainChunk = fileBuffer.subarray(start, end);

      const plainStream = bufferToStream(plainChunk);
      const encryptedStream = await encryptFileStream(plainStream, webfolder.secretKey);
      const encryptedBlob = new Uint8Array(await new Response(encryptedStream).arrayBuffer());

      const chunkNum = ('00000' + (c + 1)).slice(-5);
      const url = `${meta.uploadUrls.head}${meta.uploadUrls.path}/${chunkNum}?${meta.uploadUrls.tail}&X-Amz-Signature=${meta.uploadUrls.signatures[c]}`;

      const uploadRes = await fetch(url, {
        method: 'PUT',
        body: encryptedBlob,
        headers: {
          'Content-Length': String(encryptedBlob.length),
          ...meta.uploadUrls.headers,
        },
      });

      if (!uploadRes.ok) {
        const err = new Error(`Upload failed for ${path.basename(meta.filepath)} chunk ${c + 1}: ${uploadRes.status}`);
        if (onError) { onError(meta, err); return; }
        throw err;
      }

      uploaded++;
      onProgress?.(meta, uploaded, meta.chunks);
    }

    // Verify completion
    const checkUrl = `${API_BASE}/v1/upload/check/${meta.fid}?webfolderId=${webfolder.webfolderId}&apiAuth=${encodeURIComponent(webfolder.apiAuth)}`;
    await fetch(checkUrl);

    onFileComplete?.(meta);
  }
}

export async function encryptChunk(chunk: Buffer | Uint8Array, secretKey: string): Promise<Uint8Array> {
  const plainStream = bufferToStream(chunk);
  const encryptedStream = await encryptFileStream(plainStream, secretKey);
  return new Uint8Array(await new Response(encryptedStream).arrayBuffer());
}

export async function generateKeys(): Promise<GenerateKeysResult> {
  const keychain = new Keychain(null, null);
  const secretKey: string = keychain.keyB64;

  const secretKeyBytes = new TextEncoder().encode(secretKey);
  const skeStream = await keychain.encryptStream(bufferToStream(Buffer.from(secretKeyBytes)));
  const skeBuffer = new Uint8Array(await new Response(skeStream).arrayBuffer());
  const ske = arrayToB64(skeBuffer);

  return {
    secretKey,
    ske,
    encryptFilename: async (name: string) => {
      const nameBytes = new TextEncoder().encode(name);
      const encStream = await keychain.encryptStream(bufferToStream(Buffer.from(nameBytes)));
      const encBuf = new Uint8Array(await new Response(encStream).arrayBuffer());
      return arrayToB64(encBuf);
    },
  };
}
