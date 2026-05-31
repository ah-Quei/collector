#!/usr/bin/env bash
set -euo pipefail

DEFAULT_REPO="ah-Quei/collector"
REPO="${COLLECTOR_REPO:-$DEFAULT_REPO}"
VERSION="${COLLECTOR_VERSION:-latest}"
INSTALL_DIR="${COLLECTOR_INSTALL_DIR:-$HOME/.local/bin}"
APP_DIR="${COLLECTOR_APP_DIR:-$HOME/.local/lib/collector}"
SKILLS_DIR="${COLLECTOR_SKILLS_DIR:-$HOME/.collector/skills}"
SKILLS_STRATEGY="${COLLECTOR_SKILLS_STRATEGY:-incoming}"
RELEASE_BASE_URL="${COLLECTOR_RELEASE_BASE_URL:-}"
INSTALL_EXTERNAL_TOOLS="${COLLECTOR_INSTALL_EXTERNAL_TOOLS:-1}"

log() {
    printf '%s\n' "$*"
}

fail() {
    printf 'collector install: %s\n' "$*" >&2
    exit 1
}

need_cmd() {
    command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

normalize_version() {
    printf '%s' "$1" | sed 's/^v//'
}

detect_os() {
    if [ -n "${COLLECTOR_OS:-}" ]; then
        printf '%s' "$COLLECTOR_OS"
        return
    fi

    case "$(uname -s)" in
        Darwin) printf 'darwin' ;;
        Linux) printf 'linux' ;;
        *) fail "unsupported operating system: $(uname -s)" ;;
    esac
}

detect_arch() {
    if [ -n "${COLLECTOR_ARCH:-}" ]; then
        printf '%s' "$COLLECTOR_ARCH"
        return
    fi

    case "$(uname -m)" in
        arm64|aarch64) printf 'arm64' ;;
        x86_64|amd64) printf 'x64' ;;
        *) fail "unsupported CPU architecture: $(uname -m)" ;;
    esac
}

resolve_version() {
    if [ "$VERSION" != "latest" ]; then
        printf '%s' "$VERSION"
        return
    fi

    curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
        | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
        | head -n 1
}

asset_url() {
    asset="$1"
    if [ -n "$RELEASE_BASE_URL" ]; then
        printf '%s/%s' "${RELEASE_BASE_URL%/}" "$asset"
    else
        printf 'https://github.com/%s/releases/download/%s/%s' "$REPO" "$RESOLVED_VERSION" "$asset"
    fi
}

download_asset() {
    asset="$1"
    destination="$2"
    curl -fsSL "$(asset_url "$asset")" -o "$destination"
}

current_collector_version() {
    binary="$1"
    if [ ! -x "$binary" ]; then
        return 0
    fi

    "$binary" --version 2>/dev/null \
        | sed -n 's/.*\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*[^[:space:]]*\).*/\1/p' \
        | head -n 1
}

hash_file() {
    if command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$1" | awk '{print $1}'
    elif command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | awk '{print $1}'
    else
        fail "missing required command: shasum or sha256sum"
    fi
}

manifest_hash() {
    rel="$1"
    manifest="$2"
    if [ ! -f "$manifest" ]; then
        return 0
    fi

    awk -v key="\"$rel\"" '
        index($0, key) {
            line = $0
            sub(/^[^:]*:[[:space:]]*"/, "", line)
            sub(/".*$/, "", line)
            print line
            exit
        }
    ' "$manifest"
}

append_manifest_entry() {
    rel="$1"
    hash="$2"
    entries_file="$3"
    if [ -n "$hash" ]; then
        printf '%s\t%s\n' "$rel" "$hash" >> "$entries_file"
    fi
}

write_manifest() {
    version="$1"
    entries_file="$2"
    manifest="$3"
    mkdir -p "$(dirname "$manifest")"
    tmp_manifest="$manifest.tmp"

    {
        printf '{\n'
        printf '  "version": "%s",\n' "$version"
        printf '  "source": "%s",\n' "$REPO"
        printf '  "updatedAt": "%s",\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
        printf '  "files": {\n'
        first=1
        if [ -f "$entries_file" ]; then
            sort "$entries_file" | while IFS="$(printf '\t')" read -r rel hash; do
                if [ "$first" -eq 0 ]; then
                    printf ',\n'
                fi
                first=0
                printf '    "%s": "%s"' "$rel" "$hash"
            done
        fi
        printf '\n  }\n'
        printf '}\n'
    } > "$tmp_manifest"

    mv "$tmp_manifest" "$manifest"
}

find_collector_binary() {
    root="$1"
    candidate="$root/collector"
    if [ -x "$candidate" ] || [ -f "$candidate" ]; then
        printf '%s' "$candidate"
        return
    fi

    found=$(find "$root" -type f -name collector -perm -111 | head -n 1)
    if [ -n "$found" ]; then
        printf '%s' "$found"
        return
    fi

    found=$(find "$root" -type f -name collector | head -n 1)
    if [ -n "$found" ]; then
        printf '%s' "$found"
        return
    fi

    fail "release archive does not contain a collector binary"
}

shell_quote() {
    printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

is_app_bundle() {
    root="$1"
    [ -f "$root/collector" ] && [ -d "$root/dist" ] && [ -d "$root/node_modules" ]
}

write_bundle_wrapper() {
    destination="$1"
    app_dir="$2"
    quoted_app_dir="$(shell_quote "$app_dir")"

    {
        printf '#!/usr/bin/env bash\n'
        printf 'COLLECTOR_APP_DIR=%s\n' "$quoted_app_dir"
        printf 'exec "$COLLECTOR_APP_DIR/collector" "$@"\n'
    } > "$destination"
    chmod +x "$destination"
}

rollback_bundle_install() {
    binary_path="$1"
    backup_path="$2"
    app_dir="$3"
    backup_app_dir="$4"

    rm -rf "$app_dir"
    if [ -e "$backup_app_dir" ]; then
        mv "$backup_app_dir" "$app_dir"
    fi

    rm -f "$binary_path"
    if [ -e "$backup_path" ]; then
        mv "$backup_path" "$binary_path"
    fi
}

install_app_bundle() {
    release_root="$1"
    binary_path="$2"
    target_version="$3"

    need_cmd node

    backup_path="$binary_path.bak"
    backup_app_dir="$APP_DIR.bak"
    tmp_app_dir="$APP_DIR.tmp"
    tmp_wrapper="$TMPDIR/collector-wrapper"

    rm -rf "$tmp_app_dir" "$backup_app_dir"
    mkdir -p "$(dirname "$APP_DIR")" "$INSTALL_DIR"
    cp -R "$release_root" "$tmp_app_dir"
    chmod +x "$tmp_app_dir/collector"

    if [ -e "$binary_path" ]; then
        cp "$binary_path" "$backup_path"
    fi
    if [ -e "$APP_DIR" ]; then
        mv "$APP_DIR" "$backup_app_dir"
    fi

    mv "$tmp_app_dir" "$APP_DIR"
    write_bundle_wrapper "$tmp_wrapper" "$APP_DIR"
    install -m 0755 "$tmp_wrapper" "$binary_path"

    if ! "$binary_path" --version >/dev/null 2>&1; then
        rollback_bundle_install "$binary_path" "$backup_path" "$APP_DIR" "$backup_app_dir"
        fail "installed collector bundle failed to run; previous installation restored"
    fi

    verified_version="$(current_collector_version "$binary_path" || true)"
    if [ -n "$verified_version" ] && [ "$(normalize_version "$verified_version")" != "$target_version" ]; then
        rollback_bundle_install "$binary_path" "$backup_path" "$APP_DIR" "$backup_app_dir"
        fail "installed collector version $verified_version does not match requested $RESOLVED_VERSION"
    fi

    rm -rf "$backup_app_dir"
    log "Installed collector $RESOLVED_VERSION to $binary_path"
    log "Collector app bundle installed to $APP_DIR"
}

install_collector() {
    os="$1"
    arch="$2"
    binary_path="$INSTALL_DIR/collector"
    target_version="$(normalize_version "$RESOLVED_VERSION")"
    installed_version="$(current_collector_version "$binary_path" || true)"

    if [ -n "$installed_version" ] && [ "$(normalize_version "$installed_version")" = "$target_version" ]; then
        log "collector $target_version is already installed at $binary_path"
        return
    fi

    asset="collector-$os-$arch.tar.gz"
    archive="$TMPDIR/$asset"
    extract_dir="$TMPDIR/collector-bin"
    mkdir -p "$extract_dir"

    log "Downloading $asset from $REPO..."
    download_asset "$asset" "$archive"
    tar -xzf "$archive" -C "$extract_dir"

    new_binary="$(find_collector_binary "$extract_dir")"
    chmod +x "$new_binary"
    release_root="$(dirname "$new_binary")"

    if is_app_bundle "$release_root"; then
        install_app_bundle "$release_root" "$binary_path" "$target_version"
        return
    fi

    mkdir -p "$INSTALL_DIR"

    backup_path="$binary_path.bak"
    if [ -e "$binary_path" ]; then
        cp "$binary_path" "$backup_path"
    fi

    install -m 0755 "$new_binary" "$binary_path"

    if ! "$binary_path" --version >/dev/null 2>&1; then
        if [ -e "$backup_path" ]; then
            mv "$backup_path" "$binary_path"
        fi
        fail "installed collector failed to run; previous binary restored"
    fi

    verified_version="$(current_collector_version "$binary_path" || true)"
    if [ -n "$verified_version" ] && [ "$(normalize_version "$verified_version")" != "$target_version" ]; then
        if [ -e "$backup_path" ]; then
            mv "$backup_path" "$binary_path"
        fi
        fail "installed collector version $verified_version does not match requested $RESOLVED_VERSION"
    fi

    log "Installed collector $RESOLVED_VERSION to $binary_path"
}

sync_skills() {
    archive="$TMPDIR/collector-skills.tar.gz"
    extract_dir="$TMPDIR/collector-skills"
    manifest="$SKILLS_DIR/.collector-skills.json"
    entries_file="$TMPDIR/collector-skills-manifest.tsv"

    log "Downloading collector-skills.tar.gz from $REPO..."
    download_asset "collector-skills.tar.gz" "$archive"
    mkdir -p "$extract_dir" "$SKILLS_DIR"
    tar -xzf "$archive" -C "$extract_dir"

    if [ -d "$extract_dir/skills" ]; then
        src_root="$extract_dir/skills"
    else
        src_root="$extract_dir"
    fi

    : > "$entries_file"
    skill_files=$(find "$src_root" -type f -name 'SKILL.md' | sort)
    if [ -z "$skill_files" ]; then
        fail "collector-skills.tar.gz does not contain any SKILL.md files"
    fi

    added=0
    updated=0
    incoming=0
    kept=0
    overwritten=0
    backed_up=0

    while IFS= read -r src_file; do
        rel="${src_file#$src_root/}"
        dst_file="$SKILLS_DIR/$rel"
        new_hash="$(hash_file "$src_file")"
        old_hash="$(manifest_hash "$rel" "$manifest" || true)"

        if [ ! -f "$dst_file" ]; then
            mkdir -p "$(dirname "$dst_file")"
            cp "$src_file" "$dst_file"
            append_manifest_entry "$rel" "$new_hash" "$entries_file"
            added=$((added + 1))
            continue
        fi

        local_hash="$(hash_file "$dst_file")"
        if [ "$local_hash" = "$new_hash" ]; then
            append_manifest_entry "$rel" "$new_hash" "$entries_file"
            continue
        fi

        if [ -n "$old_hash" ] && [ "$local_hash" = "$old_hash" ]; then
            cp "$src_file" "$dst_file"
            append_manifest_entry "$rel" "$new_hash" "$entries_file"
            updated=$((updated + 1))
            continue
        fi

        case "$SKILLS_STRATEGY" in
            keep)
                append_manifest_entry "$rel" "$old_hash" "$entries_file"
                kept=$((kept + 1))
                ;;
            overwrite)
                cp "$src_file" "$dst_file"
                append_manifest_entry "$rel" "$new_hash" "$entries_file"
                overwritten=$((overwritten + 1))
                ;;
            backup)
                cp "$dst_file" "$dst_file.bak.$(date +%Y%m%d%H%M%S)"
                cp "$src_file" "$dst_file"
                append_manifest_entry "$rel" "$new_hash" "$entries_file"
                backed_up=$((backed_up + 1))
                ;;
            incoming)
                cp "$src_file" "$dst_file.incoming"
                append_manifest_entry "$rel" "$old_hash" "$entries_file"
                incoming=$((incoming + 1))
                ;;
            *)
                fail "invalid COLLECTOR_SKILLS_STRATEGY: $SKILLS_STRATEGY"
                ;;
        esac
    done <<EOF
$skill_files
EOF

    write_manifest "$RESOLVED_VERSION" "$entries_file" "$manifest"
    log "Skills synced to $SKILLS_DIR (added=$added updated=$updated incoming=$incoming kept=$kept overwritten=$overwritten backed_up=$backed_up)"
}

should_install_external_tools() {
    case "$INSTALL_EXTERNAL_TOOLS" in
        0|false|FALSE|no|NO) return 1 ;;
        *) return 0 ;;
    esac
}

npm_global_bin_dir() {
    prefix="$(npm prefix -g 2>/dev/null || true)"
    if [ -n "$prefix" ]; then
        printf '%s/bin' "$prefix"
    fi
}

ensure_npm_command() {
    command_name="$1"
    package_name="$2"

    if command -v "$command_name" >/dev/null 2>&1; then
        log "$command_name found: $(command -v "$command_name")"
        return
    fi

    need_cmd npm
    log "$command_name not found; installing $package_name with npm..."
    npm install -g "$package_name"

    if command -v "$command_name" >/dev/null 2>&1; then
        log "$command_name installed: $(command -v "$command_name")"
        return
    fi

    global_bin="$(npm_global_bin_dir)"
    if [ -n "$global_bin" ] && [ -x "$global_bin/$command_name" ]; then
        PATH="$global_bin:$PATH"
        export PATH
        log "$command_name installed: $global_bin/$command_name"
        log "Add $global_bin to PATH if your shell cannot find $command_name later."
        return
    fi

    fail "$package_name installed, but $command_name was not found on PATH"
}

ensure_external_tools() {
    if ! should_install_external_tools; then
        log "Skipping opencli/lark-cli checks (COLLECTOR_INSTALL_EXTERNAL_TOOLS=$INSTALL_EXTERNAL_TOOLS)"
        return
    fi

    ensure_npm_command "opencli" "@jackwener/opencli"
    ensure_npm_command "lark-cli" "@larksuite/cli"
}

print_path_hint() {
    case ":$PATH:" in
        *":$INSTALL_DIR:"*) ;;
        *)
            log "Add $INSTALL_DIR to PATH to run collector from any shell."
            log "For zsh:  echo 'export PATH=\"$INSTALL_DIR:\$PATH\"' >> ~/.zshrc"
            log "For bash: echo 'export PATH=\"$INSTALL_DIR:\$PATH\"' >> ~/.bashrc"
            ;;
    esac
}

main() {
    need_cmd curl
    need_cmd tar
    need_cmd install
    need_cmd sed
    need_cmd awk
    need_cmd find

    case "$SKILLS_STRATEGY" in
        keep|overwrite|backup|incoming) ;;
        *) fail "invalid COLLECTOR_SKILLS_STRATEGY: $SKILLS_STRATEGY" ;;
    esac

    os="$(detect_os)"
    arch="$(detect_arch)"
    RESOLVED_VERSION="$(resolve_version)"
    if [ -z "$RESOLVED_VERSION" ]; then
        fail "could not resolve collector version"
    fi

    TMPDIR="$(mktemp -d)"
    trap 'rm -rf "$TMPDIR"' EXIT

    install_collector "$os" "$arch"
    sync_skills
    ensure_external_tools
    print_path_hint
    log "Done. Next step: collector init"
}

main "$@"
