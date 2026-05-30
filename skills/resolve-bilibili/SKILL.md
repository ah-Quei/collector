---
name: resolve-bilibili
kind: resolve
description: Extract and process content from Bilibili videos
entry_conditions:
  url_domains:
    - bilibili.com
    - b23.tv
---

# Resolve Bilibili

## Steps

1. **Expand short link** (if URL is from b23.tv):
   - Call `fetch_url` with the short URL to get the redirect target

2. **Get video metadata**:
   - Call `opencli_run` with args `["bilibili", "video", "<BV_ID>"]`
   - Extract BV ID from the URL path
   - Returns: title, description, UP主 (uploader), view/like/coin counts

3. **Download video/audio**:
   - Call `opencli_run` with args `["bilibili", "download", "<BV_ID>"]`
   - Saves to the job asset directory

4. **Extract subtitles/transcript**:
   - Check if subtitles are available via `opencli_run` with args `["bilibili", "subtitle", "<BV_ID>"]`
   - If subtitles exist, use them directly
   - If not, use the modality-video-transcribe Skill to transcribe audio

## Output

Produce a structured article with:
- Title from the video
- Summary (one paragraph)
- Full transcript/content
- UP主 name
- Source URL
- Tags: ["bilibili"] + content-related tags
