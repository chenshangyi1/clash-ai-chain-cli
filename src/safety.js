const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function readText(file) {
  return fs.readFileSync(file, 'utf8');
}

function writeAtomic(file, contents, mode) {
  ensureDir(path.dirname(file));
  const temporary = `${file}.clash-ai-${process.pid}-${crypto.randomBytes(5).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, contents, { encoding: 'utf8', mode: mode || 0o600 });
  if (mode) fs.chmodSync(temporary, mode);
  else if (fs.existsSync(file)) fs.chmodSync(temporary, fs.statSync(file).mode & 0o777);
  fs.renameSync(temporary, file);
}

function makeBackupRoot(root, label = 'backup') {
  const parent = path.join(root, 'clash-ai-backups');
  ensureDir(parent);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(parent, `${stamp}-${label}-${crypto.randomBytes(3).toString('hex')}`);
  ensureDir(dir);
  return dir;
}

function backupFiles(files, root, label = 'install', created = []) {
  const backupDir = makeBackupRoot(root, label);
  const entries = [];
  for (const file of [...new Set(files.filter(Boolean))]) {
    if (!fs.existsSync(file)) continue;
    const relative = path.basename(file);
    let destination = path.join(backupDir, relative);
    let counter = 2;
    while (fs.existsSync(destination)) {
      destination = path.join(backupDir, `${path.basename(file, path.extname(file))}-${counter}${path.extname(file)}`);
      counter += 1;
    }
    fs.copyFileSync(file, destination);
    try { fs.chmodSync(destination, fs.statSync(file).mode & 0o777); } catch (_) { /* best effort */ }
    entries.push({ original: path.resolve(file), backup: destination });
  }
  const manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    files: entries,
    created: created.map((file) => path.resolve(file))
  };
  writeAtomic(path.join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return { directory: backupDir, manifest };
}

function restoreBackup(backupDirectory) {
  const manifestFile = path.join(path.resolve(backupDirectory), 'manifest.json');
  if (!fs.existsSync(manifestFile)) throw new Error(`未找到备份清单：${manifestFile}`);
  const manifest = JSON.parse(readText(manifestFile));
  if (!Array.isArray(manifest.files)) throw new Error('备份清单格式无效。');
  for (const entry of manifest.files) {
    if (!entry || typeof entry.original !== 'string' || typeof entry.backup !== 'string') {
      throw new Error('备份清单包含无效路径。');
    }
    if (!path.isAbsolute(entry.original) || !path.isAbsolute(entry.backup)) {
      throw new Error('备份清单必须使用绝对路径。');
    }
    if (!fs.existsSync(entry.backup)) throw new Error(`备份文件不存在：${entry.backup}`);
  }
  for (const entry of manifest.files) {
    ensureDir(path.dirname(entry.original));
    writeAtomic(entry.original, readText(entry.backup));
  }
  for (const file of Array.isArray(manifest.created) ? manifest.created : []) {
    if (!path.isAbsolute(file)) throw new Error('备份清单的新增文件路径必须是绝对路径。');
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
  return manifest;
}

function createExportDirectory(root) {
  const dir = path.join(root, 'clash-ai-exports');
  ensureDir(dir);
  return dir;
}

function maskValue(value, visible = 4) {
  if (value === undefined || value === null) return '';
  const text = String(value);
  if (text.length <= visible) return '*'.repeat(text.length);
  return `${text.slice(0, visible)}******`;
}

function maskServer(value) {
  if (!value) return '';
  const text = String(value);
  const pieces = text.split('.');
  if (pieces.length < 2) return `${text.slice(0, 3)}***`;
  return `${pieces[0].slice(0, 4)}.***.${pieces.at(-1)}`;
}

function publicProxyInfo(proxy) {
  const rawName = proxy?.name || '';
  return {
    name: rawName && rawName !== proxy?.server ? rawName : '(未命名节点)',
    type: proxy?.type || '',
    server: maskServer(proxy?.server),
    port: proxy?.port || '',
    username: maskValue(proxy?.username, 4),
    password: proxy?.password ? '********' : ''
  };
}

module.exports = {
  ensureDir,
  readText,
  writeAtomic,
  backupFiles,
  restoreBackup,
  createExportDirectory,
  maskValue,
  maskServer,
  publicProxyInfo
};
