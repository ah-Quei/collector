---
name: resolve-wechat-official
kind: resolve
description: Extract and process WeChat Official Account articles
entry_conditions:
  url_domains:
    - mp.weixin.qq.com
---

# Resolve WeChat Official Account

Use this Skill for WeChat Official Account article URLs from `mp.weixin.qq.com`.

## Steps

1. **Download the article with OpenCLI (mandatory)**:
   - Call `opencli_run` with args `["weixin", "download", "--url", "<URL>"]`
   - Do not use `fetch_url` as the source of truth for WeChat articles. Direct web fetches often return an environment verification page instead of the article body.
   - The command saves Markdown and images under the current job directory, usually below `weixin-articles/`.
   - The `opencli_run` result includes a recursive `Job asset files` listing. Use paths from that listing exactly as job-relative paths.

2. **Read the downloaded Markdown (mandatory)**:
   - Find the downloaded `.md` file from `Job asset files`.
   - Call `read_text_asset` with the exact job-relative Markdown path.
   - Use the downloaded Markdown as the source of truth for title, author, publish time, body, links, and image references.

3. **Inspect images when they carry content**:
   - If the downloaded article has images that contain charts, screenshots, tables, formulas, diagrams, or text-heavy content, call `read_image_asset` with each concrete job-relative image path.
   - Do not call `read_image_asset` with a directory path.
   - Decorative account headers, QR codes, and purely ornamental images can be omitted from the final article.

4. **Handle failure explicitly**:
   - If `opencli_run` fails, state the failure in `qualityNotes`.
   - Do not replace the article body with a WeChat verification page.

## Output

Produce a structured article with:
- Title from the downloaded article
- Summary (one paragraph)
- Faithful article content based on the downloaded Markdown
- Author and publish time when available
- Source URL
- Tags: `wechat` plus content-related tags

Use this structure:

```markdown
# <title>

## 摘要
<one concise paragraph>

## 原文整理
<clean and preserve the article's main headings, argument flow, lists, formulas, examples, and important links>

## 来源
- 作者: <author if available>
- 发布时间: <publish time if available>
- 原文链接: <URL>
```

Rules:
- Preserve the article's real structure. Do not collapse a long article into a short abstract.
- Keep important numbered lists, equations, tables, citations, and technical terminology intact.
- Include useful downloaded images as `artifactRefs` and keep their markers where the evidence belongs.
- If a downloaded image is referenced by the article but not useful for understanding the content, it does not need to be included.
