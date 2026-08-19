const fs = require('node:fs');
const { adapterFor } = require('./adapters');

async function detectClients({ clientId, root } = {}) {
  const ids = clientId ? [clientId] : ['clash-verge-rev', 'mihomo-party'];
  const results = [];
  for (const id of ids) {
    const adapter = adapterFor(id, { root });
    const detected = await adapter.detect();
    for (const item of detected) {
      results.push({ ...item, exists: fs.existsSync(item.root) });
    }
  }
  return results;
}

async function findAdapter({ clientId, root } = {}) {
  if (!clientId) {
    const detected = await detectClients({ root });
    if (detected.length === 0) throw new Error('没有自动发现支持的客户端配置目录；请用 --client 和 --root 指定。');
    clientId = detected[0].id;
    root = detected[0].root;
  }
  const adapter = adapterFor(clientId, { root });
  const detected = await adapter.detect();
  if (!adapter.root && detected[0]) adapter.root = detected[0].root;
  if (!adapter.root && root) adapter.root = root;
  if (!adapter.root) throw new Error(`未找到 ${adapter.name} 的配置根目录，请使用 --root 指定。`);
  return adapter;
}

module.exports = { detectClients, findAdapter };
