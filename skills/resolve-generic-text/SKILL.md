---
name: resolve-generic-text
kind: resolve
description: Process plain text input without any URL
entry_conditions:
  content_type: text
---

# Resolve Generic Text

This Skill handles plain text input that doesn't contain any URLs.

## Steps

1. **Analyze the text**:
   - Read the user's input text
   - Identify the main topic and key points
   - Determine if it's a note, thought, reference, or other type

2. **Structure the content**:
   - Create a clear summary
   - Organize key points
   - Preserve important details

## Output

Produce a structured article with:
- Generated title (concise, descriptive)
- Summary (one paragraph)
- Structured content (the user's text, cleaned up and organized)
- Source: "user input"
- Tags based on content topic
