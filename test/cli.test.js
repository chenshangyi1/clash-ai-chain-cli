const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const YAML = require('yaml');

const projectRoot = path.resolve(__dirname, '..');
const fixtureRoot = path.join(__dirname, 'fixtures', 'clash-verge');
const { ClashVergeAdapter } = require('../src/adapters/clash-verge');
const { MihomoPartyAdapter } = require('../src/adapters/mihomo-party');
const { createPlan, runGeneratedScriptForValidation, selectDefaultGeneralGroup } = require('../src/engine');
const { restoreBackup } = require('../src/safety');
const { standardRoots } = require('../src/paths');
const { restartDesktopApp, stopDesktopApp, startDesktopApp } = require('../src/restart');
const { parseStaticIpFile, cleanPathInput } = require('../src/static-ip');
const { publicProxyInfo } = require('../src/safety');
const { chooseStaticLanding, chooseProfile, previewText, confirmInstall, resolveSelection, preflightInstallation, installWithLifecycle } = require('../src/cli');

function tempFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clash-ai-chain-'));
  fs.cpSync(fixtureRoot, root, { recursive: true });
  return root;
}

test('static-IP YAML is parsed before client selection and shown only in masked form', () => {
  const parsed = parseStaticIpFile(path.join(__dirname, 'fixtures', 'static-ip.yaml'));
  assert.equal(parsed.proxies.length, 2);
  assert.equal(parsed.proxies[0].server, 'static.example.invalid');
  assert.equal(publicProxyInfo(parsed.proxies[0]).password, '********');
  assert.equal(publicProxyInfo(parsed.proxies[0]).username, 'fake******');
});

test('invalid static-IP path is retryable and escaped macOS paths are cleaned', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'static path-'));
  const file = path.join(root, 'static proxies (1).txt');
  fs.writeFileSync(file, 'fake-user:fake-password@static.example.invalid:1080\n');
  const escaped = file.replace(/([ ()])/g, '\\$1');
  assert.equal(cleanPathInput(escaped), file);
  const answers = ['/definitely/missing/static-ip.txt', escaped];
  const prompts = [];
  const selection = await chooseStaticLanding({}, {
    ask: async (question) => {
      prompts.push(question);
      return answers.shift();
    }
  });
  assert.equal(selection.candidate.proxy.server, 'static.example.invalid');
  assert.equal(prompts.length, 2);
  assert.match(prompts[0], /第一步/);
  assert.match(prompts[1], /重新输入/);
});

test('static-IP URI files are supported but script files are rejected', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'static-ip-'));
  const textFile = path.join(root, 'nodes.txt');
  fs.writeFileSync(textFile, '# local node\nsocks5://fake-user:fake-password@static.example.invalid:1080#My%20Static\n');
  const parsed = parseStaticIpFile(textFile);
  assert.equal(parsed.proxies[0].name, 'My Static');
  assert.equal(parsed.proxies[0].username, 'fake-user');
  fs.writeFileSync(textFile, 'static.example.invalid:1081:fake-user:fake-password\n');
  const colonParsed = parseStaticIpFile(textFile);
  assert.equal(colonParsed.proxies[0].port, 1081);
  assert.equal(colonParsed.proxies[0].name, '静态IP 1');
  const scriptFile = path.join(root, 'nodes.js');
  fs.writeFileSync(scriptFile, 'module.exports = { proxies: [] };');
  assert.throws(() => parseStaticIpFile(scriptFile), /不能是 JavaScript/);
});

test('selected static-IP candidate can be used as the generated chain landing proxy', async () => {
  const staticSelection = await chooseStaticLanding({
    'static-ip-file': path.join(__dirname, 'fixtures', 'static-ip.yaml'),
    'static-ip-index': '1'
  }, null);
  const root = tempFixture();
  const adapter = new ClashVergeAdapter({ root });
  const snapshot = await adapter.readProfile('demo');
  const plan = createPlan(snapshot, {
    landingProxy: staticSelection.candidate.proxy,
    landingProxyId: staticSelection.candidate.id,
    generalProxyGroup: '⚡ General'
  });
  assert.equal(plan.landing.server, 'static.example.invalid');
  assert.match(plan.scriptText, /static\.example\.invalid/);
});

test('Clash Verge adapter lists profiles without exposing URLs', async () => {
  const root = tempFixture();
  const adapter = new ClashVergeAdapter({ root });
  const profiles = await adapter.listProfiles();
  assert.equal(profiles.length, 2);
  assert.equal(profiles[0].active, true);
  assert.equal(profiles[0].url, null);
  const snapshot = await adapter.readProfile('demo');
  assert.equal(snapshot.config.proxies.length, 2);
  assert.match(snapshot.scriptFile, /old-script\.txt$/);
  assert.equal(adapter.detectInstallation(snapshot).installed, false);
  const allProfiles = await adapter.listProfiles(root, { includeInternal: true });
  assert.equal(allProfiles.length, 4);
  assert.ok(allProfiles.some((profile) => profile.type === 'merge'));
});

test('interactive setup always asks the user to confirm the subscription even when only one exists', async () => {
  const profiles = [{ id: 'only', name: 'Only Subscription', type: 'remote', active: true }];
  const prompts = [];
  const selected = await chooseProfile({}, profiles, {
    ask: async (question) => {
      prompts.push(question);
      return '1';
    }
  });
  assert.equal(selected.id, 'only');
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /请输入序号/);
});

test('ordinary proxy group is detected automatically without showing service-specific groups', () => {
  const config = {
    'proxy-groups': [
      { name: '🍟 Youtube', type: 'select', proxies: ['Node A', 'Node B'] },
      { name: '🤖 OpenAi', type: 'select', proxies: ['Node A', 'Node B'] },
      { name: '⚡ ＆自留地 🏆', type: 'select', proxies: ['Node A', 'Node B', 'DIRECT'] },
      { name: '🔥 自动选择', type: 'url-test', proxies: ['Node A', 'Node B'] }
    ]
  };
  const selected = selectDefaultGeneralGroup(config, '＆自留地 🏆');
  assert.equal(selected.name, '⚡ ＆自留地 🏆');
});

test('final local preview shows complete endpoint credentials while structured preview remains masked', async () => {
  const root = tempFixture();
  const adapter = new ClashVergeAdapter({ root });
  const snapshot = await adapter.readProfile('demo');
  const plan = createPlan(snapshot, { landingProxyId: '🏠 Test Residential', generalProxyGroup: '⚡ General' });
  const preview = adapter.createPreview(snapshot, {
    landingProxy: plan.landingPublic,
    generalProxyGroup: plan.generalProxyGroup,
    scriptName: plan.scriptName,
    scriptFile: plan.scriptFile
  });
  const text = previewText(preview, plan);
  assert.match(text, /服务器：ph\.example\.invalid/);
  assert.match(text, /账号：demo-user/);
  assert.match(text, /密码：demo-password/);
  assert.equal(preview.landingProxy.password, '********');
});

test('install confirmation accepts yes/no and retries invalid input', async () => {
  const answers = ['maybe', 'YES'];
  const prompts = [];
  const confirmed = await confirmInstall({ ask: async (question) => { prompts.push(question); return answers.shift(); } });
  assert.equal(confirmed, true);
  assert.equal(prompts.length, 2);
  assert.match(prompts[0], /yes.*no/);
  const cancelled = await confirmInstall({ ask: async () => 'no' });
  assert.equal(cancelled, false);
});

test('generated rules send AI to residential, media to general, and fallback away from residential', async () => {
  const root = tempFixture();
  const adapter = new ClashVergeAdapter({ root });
  const snapshot = await adapter.readProfile('demo');
  const plan = createPlan(snapshot, { landingProxyId: '🏠 Test Residential', generalProxyGroup: '⚡ General' });
  assert.doesNotMatch(plan.scriptText, /real-password-that-must-not-appear/);
  const validation = runGeneratedScriptForValidation(plan.scriptText, snapshot.config);
  assert.equal(validation.checks.residentialGroup, true);
  assert.equal(validation.checks.frontGroup, true);
  assert.equal(validation.checks.generalGroup, true);
  assert.equal(validation.checks.aiBeforeChina, true);
  assert.equal(validation.checks.matchNotResidential, true);
  assert.equal(validation.checks.aiRule, 'DOMAIN-SUFFIX,openai.com,🏠 静态住宅IP');
  assert.equal(validation.checks.matchRule, 'MATCH,🌐 其他代理');
  assert.equal(validation.config['mixed-port'], 7890);
  assert.equal(validation.config['allow-lan'], false);
  assert.equal(validation.config['bind-address'], '127.0.0.1');
  assert.equal(validation.config['external-controller'], '127.0.0.1:9097');
  const rules = validation.config.rules;
  assert.ok(rules.includes('DOMAIN-SUFFIX,youtube.com,🌐 其他代理'));
  assert.ok(rules.includes('DOMAIN-SUFFIX,x.com,🌐 其他代理'));
  const secondRun = runGeneratedScriptForValidation(plan.scriptText, validation.config);
  const secondGroupNames = secondRun.config['proxy-groups'].map((group) => group.name);
  assert.equal(new Set(secondGroupNames).size, secondGroupNames.length);
  assert.equal(secondGroupNames.filter((name) => name === '🏠 静态住宅IP').length, 1);
});

test('install is atomic, creates a new script, activates selected profile, and rolls back', async () => {
  const root = tempFixture();
  const adapter = new ClashVergeAdapter({ root });
  const snapshot = await adapter.readProfile('demo');
  const plan = createPlan(snapshot, { landingProxyId: '🏠 Test Residential', generalProxyGroup: '⚡ General', scriptName: 'demo-install' });
  const beforeProfiles = fs.readFileSync(path.join(root, 'profiles.yaml'), 'utf8');
  const result = await adapter.installScript({ snapshot, scriptText: plan.scriptText, scriptName: 'demo-install' });
  assert.equal(result.status, 'written');
  assert.equal(result.activated, true);
  assert.equal(fs.existsSync(result.scriptFile), true);
  const after = YAML.parse(fs.readFileSync(path.join(root, 'profiles.yaml'), 'utf8'));
  assert.equal(after.current, 'demo');
  assert.equal(after.items[0].option.script, result.scriptFileName);
  assert.equal(fs.existsSync(path.join(root, 'profiles', 'old-script.txt')), true);
  const installedSnapshot = await adapter.readProfile('demo');
  const installed = adapter.detectInstallation(installedSnapshot);
  assert.equal(installed.installed, true);
  assert.equal(installed.marker, '@clash-ai-chain-cli');
  const restored = restoreBackup(result.backup.directory);
  assert.equal(restored.files.length, 3);
  assert.equal(fs.readFileSync(path.join(root, 'profiles.yaml'), 'utf8'), beforeProfiles);
  assert.equal(fs.existsSync(result.scriptFile), false);
});

test('setup detection stops before a duplicate install unless force is requested', async () => {
  const root = tempFixture();
  const adapter = new ClashVergeAdapter({ root });
  const snapshot = await adapter.readProfile('demo');
  const plan = createPlan(snapshot, { landingProxyId: '🏠 Test Residential', generalProxyGroup: '⚡ General' });
  await adapter.installScript({ snapshot, scriptText: plan.scriptText, scriptName: 'first-install' });
  const preflight = await preflightInstallation({ client: 'clash-verge-rev', root, profile: 'demo' });
  assert.equal(preflight.alreadyInstalled.installed, true);
  const flags = {
    client: 'clash-verge-rev', root, profile: 'demo',
    'static-ip-file': path.join(__dirname, 'fixtures', 'static-ip.yaml'),
    'static-ip-index': '1'
  };
  const duplicate = await resolveSelection(flags, false);
  assert.equal(duplicate.alreadyInstalled.installed, true);
  assert.equal(duplicate.plan, undefined);
  const forced = await resolveSelection({ ...flags, force: true, general: '⚡ General' }, false);
  assert.ok(forced.plan);
});

test('an older selective-chain script is recognized as an existing compatible install', async () => {
  const root = tempFixture();
  const scriptFile = path.join(root, 'profiles', 'old-script.txt');
  fs.writeFileSync(scriptFile, [
    '// Clash Verge AI 定向链式代理脚本',
    '// 🏠 静态住宅IP',
    '// 🌐 其他代理',
    '// MATCH,🌐 其他代理'
  ].join('\n'));
  const adapter = new ClashVergeAdapter({ root });
  const snapshot = await adapter.readProfile('demo');
  const detected = adapter.detectInstallation(snapshot);
  assert.equal(detected.installed, true);
  assert.equal(detected.marker, 'legacy-selective-chain');
});

test('Clash Verge script references without .js keep the client convention', async () => {
  const root = tempFixture();
  fs.renameSync(path.join(root, 'profiles', 'old-script.txt'), path.join(root, 'profiles', 'old-script.js'));
  const metadataFile = path.join(root, 'profiles.yaml');
  const metadata = YAML.parse(fs.readFileSync(metadataFile, 'utf8'));
  metadata.items[0].option.script = 'old-script';
  fs.writeFileSync(metadataFile, YAML.stringify(metadata));
  const adapter = new ClashVergeAdapter({ root });
  const snapshot = await adapter.readProfile('demo');
  assert.match(snapshot.scriptFile, /old-script\.js$/);
  const plan = createPlan(snapshot, { landingProxyId: '🏠 Test Residential', generalProxyGroup: '⚡ General' });
  const result = await adapter.installScript({ snapshot, scriptText: plan.scriptText, scriptName: 'style-test' });
  const after = YAML.parse(fs.readFileSync(metadataFile, 'utf8'));
  assert.equal(after.items[0].option.script, path.basename(result.scriptFile, '.js'));
});

test('Mihomo Party refuses an unrecognized persistence layout and exports instead', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mihomo-party-'));
  fs.writeFileSync(path.join(root, 'config.yaml'), 'proxies:\n  - name: Fake\n    type: socks5\n    server: fake.invalid\n    port: 1080\n');
  const adapter = new MihomoPartyAdapter({ root });
  const detected = await adapter.detect();
  assert.equal(detected.length, 1);
  const profiles = await adapter.listProfiles();
  assert.equal(profiles[0].name, 'config.yaml');
  const snapshot = await adapter.readProfile('config.yaml');
  const plan = createPlan(snapshot, { landingProxyId: 'Fake', generalProxyGroup: 'DIRECT' });
  const exported = await adapter.installScript({ snapshot, scriptText: plan.scriptText, scriptName: 'mihomo-preview' });
  assert.equal(exported.status, 'exported');
  assert.equal(exported.activated, false);
  assert.equal(fs.existsSync(exported.exportFile), true);
});

test('provider-only configurations are recognized but do not trigger unsafe remote fetching', async () => {
  const root = tempFixture();
  const adapter = new ClashVergeAdapter({ root });
  const snapshot = await adapter.readProfile('demo');
  snapshot.config = { 'proxy-providers': { demo: { type: 'file', path: 'provider.yaml' } }, 'proxy-groups': [] };
  const validation = await adapter.validate(snapshot);
  assert.equal(validation.ok, true);
  assert.throws(() => createPlan(snapshot, { landingProxyId: 'missing', generalProxyGroup: 'DIRECT' }), /未找到可用住宅/);
});

test('standard roots are platform-specific and do not include credentials', () => {
  const roots = standardRoots('win32', { APPDATA: 'C:/Users/test/AppData/Roaming', LOCALAPPDATA: 'C:/Users/test/AppData/Local' }, 'C:/Users/test');
  assert.ok(roots.some((root) => root.includes('clash-verge')));
  assert.ok(roots.some((root) => root.includes('mihomo-party')));
  assert.ok(!roots.join('\n').includes('password'));
});

test('restart helper refuses to guess Linux process paths', () => {
  const result = restartDesktopApp('Clash Verge', 'linux');
  assert.equal(result.status, 'manual-required');
  assert.equal(stopDesktopApp('Clash Verge', 'linux').status, 'manual-required');
  assert.equal(startDesktopApp('Clash Verge', 'linux').status, 'manual-required');
});

test('durable installation stops the client before writing and verifies after reopening', async () => {
  const events = [];
  const adapter = {
    supportsDurableInstall: () => true,
    stopForInstall: async () => { events.push('stop'); return { status: 'stopped' }; },
    readProfile: async () => { events.push('refresh'); return { profile: { id: 'demo' }, metadataFile: '/tmp/profiles.yaml' }; },
    installScript: async () => {
      events.push('write');
      return { status: 'written', profileId: 'demo', scriptFile: '/tmp/new-script.js' };
    },
    startAfterInstall: async () => { events.push('start'); return { status: 'restarted' }; },
    verifyInstalledBinding: () => {
      events.push('verify');
      return { bound: true, active: true, marker: '@clash-ai-chain-cli' };
    }
  };
  const result = await installWithLifecycle({
    adapter,
    snapshot: { profile: { id: 'demo' }, metadataFile: '/tmp/profiles.yaml' },
    scriptText: '// fake',
    scriptName: 'fake',
    settleMs: 0
  });
  assert.deepEqual(events, ['stop', 'refresh', 'write', 'start', 'verify']);
  assert.equal(result.verification.bound, true);
});

test('durable installation refuses to write when the client cannot be stopped safely', async () => {
  let wrote = false;
  const adapter = {
    supportsDurableInstall: () => true,
    stopForInstall: async () => ({ status: 'stop-failed', reason: 'still running' }),
    installScript: async () => { wrote = true; }
  };
  await assert.rejects(() => installWithLifecycle({
    adapter,
    snapshot: { metadataFile: '/tmp/profiles.yaml' },
    scriptText: '// fake',
    scriptName: 'fake',
    settleMs: 0
  }), /未写入任何文件/);
  assert.equal(wrote, false);
});
