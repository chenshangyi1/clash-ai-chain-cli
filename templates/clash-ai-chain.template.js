// Clash AI Chain CLI generated script.
// @clash-ai-chain-cli v1
// This file is created from the selected local proxy. Credentials are kept local.

const residentialProxies = __RESIDENTIAL_PROXIES__;
const GENERAL_GROUP_CANDIDATES = __GENERAL_GROUP_CANDIDATES__;

const AI_DOMAINS = [
  'openai.com', 'chatgpt.com', 'oaistatic.com', 'oaiusercontent.com',
  'auth0.com', 'chat.openai.com', 'api.openai.com', 'platform.openai.com',
  'gemini.google.com', 'ai.google.dev', 'generativelanguage.googleapis.com',
  'claude.ai', 'anthropic.com', 'console.anthropic.com',
  'grok.com', 'x.ai', 'grok.x.com', 'api.x.ai'
];

const MEDIA_DOMAINS = [
  'x.com', 'twitter.com', 't.co', 'twimg.com',
  'youtube.com', 'youtu.be', 'yt.be', 'youtube-nocookie.com',
  'youtubei.googleapis.com', 'youtube.googleapis.com',
  'youtubeembeddedplayer.googleapis.com', 'googlevideo.com',
  'ytimg.com', 'yt3.ggpht.com'
];

const globalConfig = {
  mode: 'rule',
  'log-level': 'info',
  ipv6: false,
  'tcp-concurrent': true,
  'geodata-mode': true,
  'geo-auto-update': true,
  'geo-update-interval': 24
};

const domesticNameservers = [
  'https://223.5.5.5/dns-query',
  'https://doh.pub/dns-query'
];
const foreignNameservers = [
  'https://cloudflare-dns.com/dns-query',
  'https://8.8.4.4/dns-query#ecs=1.1.1.1/24&ecs-override=true'
];
const dnsConfig = {
  enable: true,
  ipv6: false,
  'prefer-h3': false,
  'respect-rules': true,
  'use-system-hosts': false,
  'enhanced-mode': 'fake-ip',
  'fake-ip-range': '198.18.0.1/16',
  'fake-ip-filter': [
    '+.lan', '+.local', '*.localdomain', '*.localhost', '*.invalid',
    '+.pool.ntp.org', '+.msftconnecttest.com', '+.msftncsi.com',
    '+.edu.cn', 'localhost.ptlogin2.qq.com', 'localhost.sec.qq.com',
    '+.srv.nintendo.net', '+.stun.playstation.net', 'xbox.*.microsoft.com',
    '+.stun.*.*', 'stun.l.google.com', 'lens.l.google.com',
    'music.163.com', '*.music.163.com', '*.126.net', 'y.qq.com', '*.y.qq.com',
    'mesu.apple.com', 'swscan.apple.com', 'swdownload.apple.com'
  ],
  'default-nameserver': ['223.5.5.5', '1.2.4.8'],
  nameserver: foreignNameservers,
  'proxy-server-nameserver': domesticNameservers,
  'direct-nameserver': domesticNameservers,
  'direct-nameserver-follow-policy': false,
  'nameserver-policy': { 'geosite:cn': domesticNameservers }
};

function suffixRules(domains, target) {
  return domains.map((domain) => `DOMAIN-SUFFIX,${domain},${target}`);
}

function uniqueNames(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.length > 0))];
}

function isPlaceholder(name) {
  return /更新客户端|请.*更新|占位|placeholder|剩余流量|流量剩余|套餐到期|距离下次重置/i.test(String(name || '')) ||
    /^1\.1\.1\.1(?::\d+)?$/.test(String(name || ''));
}

function main(config) {
  const airportProxies = Array.isArray(config.proxies) ? config.proxies : [];
  const usableAirportProxies = airportProxies.filter((proxy) => proxy && proxy.name && !isPlaceholder(proxy.name));
  if (usableAirportProxies.length === 0) {
    throw new Error('订阅没有可用的本地 proxies 节点；请先把代理提供者展开为节点后再安装链式脚本。');
  }

  const airportProxyNames = uniqueNames(usableAirportProxies.map((proxy) => proxy.name));
  const residential = residentialProxies.filter((proxy) => proxy && proxy.name);
  if (residential.length === 0) throw new Error('未找到住宅落地节点。');
  const residentialNames = residential.map((proxy) => proxy.name);
  const selectedGeneral = GENERAL_GROUP_CANDIDATES.find((name) =>
    name && Array.isArray(config['proxy-groups']) && config['proxy-groups'].some((group) => group && group.name === name)
  );
  const fallbackGeneral = selectedGeneral || airportProxyNames[0];

  const currentGroups = Array.isArray(config['proxy-groups']) ? config['proxy-groups'] : [];
  const reserved = new Set(['✈️ 前置中转', '🏠 静态住宅IP', '🌐 其他代理']);
  const preservedGroups = currentGroups.filter((group) => group && group.name && !reserved.has(group.name));
  const frontGroup = {
    name: '✈️ 前置中转',
    type: 'url-test',
    url: 'http://www.gstatic.com/generate_204',
    interval: 300,
    tolerance: 50,
    proxies: airportProxyNames
  };
  const residentialGroup = {
    name: '🏠 静态住宅IP',
    type: 'select',
    proxies: residentialNames
  };
  const generalGroup = {
    name: '🌐 其他代理',
    type: 'select',
    proxies: uniqueNames([fallbackGeneral, 'DIRECT', ...airportProxyNames])
  };

  const existingProxyNames = new Set(airportProxies.map((proxy) => proxy && proxy.name));
  config.proxies = [...airportProxies, ...residential.filter((proxy) => !existingProxyNames.has(proxy.name))];
  config['proxy-groups'] = [...preservedGroups, frontGroup, residentialGroup, generalGroup];
  Object.assign(config, globalConfig);
  config.profile = { ...(config.profile || {}), 'store-selected': true, 'store-fake-ip': true };
  config.dns = { ...(config.dns || {}), ...dnsConfig };

  config.rules = [
    ...suffixRules(AI_DOMAINS, '🏠 静态住宅IP'),
    ...suffixRules(MEDIA_DOMAINS, '🌐 其他代理'),
    'DOMAIN-SUFFIX,localhost,DIRECT',
    'DOMAIN-SUFFIX,local,DIRECT',
    'IP-CIDR,10.0.0.0/8,DIRECT,no-resolve',
    'IP-CIDR,172.16.0.0/12,DIRECT,no-resolve',
    'IP-CIDR,192.168.0.0/16,DIRECT,no-resolve',
    'IP-CIDR,127.0.0.0/8,DIRECT,no-resolve',
    'GEOSITE,CN,DIRECT',
    'GEOIP,CN,DIRECT,no-resolve',
    'MATCH,🌐 其他代理'
  ];
  return config;
}
