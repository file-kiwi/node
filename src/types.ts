export interface UploadUrls {
  head: string;
  tail: string;
  path: string;
  signatures: string[];
  headers: Record<string, string>;
}

export interface WebFolderFile {
  filepath: string;
  filesize: number;
  fid: string;
  chunkSize: number;
  chunks: number;
  freeDownloadHours: number;
  uploadUrls: UploadUrls;
}

export interface WebFolder {
  webfolderId: string;
  webfolderUrl: string;
  secretKey: string;
  apiAuth: string;
  retentionHours: number;
  files: WebFolderFile[];
}

export interface CreateWebFolderOptions {
  title?: string;
  files: Array<string | { filepath: string }>;
}

export interface StartUploadOptions {
  resume?: boolean;
  onProgress?: (file: WebFolderFile, uploaded: number, total: number) => void;
  onFileComplete?: (file: WebFolderFile) => void;
  onError?: (file: WebFolderFile, error: Error) => void;
}

export interface GenerateKeysResult {
  secretKey: string;
  ske: string;
  encryptFilename: (name: string) => Promise<string>;
}
