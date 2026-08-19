const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function unique(values) {
  return [...new Set(values.filter(Boolean).map((value) => path.resolve(value)))];
}

function standardRoots(platform = process.platform, env = process.env, home = os.homedir()) {
  if (platform === 'darwin') {
    return unique([
      path.join(home, 'Library/Application Support/io.github.clash-verge-rev.clash-verge-rev'),
      path.join(home, 'Library/Application Support/mihomo-party'),
      path.join(home, 'Library/Application Support/Mihomo Party'),
      path.join(home, 'Library/Application Support/io.github.mihomo-party.mihomo-party')
    ]);
  }
  if (platform === 'win32') {
    const appData = env.APPDATA || path.join(home, 'AppData/Roaming');
    const localAppData = env.LOCALAPPDATA || path.join(home, 'AppData/Local');
    return unique([
      path.join(appData, 'io.github.clash-verge-rev.clash-verge-rev'),
      path.join(appData, 'mihomo-party'),
      path.join(appData, 'Mihomo Party'),
      path.join(localAppData, 'Mihomo Party')
    ]);
  }
  const xdg = env.XDG_CONFIG_HOME || path.join(home, '.config');
  return unique([
    path.join(xdg, 'io.github.clash-verge-rev.clash-verge-rev'),
    path.join(xdg, 'mihomo-party'),
    path.join(xdg, 'Mihomo Party'),
    path.join(home, '.config/mihomo-party')
  ]);
}

function rootLooksLikeClashVerge(root) {
  return fs.existsSync(path.join(root, 'profiles.yaml')) && fs.existsSync(path.join(root, 'profiles'));
}

function rootLooksLikeMihomoParty(root) {
  return fs.existsSync(path.join(root, 'profiles.yaml')) ||
    fs.existsSync(path.join(root, 'profiles')) ||
    fs.existsSync(path.join(root, 'config.yaml')) ||
    fs.existsSync(path.join(root, 'config.yml'));
}

function appCandidates(platform = process.platform) {
  if (platform === 'darwin') {
    return [
      { id: 'clash-verge-rev', name: 'Clash Verge Rev', executable: '/Applications/Clash Verge.app' },
      { id: 'mihomo-party', name: 'Mihomo Party', executable: '/Applications/Mihomo Party.app' }
    ];
  }
  if (platform === 'win32') {
    return [
      { id: 'clash-verge-rev', name: 'Clash Verge Rev', executableNames: ['Clash Verge.exe', 'clash-verge.exe'] },
      { id: 'mihomo-party', name: 'Mihomo Party', executableNames: ['Mihomo Party.exe', 'mihomo-party.exe'] }
    ];
  }
  return [
    { id: 'clash-verge-rev', name: 'Clash Verge Rev', executableNames: ['clash-verge', 'clash-verge-rev'] },
    { id: 'mihomo-party', name: 'Mihomo Party', executableNames: ['mihomo-party'] }
  ];
}

module.exports = {
  standardRoots,
  rootLooksLikeClashVerge,
  rootLooksLikeMihomoParty,
  appCandidates,
  unique
};
