---
name: modality-audio-transcribe
kind: modality
description: Transcribe audio content to text
entry_conditions:
  content_type: audio
---

# Modality: Audio Transcribe

This Skill handles audio inputs when the model does NOT have audio understanding.

## Steps

1. **Locate the audio file**:
   - The audio file path is provided in the input
   - Use `list_directory` to find it if needed

2. **Run transcription**:
   - Use `bash` to run a speech-to-text command:
     ```bash
     whisper <audio_path> --output_format txt --output_dir /tmp
     ```
   - Or use any other transcription tool available

3. **Process transcript**:
   - Clean up the transcription
   - Add punctuation and formatting if needed
   - Structure the content

## Notes

- If the model HAS audio understanding, this Skill should NOT be used
- Instead, the model should analyze audio content directly
