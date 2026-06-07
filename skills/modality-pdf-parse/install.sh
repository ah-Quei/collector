#!/usr/bin/env bash
set -euo pipefail

backend="${COLLECTOR_PDF_MINERU_BACKEND:-hybrid-http-client}"
venv_dir="${COLLECTOR_MINERU_VENV:-$HOME/.collector/venvs/mineru}"
venv_mineru="$venv_dir/bin/mineru"

case "$backend" in
  hybrid-http-client|vlm-http-client) ;;
  *)
    echo "Invalid COLLECTOR_PDF_MINERU_BACKEND: $backend. Use hybrid-http-client or vlm-http-client." >&2
    exit 1
    ;;
esac

if mineru_bin="$(command -v mineru 2>/dev/null)" && [ -n "$mineru_bin" ]; then
  if "$mineru_bin" --version; then
    echo "Using existing mineru: $mineru_bin"
    exit 0
  fi
  echo "Existing mineru failed verification, installing isolated Collector venv instead: $mineru_bin" >&2
fi

if [ -x "$venv_mineru" ] && "$venv_mineru" --version; then
  echo "Using Collector MinerU venv: $venv_dir"
  exit 0
fi

validate_python() {
  "$1" - <<'PY'
import sys
if sys.version_info >= (3, 14):
    raise SystemExit(
        f"Python {sys.version.split()[0]} is not supported by mineru. "
        "Use Python >=3.10,<3.14."
    )
if sys.version_info < (3, 10):
    raise SystemExit(
        f"Python {sys.version.split()[0]} is too old for mineru. "
        "Use Python >=3.10,<3.14."
    )
PY
}

resolve_python() {
  if [ -n "${COLLECTOR_PYTHON:-}" ]; then
    validate_python "$COLLECTOR_PYTHON"
    printf '%s\n' "$COLLECTOR_PYTHON"
    return 0
  fi

  for candidate in \
    "$HOME/miniforge3/envs/py312/bin/python" \
    "$HOME/miniforge3/bin/python" \
    python3 \
    python
  do
    if [ -x "$candidate" ] || command -v "$candidate" >/dev/null 2>&1; then
      if validate_python "$candidate" >/dev/null 2>&1; then
        command -v "$candidate" 2>/dev/null || printf '%s\n' "$candidate"
        return 0
      fi
    fi
  done

  echo "No supported Python found for MinerU. Set COLLECTOR_PYTHON to Python >=3.10,<3.14." >&2
  return 1
}

python_bin="$(resolve_python)"
mkdir -p "$(dirname "$venv_dir")"

if [ ! -x "$venv_dir/bin/python" ]; then
  "$python_bin" -m venv "$venv_dir"
fi

venv_python="$venv_dir/bin/python"

"$venv_python" -m pip install -U pip
if [ "$backend" = "vlm-http-client" ]; then
  "$venv_python" -m pip install -U mineru
else
  "$venv_python" -m pip install -U "mineru[pipeline]" six
  "$venv_python" - <<'PY'
import six
PY
fi

"$venv_mineru" --version
echo "MinerU installed in isolated Collector venv: $venv_dir"
