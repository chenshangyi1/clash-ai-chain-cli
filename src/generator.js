const fs = require('node:fs');
const path = require('node:path');

const templatePath = path.join(__dirname, '..', 'templates', 'clash-ai-chain.template.js');
const template = fs.readFileSync(templatePath, 'utf8');

const ALLOWED_PROXY_FIELDS = new Set([
  'type', 'server', 'port', 'username', 'password', 'tls', 'udp', 'sni',
  'servername', 'skip-cert-verify', 'client-fingerprint', 'fingerprint',
  'plugin', 'plugin-opts', 'ip-version', 'connect-timeout', 'url', 'dialer-proxy',
  'uuid', 'flow', 'alterId', 'cipher', 'network', 'ws-opts', 'grpc-opts',
  'h2-opts', 'http-opts', 'reality-opts', 'headers', 'obfs', 'obfs-password',
  'proxy-opts', 'smux', 'packet-encoding', 'ip', 'sub-ip', 'sub-port',
  'interface-name', 'routing-mark', 'up', 'down', 'socks5'
]);

function copyProxy(proxy) {
  const result = { name: '🏠 AI住宅IP' };
  for (const [key, value] of Object.entries(proxy || {})) {
    if (ALLOWED_PROXY_FIELDS.has(key) && value !== undefined) result[key] = value;
  }
  result['dialer-proxy'] = '✈️ 前置中转';
  return result;
}

function generateScript({ landingProxy, generalProxyGroup }) {
  if (!landingProxy || !landingProxy.server || !landingProxy.port || !landingProxy.type) {
    throw new Error('住宅落地节点缺少 type、server 或 port，不能生成脚本。');
  }
  if (!generalProxyGroup) throw new Error('必须选择普通代理组。');
  const residential = JSON.stringify([copyProxy(landingProxy)], null, 2);
  const general = JSON.stringify([generalProxyGroup], null, 2);
  return template
    .replace('__RESIDENTIAL_PROXIES__', residential)
    .replace('__GENERAL_GROUP_CANDIDATES__', general);
}

function validateGeneratedScript(scriptText) {
  if (!scriptText.includes('function main(config)')) throw new Error('生成脚本缺少 main(config) 入口。');
  if (!scriptText.includes('MATCH,🌐 其他代理')) throw new Error('生成脚本缺少普通代理兜底规则。');
  if (scriptText.includes('MATCH,🏠 静态住宅IP')) throw new Error('生成脚本不能把所有流量兜底到住宅链。');
}

module.exports = { generateScript, validateGeneratedScript, copyProxy };
