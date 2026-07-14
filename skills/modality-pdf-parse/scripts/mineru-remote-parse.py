#!/usr/bin/env python3
"""MinerU remote API PDF parser for the collector modality-pdf-parse skill.

Usage:
    python3 mineru-remote-parse.py <pdf-path-or-url> <output-dir>

Environment:
    MINERU_API_TOKEN        required, token from https://mineru.net/user-center/api-token
    MINERU_API_BASE_URL     optional, default https://mineru.net/api/v4
    MINERU_MODEL_VERSION    optional, vlm (default) or pipeline
    MINERU_LANGUAGE         optional, default ch
    MINERU_ENABLE_OCR       optional, true/false, default false
    MINERU_PAGE_RANGES      optional, e.g. "1-10,15,20-30"
    MINERU_EXTRACT_TIMEOUT  optional, total polling seconds, default 1800

Behavior:
    - If <pdf-path-or-url> starts with http(s)://, submits via /extract/task and polls that task.
    - Otherwise treats it as a local file: applies for an upload URL via /file-urls/batch,
      uploads via curl PUT (no Content-Type, to satisfy OSS presigned signature), then polls the batch.
    - Downloads the result zip, extracts it into <output-dir>, and prints the absolute path
      of full.md to stdout as the final line. Progress and errors go to stderr.
    - Exits non-zero on any failure.
"""
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
import zipfile
from typing import NoReturn

TOKEN = os.environ.get("MINERU_API_TOKEN", "")
BASE = os.environ.get("MINERU_API_BASE_URL", "https://mineru.net/api/v4").rstrip("/")
MODEL = os.environ.get("MINERU_MODEL_VERSION", "vlm")
LANGUAGE = os.environ.get("MINERU_LANGUAGE", "ch")
ENABLE_OCR = os.environ.get("MINERU_ENABLE_OCR", "").lower() in ("1", "true", "yes", "on")
PAGE_RANGES = os.environ.get("MINERU_PAGE_RANGES", "").strip()
TIMEOUT = int(os.environ.get("MINERU_EXTRACT_TIMEOUT", "1800"))


def die(msg: str, code: int = 1) -> NoReturn:
    print(msg, file=sys.stderr)
    sys.exit(code)


def req(method: str, path: str, body=None) -> dict:
    data = None
    headers = {"Authorization": f"Bearer {TOKEN}"}
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    r = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=120) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body_text = e.read().decode(errors="replace")
        die(f"HTTP {e.code} for {method} {path}: {body_text[:500]}")
    except urllib.error.URLError as e:
        die(f"network error for {method} {path}: {e}")


def common_fields():
    f = {
        "model_version": MODEL,
        "is_ocr": ENABLE_OCR,
        "enable_formula": True,
        "enable_table": True,
        "language": LANGUAGE,
    }
    if PAGE_RANGES:
        f["page_ranges"] = PAGE_RANGES
    return f


def poll_task(task_id: str) -> str:
    deadline = time.time() + TIMEOUT
    while time.time() < deadline:
        r = req("GET", f"/extract/task/{task_id}")
        d = r.get("data", {})
        state = d.get("state", "?")
        print(f"  task {task_id[:8]} state={state}", file=sys.stderr)
        if state == "done":
            return d.get("full_zip_url", "")
        if state == "failed":
            die(f"task failed: {d.get('err_msg', '')}")
        time.sleep(10)
    die("task polling timed out")


def poll_batch(batch_id: str) -> str:
    deadline = time.time() + TIMEOUT
    while time.time() < deadline:
        r = req("GET", f"/extract-results/batch/{batch_id}")
        items = r.get("data", {}).get("extract_result", [])
        states = [it.get("state") for it in items]
        print(f"  batch {batch_id[:8]} states={states}", file=sys.stderr)
        if items:
            it = items[0]
            if it.get("state") == "done":
                return it.get("full_zip_url", "")
            if it.get("state") == "failed":
                die(f"batch file failed: {it.get('err_msg', '')}")
        time.sleep(10)
    die("batch polling timed out")


def put_upload(url: str, path: str) -> int:
    # IMPORTANT: use curl with an empty Content-Type header. OSS presigned PUT
    # signatures break if a Content-Type is sent; curl's -H "Content-Type:" clears
    # the default it would otherwise add for --data-binary.
    res = subprocess.run(
        [
            "curl", "-sS", "-o", "/dev/null", "-w", "%{http_code}",
            "-X", "PUT", "--data-binary", f"@{path}", "-H", "Content-Type:", url,
        ],
        capture_output=True,
        text=True,
    )
    code = res.stdout.strip()
    if code != "200":
        die(f"upload PUT failed HTTP {code}: {res.stderr[:300]}")
    return 200


def main() -> None:
    if not TOKEN:
        die("MINERU_API_TOKEN is not set")
    if len(sys.argv) < 3:
        die("usage: mineru-remote-parse.py <pdf-path-or-url> <output-dir>")
    src, out = sys.argv[1], sys.argv[2]
    is_url = src.startswith("http://") or src.startswith("https://")
    print(f"== MinerU remote parse: {src} -> {out} ==", file=sys.stderr)

    if is_url:
        body = {"url": src, "data_id": f"collector-{int(time.time())}", **common_fields()}
        r = req("POST", "/extract/task", body)
        if r.get("code") != 0:
            die(f"submit failed: {r.get('msg')} {r.get('data', '')}")
        zip_url = poll_task(r["data"]["task_id"])
    else:
        if not os.path.isfile(src):
            die(f"file not found: {src}")
        name = os.path.basename(src)
        body = {
            "files": [{"name": name, "data_id": f"collector-{int(time.time())}"}],
            **common_fields(),
        }
        r = req("POST", "/file-urls/batch", body)
        if r.get("code") != 0:
            die(f"apply upload url failed: {r.get('msg')} {r.get('data', '')}")
        d = r["data"]
        batch_id, urls = d["batch_id"], d["file_urls"]
        if not urls:
            die("no upload url returned")
        print(f"  uploading {name} ({os.path.getsize(src)} bytes)", file=sys.stderr)
        put_upload(urls[0], src)
        zip_url = poll_batch(batch_id)

    if not zip_url:
        die("no full_zip_url in result")
    os.makedirs(out, exist_ok=True)
    tmp_zip = os.path.join(out, "mineru-result.zip")
    print("  downloading result zip", file=sys.stderr)
    urllib.request.urlretrieve(zip_url, tmp_zip)
    with zipfile.ZipFile(tmp_zip) as z:
        z.extractall(out)
    os.remove(tmp_zip)

    full_md = None
    for root, _, files in os.walk(out):
        if "full.md" in files:
            full_md = os.path.join(root, "full.md")
            break
    if not full_md:
        die(f"full.md not found in {out}")
    print(f"  done: {full_md}", file=sys.stderr)
    print(os.path.abspath(full_md))


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001 - surface any failure as clean stderr
        die(f"unexpected error: {e}")
