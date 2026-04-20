# @file-kiwi/node

Node.js library and CLI for uploading E2E encrypted files to [file.kiwi](https://file.kiwi).

For API documentation, limits, encryption details, and policies, see the [API docs](https://file.kiwi/api).

## Install

```bash
npm install @file-kiwi/node
```

## CLI Usage

![filekiwi CLI demo](filekiwi.gif)

```bash
# Upload files
npx @file-kiwi/node file1.txt file2.pdf image.png

# With a custom title
npx @file-kiwi/node --title "Project assets" file1.zip file2.zip

# Resume an interrupted upload
npx @file-kiwi/node --resume <webfolderId>
```

Or install globally to use the short command:

```bash
npm install -g @file-kiwi/node
filekiwi file1.txt file2.pdf
```

The CLI prints the shareable URL immediately and shows real-time upload progress for each file.

### Piping

When piped or used in a script, the CLI outputs only the URL to stdout. Progress goes to stderr, so it never breaks the pipeline.

```bash
# Save URL to a variable
URL=$(filekiwi report.pdf)

# Copy to clipboard (macOS)
filekiwi build.zip | pbcopy

# Send download link via email
echo "Build complete. Download: $(filekiwi dist.tar.gz)" | mail -s "Release v1.2.3" team@example.com
```

If the upload is interrupted, a temporary file `filekiwi.tmp.<webfolderId>.json` is left in the current directory. Use `--resume <webfolderId>` to continue from where it stopped.

File size, count, and retention limits apply. See [Limits](https://file.kiwi/api#limits) for details.

## Library Usage

### Quick Upload

```js
import { createWebFolder, startUpload } from '@file-kiwi/node';

// 1. Create a WebFolder (returns webfolderId, upload URLs, encryption keys, etc.)
const webfolder = await createWebFolder({
  title: 'My files',
  files: [
    { filepath: '/path/to/report.pdf' },
    { filepath: '/path/to/video.mp4' },
  ],
});

console.log(webfolder.webfolderUrl);  // https://file.kiwi/abc123#secretKey

// Save webfolder to disk in case upload is interrupted
fs.writeFileSync('webfolder.json', JSON.stringify(webfolder));

// 2. Upload all files
await startUpload(webfolder, {
  onProgress: (file, uploaded, total) => {
    console.log(`${file.fid}: ${uploaded}/${total} chunks`);
  },
  onFileComplete: (file) => {
    console.log(`${file.fid} complete`);
  },
});

// Upload done — clean up
fs.unlinkSync('webfolder.json');
```

### Resume Upload

```js
import { startUpload } from '@file-kiwi/node';
import fs from 'fs';

// Load the saved webfolder
const webfolder = JSON.parse(fs.readFileSync('webfolder.json', 'utf-8'));

// Resume — queries the API for each file's status and skips completed chunks
await startUpload(webfolder, {
  resume: true,
  onProgress: (file, uploaded, total) => {
    console.log(`${file.fid}: ${uploaded}/${total} chunks`);
  },
});
```

## API Reference

### `createWebFolder(options)`

Creates a WebFolder on file.kiwi. Returns a JSON-serializable webfolder object.

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `options.title` | `string` | No | WebFolder title (default: `MM/DD WebFolder`) |
| `options.files` | `Array<{ filepath: string }>` | Yes | Files to upload |

**Returns:** `Promise<WebFolder>`

```json
{
  "webfolderId": "a3f1b29c",
  "webfolderUrl": "https://file.kiwi/a3f1b29c#kR7xQ2mN9pLwYjHd",
  "secretKey": "kR7xQ2mN9pLwYjHd",
  "apiAuth": "8c4d2e1fa7b03956",
  "retentionHours": 90,
  "files": [
    {
      "filepath": "/home/user/report.pdf",
      "filesize": 1048576,
      "fid": "e5f6a7b8",
      "chunkSize": 10485760,
      "chunks": 1,
      "freeDownloadHours": 24,
      "uploadUrls": {
        "head": "https://filekiwi.8bf6ec6d...r2.cloudflarestorage.com/",
        "tail": "X-Amz-Algorithm=AWS4-HMAC-SHA256&...",
        "path": "stbox/0328/e5f6a7b8",
        "signatures": ["a1b2c3d4e5f6..."],
        "headers": {
          "x-amz-meta-folder_id": "a3f1b29c",
          "x-amz-meta-chunks": "1"
        }
      }
    }
  ]
}
```

| Field | Description |
|-------|-------------|
| `webfolderId` | Unique WebFolder ID |
| `webfolderUrl` | Shareable URL with decryption key (`#secretKey`) |
| `secretKey` | Decryption key (base64url, never sent to server) |
| `apiAuth` | Auth token for upload verification (keep secret) |
| `retentionHours` | Hours until files are deleted from server |
| `files[].filepath` | Local file path |
| `files[].filesize` | File size in bytes |
| `files[].fid` | Unique file ID |
| `files[].chunkSize` | Bytes per chunk |
| `files[].chunks` | Total number of chunks |
| `files[].freeDownloadHours` | Free download hours after upload completes |
| `files[].uploadUrls` | Presigned URL components for chunk uploads |

Save this object to JSON for resume support.

---

### `startUpload(webfolder, options?)`

Encrypts and uploads all files in the webfolder.

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `webfolder` | `WebFolder` | Yes | Object from `createWebFolder` or loaded from saved JSON |
| `options.resume` | `boolean` | No | Query the API and skip already-uploaded chunks. Default: `false` |
| `options.onProgress` | `(file, uploaded, total) => void` | No | Called after each chunk upload. `file` is the entry from `webfolder.files[]` |
| `options.onFileComplete` | `(file) => void` | No | Called when a file is fully verified |
| `options.onError` | `(file, error) => void` | No | Called on error. If provided, the error is not thrown and other files continue uploading |

**Returns:** `Promise<void>`

---

## About file.kiwi

file.kiwi is a free file sharing service that lets you share large files online with no size limits and no sign-up. Files are protected with end-to-end encryption, so only you and the recipient can access them. Works in any modern browser across desktop and mobile.

Start [instant file sharing](https://file.kiwi)

## License

MIT