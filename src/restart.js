const { spawnSync } = require('node:child_process');

const ALLOWED_MAC_APPS = new Set(['Clash Verge', 'Mihomo Party']);
const MAC_PROCESS_NAMES = {
  'Clash Verge': ['clash-verge', 'verge-mihomo'],
  'Mihomo Party': ['mihomo-party']
};

function macProcessIsRunning(processName) {
  return spawnSync('pgrep', ['-x', processName], { encoding: 'utf8' }).status === 0;
}

function waitForMacAppToStop(appName, timeoutMs = 5000) {
  const processNames = MAC_PROCESS_NAMES[appName] || [];
  const deadline = Date.now() + timeoutMs;
  const signal = new Int32Array(new SharedArrayBuffer(4));
  while (Date.now() < deadline) {
    if (!processNames.some(macProcessIsRunning)) return true;
    Atomics.wait(signal, 0, 0, 100);
  }
  return !processNames.some(macProcessIsRunning);
}

function stopDesktopApp(appName, platform = process.platform) {
  if (platform !== 'darwin') {
    return { status: 'manual-required', reason: '当前平台未实现可靠的自动退出；请先手动退出客户端，再使用 --no-restart 安装。' };
  }
  if (!ALLOWED_MAC_APPS.has(appName)) return { status: 'manual-required', reason: '未知的 macOS 应用名称，拒绝自动退出。' };
  const processNames = MAC_PROCESS_NAMES[appName] || [];
  if (processNames.length && !processNames.some(macProcessIsRunning)) {
    return { status: 'stopped', method: 'already-not-running' };
  }
  const quit = spawnSync('osascript', ['-e', `tell application ${JSON.stringify(appName)} to quit`], { encoding: 'utf8' });
  if (quit.status !== 0) {
    return { status: 'stop-failed', reason: quit.stderr?.trim() || `macOS 未能退出 ${appName}。` };
  }
  if (!waitForMacAppToStop(appName)) {
    return { status: 'stop-failed', reason: `${appName} 在 5 秒内没有完全退出，为避免配置被覆盖，本次不写入。` };
  }
  return { status: 'stopped', method: 'AppleScript quit' };
}

function startDesktopApp(appName, platform = process.platform) {
  if (platform === 'darwin') {
    if (!ALLOWED_MAC_APPS.has(appName)) return { status: 'manual-required', reason: '未知的 macOS 应用名称，拒绝自动启动。' };
    const open = spawnSync('open', ['-a', appName], { encoding: 'utf8' });
    if (open.status === 0) return { status: 'restarted', method: 'open -a' };
    return { status: 'manual-required', reason: open.stderr?.trim() || 'macOS 未能启动客户端。' };
  }
  if (platform === 'win32') {
    return { status: 'manual-required', reason: 'Windows 安装位置和打包方式不同，未猜测可执行文件路径；请手动启动客户端。' };
  }
  return { status: 'manual-required', reason: 'Linux 发行版的启动方式不同；请手动启动客户端。' };
}

function restartDesktopApp(appName, platform = process.platform) {
  const stopped = stopDesktopApp(appName, platform);
  if (stopped.status !== 'stopped') return stopped;
  const started = startDesktopApp(appName, platform);
  return { ...started, stop: stopped };
}

module.exports = { restartDesktopApp, stopDesktopApp, startDesktopApp, waitForMacAppToStop };
