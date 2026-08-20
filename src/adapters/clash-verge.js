const fs = require('node:fs');
const path = require('node:path');
const { BaseAdapter, listYamlProfiles, parseYamlFile } = require('./base');
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

  verifyRuntimeActivation(expected = {}) {
    const runtimeFile = path.join(this.root, 'clash-verge.yaml');
    if (!fs.existsSync(runtimeFile)) {
      return { supported: true, active: false, runtimeFile, reason: '未找到 Clash Verge 运行配置。' };
    }
    try {
      const config = parseYamlFile(runtimeFile);
      const groups = Array.isArray(config['proxy-groups']) ? config['proxy-groups'] : [];
      const proxies = Array.isArray(config.proxies) ? config.proxies : [];
      const rules = Array.isArray(config.rules) ? config.rules : [];
      const group = (name) => groups.find((candidate) => candidate?.name === name);
      const front = group('✈️ 前置中转');
      const residential = group('🏠 静态住宅IP');
      const general = group('🌐 其他代理');
      const landingName = expected.landingName || '🏠 AI住宅IP';
      const landing = proxies.find((candidate) => candidate?.name === landingName);
      const hasRule = (value) => rules.includes(value);
      const expectedLanding = expected.landing || {};
      const expectedServerMatches = expectedLanding.server === undefined || String(landing?.server) === String(expectedLanding.server);
      const expectedPortMatches = expectedLanding.port === undefined || String(landing?.port) === String(expectedLanding.port);
      const expectedGeneralMatches = !expected.generalProxyGroup ||
        (Array.isArray(general?.proxies) && general.proxies.includes(expected.generalProxyGroup));
      const checks = {
        modeRule: config.mode === 'rule',
        frontGroup: Boolean(front && Array.isArray(front.proxies) && front.proxies.length > 0),
        residentialGroup: Boolean(residential && Array.isArray(residential.proxies) && residential.proxies.includes(landingName)),
        generalGroup: Boolean(general && Array.isArray(general.proxies) && general.proxies.length > 0),
        selectedGeneralGroup: expectedGeneralMatches,
        landingProxy: Boolean(landing && expectedServerMatches && expectedPortMatches),
        chainedDialer: landing?.['dialer-proxy'] === '✈️ 前置中转',
        aiRule: hasRule('DOMAIN-SUFFIX,chatgpt.com,🏠 静态住宅IP'),
        youtubeRule: hasRule('DOMAIN-SUFFIX,youtube.com,🌐 其他代理'),
        xRule: hasRule('DOMAIN-SUFFIX,x.com,🌐 其他代理'),
        privateDirect: hasRule('IP-CIDR,10.0.0.0/8,DIRECT,no-resolve'),
        chinaDomainDirect: hasRule('GEOSITE,CN,DIRECT'),
        chinaIpDirect: hasRule('GEOIP,CN,DIRECT,no-resolve'),
        normalFallback: rules.at(-1) === 'MATCH,🌐 其他代理'
      };
      const failedChecks = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
      return {
        supported: true,
        active: failedChecks.length === 0,
        runtimeFile,
        checks,
        failedChecks,
        observed: {
          aiRule: rules.find((rule) => typeof rule === 'string' && rule.includes('chatgpt.com')) || null,
          youtubeRule: rules.find((rule) => typeof rule === 'string' && rule.includes('youtube.com')) || null,
          xRule: rules.find((rule) => typeof rule === 'string' && rule.startsWith('DOMAIN-SUFFIX,x.com,')) || null,
          matchRule: rules.findLast((rule) => typeof rule === 'string' && rule.startsWith('MATCH,')) || null
        },
        reason: failedChecks.length ? `运行配置缺少或未匹配：${failedChecks.join(', ')}` : null
      };
    } catch (error) {
      return { supported: true, active: false, runtimeFile, reason: `运行配置无法解析：${error.message}` };
    }
  }
}

module.exports = { ClashVergeAdapter };
