const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const YAML = require('yaml');

const DISALLOWED_SCRIPT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx']);
const SUPPORTED_TYPES = new Set([
  'socks5', 'socks5h', 'http', 'https', 'vless', 'vmess', 'trojan', 'ss', 'ssr',
  'hysteria', 'hysteria2', 'tuic', 'wireguard'
]);

function cleanPathInput(value) {
  let cleaned = String(value ?? '').trim();
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    cleaned = cleaned.slice(1, -1);
  }
  // macOS Finder/Terminal drag-and-drop commonly pastes spaces and parentheses
  // escaped with backslashes. Only unescape shell punctuation, not Windows '\\'.
  cleaned = cleaned.replace(/\\([ ()[\]{}'"])/g, '$1');
  if (cleaned === '~') cleaned = os.homedir();
  else if (cleaned.startsWith(`~${path.sep}`)) cleaned = path.join(os.homedir(), cleaned.slice(2));
  return cleaned;
}

function isProxyLike(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const type = String(value.type || '').toLowerCase();
  const hasServer = value.server || value.host || value.address;
  const hasPort = value.port !== undefined && value.port !== null;
  return Boolean(hasServer && hasPort);
}

function boolParam(value) {
  if (value === undefined) return undefined;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function normalizeProxy(value, index, source) {
  if (!isProxyLike(value)) return null;
  const type = String(value.type || 'socks5').toLowerCase();
  if (!SUPPORTED_TYPES.has(type)) return null;
  const server = String(value.server || value.host || value.address || '').trim();
  const port = Number(value.port);
  if (!server || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  const proxy = {
    ...value,
    name: String(value.name || value.label || `静态IP ${index + 1}`),
    type,
    server,
    port
  };
  if (value.username !== undefined) proxy.username = String(value.username);
  if (value.password !== undefined) proxy.password = String(value.password);
  if (proxy.name && /更新客户端|占位|placeholder/i.test(proxy.name)) return null;
  proxy.__source = source;
  return proxy;
}

function collectStructured(value, output, source, state = { count: 0 }) {
  if (state.count > 500) return;
  if (Array.isArray(value)) {
    for (const item of value) collectStructured(item, output, source, state);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const candidate = normalizeProxy(value, state.count, source);
  if (candidate) {
    output.push(candidate);
    state.count += 1;
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    // Do not descend into provider URLs or arbitrary script fields. We only inspect
    // well-known structured node containers and direct proxy-shaped objects.
    if (['proxy-providers', 'script', 'scripts', 'url', 'subscription', 'subscribe'].includes(key)) continue;
    if (['proxies', 'proxy', 'nodes', 'node', 'outbounds', 'servers', 'items', 'data', 'static-proxies', 'staticProxies', 'staticProxy', 'staticIp', 'residential', 'residentialProxies', 'proxyNode'].includes(key) || Array.isArray(child)) {
      collectStructured(child, output, source, state);
    }
  }
}

function parseUri(line, index, source) {
  let parsed;
  try { parsed = new URL(line); } catch (_) { return null; }
  const type = parsed.protocol.replace(/:$/, '').toLowerCase();
  if (!SUPPORTED_TYPES.has(type) || !parsed.hostname) return null;
  const defaultPort = type === 'http' || type === 'https' ? 80 : 1080;
  const proxy = {
    name: decodeURIComponent(parsed.hash.replace(/^#/, '')) || `静态IP ${index + 1}`,
    type,
    server: parsed.hostname,
    port: Number(parsed.port || defaultPort)
  };
  if (parsed.username) proxy.username = decodeURIComponent(parsed.username);
  if (parsed.password) proxy.password = decodeURIComponent(parsed.password);
  const tls = boolParam(parsed.searchParams.get('tls'));
  const udp = boolParam(parsed.searchParams.get('udp'));
  if (tls !== undefined) proxy.tls = tls;
  if (udp !== undefined) proxy.udp = udp;
  proxy.__source = source;
  return proxy;
}

function parseTextLines(text, source) {
  const output = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) return;
    const uri = parseUri(line, index, source);
    if (uri) {
      output.push(uri);
      return;
    }
    const credentialEndpoint = line.match(/^([^:\s@]+):(.+)@(?:\[([^\]]+)\]|([^:\s]+)):(\d+)$/);
    if (credentialEndpoint) {
      const proxy = normalizeProxy({
        name: `静态IP ${index + 1}`,
        type: 'socks5',
        server: credentialEndpoint[3] || credentialEndpoint[4],
        port: credentialEndpoint[5],
        username: credentialEndpoint[1],
        password: credentialEndpoint[2]
      }, index, source);
      if (proxy) output.push(proxy);
      return;
    }
    const endpoint = line.match(/^\[([^\]]+)\]:(\d+)(?::([^:]+):(.+))?$/) || line.match(/^([^:\s,]+):(\d+)(?::([^:]+):(.+))?$/);
    if (endpoint) {
      const proxy = normalizeProxy({
        name: `静态IP ${index + 1}`, type: 'socks5', server: endpoint[1], port: endpoint[2], username: endpoint[3], password: endpoint[4]
      }, index, source);
      if (proxy) output.push(proxy);
      return;
    }
    const fields = line.split(/[\s,]+/).filter(Boolean);
    if (fields.length >= 2 && /^\d+$/.test(fields[1])) {
      const proxy = normalizeProxy({
        name: `静态IP ${index + 1}`, type: fields[0].includes('://') ? fields[0].split('://')[0] : 'socks5',
        server: fields[0].replace(/^[a-z0-9]+:\/\//i, ''), port: fields[1], username: fields[2], password: fields[3]
      }, index, source);
      if (proxy) output.push(proxy);
    }
  });
  return output;
}

function dedupeProxies(proxies) {
  const seen = new Set();
  return proxies.filter((proxy) => {
    const key = `${proxy.type}|${proxy.server}|${proxy.port}|${proxy.username || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((proxy, index) => {
    const result = { ...proxy };
    delete result.__source;
    if (!result.name) result.name = `静态IP ${index + 1}`;
    return result;
  });
}

function parseStaticIpFile(file) {
  const absolute = path.resolve(cleanPathInput(file));
  const extension = path.extname(absolute).toLowerCase();
  if (DISALLOWED_SCRIPT_EXTENSIONS.has(extension)) {
    throw new Error('静态 IP 文件不能是 JavaScript/TypeScript；CLI 只解析 YAML、JSON 或纯文本节点。');
  }
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) throw new Error(`静态 IP 文件不存在：${absolute}`);
  const text = fs.readFileSync(absolute, 'utf8');
  const candidates = [];
  let format = 'text';
  try {
    const parsed = YAML.parse(text);
    if (parsed !== null && parsed !== undefined && typeof parsed === 'object') {
      format = extension === '.json' ? 'json' : 'yaml';
      collectStructured(parsed, candidates, absolute);
    }
  } catch (_) {
    // Plain text URI/list files are handled below. We intentionally do not eval.
  }
  if (!candidates.length) candidates.push(...parseTextLines(text, absolute));
  const proxies = dedupeProxies(candidates);
  if (!proxies.length) throw new Error('没有识别到可用静态 IP 节点。支持 Clash proxy 对象、proxies 数组、socks5/http URI 或“服务器 端口 账号 密码”文本行。');
  return { file: absolute, format, proxies };
}

module.exports = { parseStaticIpFile, cleanPathInput, isProxyLike, normalizeProxy, dedupeProxies };
