#!/usr/bin/env node

const fs = require('node:fs');
const readline = require('node:readline');
const path = require('node:path');
const os = require('node:os');
const { detectClients, findAdapter } = require('./discovery');
const { createPlan, listLandingCandidates, listGeneralCandidates, selectDefaultGeneralGroup, runGeneratedScriptForValidation } = require('./engine');
const { restoreBackup } = require('./safety');
const { parseStaticIpFile } = require('./static-ip');

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const raw = token.slice(2);
    if (raw.includes('=')) {
      const [key, ...rest] = raw.split('=');
      flags[key] = rest.join('=');
    } else if (['yes', 'json', 'no-restart', 'force', 'help'].includes(raw)) {
      flags[raw] = true;
    } else {
      flags[raw] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    }
  }
  return { flags, positional };
}

function print(value, json = false) {
  if (json) console.log(JSON.stringify(value, null, 2));
  else console.log(value);
}

function help() {
  console.log(`Clash AI Chain CLI\n\n用法：\n  clash-ai setup [--static-ip-file <文件>] [--static-ip-index <序号>] [--client <id>] [--root <目录>] [--force]\n  clash-ai detect [--json]\n  clash-ai profiles [--client <id>] [--root <目录>] [--all] [--json]\n  clash-ai preview --client <id> --profile <id> [--landing <节点名>] [--general <高级覆盖组名>]\n  clash-ai rollback --backup <备份目录>\n  clash-ai doctor\n\n检测到目标订阅已安装时默认立即结束；--force 仅用于确实需要更换或重装。\n普通代理组默认自动识别；--general 仅用于高级手动覆盖。\n默认只显示可切换订阅；profiles --all 可查看 Clash Verge Rev 的内部合并/脚本/规则条目。\n客户端：clash-verge-rev、mihomo-party\n安全选项：--yes 表示已明确确认安装；--no-restart 只写入并跳过重启。`);
}

function createPrompter() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (question) => new Promise((resolve) => rl.question(question, resolve));
  const close = () => rl.close();
  return { ask, close };
}

async function choose(prompter, title, items, formatter = (item) => String(item.name || item)) {
  if (!items.length) throw new Error(`${title}：没有可选项。`);
  if (!prompter) throw new Error(`${title}有多个候选，请在交互终端运行，或通过参数明确指定。`);
  console.log(`\n${title}`);
  items.forEach((item, index) => console.log(`  ${index + 1}. ${formatter(item)}`));
  while (true) {
    const answer = await prompter.ask('请输入序号：');
    const index = Number.parseInt(answer, 10) - 1;
    if (Number.isInteger(index) && items[index]) return items[index];
    console.log('序号无效，请重试。');
  }
}

function profileSummary(profile) {
  const active = profile.active ? '（当前启用）' : '';
  const script = profile.script ? `，脚本 ${profile.script}` : '';
  return `${profile.name} [${profile.type}] ${active}${script}`;
}

async function chooseProfile(flags, profiles, prompter) {
  if (flags.profile) return profiles.find((item) => item.id === flags.profile || item.name === flags.profile) || null;
  if (prompter) return choose(prompter, '选择订阅/配置', profiles, profileSummary);
  if (profiles.length === 1) return profiles[0];
  return choose(null, '选择订阅/配置', profiles, profileSummary);
}

function previewText(preview, plan) {
  const landing = plan.landing || {};
  return [
    '\n========== 安装预览 ==========',
    `客户端：${preview.client}`,
    `订阅：${preview.profile}`,
    `订阅文件：${preview.profileFile}`,
    `住宅候选：${plan.landingPublic.name}`,
    `类型：${plan.landingPublic.type}`,
    `服务器：${landing.server || '(无)'}`,
    `端口：${landing.port || '(无)'}`,
    `账号：${landing.username || '(无)'}`,
    `密码：${landing.password || '(无)'}`,
    `静态 IP 来源：${preview.staticIpSource || '订阅节点'}`,
    '注意：以上凭据仅在本机最终预览中完整显示，请勿分享终端截图或日志。',
    '注意：CLI 不会宣称节点一定是住宅 IP；请在确认前自行核对节点和出口。',
    `普通代理组：${plan.generalProxyGroup}`,
    `新脚本：${preview.scriptFile}`,
    '变更：',
    ...preview.changes.map((item) => `  - ${item}`),
    '================================\n'
  ].join('\n');
}

async function confirmInstall(prompter) {
  while (true) {
    const answer = (await prompter.ask('确认写入并启用？请输入 yes，否则输入 no：')).trim().toLowerCase();
    if (answer === 'yes') return true;
    if (answer === 'no') return false;
    console.log('请输入 yes 或 no。');
  }
}

async function preflightInstallation(flags) {
  if (flags.force) return null;
  try {
    const detected = await detectClients({ clientId: flags.client, root: flags.root });
    let clientId = flags.client;
    let root = flags.root;
    if (!clientId) {
      if (detected.length !== 1) return null;
      clientId = detected[0].id;
      root = detected[0].root;
    }
    const adapter = await findAdapter({ clientId, root });
    const profiles = await adapter.listProfiles();
    const profile = flags.profile
      ? profiles.find((item) => item.id === flags.profile || item.name === flags.profile)
      : (profiles.find((item) => item.active) || (profiles.length === 1 ? profiles[0] : null));
    if (!profile) return null;
    const snapshot = await adapter.readProfile(profile.id);
    const installed = adapter.detectInstallation(snapshot);
    return installed.installed ? { adapter, profile, snapshot, alreadyInstalled: installed } : null;
  } catch (_) {
    return null;
  }
}

function finishAlreadyInstalled(state, flags) {
  if (state.prompter) state.prompter.close();
  const report = {
    status: 'already-installed',
    client: state.adapter.name,
    profile: state.profile.name,
    scriptFile: state.alreadyInstalled.scriptFile,
    changed: false,
    message: '该订阅已经绑定 Clash AI Chain 脚本，无需重复安装。',
    forceHint: '如需更换静态 IP 或重装，请重新运行 setup --force。'
  };
  if (flags.json) print(report, true);
  else console.log([
    '\n检测到已经安装，无需重复操作。',
    `客户端：${report.client}`,
    `订阅：${report.profile}`,
    `已绑定脚本：${report.scriptFile}`,
    '本次没有读取静态 IP、备份、写入或重启。',
    `提示：${report.forceHint}`
  ].join('\n'));
  return report;
}

async function chooseStaticLanding(flags, prompter) {
  let file = flags['static-ip-file'] || flags.staticIpFile;
  while (true) {
    if (!file && prompter) {
      const answer = await prompter.ask('第一步：输入静态 IP 文件路径（YAML/JSON/文本；直接回车跳过）：');
      file = answer.trim() || null;
    }
    if (!file) return null;

    let parsed;
    try {
      parsed = parseStaticIpFile(file);
    } catch (error) {
      if (!prompter) throw error;
      console.log(`错误：${error.message}`);
      const retry = await prompter.ask('请重新输入静态 IP 文件路径（直接回车跳过）：');
      file = retry.trim() || null;
      continue;
    }

    const candidates = parsed.proxies.map((proxy) => ({
      id: proxy.name,
      name: proxy.name,
      proxy,
      info: require('./safety').publicProxyInfo(proxy)
    }));
    const candidateFormatter = (candidate) => `${candidate.info.name} | ${candidate.info.type} | ${candidate.info.server}:${candidate.info.port} | ${candidate.info.username || '无账号'}`;
    let selected;
    if (flags['static-ip-index'] !== undefined) {
      const index = Number(flags['static-ip-index']) - 1;
      selected = Number.isInteger(index) && candidates[index] ? candidates[index] : null;
      if (!selected && prompter) {
        console.log(`静态 IP 序号无效，请从 1-${candidates.length} 重新选择。`);
        selected = await choose(prompter, '识别到的静态 IP 候选（仅显示脱敏信息）', candidates, candidateFormatter);
      }
    } else if (flags.landing) {
      selected = candidates.find((candidate) => candidate.id === flags.landing || candidate.name === flags.landing);
      if (!selected && prompter) {
        console.log(`没有找到名为“${flags.landing}”的静态 IP 候选，请重新选择。`);
        selected = await choose(prompter, '识别到的静态 IP 候选（仅显示脱敏信息）', candidates, candidateFormatter);
      }
    } else if (candidates.length === 1) {
      selected = candidates[0];
    } else {
      selected = await choose(prompter, '识别到的静态 IP 候选（仅显示脱敏信息）', candidates, candidateFormatter);
    }
    if (!selected) throw new Error(`静态 IP 文件中未找到指定候选：${flags['static-ip-index'] || flags.landing || '(未选择)'}`);
    return { file: parsed.file, format: parsed.format, candidate: selected };
  }
}

async function resolveSelection(flags, interactive = true) {
  let clientId = flags.client;
  let root = flags.root;
  const prompter = interactive ? createPrompter() : null;
  try {
    const staticSelection = await chooseStaticLanding(flags, prompter);
    const detected = await detectClients({ clientId: flags.client, root: flags.root });
    if (!clientId) {
      if (!detected.length) throw new Error('未发现支持的客户端，请指定 --client 和 --root。');
      const chosen = detected.length === 1 ? detected[0] : await choose(prompter, '选择代理客户端', detected, (item) => `${item.name} — ${item.root}`);
      clientId = chosen.id;
      root = chosen.root;
    }
    const adapter = await findAdapter({ clientId, root });
    root = adapter.root;
    const profiles = await adapter.listProfiles();
    if (!profiles.length) throw new Error(`${adapter.name} 中没有可用本地订阅。`);
    const profile = await chooseProfile(flags, profiles, prompter);
    if (!profile) throw new Error(`未找到订阅：${flags.profile}`);
    const snapshot = await adapter.readProfile(profile.id);
    const existingInstall = adapter.detectInstallation(snapshot);
    if (existingInstall.installed && !flags.force) {
      return { adapter, profile, snapshot, prompter, staticSelection, alreadyInstalled: existingInstall };
    }
    if (existingInstall.installed && flags.force && prompter) {
      console.log(`检测到已有安装，将按 --force 继续替换：${existingInstall.scriptFile}`);
    }
    const landingCandidates = listLandingCandidates(snapshot);
    if (!staticSelection && !landingCandidates.length) throw new Error('目标订阅没有可直接选择的 proxies 节点。当前版本不会执行 proxy-providers 的远程抓取，请先在客户端生成本地节点列表，或在第一步提供静态 IP 文件。');
    const landing = staticSelection?.candidate || (flags.landing ? landingCandidates.find((item) => item.id === flags.landing || item.name === flags.landing) :
      (landingCandidates.length === 1 ? landingCandidates[0] : await choose(prompter, '选择住宅落地候选节点（仅显示脱敏信息）', landingCandidates, (item) => `${item.info.name} | ${item.info.type} | ${item.info.server}:${item.info.port} | ${item.info.username || '无账号'}`)));
    if (!landing) throw new Error(`未找到住宅节点：${flags.landing}`);
    const generalCandidates = listGeneralCandidates(snapshot);
    const general = flags.general ? generalCandidates.find((item) => item.name === flags.general) :
      selectDefaultGeneralGroup(snapshot.config, profile.name);
    if (!general) throw new Error(`未找到普通代理组：${flags.general}`);
    if (!flags.general && prompter) console.log(`已自动识别普通代理组：${general.name} [${general.type}]`);
    const scriptName = flags['script-name'] || flags.scriptName || 'clash-ai-selective-chain';
    const plan = createPlan(snapshot, {
      landingProxyId: landing.id,
      landingProxy: landing.proxy || undefined,
      generalProxyGroup: general.name,
      scriptName
    });
    const preview = adapter.createPreview(snapshot, {
      landingProxy: plan.landingPublic,
      generalProxyGroup: plan.generalProxyGroup,
      scriptName,
      scriptFile: plan.scriptFile,
      staticIpSource: staticSelection?.file
    });
    return { adapter, profile, snapshot, plan, preview, prompter, staticSelection };
  } catch (error) {
    if (prompter) prompter.close();
    throw error;
  }
}

async function installWithLifecycle({ adapter, snapshot, scriptText, scriptName, noRestart = false, settleMs = 750 }) {
  const durable = typeof adapter.supportsDurableInstall === 'function'
    ? adapter.supportsDurableInstall(snapshot)
    : Boolean(snapshot?.metadataFile);
  let stopped = { status: 'skipped', reason: noRestart ? '--no-restart' : '无需修改持久配置' };

  if (durable && !noRestart) {
    stopped = await adapter.stopForInstall();
    if (stopped.status !== 'stopped') {
      throw new Error(`无法在写入前安全退出客户端：${stopped.reason || stopped.status} 未写入任何文件。`);
    }
  }

  let installSnapshot = snapshot;
  if (stopped.status === 'stopped' && typeof adapter.readProfile === 'function') {
    try {
      installSnapshot = await adapter.readProfile(snapshot.profile.id);
    } catch (error) {
      const recovery = await adapter.startAfterInstall();
      if (recovery.status !== 'restarted') error.message += `；客户端也未能自动重新启动：${recovery.reason || recovery.status}`;
      throw new Error(`客户端退出后无法重新读取订阅，未写入任何文件：${error.message}`);
    }
  }

  let install;
  try {
    install = await adapter.installScript({ snapshot: installSnapshot, scriptText, scriptName });
  } catch (error) {
    if (stopped.status === 'stopped') {
      const recovery = await adapter.startAfterInstall();
      if (recovery.status !== 'restarted') error.message += `；客户端也未能自动重新启动：${recovery.reason || recovery.status}`;
    }
    throw error;
  }

  if (install.status !== 'written') {
    return { install, stopped, restart: { status: 'skipped', reason: '仅导出，未修改客户端配置' }, verification: null };
  }

  let restart = { status: 'skipped', reason: '--no-restart' };
  if (!noRestart) restart = await adapter.startAfterInstall();
  if (restart.status === 'restarted' && settleMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, settleMs));
  }
  const verification = typeof adapter.verifyInstalledBinding === 'function'
    ? adapter.verifyInstalledBinding(install.profileId, install.scriptFile)
    : { bound: false, active: false, marker: null, error: '适配器不支持绑定复核。' };
  return { install, stopped, restart, verification };
}

async function setup(flags) {
  const preflight = await preflightInstallation(flags);
  if (preflight) return finishAlreadyInstalled(preflight, flags);
  const interactive = !flags.yes || Boolean(process.stdin.isTTY);
  const state = await resolveSelection(flags, interactive);
  if (state.alreadyInstalled) return finishAlreadyInstalled(state, flags);
  const { adapter, plan, preview, prompter } = state;
  if (!flags.json) console.log(previewText(preview, plan));
  const validation = runGeneratedScriptForValidation(plan.scriptText, state.snapshot.config);
  const failedChecks = Object.entries(validation.checks).filter(([key, value]) => key !== 'aiRule' && key !== 'matchRule' && value !== true);
  if (failedChecks.length) {
    if (prompter) prompter.close();
    throw new Error(`生成规则校验失败：${failedChecks.map(([key]) => key).join(', ')}`);
  }
  if (!flags.yes) {
    const confirmed = await confirmInstall(prompter);
    if (!confirmed) {
      prompter.close();
      console.log('已取消，未写入任何文件。');
      return { status: 'cancelled' };
    }
  }
  if (prompter) prompter.close();
  const lifecycle = await installWithLifecycle({
    adapter,
    snapshot: state.snapshot,
    scriptText: plan.scriptText,
    scriptName: plan.scriptName,
    noRestart: Boolean(flags['no-restart'])
  });
  const { install, restart, verification } = lifecycle;
  if (install.status !== 'written') {
    print({ ...install, client: adapter.name, profile: state.profile.name }, false);
    return install;
  }
  const bindingVerified = Boolean(verification?.bound && verification?.active && verification?.marker);
  const activated = bindingVerified && restart.status === 'restarted';
  const report = {
    status: activated ? 'success' : 'partial',
    client: adapter.name,
    profile: state.profile.name,
    profileFile: install.profileFile,
    scriptFile: install.scriptFile,
    backupDirectory: install.backup.directory,
    bindingVerified,
    activated,
    restarted: restart.status === 'restarted',
    stop: lifecycle.stopped,
    restart,
    warning: activated ? undefined : (flags['no-restart']
      ? '脚本已写入并复核绑定，但 --no-restart 跳过了客户端重新加载；请手动启动或重载后再检查。'
      : `未能确认新脚本已持久启用：${verification?.error || restart.reason || '绑定复核失败'}`),
    rollback: `clash-ai rollback --backup ${install.backup.directory}`
  };
  print(report, Boolean(flags.json));
  if (!activated) process.exitCode = 1;
  return report;
}

async function commandPreview(flags) {
  const state = await resolveSelection(flags, false);
  if (state.alreadyInstalled) {
    const result = {
      status: 'already-installed',
      client: state.adapter.name,
      profile: state.profile.name,
      scriptFile: state.alreadyInstalled.scriptFile,
      changed: false
    };
    print(result, Boolean(flags.json));
    return result;
  }
  if (!flags.json) console.log(previewText(state.preview, state.plan));
  const validation = runGeneratedScriptForValidation(state.plan.scriptText, state.snapshot.config);
  print({ preview: state.preview, landingProxy: state.plan.landingPublic, checks: validation.checks }, Boolean(flags.json));
  return validation;
}

async function commandDetect(flags) {
  const detected = await detectClients({ clientId: flags.client, root: flags.root });
  print(detected.map((item) => ({ id: item.id, name: item.name, root: item.root, confidence: item.confidence })), Boolean(flags.json));
  return detected;
}

async function commandProfiles(flags) {
  const adapter = await findAdapter({ clientId: flags.client, root: flags.root });
  const profiles = await adapter.listProfiles(adapter.root, { includeInternal: Boolean(flags.all) });
  print(profiles, Boolean(flags.json));
  return profiles;
}

async function commandRollback(flags) {
  if (!flags.backup || typeof flags.backup !== 'string') throw new Error('rollback 需要 --backup <备份目录>。');
  const manifest = restoreBackup(flags.backup);
  const result = { status: 'rolled-back', backupDirectory: path.resolve(flags.backup), restoredFiles: manifest.files.length, removedCreatedFiles: (manifest.created || []).length };
  print(result, Boolean(flags.json));
  return result;
}

async function commandDoctor(flags) {
  const detected = await detectClients({ root: flags.root });
  const checks = [
    { name: 'Node.js', ok: Number(process.versions.node.split('.')[0]) >= 18, detail: process.versions.node },
    { name: 'YAML parser', ok: Boolean(require('yaml')), detail: 'yaml' },
    { name: '配置发现', ok: detected.length > 0, detail: detected.map((item) => `${item.name}: ${item.root}`).join('; ') || '未发现，可使用 --root' },
    { name: '工作目录可写', ok: (() => { try { fs.accessSync(process.cwd(), fs.constants.W_OK); return true; } catch (_) { return false; } })(), detail: process.cwd() },
    { name: '当前用户', ok: Boolean(os.userInfo().username), detail: os.userInfo().username }
  ];
  print({ ok: checks.every((item) => item.ok), checks }, Boolean(flags.json));
  return checks;
}

async function main(argv) {
  const [command = 'help', ...rest] = argv;
  const { flags } = parseArgs(rest);
  if (flags.help || command === 'help') return help();
  if (command === 'detect') return commandDetect(flags);
  if (command === 'profiles') return commandProfiles(flags);
  if (command === 'preview') return commandPreview(flags);
  if (command === 'setup') return setup(flags);
  if (command === 'rollback') return commandRollback(flags);
  if (command === 'doctor') return commandDoctor(flags);
  throw new Error(`未知命令：${command}。使用 clash-ai help 查看用法。`);
}

module.exports = { main, parseArgs, resolveSelection, chooseStaticLanding, chooseProfile, previewText, confirmInstall, preflightInstallation, finishAlreadyInstalled, installWithLifecycle };
