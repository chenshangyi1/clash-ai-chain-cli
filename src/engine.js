const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { generateScript, validateGeneratedScript } = require('./generator');
const { publicProxyInfo } = require('./safety');

const RESERVED_GROUPS = new Set(['✈️ 前置中转', '🏠 静态住宅IP', '🌐 其他代理']);
const SERVICE_GROUP_PATTERN = /youtube|telegram|openai|claude|gemini|grok|netflix|disney|steam|emby|microsoft|crypto|油管|电报|奈飞|迪士尼|微软|游戏|加密/i;
const MAIN_GROUP_PATTERN = /自留地|节点选择|代理选择|主代理|全局代理|自动选择|故障转移|general|proxy|global|select/i;

function usableProxy(proxy) {
  return Boolean(proxy && proxy.name && proxy.type && proxy.server && proxy.port &&
    !/更新客户端|请.*更新|占位|placeholder|剩余流量|流量剩余|套餐到期|距离下次重置/i.test(String(proxy.name)) &&
    !/^1\.1\.1\.1(?::\d+)?$/.test(String(proxy.name)));
}

function proxyCandidates(config) {
  return (Array.isArray(config?.proxies) ? config.proxies : []).filter(usableProxy);
}

function generalGroupCandidates(config) {
  const groups = Array.isArray(config?.['proxy-groups']) ? config['proxy-groups'] : [];
  const selectors = groups
    .filter((group) => group && group.name && !RESERVED_GROUPS.has(group.name))
    .map((group) => ({
      name: group.name,
      type: group.type || 'unknown',
      selected: group.proxies?.[0] || null,
      proxyCount: Array.isArray(group.proxies) ? group.proxies.length : 0
    }));
  return [{ name: 'DIRECT', type: 'direct', selected: 'DIRECT', proxyCount: 0 }, ...selectors];
}

function normalizeGroupName(value) {
  return String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function selectDefaultGeneralGroup(config, profileName) {
  const profileToken = normalizeGroupName(profileName);
  const candidates = generalGroupCandidates(config).filter((group) => group.name !== 'DIRECT');
  const scored = candidates.map((group) => {
    const groupToken = normalizeGroupName(group.name);
    let score = 0;
    if (group.type === 'select') score += 50;
    else if (group.type === 'url-test' || group.type === 'fallback') score += 15;
    if (MAIN_GROUP_PATTERN.test(group.name)) score += 80;
    if (SERVICE_GROUP_PATTERN.test(group.name)) score -= 250;
    if (profileToken.length >= 2 && groupToken.length >= 2 && (groupToken.includes(profileToken) || profileToken.includes(groupToken))) score += 250;
    score += Math.min(group.proxyCount || 0, 50);
    if ((group.proxyCount || 0) <= 1 && group.selected === 'DIRECT') score -= 100;
    return { ...group, score };
  }).sort((left, right) => right.score - left.score);
  return scored[0]?.score > 0 ? scored[0] : { name: 'DIRECT', type: 'direct', selected: 'DIRECT', proxyCount: 0, score: 0 };
}

function findByName(items, value) {
  if (!value) return null;
  return items.find((item) => String(item.name) === String(value) || String(item.id || '') === String(value));
}

function createPlan(snapshot, selection) {
  const proxies = proxyCandidates(snapshot.config);
  const landing = selection.landingProxy || findByName(proxies, selection.landingProxyId);
  if (!landing) throw new Error(`未找到可用住宅候选节点：${selection.landingProxyId}`);
  const groups = generalGroupCandidates(snapshot.config);
  const general = findByName(groups, selection.generalProxyGroup) || groups[0];
  if (!general) throw new Error('订阅中没有可供选择的普通代理组。');
  const scriptName = selection.scriptName || 'clash-ai-selective-chain';
  const scriptText = generateScript({ landingProxy: landing, generalProxyGroup: general.name });
  validateGeneratedScript(scriptText);
  const scriptFile = path.join(path.dirname(snapshot.profileFile), '(新建随机脚本文件名).js');
  return {
    snapshot,
    landing,
    general,
    scriptName,
    scriptText,
    scriptFile,
    landingPublic: publicProxyInfo(landing),
    generalProxyGroup: general.name
  };
}

function runGeneratedScriptForValidation(scriptText, sourceConfig) {
  const sandbox = { module: { exports: {} }, exports: {}, console };
  vm.runInNewContext(`${scriptText}\nmodule.exports = { main };`, sandbox, { timeout: 1000 });
  const config = JSON.parse(JSON.stringify(sourceConfig || {}));
  const result = sandbox.module.exports.main(config);
  const rules = Array.isArray(result.rules) ? result.rules : [];
  const aiIndex = rules.findIndex((rule) => rule.startsWith('DOMAIN-SUFFIX,openai.com,'));
  const cnIndex = rules.findIndex((rule) => rule === 'GEOSITE,CN,DIRECT');
  const matchIndex = rules.findIndex((rule) => rule.startsWith('MATCH,'));
  const matchTarget = matchIndex >= 0 ? rules[matchIndex].split(',')[1] : null;
  const groupNames = (result['proxy-groups'] || []).map((group) => group.name);
  return {
    config: result,
    checks: {
      residentialGroup: groupNames.includes('🏠 静态住宅IP'),
      frontGroup: groupNames.includes('✈️ 前置中转'),
      generalGroup: groupNames.includes('🌐 其他代理'),
      aiBeforeChina: aiIndex >= 0 && cnIndex >= 0 && aiIndex < cnIndex,
      matchNotResidential: matchTarget !== '🏠 静态住宅IP',
      aiRule: aiIndex >= 0 ? rules[aiIndex] : null,
      matchRule: matchIndex >= 0 ? rules[matchIndex] : null
    }
  };
}

function listLandingCandidates(snapshot) {
  return proxyCandidates(snapshot.config).map((proxy) => ({
    id: proxy.name,
    name: proxy.name,
    info: publicProxyInfo(proxy)
  }));
}

function listGeneralCandidates(snapshot) {
  return generalGroupCandidates(snapshot.config);
}

module.exports = {
  RESERVED_GROUPS,
  usableProxy,
  proxyCandidates,
  generalGroupCandidates,
  selectDefaultGeneralGroup,
  createPlan,
  runGeneratedScriptForValidation,
  listLandingCandidates,
  listGeneralCandidates
};
