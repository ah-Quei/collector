---
name: modality-image-transcribe
kind: modality
description: Extract text content from images (OCR)
entry_conditions:
  content_type: image
---

# Modality: Image Transcribe

This Skill handles image inputs when the model does NOT have vision capability.

## Steps

1. **Locate the image file**:
   - Use the image path from the input, `opencli_run` output, or `list_asset_directory`
   - Use a concrete image file path, not a directory path

2. **Run OCR**:
   - Use `bash` to run an OCR command:
     ```bash
     tesseract <image_path> stdout 2>/dev/null
     ```
   - Or use any other OCR tool available in the environment

3. **Process extracted text**:
   - Clean up the OCR output
   - Structure the extracted information
   - When the final article includes the image, describe what the image shows and preserve the original extracted text as far as the OCR result allows

## Notes

- If the model HAS vision capability, this Skill should NOT be used
- Instead, the model should analyze images directly after loading them with `read_image_asset`
