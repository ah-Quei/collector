---
name: modality-pdf-parse
kind: modality
description: Parse PDF files into Markdown with the MinerU official remote API (mineru.net), uploading local PDFs and polling until parsing completes
entry_conditions:
  content_type: file
---

# Modality: PDF Parse

Use this Skill for PDF files. It parses PDFs through the **MinerU official hosted API** at `https://mineru.net/api/v4` using a single API token. No local MinerU installation, Python venv, or OpenAI-compatible vision model is required — all parsing happens on MinerU's servers.

## Required human configuration

Before parsing, run a configuration check with `bash`. If the required token is missing, stop and produce a blocked output that explains exactly how to configure it.

Required:

```
MINERU_API_TOKEN    # API token from https://mineru.net/user-center/api-token (starts with "sk-")
```

Optional:

```
MINERU_API_BASE_URL      # default: https://mineru.net/api/v4
MINERU_MODEL_VERSION     # vlm (default, recommended) or pipeline
MINERU_LANGUAGE          # default: ch
MINERU_ENABLE_OCR        # true/false, default false (set true for scanned PDFs)
MINERU_PAGE_RANGES       # e.g. "1-10,15,20-30"; empty = whole document
MINERU_EXTRACT_TIMEOUT   # total polling seconds, default 1800
```

These variables are configured via `collector init` or `collector skills configure modality-pdf-parse` and stored in `~/.collector/config.yaml`. They are injected into the `bash` tool environment at runtime.

Validation command:

```bash
missing=0
if [ -z "${MINERU_API_TOKEN:-}" ]; then
  printf 'Missing required environment variable: MINERU_API_TOKEN\n' >&2
  printf 'Get a token at https://mineru.net/user-center/api-token and run: collector skills configure modality-pdf-parse\n' >&2
  missing=1
fi
case "${MINERU_MODEL_VERSION:-vlm}" in
  vlm|pipeline) ;;
  *)
    printf 'Invalid MINERU_MODEL_VERSION: %s. Use vlm or pipeline.\n' "${MINERU_MODEL_VERSION:-vlm}" >&2
    missing=1
    ;;
esac
exit "$missing"
```

## Runtime dependencies

Only standard CLI tools are needed: `curl`, `python3`, and `unzip`. They are part of Collector's base requirements. Verify with:

```bash
for bin in curl python3 unzip; do command -v "$bin" >/dev/null 2>&1 || { echo "missing: $bin" >&2; exit 1; }; done
```

If any are missing, produce a blocked output telling the human to install them. Do not attempt to install MinerU or any Python package at runtime.

## Steps

1. **Locate the PDF file**:
   - Use `list_asset_directory` with `recursive: true`.
   - Select a concrete `.pdf` file path inside the job asset directory.
   - If there is no PDF file, stop and report that this Skill only handles PDF files.

2. **Check configuration**:
   - Run the validation command above.
   - If it fails, do not parse. Produce a blocked output with the missing variables and the exact steps the human should run.

3. **Parse the PDF with the MinerU remote API**:
   - Save the helper script below to `/tmp/mineru-remote-parse.py`.
   - Run it from the job asset directory, passing the PDF path (relative or absolute) and an output directory such as `mineru-output`:

   ```bash
   python3 /tmp/mineru-remote-parse.py "<pdf-path>" "mineru-output"
   ```

   - The script prints progress to stderr and, on success, prints the absolute path of the generated `full.md` to stdout as the final line.
   - On failure it prints the reason to stderr and exits non-zero. Produce a blocked output with the stderr text and set `needsReview` to true.

   Helper script:

   ```python
   #!/usr/bin/env python3
   import json, os, sys, time, urllib.request, urllib.error, zipfile

   TOKEN = os.environ.get("MINERU_API_TOKEN", "")
   BASE = os.environ.get("MINERU_API_BASE_URL", "https://mineru.net/api/v4").rstrip("/")
   MODEL = os.environ.get("MINERU_MODEL_VERSION", "vlm")
   LANGUAGE = os.environ.get("MINERU_LANGUAGE", "ch")
   ENABLE_OCR = os.environ.get("MINERU_ENABLE_OCR", "").lower() in ("1", "true", "yes", "on")
   PAGE_RANGES = os.environ.get("MINERU_PAGE_RANGES", "").strip()
   TIMEOUT = int(os.environ.get("MINERU_EXTRACT_TIMEOUT", "1800"))

   def die(msg, code=1):
       print(msg, file=sys.stderr); sys.exit(code)

   def req(method, path, body=None, raw=None):
       data = None
       headers = {"Authorization": f"Bearer {TOKEN}"}
       if body is not None:
           data = json.dumps(body).encode(); headers["Content-Type"] = "application/json"
       elif raw is not None:
           data = raw
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
       f = {"model_version": MODEL, "is_ocr": ENABLE_OCR,
            "enable_formula": True, "enable_table": True, "language": LANGUAGE}
       if PAGE_RANGES: f["page_ranges"] = PAGE_RANGES
       return f

   def poll_task(task_id):
       deadline = time.time() + TIMEOUT
       while time.time() < deadline:
           r = req("GET", f"/extract/task/{task_id}")
           d = r.get("data", {})
           state = d.get("state", "?")
           print(f"  task {task_id[:8]} state={state}", file=sys.stderr)
           if state == "done": return d.get("full_zip_url", "")
           if state == "failed": die(f"task failed: {d.get('err_msg','')}")
           time.sleep(10)
       die("task polling timed out")

   def poll_batch(batch_id):
       deadline = time.time() + TIMEOUT
       while time.time() < deadline:
           r = req("GET", f"/extract-results/batch/{batch_id}")
           items = r.get("data", {}).get("extract_result", [])
           states = [it.get("state") for it in items]
           print(f"  batch {batch_id[:8]} states={states}", file=sys.stderr)
           if items:
               it = items[0]
               if it.get("state") == "done": return it.get("full_zip_url", "")
               if it.get("state") == "failed": die(f"batch file failed: {it.get('err_msg','')}")
           time.sleep(10)
       die("batch polling timed out")

   def put_upload(url, path):
       import subprocess
       # IMPORTANT: use curl with an empty Content-Type header. OSS presigned PUT
       # signatures break if a Content-Type is sent; curl's -H "Content-Type:" clears
       # the default it would otherwise add for --data-binary.
       res = subprocess.run(
           ["curl", "-sS", "-o", "/dev/null", "-w", "%{http_code}",
            "-X", "PUT", "--data-binary", f"@{path}", "-H", "Content-Type:", url],
           capture_output=True, text=True)
       code = res.stdout.strip()
       if code != "200":
           die(f"upload PUT failed HTTP {code}: {res.stderr[:300]}")
       return 200

   def main():
       if not TOKEN: die("MINERU_API_TOKEN is not set")
       if len(sys.argv) < 3: die("usage: mineru-remote-parse.py <pdf-path-or-url> <output-dir>")
       src, out = sys.argv[1], sys.argv[2]
       is_url = src.startswith("http://") or src.startswith("https://")
       print(f"== MinerU remote parse: {src} -> {out} ==", file=sys.stderr)

       if is_url:
           body = {"url": src, "data_id": f"collector-{int(time.time())}", **common_fields()}
           r = req("POST", "/extract/task", body)
           if r.get("code") != 0: die(f"submit failed: {r.get('msg')} {r.get('data','')}")
           zip_url = poll_task(r["data"]["task_id"])
       else:
           if not os.path.isfile(src): die(f"file not found: {src}")
           name = os.path.basename(src)
           body = {"files": [{"name": name, "data_id": f"collector-{int(time.time())}"}], **common_fields()}
           r = req("POST", "/file-urls/batch", body)
           if r.get("code") != 0: die(f"apply upload url failed: {r.get('msg')} {r.get('data','')}")
           d = r["data"]; batch_id, urls = d["batch_id"], d["file_urls"]
           if not urls: die("no upload url returned")
           print(f"  uploading {name} ({os.path.getsize(src)} bytes)", file=sys.stderr)
           put_upload(urls[0], src)
           zip_url = poll_batch(batch_id)

       if not zip_url: die("no full_zip_url in result")
       os.makedirs(out, exist_ok=True)
       tmp_zip = os.path.join(out, "mineru-result.zip")
       print(f"  downloading result zip", file=sys.stderr)
       urllib.request.urlretrieve(zip_url, tmp_zip)
       with zipfile.ZipFile(tmp_zip) as z: z.extractall(out)
       os.remove(tmp_zip)

       full_md = None
       for root, _, files in os.walk(out):
           if "full.md" in files: full_md = os.path.join(root, "full.md"); break
       if not full_md: die(f"full.md not found in {out}")
       print(f"  done: {full_md}", file=sys.stderr)
       print(os.path.abspath(full_md))

   if __name__ == "__main__": main()
   ```

4. **Read parsed Markdown**:
   - Take the `full.md` path printed on stdout by the script.
   - Read it with `read_text_asset` (or `read` if absolute).
   - Images extracted by MinerU live next to `full.md` in an `images/` directory and are referenced from the Markdown. They are extracted content; describe them inline where useful.

5. **Produce the article**:
   - Use the MinerU Markdown as the source of truth.
   - Preserve headings, tables, formulas, image placeholders, and page-derived structure when useful.
   - Include the original PDF filename in the source section.
   - If the task reported `failed`, the script exited non-zero, or content looks truncated, set `needsReview` to true and explain this in `qualityNotes`.

## Blocked output requirements

When blocked by missing token, missing runtime tools, invalid configuration, network/API failure, or parse failure:

- Do not invent PDF content.
- Set `needsReview` to true and confidence low.
- In `summary`, state that PDF parsing could not run.
- In `contentMarkdown`, include:
  - the blocked reason
  - missing environment variables or failed command stderr
  - exact commands the human should run (e.g. `collector skills configure modality-pdf-parse`)
- In `qualityNotes`, include the relevant stderr or diagnostic text.
