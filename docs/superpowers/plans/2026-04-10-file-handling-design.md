# QQ Bot File Handling - Design Spec

**Goal:** Enable QQ Bot users to send files (non-image attachments) for Claude to process and receive result files back.

**Date:** 2026-04-10

---

## Current State

- Bot supports **image attachments** only: `msg.attachments[0].url` is passed as an image URL to Claude
- No file download, no file upload, no `msg_type: 7` (rich media) support
- Claude runs via `claude -p` with `--append-system-prompt`, receiving only text + image URL

## QQ API Constraints

| File Type | C2C Send | Group Send | Channel Send |
|-----------|----------|------------|--------------|
| Image (png/jpg) | Supported | Supported | Supported |
| Video (mp4) | Supported | Supported | Supported |
| Voice (silk/wav/mp3/flac) | Supported | **Not supported** | **Not supported** |
| File (pdf/doc/txt) | Supported | **Not supported** | **Not supported** |

- File upload: `POST /v2/users/{openid}/files` or `POST /v2/groups/{group_openid}/files`
- File send: `POST /v2/{users|groups}/{id}/messages` with `msg_type: 7` and `media` field
- Upload uses `file_data` (base64) or `url` (public URL)
- `file_info` from upload has a TTL — must use before expiry
- No explicit file size limit documented; base64 approach is limited by HTTP request size

## Design

### Receive Flow

1. User sends a file via QQ → Bot receives `attachments` with `content_type` and `url`
2. If `content_type` starts with `image/`: existing logic (pass URL to Claude)
3. If `content_type` is not image: download file to `/tmp/claudeclaw-files/<sessionId>/`
4. Include local file path in the prompt so Claude can read it
5. After Claude finishes, clean up downloaded files

### Send (Return) Flow

1. In the system prompt, tell Claude to put output files in `/tmp/claudeclaw-output/<sessionId>/`
2. After Claude finishes, scan the output directory for new files
3. For each output file:
   - Upload via QQ rich media API (`file_data` base64 approach)
   - Send as `msg_type: 7` message
4. Clean up output directory

### Files to Modify

| File | Change |
|------|--------|
| `src/commands/qq.ts` | Add file download, upload, and send functions; modify handlers |
| `README.md` | Document file handling feature with QQ API limitations |

### New Functions

- `downloadFile(url, destPath)` — download attachment to local path
- `uploadAndSendFile(endpoint, channelId, filePath, fileType)` — upload + send via msg_type 7
- `cleanupDir(dir)` — recursive directory cleanup
- Modified `buildPrompt()` — accept file paths array in addition to imageUrl

### Prompt Changes

When files are present, the prompt will include:
```
The user attached a file: /tmp/claudeclaw-files/<session>/filename.ext
Read this file and process it as requested.
If you need to return a file, save it to: /tmp/claudeclaw-output/<session>/
```

### Supported Scenarios

- **C2C**: Full support — receive any file, send back any file (image/video/voice/file)
- **Group**: Receive files, but send-back limited to images and videos only (QQ API limitation)
- **Guild Channel**: Receive files, but send-back limited to images and videos only (QQ API limitation)
