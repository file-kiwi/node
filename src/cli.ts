#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { createWebFolder, startUpload } from './index.js';
import type { WebFolder, WebFolderFile } from './types.js';

// --- Helpers ---

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function tmpFilePath(webfolderId: string): string {
  return path.resolve(`filekiwi.tmp.${webfolderId}.json`);
}

// --- Progress display ---

const ESC = '\x1b';
const CLEAR_LINE = `${ESC}[2K`;
const MOVE_UP = (n: number) => `${ESC}[${n}A`;
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;

interface FileState {
  name: string;
  size: number;
  freeDownloadHours: number;
  progress: number;
  done: boolean;
}

function calcWidth(fileStates: FileState[]): number {
  let max = 0;
  for (const f of fileStates) {
    const name = f.name.length > 100 ? f.name.slice(0, 97) + '...' : f.name;
    const len = name.length + 2 + formatBytes(f.size).length + 2; // spaces around name and size
    if (len > max) max = len;
  }
  return max;
}

function renderFileLine(f: FileState, width: number): string {
  const truncName = f.name.length > 100 ? f.name.slice(0, 97) + '...' : f.name;
  const label = ` ${truncName} `;
  const sizeStr = ` ${formatBytes(f.size)} `;
  const totalWidth = Math.max(width, label.length + sizeStr.length);
  const text = label + sizeStr.padStart(totalWidth - label.length);
  const dlHours = f.freeDownloadHours ? ` \u274b${f.freeDownloadHours}h` : '';

  if (f.done) {
    return `  \x1b[42;30m${text}\x1b[0m\x1b[32m${dlHours}\x1b[0m`;
  }

  const filled = Math.round(f.progress * totalWidth);
  const pct = (f.progress * 100).toFixed(0) + '%';
  const filledText = text.slice(0, filled);
  const unfilledText = text.slice(filled);

  return `  \x1b[44;97m${filledText}\x1b[0m\x1b[7m${unfilledText}\x1b[0m \x1b[2m${pct}${dlHours}\x1b[0m`;
}

function drawProgress(fileStates: FileState[], url: string, retentionHours: number, lineCount: number): number {
  if (lineCount > 0) {
    process.stdout.write(MOVE_UP(lineCount));
  }
  const width = calcWidth(fileStates);
  let count = 0;
  for (const f of fileStates) {
    process.stdout.write(`${CLEAR_LINE}${renderFileLine(f, width)}\n`);
    count += 1;
  }
  process.stdout.write(`${CLEAR_LINE}\n`);
  process.stdout.write(`${CLEAR_LINE}  ${url}\n`);
  process.stdout.write(`${CLEAR_LINE}\n`);
  process.stdout.write(`${CLEAR_LINE}  \x1b[2m\u274b = free download hours left\x1b[0m\n`);
  process.stdout.write(`${CLEAR_LINE}  \x1b[2mAll files will be deleted from the server after ${retentionHours} hours.\x1b[0m\n`);
  count += 5;
  return count;
}

function makeCallbacks(webfolder: WebFolder, fileStates: FileState[], lineCountRef: { value: number }) {
  return {
    onProgress: (file: WebFolderFile, uploaded: number, total: number) => {
      const idx = webfolder.files.indexOf(file);
      fileStates[idx].progress = uploaded / total;
      lineCountRef.value = drawProgress(fileStates, webfolder.webfolderUrl, webfolder.retentionHours, lineCountRef.value);
    },
    onFileComplete: (file: WebFolderFile) => {
      const idx = webfolder.files.indexOf(file);
      fileStates[idx].done = true;
      lineCountRef.value = drawProgress(fileStates, webfolder.webfolderUrl, webfolder.retentionHours, lineCountRef.value);
    },
  };
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
  filekiwi - Upload files to file.kiwi

  Usage:
    filekiwi <file1> [file2] [file3] ...
    filekiwi --title "my files" file1.txt file2.pdf
    filekiwi --resume <webfolderId>

  Options:
    --title <name>          Set WebFolder title
    --resume <webfolderId>  Resume interrupted upload
    --help, -h              Show this help
`);
    process.exit(0);
  }

  let title: string | undefined;
  let resumeId: string | null = null;
  const filePaths: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--title' && args[i + 1]) {
      title = args[++i];
    } else if (args[i] === '--resume' && args[i + 1]) {
      resumeId = args[++i];
    } else if (!args[i].startsWith('-')) {
      filePaths.push(args[i]);
    }
  }

  if (resumeId) {
    const tmp = tmpFilePath(resumeId);
    if (!fs.existsSync(tmp)) {
      console.error(`Error: Resume file not found: ${tmp}`);
      process.exit(1);
    }

    const webfolder: WebFolder = JSON.parse(fs.readFileSync(tmp, 'utf-8'));

    for (const file of webfolder.files) {
      if (!fs.existsSync(file.filepath)) {
        console.error(`Error: File not found: ${file.filepath}`);
        process.exit(1);
      }
    }

    const fileStates: FileState[] = webfolder.files.map((meta) => ({
      name: path.basename(meta.filepath),
      size: meta.filesize,
      freeDownloadHours: meta.freeDownloadHours,
      progress: 0,
      done: false,
    }));

    process.stdout.write(HIDE_CURSOR);
    console.log('');
    const lineCountRef = { value: drawProgress(fileStates, webfolder.webfolderUrl, webfolder.retentionHours, 0) };

    await startUpload(webfolder, {
      resume: true,
      ...makeCallbacks(webfolder, fileStates, lineCountRef),
    });

    process.stdout.write(SHOW_CURSOR);
    fs.unlinkSync(tmp);
    console.log(`\n  Done. Resume complete.\n`);

  } else if (filePaths.length > 0) {
    const webfolder = await createWebFolder({
      title,
      files: filePaths.map((fp) => ({ filepath: fp })),
    });

    const tmp = tmpFilePath(webfolder.webfolderId);
    fs.writeFileSync(tmp, JSON.stringify(webfolder, null, 2));

    const fileStates: FileState[] = webfolder.files.map((meta) => ({
      name: path.basename(meta.filepath),
      size: meta.filesize,
      freeDownloadHours: meta.freeDownloadHours,
      progress: 0,
      done: false,
    }));

    process.stdout.write(HIDE_CURSOR);
    console.log('');
    const lineCountRef = { value: drawProgress(fileStates, webfolder.webfolderUrl, webfolder.retentionHours, 0) };

    await startUpload(webfolder, makeCallbacks(webfolder, fileStates, lineCountRef));

    process.stdout.write(SHOW_CURSOR);
    fs.unlinkSync(tmp);
    console.log(`\n  Done. ${webfolder.files.length} file(s) uploaded.\n`);

  } else {
    console.error('Error: No files specified.');
    process.exit(1);
  }
}

main().catch((err) => {
  process.stdout.write(SHOW_CURSOR);
  console.error(err.message || err);
  process.exit(1);
});
