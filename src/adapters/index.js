const { ClashVergeAdapter } = require('./clash-verge');
const { MihomoPartyAdapter } = require('./mihomo-party');

function adapterFor(id, options = {}) {
  if (id === 'clash-verge-rev') return new ClashVergeAdapter(options);
  if (id === 'mihomo-party') return new MihomoPartyAdapter(options);
  throw new Error(`不支持的客户端：${id}`);
}

module.exports = { adapterFor, ClashVergeAdapter, MihomoPartyAdapter };
