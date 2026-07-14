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
   - Run the preinstalled helper script directly with `bash`. It already exists in the Skill directory — do NOT create, write, or save any file yourself.

   ```bash
   python3 "$HOME/.collector/skills/modality-pdf-parse/scripts/mineru-remote-parse.py" "<pdf-path>" "mineru-output"
   ```

   - Pass the PDF path (relative to the job asset directory or absolute) and an output directory such as `mineru-output`.
   - The script prints progress to stderr and, on success, prints the absolute path of the generated `full.md` to stdout as the final line.
   - On failure it prints the reason to stderr and exits non-zero. Produce a blocked output with the stderr text and set `needsReview` to true.
   - Do NOT invent or call any `write_text_asset` / `write_file` / similar tool. The only tools available are `bash`, `list_asset_directory`, `read_text_asset`, `read_image_asset`, `fetch_url`, `opencli_run`, `get_skill_detail`, and `submit_output`. Writing files is done through `bash` only, and this Skill does not require writing any file.

4. **Read parsed Markdown**:
   - Take the `full.md` path printed on stdout by the script.
   - Read it with `read_text_asset` using the path relative to the job asset directory (strip the job root prefix from the absolute path the script prints). Example: if the script prints `/home/.../data/<knowledgeId>/mineru-output/full.md`, the `read_text_asset` path is `mineru-output/full.md`.
   - Images extracted by MinerU live next to `full.md` in an `images/` directory and are referenced from the Markdown as `![](images/<hash>.jpg)`. These paths are **relative to `full.md`'s directory (the output dir, e.g. `mineru-output/`)**, NOT to the job root.

5. **Build artifactRefs with correct job-relative paths** (IMPORTANT — getting this wrong causes publish-time ENOENT):
   - Call `list_asset_directory` with `path: "mineru-output"` and `recursive: true` to get the exact job-relative paths of every extracted image (they will look like `mineru-output/images/<hash>.jpg`).
   - When you convert a Markdown `![](images/<hash>.jpg)` into an artifact marker `[[artifact:<id>]]`, the matching `artifactRefs[].path` MUST be the job-relative path from that listing — i.e. `mineru-output/images/<hash>.jpg`, **with the `mineru-output/` prefix**. NEVER submit `images/<hash>.jpg` alone, because that resolves to `<dataDir>/<knowledgeId>/images/<hash>.jpg` which does not exist; the real file is under `mineru-output/`.
   - Paths in `artifactRefs` must be relative to the job directory and must NOT start with `/` or contain the knowledge id / storage data directory.

6. **Produce the article**:
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
