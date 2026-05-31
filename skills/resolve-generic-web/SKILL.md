---
name: resolve-generic-web
kind: resolve
description: Fallback handler for generic web URLs
entry_conditions: {}
---

# Resolve Generic Web

This is the fallback Skill for URLs that don't match any specific platform.

## Steps

1. **Fetch the page**:
   - Call `fetch_url` with the URL
   - It returns title, final URL, Markdown content, plain text, artifact markers, artifactRefs, and media links

2. **Preserve source material**:
   - Treat generic web URLs as model-driven archiving tasks, not short summarization tasks
   - Use the fetched Markdown/media/table data as the source of truth
   - Preserve the page's headings, sections, structured data, important tables, artifact markers, examples, media, and source links from the fetched Markdown in your final `contentMarkdown`
   - Do not omit key numbers, comparison matrices, example text, code blocks, lists, or tables when they are central to the page
   - Follow the source page's information structure and media placement as closely as Markdown allows
   - Use Markdown tables only for content that is truly tabular or matrix-like in the source
   - For showcase cards, media examples, product sections, timelines, or repeated content blocks, prefer headings/lists that mirror the source layout instead of forcing them into tables
   - When fetched Markdown contains `[[artifact:id]]`, keep source content markers at the position where that media belongs
   - If the media belongs to normal prose, place the marker on a standalone line
   - If the media belongs to a table cell, keep the marker inside that same Markdown table row and cell; never split one logical table row across multiple lines
   - For every retained image marker, add nearby Markdown that explains what the image shows
   - If the image contains readable text, transcribe the original image text as far as the tools allow

3. **Process content**:
   - Produce a concise summary
   - Then produce structured Markdown that follows the source page closely and is authored by you from the fetched tool output
   - Clean navigation, duplicated boilerplate, and purely decorative content if obvious
   - If a page is too long, keep the main article structure and representative data instead of collapsing it to a paragraph

## Output

Produce a structured article with:
- Title from the page
- `summary`: one paragraph
- `contentMarkdown` with this structure:
  - `# <title>`
  - `## 摘要`
  - `## 原文整理`
  - `## 来源`
- Main content from the source page, cleaned and structured under `原文整理`
- Artifact markers such as `[[artifact:art_001]]` for images, audio, video, or files when present
- Matching `artifactRefs` entries for every artifact marker kept in `contentMarkdown`
- A description and original text transcription for every retained image artifact
- Tables, comparison matrices, and other genuinely tabular data as standard Markdown tables when present
- For reliable Feishu rendering, keep normal prose artifact markers as standalone lines, and keep table artifact markers inside the correct table cell
- Tables must be valid standard pipe tables with a header separator row, and every body row must have the same number of cells as the header
- If a source section cannot be represented as a valid Markdown table without distorting the original layout, do not use a table; use subsections or lists instead
- Source URL under `来源`
- Tags based on content topic
