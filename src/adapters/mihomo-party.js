const fs = require('node:fs');
const path = require('node:path');
const { BaseAdapter, listYamlProfiles, parseYamlFile } = require('./base');
const { standardRoots, rootLooksLikeMihomoParty, rootLooksLikeClashVerge, appCandidates } = require('../paths');
const { restartDesktopApp, stopDesktopApp, startDesktopApp } = require('../restart');

class MihomoPartyAdapter extends BaseAdapter {
  constructor(options = {}) {
    super({
      id: 'mihomo-party',
      name: 'Mihomo Party',
      root: options.root,
      app: appCandidates(process.platform).find((item) => item.id === 'mihomo-party')
    });
  }

  async detect() {
    const explicitRoot = Boolean(this.root);
    const roots = this.root ? [this.root] : standardRoots();
    return roots.filter(rootLooksLikeMihomoParty)
      .filter((root) => explicitRoot || !rootLooksLikeClashVerge(root)).map((root) => ({
      id: this.id,
      name: this.name,
      root,
      app: this.app,
      confidence: fs.existsSync(path.join(root, 'profiles.yaml')) ? 'medium' : 'low'
    }));
  }

  async listProfiles(root = this.root, options = {}) {
    if (root && root !== this.root) this.root = path.resolve(root);
    const listed = this.listProfilesFromMetadata(options);
    if (listed.length > 0) return listed;
    const directoryProfiles = listYamlProfiles(this.root);
    if (directoryProfiles.length > 0) return directoryProfiles;
    return ['config.yaml', 'config.yml']
      .filter((file) => fs.existsSync(path.join(this.root, file)))
      .map((file) => ({ id: file, uid: file, name: file, type: 'runtime-unknown', file, active: false, script: null }));
  }

  async readProfile(profileId) {
    try {
      return this.readSelectedProfile(profileId);
    } catch (error) {
      const requested = path.basename(String(profileId));
      const candidate = fs.existsSync(path.resolve(this.root, requested))
        ? path.resolve(this.root, requested)
        : path.resolve(this.root, 'profiles', requested);
      if (!candidate.startsWith(`${path.resolve(this.root)}${path.sep}`) || !fs.existsSync(candidate)) throw error;
      return {
        profile: { id: String(profileId), uid: String(profileId), name: path.basename(candidate), type: 'local', file: path.basename(candidate), active: false, script: null },
        profileItem: {},
        metadata: null,
        metadataFile: null,
        profileFile: candidate,
        config: parseYamlFile(candidate),
        scriptFile: null
      };
    }
  }

  supportsDurableInstall(snapshot) {
    return Boolean(snapshot?.metadataFile && snapshot?.profileItem?.option && snapshot?.profileItem?.file);
  }

  async installScript(input) {
    if (!this.supportsDurableInstall(input.snapshot)) {
      const exportFile = this.exportScript(input.scriptText, input.scriptName);
      return {
        status: 'exported',
        exportFile,
        activated: false,
        reason: '未识别到 Mihomo Party 的安全持久化脚本入口，已降级为导出模式。'
      };
    }
    return this.installWithMetadata(input.snapshot, input.scriptText, input.scriptName);
  }

  async restart() {
    return restartDesktopApp('Mihomo Party', process.platform);
  }

  async stopForInstall() {
    return stopDesktopApp('Mihomo Party', process.platform);
  }

  async startAfterInstall() {
    return startDesktopApp('Mihomo Party', process.platform);
  }
}

module.exports = { MihomoPartyAdapter };
