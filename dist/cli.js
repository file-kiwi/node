#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { exec } from 'child_process';
import { createWebFolder, startUpload } from './index.js';
const require = createRequire(import.meta.url);
// --- Helpers ---
function formatBytes(bytes) {
    if (bytes < 1024)
        return `${bytes} B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024)
        return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
function tmpFilePath(webfolderId) {
    return path.resolve(`filekiwi.tmp.${webfolderId}.json`);
}
// --- Terminal escape codes ---
const ESC = '\x1b';
const CLEAR_LINE = `${ESC}[2K`;
const CLEAR_BELOW = `${ESC}[J`;
const MOVE_UP = (n) => `${ESC}[${n}A`;
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;
// --- Renderer ---
// Tracks how many visible lines were drawn last time for MOVE_UP on next redraw.
let drawnLines = 0;
function redrawLines(lines) {
    const rows = process.stdout.rows || 24;
    if (drawnLines > 0) {
        process.stdout.write(MOVE_UP(Math.min(drawnLines, rows - 1)));
    }
    let buf = '';
    for (const line of lines) {
        buf += `${CLEAR_LINE}${line}\n`;
    }
    buf += CLEAR_BELOW;
    process.stdout.write(buf);
    drawnLines = lines.length;
}
function clearDrawn() {
    const rows = process.stdout.rows || 24;
    if (drawnLines > 0) {
        process.stdout.write(MOVE_UP(Math.min(drawnLines, rows - 1)));
        process.stdout.write(CLEAR_BELOW);
        drawnLines = 0;
    }
}
// --- Interactive helpers ---
function startKeyListener(validKeys, onKey) {
    const { stdin } = process;
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (key) => {
        const k = key.toLowerCase();
        if (validKeys.includes(k)) {
            onKey(k);
        }
    };
    stdin.on('data', onData);
    return () => {
        stdin.removeListener('data', onData);
        stdin.setRawMode(wasRaw ?? false);
        stdin.pause();
    };
}
function openInBrowser(url) {
    const plat = process.platform;
    const cmd = plat === 'darwin' ? 'open' : plat === 'win32' ? 'start ""' : 'xdg-open';
    exec(`${cmd} "${url}"`);
}
function copyToClipboard(text) {
    const plat = process.platform;
    const cmd = plat === 'darwin' ? 'pbcopy' : plat === 'win32' ? 'clip' : 'xclip -selection clipboard';
    const child = exec(cmd);
    child.stdin?.write(text);
    child.stdin?.end();
}
function generateQrCode(text) {
    const qrcode = require('qrcode-terminal');
    let result = '';
    qrcode.generate(text, { small: true }, (code) => {
        result = code;
    });
    // Add left padding to each line
    return result.split('\n').map((l) => l.length > 0 ? '  ' + l : l).join('\n');
}
// Terminal display width for a string (CJK/fullwidth = 2, others = 1)
function strWidth(str) {
    let w = 0;
    for (const ch of str) {
        const cp = ch.codePointAt(0) || 0;
        if ((cp >= 0x1100 && cp <= 0x115F) ||
            (cp >= 0x2E80 && cp <= 0x303E) ||
            (cp >= 0x3040 && cp <= 0x33BF) ||
            (cp >= 0x3400 && cp <= 0x4DBF) ||
            (cp >= 0x4E00 && cp <= 0xA4CF) ||
            (cp >= 0xAC00 && cp <= 0xD7AF) ||
            (cp >= 0xF900 && cp <= 0xFAFF) ||
            (cp >= 0xFE30 && cp <= 0xFE6F) ||
            (cp >= 0xFF01 && cp <= 0xFF60) ||
            (cp >= 0xFFE0 && cp <= 0xFFE6) ||
            (cp >= 0x20000 && cp <= 0x2FA1F)) {
            w += 2;
        }
        else {
            w += 1;
        }
    }
    return w;
}
function truncName(name, maxChars = 100) {
    return name.length > maxChars ? name.slice(0, maxChars - 3) + '...' : name;
}
function calcWidth(fileStates) {
    let max = 0;
    for (const f of fileStates) {
        const name = truncName(f.name);
        const w = strWidth(name) + 2 + strWidth(formatBytes(f.size)) + 2;
        if (w > max)
            max = w;
    }
    return Math.max(max, 30);
}
function renderFileLine(f, width) {
    const name = truncName(f.name);
    const sizeStr = formatBytes(f.size);
    const nameW = strWidth(name) + 2;
    const sizeW = strWidth(sizeStr) + 2;
    const totalWidth = Math.max(width, nameW + sizeW);
    const gap = totalWidth - nameW - sizeW;
    const text = ` ${name} ${' '.repeat(gap)} ${sizeStr} `;
    const dlTag = f.freeDownloadHours ? ` [${f.freeDownloadHours}h]` : '';
    if (f.done) {
        return `  \x1b[42;30m${text}\x1b[0m\x1b[32m${dlTag}\x1b[0m`;
    }
    const filled = Math.round(f.progress * totalWidth);
    const pct = (f.progress * 100).toFixed(2) + '%';
    const filledText = text.slice(0, filled);
    const unfilledText = text.slice(filled);
    return `  \x1b[44;97m${filledText}\x1b[0m\x1b[7m${unfilledText}\x1b[0m \x1b[2m${pct}${dlTag}\x1b[0m`;
}
// --- Line builders ---
const MENU_UPLOADING = `  \x1b[36m[O]\x1b[0mpen in browser  \x1b[36m[C]\x1b[0mopy link  \x1b[36m[S]\x1b[0mtop`;
const MENU_DONE = `  \x1b[36m[O]\x1b[0mpen in browser  \x1b[36m[C]\x1b[0mopy link  \x1b[2mAny other key to exit...\x1b[0m`;
function buildFullLines(fileStates, url, retentionHours, qrLines) {
    const rows = process.stdout.rows || 24;
    const width = calcWidth(fileStates);
    const allDone = fileStates.every((f) => f.done);
    const lines = [''];
    for (const f of fileStates) {
        lines.push(renderFileLine(f, width));
    }
    lines.push('');
    lines.push(`  \x1b[2m[ ] = free download hours left\x1b[0m`);
    lines.push(`  \x1b[2mAll files will be deleted from the server after ${retentionHours} hours.\x1b[0m`);
    // fixed lines so far + blank + qr? + blank + url + blank + msg + blank + menu(+hint) = +7 or +8
    const fixedCount = lines.length + (allDone ? 8 : 7);
    if (fixedCount + qrLines.length < rows) {
        lines.push('');
        for (const ql of qrLines) {
            lines.push(ql);
        }
    }
    lines.push('');
    lines.push(`  ${url}`);
    lines.push('');
    if (allDone) {
        lines.push(`  \x1b[42;30m Done. ${fileStates.length} file(s) uploaded. \x1b[0m`);
    }
    else {
        lines.push(`  \x1b[42;30m You can share this link even while uploading. \x1b[0m`);
    }
    lines.push('');
    if (allDone) {
        lines.push(MENU_DONE);
    }
    else {
        lines.push(MENU_UPLOADING);
    }
    return lines;
}
function buildProgressLines(fileStates, url, retentionHours) {
    const width = calcWidth(fileStates);
    const allDone = fileStates.every((f) => f.done);
    const lines = [''];
    for (const f of fileStates) {
        lines.push(renderFileLine(f, width));
    }
    lines.push('');
    lines.push(`  \x1b[2m[ ] = free download hours left\x1b[0m`);
    lines.push(`  \x1b[2mAll files will be deleted from the server after ${retentionHours} hours.\x1b[0m`);
    lines.push('');
    lines.push(`  ${url}`);
    lines.push('');
    if (allDone) {
        lines.push(`  \x1b[42;30m Done. ${fileStates.length} file(s) uploaded. \x1b[0m`);
    }
    else {
        lines.push(`  \x1b[42;30m You can share this link even while uploading. \x1b[0m`);
    }
    return lines;
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
    let title;
    let resumeId = null;
    const filePaths = [];
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--title' && args[i + 1]) {
            title = args[++i];
        }
        else if (args[i] === '--resume' && args[i + 1]) {
            resumeId = args[++i];
        }
        else if (!args[i].startsWith('-')) {
            filePaths.push(args[i]);
        }
    }
    const isTTY = process.stdout.isTTY;
    if (resumeId) {
        const tmp = tmpFilePath(resumeId);
        if (!fs.existsSync(tmp)) {
            console.error(`Error: Resume file not found: ${tmp}`);
            process.exit(1);
        }
        const webfolder = JSON.parse(fs.readFileSync(tmp, 'utf-8'));
        for (const file of webfolder.files) {
            if (!fs.existsSync(file.filepath)) {
                console.error(`Error: File not found: ${file.filepath}`);
                process.exit(1);
            }
        }
        if (!isTTY) {
            process.stdout.write(webfolder.webfolderUrl + '\n');
            process.stderr.write(`Resuming ${webfolder.files.length} file(s)...\n`);
            await startUpload(webfolder, {
                resume: true,
                onFileComplete: (file) => {
                    process.stderr.write(`  done: ${path.basename(file.filepath)}\n`);
                },
            });
            fs.unlinkSync(tmp);
            process.stderr.write(`Done. ${webfolder.files.length} file(s) uploaded.\n`);
        }
        else {
            const fileStates = webfolder.files.map((meta) => ({
                name: path.basename(meta.filepath),
                size: meta.filesize,
                freeDownloadHours: meta.freeDownloadHours,
                progress: 0,
                done: false,
            }));
            process.stdout.write(HIDE_CURSOR);
            const redraw = () => redrawLines(buildProgressLines(fileStates, webfolder.webfolderUrl, webfolder.retentionHours));
            redraw();
            process.stdout.on('resize', redraw);
            await startUpload(webfolder, {
                resume: true,
                onProgress: (file, uploaded, total) => {
                    const idx = webfolder.files.indexOf(file);
                    fileStates[idx].progress = uploaded / total;
                    redraw();
                },
                onFileComplete: (file) => {
                    const idx = webfolder.files.indexOf(file);
                    fileStates[idx].done = true;
                    redraw();
                },
            });
            process.stdout.removeListener('resize', redraw);
            clearDrawn();
            process.stdout.write(SHOW_CURSOR);
            fs.unlinkSync(tmp);
            printFinalResult(fileStates, webfolder);
        }
    }
    else if (filePaths.length > 0) {
        for (const fp of filePaths) {
            const resolved = path.resolve(fp);
            if (!fs.existsSync(resolved)) {
                console.error(`Error: File not found: ${fp}`);
                process.exit(1);
            }
            const stat = fs.statSync(resolved);
            if (!stat.isFile()) {
                console.error(`Error: Not a file: ${fp}`);
                process.exit(1);
            }
        }
        if (!isTTY) {
            process.stderr.write(`Creating link...\n`);
            const webfolder = await createWebFolder({
                title,
                files: filePaths.map((fp) => ({ filepath: fp })),
            });
            process.stdout.write(webfolder.webfolderUrl + '\n');
            const tmp = tmpFilePath(webfolder.webfolderId);
            fs.writeFileSync(tmp, JSON.stringify(webfolder, null, 2));
            await startUpload(webfolder, {
                onFileComplete: (file) => {
                    process.stderr.write(`  done: ${path.basename(file.filepath)}\n`);
                },
            });
            fs.unlinkSync(tmp);
            process.stderr.write(`Done. ${webfolder.files.length} file(s) uploaded.\n`);
        }
        else {
            // Interactive TTY mode
            process.stdout.write(HIDE_CURSOR);
            const earlyStates = [];
            for (const fp of filePaths) {
                const resolved = path.resolve(fp);
                earlyStates.push({
                    name: path.basename(resolved),
                    size: fs.statSync(resolved).size,
                    freeDownloadHours: 0,
                    progress: 0,
                    done: false,
                });
            }
            // Show file list + "Creating link..."
            const width = calcWidth(earlyStates);
            const earlyLines = ['', ...earlyStates.map((f) => renderFileLine(f, width)), '', '  \x1b[2mCreating link...\x1b[0m'];
            redrawLines(earlyLines);
            // Create webfolder
            const webfolder = await createWebFolder({
                title,
                files: filePaths.map((fp) => ({ filepath: fp })),
            });
            const tmp = tmpFilePath(webfolder.webfolderId);
            fs.writeFileSync(tmp, JSON.stringify(webfolder, null, 2));
            const fileStates = webfolder.files.map((meta) => ({
                name: path.basename(meta.filepath),
                size: meta.filesize,
                freeDownloadHours: meta.freeDownloadHours,
                progress: 0,
                done: false,
            }));
            // Build full UI lines
            const qrLines = generateQrCode(webfolder.webfolderUrl).split('\n').filter((l) => l.length > 0);
            const redraw = () => redrawLines(buildFullLines(fileStates, webfolder.webfolderUrl, webfolder.retentionHours, qrLines));
            redraw();
            process.stdout.on('resize', redraw);
            // Key listener (non-blocking)
            const stopKeys = startKeyListener(['o', 'c', 's'], (key) => {
                if (key === 's') {
                    stopKeys();
                    process.stdout.removeListener('resize', redraw);
                    clearDrawn();
                    process.stdout.write(SHOW_CURSOR);
                    fs.unlinkSync(tmp);
                    console.log('  Stopped.\n');
                    process.exit(0);
                }
                if (key === 'o')
                    openInBrowser(webfolder.webfolderUrl);
                if (key === 'c')
                    copyToClipboard(webfolder.webfolderUrl);
            });
            // Upload
            await startUpload(webfolder, {
                onProgress: (file, uploaded, total) => {
                    const idx = webfolder.files.indexOf(file);
                    fileStates[idx].progress = uploaded / total;
                    redraw();
                },
                onFileComplete: (file) => {
                    const idx = webfolder.files.indexOf(file);
                    fileStates[idx].done = true;
                    redraw();
                },
            });
            fs.unlinkSync(tmp);
            // Upload done — redraw with "Done" message, keep waiting for key input
            redraw();
            // Wait for any key (o/c still functional)
            await new Promise((resolve) => {
                stopKeys(); // remove old listener
                const { stdin } = process;
                const wasRaw = stdin.isRaw;
                stdin.setRawMode(true);
                stdin.resume();
                stdin.setEncoding('utf8');
                const onData = (key) => {
                    const k = key.toLowerCase();
                    if (k === 'o') {
                        openInBrowser(webfolder.webfolderUrl);
                        return;
                    }
                    if (k === 'c') {
                        copyToClipboard(webfolder.webfolderUrl);
                        return;
                    }
                    stdin.removeListener('data', onData);
                    stdin.setRawMode(wasRaw ?? false);
                    stdin.pause();
                    resolve();
                };
                stdin.on('data', onData);
            });
            process.stdout.removeListener('resize', redraw);
            clearDrawn();
            process.stdout.write(SHOW_CURSOR);
            printFinalResult(fileStates, webfolder);
            process.exit(0);
        }
    }
    else {
        console.error('Error: No files specified.');
        process.exit(1);
    }
}
function printFinalResult(fileStates, webfolder) {
    const width = calcWidth(fileStates);
    console.log('');
    for (const f of fileStates) {
        console.log(renderFileLine(f, width));
    }
    console.log('');
    console.log(`  \x1b[2m[ ] = free download hours left\x1b[0m`);
    console.log(`  \x1b[2mAll files will be deleted from the server after ${webfolder.retentionHours} hours.\x1b[0m`);
    const qr = generateQrCode(webfolder.webfolderUrl);
    if (qr) {
        console.log('');
        process.stdout.write(qr);
    }
    console.log('');
    console.log(`  ${webfolder.webfolderUrl}`);
    console.log('');
    console.log(`  \x1b[42;30m Done. ${fileStates.length} file(s) uploaded. \x1b[0m\n`);
}
main().catch((err) => {
    if (process.stdout.isTTY) {
        clearDrawn();
        process.stdout.write(SHOW_CURSOR);
    }
    console.error(err.message || err);
    process.exit(1);
});
//# sourceMappingURL=cli.js.map