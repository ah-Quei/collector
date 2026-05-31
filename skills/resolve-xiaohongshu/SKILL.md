---
name: resolve-xiaohongshu
kind: resolve
description: Extract and process content from Xiaohongshu (Little Red Book) notes
entry_conditions:
  url_domains:
    - xiaohongshu.com
    - xhslink.com
    - xhs.link
---

# Resolve Xiaohongshu

## Steps

1. **Expand short link** (if URL is from xhslink.com or xhs.link):
   - Call `fetch_url` with the short URL to get the redirect target
   - Extract the full Xiaohongshu note URL (contains xsec_token)

2. **Get note metadata**:
   - Call `opencli_run` with args `["xiaohongshu", "note", "<full_url>", "--format", "json"]`
   - This returns: title, body text, author, likes, comments count

3. **Download images (mandatory)**:
   - Call `opencli_run` with args `["xiaohongshu", "download", "<full_url>", "--output", "xiaohongshu-downloads", "--format", "json"]`
   - Images are saved to the job asset directory under `xiaohongshu-downloads/`
   - The `opencli_run` result includes a recursive `Job asset files` listing; use that listing to find concrete image paths.
   - Do not produce the final answer before this step has either succeeded or clearly failed

4. **Process images (mandatory when download succeeds)**:
   - If `read_image_asset` is available: for every downloaded image that may contain content, call it with the exact file path from `Job asset files`
   - Do not call `read_image_asset` with a directory path
   - If `read_image_asset` is not available: use `bash` to run OCR commands against the concrete image paths
   - Do not ignore image text. For Xiaohongshu notes, images often contain the main content.
   - For every downloaded image kept in the article, include its artifact marker and explain what the image shows.
   - If an image contains readable text, transcribe the original image text as far as the tools allow.

5. **Get comments** (optional):
   - Call `opencli_run` with args `["xiaohongshu", "comments", "<full_url>"]`
   - Only if the comment section contains supplementary information

## Output

Produce a structured article with:
- Title from the note
- Summary (one paragraph)
- Full content (body text + image text/descriptions)
- Author name
- Source URL
- Tags: ["xiaohongshu"] + content-related tags

Use this structure:

```markdown
# <title>

## 摘要
<one concise paragraph>

## 原文整理
### 笔记正文
<preserve the author's original body text in a cleaned but faithful form>

### 图片内容
<for each useful downloaded image, include its artifact marker, describe the image content, and transcribe the original image text; if images contain a job description, interview list, chart, screenshot, or handwritten note, keep that structure>

### 评论补充
<only include if comments were fetched and add useful information>

## 来源
- 作者: <author>
- 原文链接: <canonical URL>
```

Rules:
- Keep the author's rough interview notes as notes; do not over-invent headings or turn every sentence into a separate category.
- If image download or image reading fails, state that in `qualityNotes` and do not pretend image content was inspected.
- Include image artifacts in `artifactRefs` when downloaded images are useful evidence for the article.
- Do not summarize away image text. Preserve the original image wording where it is readable, then add any cleaned structure or explanation separately.
