const fs = require('node:fs');
const path = require('node:path');
const { BaseAdapter, listYamlProfiles } = require('./base');
const { standardRoots, rootLooksLikeClashVerge, appCandidates } = require('../paths');
const { restartDesktopApp, stopDesktopApp, startDesktopApp } = require('../restart');

class ClashVergeAdapter extends BaseAdapter {
  constructor(options = {}) {
    super({
      id: 'clash-verge-rev',
      name: 'Clash Verge Rev',
      root: options.root,
      app: appCandidates(process.platform).find((item) => item.id === 'clash-verge-rev')
    });
  }

  async detect() {
    const roots = this.root ? [this.root] : standardRoots();
    return roots.filter(rootLooksLikeClashVerge).map((root) => ({
      id: this.id,
      name: this.name,
      root,
      app: this.app,
      confidence: 'high'
    }));
  }

  async listProfiles(root = this.root, options = {}) {
    if (root && root !== this.root) this.root = path.resolve(root);
    const listed = this.listProfilesFromMetadata(options);
    if (listed.length > 0) return listed;
    return listYamlProfiles(this.root);
  }

  async readProfile(profileId) {
    return this.readSelectedProfile(profileId);
  }

  async installScript(input) {
    return this.installWithMetadata(input.snapshot, input.scriptText, input.scriptName);
  }

  async activate() {
    // Binding the new script and changing profiles.yaml.current are the durable activation steps.
    return undefined;
  }

  async restart() {
    return restartDesktopApp('Clash Verge', process.platform);
  }

  async stopForInstall() {
    return stopDesktopApp('Clash Verge', process.platform);
  }

  async startAfterInstall() {
    return startDesktopApp('Clash Verge', process.platform);
  }
}

module.exports = { ClashVergeAdapter };
