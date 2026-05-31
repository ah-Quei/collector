# Collector

Collector 是一个面向个人知识收集的本地服务。它通过飞书机器人、浏览器扩展入口和本地 Agent，把网页、文本、图片、音频等素材整理成结构化知识，并发布到飞书知识库。

## 功能概览

- 飞书机器人入口：把消息发给机器人后自动整理、处理并回传进度。
- 浏览器扩展入口：接收浏览器侧采集的内容。
- 本地知识库：使用 SQLite 保存知识条目、标签、处理状态和附件信息。
- Agent + Skills：根据本地 skills 模板处理不同来源和模态的内容。
- 飞书知识库发布：把处理结果写入飞书 Wiki/Docx。
- MCP 服务：可选暴露本地知识库查询能力。

## 系统要求

- macOS 或 Linux
- Node.js >= 20
- npm
- curl、tar、bash
- 飞书企业自建应用

安装器会检查 `opencli` 和 `lark-cli`。如果当前环境没有这些工具，会使用 npm 自动安装：

- `opencli` -> `@jackwener/opencli`
- `lark-cli` -> `@larksuite/cli`

如需跳过外部工具检查：

```bash
COLLECTOR_INSTALL_EXTERNAL_TOOLS=0 bash scripts/install.sh
```

## 安装

```bash
curl -fsSL https://raw.githubusercontent.com/ah-Quei/collector/main/scripts/install.sh | bash
```

安装内容：

- Collector 命令：默认安装到 `~/.local/bin/collector`
- Collector 应用包：默认安装到 `~/.local/lib/collector`
- Skills 模板：默认同步到 `~/.collector/skills`
- 配置文件：默认位于 `~/.collector/config.yaml`

如果 `~/.local/bin` 不在 `PATH` 中，请按安装器提示加入 shell 配置。

## 初始化

```bash
collector init
```

初始化向导会配置：

- 飞书 App ID / App Secret
- 飞书知识库 Space ID
- LLM API Base URL / API Key / Model
- MCP 服务开关和端口
- 浏览器扩展入口开关和端口
- Skills 目录

初始化后检查配置：

```bash
collector check
```

## 运行

前台运行：

```bash
collector start
```

后台运行：

```bash
collector start -d
```

停止后台服务：

```bash
collector stop
```

后台日志默认写入：

```text
~/.collector/collector.log
```

## 更新

推荐使用：

```bash
collector update
```

也可以重新运行安装脚本：

```bash
curl -fsSL https://raw.githubusercontent.com/ah-Quei/collector/main/scripts/install.sh | bash
```

更新会同步程序和默认 Skills 模板。若本地修改过默认 Skill，安装器默认保留本地文件，并把上游版本写成 `.incoming` 文件。

## 常用环境变量

| 变量 | 说明 |
| --- | --- |
| `COLLECTOR_REPO` | GitHub 仓库，默认 `ah-Quei/collector` |
| `COLLECTOR_VERSION` | 安装指定版本，默认 `latest` |
| `COLLECTOR_INSTALL_DIR` | Collector 命令安装目录 |
| `COLLECTOR_APP_DIR` | Collector 应用包安装目录 |
| `COLLECTOR_SKILLS_DIR` | Skills 目录 |
| `COLLECTOR_SKILLS_STRATEGY` | Skill 冲突策略：`incoming`、`keep`、`overwrite`、`backup` |
| `COLLECTOR_INSTALL_EXTERNAL_TOOLS` | 设为 `0` 可跳过 `opencli` / `lark-cli` 检查 |

## 开发

```bash
npm ci
npm run lint
npm test
npm run build
```

本地打包当前平台 Release 资产：

```bash
npm run build
scripts/package-release.sh
```

输出目录默认为 `release/`。

## 发版

项目使用 GitHub Actions 自动发版。推送 `v*` tag 后会自动：

1. 运行 lint、test、build。
2. 打包 macOS/Linux 的 arm64/x64 Release 资产。
3. 打包 `collector-skills.tar.gz`。
4. 创建 GitHub Release 并上传所有资产。

首个可用版本使用 `v0.1.0`。后续个人项目建议按 SemVer 递增：

- 修 bug 或小改动：`patch`，如 `v0.1.1`
- 增加兼容功能：`minor`，如 `v0.2.0`
- 破坏性配置或数据变更：`major`，如 `v1.0.0`

发版命令：

```bash
npm version patch
git push origin main --follow-tags
```

如果当前 `package.json` 版本已经是目标版本，可以直接创建 tag：

```bash
git tag v0.1.0
git push origin v0.1.0
```
