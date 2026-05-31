#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${COLLECTOR_RELEASE_OUT_DIR:-$ROOT_DIR/release}"
PACKAGE_SKILLS="${COLLECTOR_PACKAGE_SKILLS:-1}"

detect_os() {
    if [ -n "${COLLECTOR_RELEASE_OS:-}" ]; then
        printf '%s' "$COLLECTOR_RELEASE_OS"
        return
    fi

    case "$(uname -s)" in
        Darwin) printf 'darwin' ;;
        Linux) printf 'linux' ;;
        *) printf 'unsupported' ;;
    esac
}

detect_arch() {
    if [ -n "${COLLECTOR_RELEASE_ARCH:-}" ]; then
        printf '%s' "$COLLECTOR_RELEASE_ARCH"
        return
    fi

    case "$(uname -m)" in
        arm64|aarch64) printf 'arm64' ;;
        x86_64|amd64) printf 'x64' ;;
        *) printf 'unsupported' ;;
    esac
}

fail() {
    printf 'collector package: %s\n' "$*" >&2
    exit 1
}

OS="$(detect_os)"
ARCH="$(detect_arch)"
[ "$OS" != "unsupported" ] || fail "unsupported operating system"
[ "$ARCH" != "unsupported" ] || fail "unsupported CPU architecture"

TARGET="collector-$OS-$ARCH"
WORK_DIR="$OUT_DIR/work/$TARGET"
BUNDLE_DIR="$WORK_DIR/$TARGET"

rm -rf "$WORK_DIR"
mkdir -p "$BUNDLE_DIR" "$OUT_DIR"

if [ ! -d "$ROOT_DIR/dist" ]; then
    fail "dist directory not found; run npm run build before packaging"
fi

cp "$ROOT_DIR/package.json" "$ROOT_DIR/package-lock.json" "$BUNDLE_DIR/"
cp -R "$ROOT_DIR/dist" "$BUNDLE_DIR/dist"

(
    cd "$BUNDLE_DIR"
    npm ci --omit=dev
)

cat > "$BUNDLE_DIR/collector" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
exec node "$DIR/dist/cli.js" "$@"
EOF
chmod +x "$BUNDLE_DIR/collector"

tar -czf "$OUT_DIR/$TARGET.tar.gz" -C "$WORK_DIR" "$TARGET"
printf 'Wrote %s\n' "$OUT_DIR/$TARGET.tar.gz"

if [ "$PACKAGE_SKILLS" != "0" ]; then
    tar -czf "$OUT_DIR/collector-skills.tar.gz" -C "$ROOT_DIR" skills
    printf 'Wrote %s\n' "$OUT_DIR/collector-skills.tar.gz"
fi
