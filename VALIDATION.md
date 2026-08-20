# Validation report

日期：2026-08-21

## 已通过

- `npm run check`：CLI、生成器和重启生命周期代码的 JavaScript 语法检查通过。
- `npm test`：22 个测试通过，覆盖静态 IP YAML/JSON/URI 识别、带账号密码的文本行、错误路径重试、macOS 转义路径清理与脚本文件拒绝、单一订阅的交互确认、主代理组自动识别、最终凭据预览、`yes/no` 确认重试、安装前预检、已安装二次检测和 `--force` 覆盖、Clash Verge Rev profile 解析、AI/YouTube/X/中国直连规则、备份与原子写入、Script 项目注册、未注册脚本修复识别、真实运行配置复核、旧版兼容脚本识别、Mihomo Party 未识别布局的导出降级、`proxy-providers` 结构识别、跨平台路径以及“先退出客户端、再写入、重启后复核绑定和运行配置”的生命周期。
- 使用 Clash Verge Rev 内置 `verge-mihomo` 对修复后的实际运行配置执行 `-t`：配置语法检查成功。
- 对本机 Clash Verge Rev 配置执行了只读 `profiles` / `preview` 检查：识别到当前订阅和普通代理组，AI 规则位于中国直连之前，最终 `MATCH` 指向 `🌐 其他代理`。
- 测试确认 `allow-lan`、`bind-address`、端口和 `external-controller` 不会被脚本改写。
- 测试确认原脚本保留、新脚本单独创建、备份可恢复且回滚会删除新脚本。
- 使用静态 IP 测试文件执行过一次完整 `setup --static-ip-file ... --static-ip-index 1 --no-restart`，随后已回滚；项目仓库和测试夹具均未留下真实凭据。
- 对本机当前 Clash Verge Rev 完成一次带备份的修复安装：新脚本拥有对应的 `type: script` 项目，订阅绑定、客户端重启和运行配置复核全部通过；再次执行 setup 返回 `already-installed`，未重复写入。
- 对修复后的本机运行状态做了出口核验：`chatgpt.com` 的出口地区为 `PH`，普通兜底流量的出口地区为 `US`，证明两类流量没有共用住宅链。实际出口地址和凭据均未写入仓库。

## 仍需运行时确认

- 静态配置不能证明候选节点一定是住宅 IP，也不能证明出口一定是某个固定地址；候选列表保持脱敏，最终本机确认页会完整显示所选节点凭据并明确提醒不要分享终端截图。
- Mihomo Party 未在本机发现；没有明确识别其持久化脚本入口时，适配器只导出脚本，不修改未知文件。
- macOS 的实际安装路径和运行配置已经验证；Windows、Linux 仍只通过路径和适配器单元测试验证，客户端启动方式不同的平台可能要求手动重启。
- 代理提供者只有在客户端已经展开为本地 `proxies` 节点时才可选择落地节点；CLI 不会抓取远程订阅或执行提供者脚本。
