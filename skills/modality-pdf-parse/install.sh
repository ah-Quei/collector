#!/usr/bin/env bash
set -euo pipefail

# MinerU remote-API PDF parsing no longer installs a local Python venv.
# Parsing runs entirely on mineru.net servers. This script only verifies
# the lightweight runtime dependencies required by the Skill.

echo "modality-pdf-parse 使用 MinerU 官网远程 API，无需本地安装 MinerU。"
echo "检查运行时依赖..."

missing=0
for bin in curl python3 unzip; do
	if command -v "$bin" >/dev/null 2>&1; then
		printf '  ✓ %s\n' "$bin"
	else
		printf '  ✗ 缺少: %s\n' "$bin" >&2
		missing=1
	fi
done

if [ "$missing" -ne 0 ]; then
	echo "请安装缺失的依赖后重试。" >&2
	exit 1
fi

echo "运行时依赖就绪。"
echo "下一步：配置 MinerU API Token（来自 https://mineru.net/user-center/api-token）："
echo "  collector skills configure modality-pdf-parse"
