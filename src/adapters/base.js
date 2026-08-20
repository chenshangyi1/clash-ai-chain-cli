const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const YAML = require('yaml');
const { backupFiles, writeAtomic, ensureDir, createExportDirectory } = require('../safety');

function parseYamlFile(file) {
  return YAML.parse(fs.readFileSync(file, 'utf8')) || {};
}

function stringifyYaml(value) {
  return YAML.stringify(value, { indent: 2, lineWidth: 0 });
}

function uid() {
  return crypto.randomBytes(8).toString('hex');
}

function profileItemType(item) {
  return String(item?.type || '').toLowerCase();
}

function isProfileItem(item) {
  return Boolean(item && item.uid && item.file);
}

function isInternalProfile(item) {
  return new Set(['merge', 'script', 'rules', 'proxies', 'groups']).has(profileItemType(item));
}

function resolveInside(root, requested) {
  if (!requested) return null;
  const rootResolved = path.resolve(root);
  const requestedText = String(requested);
  const variants = [requestedText];
  if (!path.extname(requestedText)) variants.push(`${requestedText}.js`, `${requestedText}.yaml`, `${requestedText}.yml`);
  const candidates = [
    ...variants.flatMap((item) => [
      path.resolve(rootResolved, item),
      path.resolve(rootResolved, 'profiles', item),
      path.resolve(rootResolved, 'profiles', path.basename(item))
    ])
  ];
  const safe = candidates.filter((candidate) => candidate === rootResolved || candidate.startsWith(`${rootResolved}${path.sep}`));
  return safe.find((candidate) => fs.existsSync(candidate)) || safe[1] || safe[0] || null;
}

function locateProfileFile(root, item) {
  const direct = resolveInside(root, item.file);
  if (direct && fs.existsSync(direct)) return direct;
  return direct;
}

function listYamlProfiles(root) {
  const profilesDir = path.join(root, 'profiles');
  if (!fs.existsSync(profilesDir)) return [];
  return fs.readdirSync(profilesDir)
    .filter((file) => /\.(ya?ml|json)$/i.test(file))
    .map((file) => ({
      id: file,
      uid: file,
      name: path.basename(file, path.extname(file)),
      type: 'local',
      file,
      active: false,
      source: 'directory'
    }));
}

function describeProfile(item, current) {
  const type = profileItemType(item) || 'local';
  return {
    id: String(item.uid),
    uid: String(item.uid),
    name: item.name || item.desc || item.file || String(item.uid),
    type,
    file: item.file,
    active: String(item.uid) === String(current),
    script: item.option?.script || null,
    url: item.url ? '[本地订阅元数据已隐藏]' : null
  };
}

function scriptReferenceAliases(item) {
  if (!item) return [];
  const file = typeof item.file === 'string' ? item.file : '';
  return [...new Set([
    item.uid,
    file,
    file ? path.basename(file, path.extname(file)) : null
  ].filter(Boolean).map(String))];
}

function findRegisteredScriptItem(items, reference) {
  if (!reference) return null;
  const wanted = String(reference);
  return (Array.isArray(items) ? items : []).find((candidate) =>
    profileItemType(candidate) === 'script' && scriptReferenceAliases(candidate).includes(wanted)
  ) || null;
}

class BaseAdapter {
  constructor({ id, name, root, app }) {
    this.id = id;
    this.name = name;
    this.root = root ? path.resolve(root) : null;
    this.app = app || {};
  }

  profileMetadataPath() {
    return this.root ? path.join(this.root, 'profiles.yaml') : null;
  }

  readMetadata() {
    const file = this.profileMetadataPath();
    if (!file || !fs.existsSync(file)) return null;
    return { file, data: parseYamlFile(file) };
  }

  listProfilesFromMetadata({ includeInternal = false } = {}) {
    const metadata = this.readMetadata();
    if (!metadata) return [];
    const items = Array.isArray(metadata.data.items) ? metadata.data.items : [];
    return items
      .filter(isProfileItem)
      .filter((item) => includeInternal || !isInternalProfile(item))
      .map((item) => describeProfile(item, metadata.data.current));
  }

  readSelectedProfile(profileId) {
    const metadata = this.readMetadata();
    if (!metadata) throw new Error(`${this.name} 未找到 profiles.yaml。`);
    const items = Array.isArray(metadata.data.items) ? metadata.data.items : [];
    const item = items.find((candidate) => String(candidate.uid) === String(profileId) || String(candidate.file) === String(profileId));
    if (!item) throw new Error(`未找到订阅/配置：${profileId}`);
    const profileFile = locateProfileFile(this.root, item);
    if (!profileFile || !fs.existsSync(profileFile)) throw new Error(`目标订阅文件不存在：${item.file}`);
    const config = parseYamlFile(profileFile);
    const scriptReference = item.option?.script;
    const scriptItem = findRegisteredScriptItem(items, scriptReference);
    const scriptFile = scriptReference
      ? resolveInside(this.root, scriptItem?.file || scriptReference)
      : null;
    return {
      profile: describeProfile(item, metadata.data.current),
      profileItem: item,
      metadata: metadata.data,
      metadataFile: metadata.file,
      profileFile,
      config,
      scriptReference: scriptReference || null,
      scriptItem,
      scriptFile
    };
  }

  detectInstallation(snapshot) {
    const scriptFile = snapshot?.scriptFile;
    if (!scriptFile || !fs.existsSync(scriptFile) || !fs.statSync(scriptFile).isFile()) {
      return { installed: false, registered: Boolean(snapshot?.scriptItem), repairable: false, scriptFile: scriptFile || null, marker: null };
    }
    if (fs.statSync(scriptFile).size > 5 * 1024 * 1024) {
      return { installed: false, registered: Boolean(snapshot?.scriptItem), repairable: false, scriptFile, marker: null, reason: '绑定脚本过大，未读取检查。' };
    }
    const text = fs.readFileSync(scriptFile, 'utf8');
    const marker = text.includes('@clash-ai-chain-cli') ? '@clash-ai-chain-cli' :
      (text.includes('Clash AI Chain CLI generated script.') ? 'legacy-clash-ai-chain-cli' :
        (text.includes('Clash Verge AI 定向链式代理脚本') &&
          text.includes('🏠 静态住宅IP') &&
          text.includes('🌐 其他代理') &&
          text.includes('MATCH,🌐 其他代理')
          ? 'legacy-selective-chain' : null));
    const registered = Boolean(snapshot?.scriptItem);
    return {
      installed: Boolean(marker && registered),
      registered,
      repairable: Boolean(marker && !registered),
      scriptFile,
      marker,
      reason: marker && !registered ? '脚本文件存在，但未注册为客户端 Script 配置项目。' : null
    };
  }

  supportsDurableInstall(snapshot) {
    return Boolean(snapshot?.metadataFile && snapshot?.profileItem?.file);
  }

  verifyInstalledBinding(profileId, expectedScriptFile) {
    try {
      const snapshot = this.readSelectedProfile(profileId);
      const actual = snapshot.scriptFile ? path.resolve(snapshot.scriptFile) : null;
      const expected = expectedScriptFile ? path.resolve(expectedScriptFile) : null;
      const detected = this.detectInstallation(snapshot);
      return {
        bound: Boolean(actual && expected && actual === expected && detected.registered),
        registered: detected.registered,
        active: Boolean(snapshot.profile.active),
        marker: detected.marker,
        scriptFile: actual,
        expectedScriptFile: expected
      };
    } catch (error) {
      return { bound: false, registered: false, active: false, marker: null, error: error.message };
    }
  }

  createPreview(snapshot, { landingProxy, generalProxyGroup, scriptName, scriptFile, staticIpSource }) {
    const proxies = Array.isArray(snapshot.config.proxies) ? snapshot.config.proxies : [];
    return {
      client: this.name,
      profile: snapshot.profile.name,
      profileId: snapshot.profile.id,
      profileFile: snapshot.profileFile,
      existingProxyCount: proxies.length,
      landingProxy,
      staticIpSource: staticIpSource || null,
      generalProxyGroup,
      scriptName,
      scriptFile,
      changes: [
        `创建新脚本：${scriptFile}`,
        '注册新的 Script 配置项目，使客户端能够加载该脚本',
        `绑定到订阅：${snapshot.profile.name}`,
        '将所选订阅设为当前配置（不改变系统代理或 TUN）',
        `AI 域名 → 🏠 静态住宅IP（链式）`,
        `YouTube / X / Twitter → 🌐 其他代理`,
        `中国大陆域名、IP、局域网 → DIRECT`,
        `其它流量 → 🌐 其他代理`,
        '住宅属性和出口 IP 不由静态配置验证，请确认候选节点确实是你的住宅落地节点',
        `写入前备份 profiles.yaml、订阅文件和原脚本（如有）`
      ]
    };
  }

  installWithMetadata(snapshot, scriptText, scriptName, validate) {
    if (!this.root) throw new Error('未指定配置根目录。');
    if (typeof validate === 'function') validate(snapshot.config);
    const scriptDir = path.join(this.root, 'profiles');
    ensureDir(scriptDir);
    const scriptId = uid();
    const scriptFileName = `${scriptId}.js`;
    const scriptFile = path.join(scriptDir, scriptFileName);
    const filesToBackup = [snapshot.metadataFile, snapshot.profileFile, snapshot.scriptFile];
    const backup = backupFiles(filesToBackup, this.root, 'install', [scriptFile]);
    try {
      writeAtomic(scriptFile, scriptText, 0o600);
      const updated = JSON.parse(JSON.stringify(snapshot.metadata));
      if (!Array.isArray(updated.items)) updated.items = [];
      const item = updated.items.find((candidate) => String(candidate.uid) === String(snapshot.profile.id));
      if (!item) throw new Error('写入前订阅条目已变化，请重新运行预览。');
      if (updated.items.some((candidate) => String(candidate.uid) === scriptId)) {
        throw new Error('生成的脚本 UID 与现有配置冲突，请重新运行安装。');
      }
      updated.items.push({
        uid: scriptId,
        type: 'script',
        file: scriptFileName,
        updated: Math.floor(Date.now() / 1000)
      });
      item.option = { ...(item.option || {}), script: scriptId };
      updated.current = item.uid;
      writeAtomic(snapshot.metadataFile, stringifyYaml(updated));
      return {
        status: 'written',
        backup,
        scriptFile,
        scriptId,
        scriptFileName,
        scriptName,
        profileFile: snapshot.profileFile,
        profileId: item.uid,
        registered: true
      };
    } catch (error) {
      try { require('../safety').restoreBackup(backup.directory); } catch (_) { /* surface original error */ }
      throw error;
    }
  }

  exportScript(scriptText, scriptName) {
    const exportDir = createExportDirectory(this.root || process.cwd());
    const file = path.join(exportDir, `${String(scriptName || 'clash-ai-chain').replace(/[^\w.-]+/g, '-')}.js`);
    writeAtomic(file, scriptText, 0o600);
    return file;
  }

  async restart() {
    return { status: 'manual-required', reason: '此客户端适配器未实现安全的自动重启；请在客户端中重新加载配置。' };
  }

  async stopForInstall() {
    return { status: 'manual-required', reason: '此客户端适配器未实现安全的自动退出。' };
  }

  async startAfterInstall() {
    return { status: 'manual-required', reason: '此客户端适配器未实现安全的自动启动。' };
  }

  verifyRuntimeActivation() {
    return { supported: false, active: false, reason: '此客户端适配器未实现运行配置复核。' };
  }

  async validate(snapshot) {
    const errors = [];
    if (!snapshot || !snapshot.config) errors.push('目标配置为空。');
    if (!Array.isArray(snapshot?.config?.proxies) && !snapshot?.config?.['proxy-providers']) {
      errors.push('配置中没有 proxies 或 proxy-providers。');
    }
    return { ok: errors.length === 0, errors, warnings: [] };
  }
}

module.exports = {
  BaseAdapter,
  parseYamlFile,
  stringifyYaml,
  listYamlProfiles,
  describeProfile,
  locateProfileFile,
  profileItemType,
  isInternalProfile,
  findRegisteredScriptItem
};
