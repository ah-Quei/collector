---
name: modality-pdf-parse
kind: modality
description: Parse PDF files into Markdown with MinerU using remote VLM backends, preferring hybrid-http-client and falling back to vlm-http-client for low-resource machines
entry_conditions:
  content_type: file
---

# Modality: PDF Parse

Use this Skill for PDF files. It parses PDFs with MinerU and a remote OpenAI-compatible vision model.

## Backend choice

- Default to `hybrid-http-client` for best quality when the machine has enough RAM.
- Use `vlm-http-client` when `COLLECTOR_PDF_MINERU_BACKEND=vlm-http-client` is set or when the machine is too weak for local pipeline work.
- Do not use `pipeline`, `hybrid-auto-engine`, or `vlm-auto-engine` in this Skill.

## Required human configuration

Before parsing, run a configuration check with `bash`. If any required variable is missing, stop and produce a blocked output that explains exactly how to configure it.

Required:

```bash
export MINERU_VL_BASE_URL="https://api.openai.com/v1"
export MINERU_VL_API_KEY="<api-key>"
export MINERU_VL_MODEL_NAME="<vision-model-id>"
```

Optional:

```bash
export COLLECTOR_PDF_MINERU_BACKEND="hybrid-http-client"  # or vlm-http-client
export MINERU_HYBRID_BATCH_RATIO="1"                     # lower local batch pressure for hybrid-http-client
```

Validation command:

```bash
missing=0
for name in MINERU_VL_BASE_URL MINERU_VL_API_KEY MINERU_VL_MODEL_NAME; do
  value="$(eval "printf '%s' \"\${$name:-}\"")"
  if [ -z "$value" ]; then
    printf 'Missing required environment variable: %s\n' "$name" >&2
    missing=1
  fi
done
backend="${COLLECTOR_PDF_MINERU_BACKEND:-hybrid-http-client}"
case "$backend" in
  hybrid-http-client|vlm-http-client) ;;
  *)
    printf 'Invalid COLLECTOR_PDF_MINERU_BACKEND: %s. Use hybrid-http-client or vlm-http-client.\n' "$backend" >&2
    missing=1
    ;;
esac
exit "$missing"
```

## Install MinerU

If `mineru` is not available, install it with `bash`. Use the backend-specific install command.

For the default `hybrid-http-client`:

```bash
python3 -m pip install -U "mineru[pipeline]"
```

For low-resource `vlm-http-client` only:

```bash
python3 -m pip install -U mineru
```

After installation, verify:

```bash
mineru --version
```

If installation or verification fails, produce a blocked output with the command stderr and tell the human to install MinerU in the Collector runtime environment.

## Steps

1. **Locate the PDF file**:
   - Use `list_asset_directory` with `recursive: true`.
   - Select a concrete `.pdf` file path inside the job asset directory.
   - If there is no PDF file, stop and report that this Skill only handles PDF files.

2. **Check configuration**:
   - Run the validation command above.
   - If it fails, do not parse. Produce a blocked output with the missing variables and the exact export commands the human should set.

3. **Check MinerU**:
   - Run `command -v mineru >/dev/null 2>&1`.
   - If missing, run the install command for the selected backend.
   - Verify `mineru --version`.

4. **Parse the PDF**:
   - Run MinerU from the job asset directory.
   - Use a dedicated output directory such as `mineru-output`.

   ```bash
   backend="${COLLECTOR_PDF_MINERU_BACKEND:-hybrid-http-client}"
   mineru -p "<pdf-relative-path>" -o "mineru-output" -b "$backend" -u "$MINERU_VL_BASE_URL"
   ```

5. **Find and read parsed Markdown**:
   - Use `list_asset_directory` on `mineru-output` with `recursive: true`.
   - Read the generated `.md` file with `read_text_asset`.
   - If multiple Markdown files exist, use the one under the parsed PDF's output directory that contains the main document content.

6. **Produce the article**:
   - Use the MinerU Markdown as the source of truth.
   - Preserve headings, tables, formulas, image placeholders, and page-derived structure when useful.
   - Include the original PDF filename in the source section.
   - If parsing was incomplete or MinerU reported errors, set `needsReview` to true and explain this in `qualityNotes`.

## Blocked output requirements

When blocked by missing configuration, missing credentials, unavailable MinerU, install failure, invalid backend, or parse failure:

- Do not invent PDF content.
- Set `needsReview` to true and confidence low.
- In `summary`, state that PDF parsing could not run.
- In `contentMarkdown`, include:
  - the blocked reason
  - missing environment variables or failed command
  - exact commands the human should run
- In `qualityNotes`, include the relevant stderr or diagnostic text.
