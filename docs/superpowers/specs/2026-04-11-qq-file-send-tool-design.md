# QQ File Send Tool Design

**Date:** 2026-04-11

**Goal:** Replace output-directory scanning with an explicit Claude-callable file sending tool so QQ file replies are reliable, simpler, and privacy-safe.

---

## Problem

The current QQ file workflow is based on:
- downloading incoming files to a temporary directory
- asking Claude to write result files into an output directory
- scanning that output directory after the response finishes
- uploading any discovered files back to QQ

This creates several problems:
1. Claude may describe a file without actually writing it
2. output-directory scanning adds brittle control flow
3. file cleanup timing interferes with multi-turn file work
4. sending is implicit instead of explicit
5. the current design leaks absolute home-directory paths into prompts and docs

The user wants a simpler model:
- QQ received files go to `~/tmp/`
- Claude can send any file under `~/`
- sending should happen through an explicit tool call with a file path
- user-facing descriptions should prefer `~/...` over absolute home-directory paths

---

## Chosen Approach

Use an explicit internal file-send tool for QQ sessions.

Instead of scanning output directories, Claude will call a dedicated tool whenever it wants to send a file back to the user. The tool will receive a file path, validate that it is under the user's home directory, resolve `~` to the actual home path, and upload/send the file to the current QQ conversation.

Incoming QQ files will still be downloaded automatically, but into a fixed default workspace at `~/tmp/` instead of per-turn temporary directories. Claude will be told that:
- received QQ files are typically stored in `~/tmp/`
- it may also use other files under `~/`
- if it wants to send a file to the current QQ chat, it must call the file-send tool

This removes output-directory scanning entirely.

---

## Architecture

### 1. File workspace

Default incoming file download directory:
- `~/tmp/`

Behavior:
- incoming QQ attachments are downloaded into `~/tmp/`
- filenames should avoid collisions (timestamp or suffix)
- Claude may read or write files anywhere under `~/`
- user-facing prompts and docs should say `~/...`, not absolute home-directory paths

### 2. Explicit send tool

Introduce a QQ-specific internal tool function with semantics like:

- input: `filePath: string`
- available only while handling an active QQ message
- sends the specified file to the current QQ conversation

Behavior:
1. expand `~` to the real home directory
2. reject paths outside `~/`
3. reject missing files or directories
4. infer QQ upload type from extension/content type
5. upload and send the file to the current QQ endpoint:
   - C2C
   - group
   - guild/channel
6. return success/failure to Claude

### 3. QQ context binding

The send tool must know the active QQ destination without Claude passing it manually.

Per message handling flow:
- handler constructs a context object for the current QQ request
- context includes endpoint type and destination id
- Claude-callable send tool uses this current context

This keeps the Claude tool interface simple:
- Claude passes only the file path
- bot code supplies the conversation routing details

### 4. Prompt changes

Prompt should state:
- QQ attachments are downloaded to `~/tmp/`
- you may use files under `~/`
- if you want to send a file to the current QQ conversation, call the file-send tool
- do not merely say that you will send a file

The prompt should not enumerate every existing file unless needed.

### 5. Removal of output scanning

Delete or bypass the current logic that:
- creates per-turn output directories
- scans output directories after each response
- infers send intent from discovered files

Sending becomes explicit via tool call only.

### 6. Cleanup behavior

Do not auto-delete files after each turn.

Behavior:
- downloaded files remain in `~/tmp/`
- generated files remain where Claude writes them under `~/`
- if user asks to delete files, Claude handles deletion through normal file tools
- no new slash command is required

---

## Security Model

Allowed send scope:
- any file under `~/`

Disallowed:
- any path outside the user's home directory
- directories instead of files
- non-existent paths

Path handling rules:
- `~/foo/bar.txt` is allowed
- `$HOME/foo/bar.txt` is allowed internally
- user-facing text should prefer `~/foo/bar.txt`
- `/etc/passwd` must be rejected

This balances convenience with a clear boundary.

---

## Code Changes

### `src/commands/qq.ts`
Primary changes:
- replace per-turn input/output temp logic with `~/tmp/` default download behavior
- add a current QQ send context abstraction
- add a callable `send current file to QQ` path
- remove output-directory scanning logic
- remove automatic cleanup of input/output directories after each message
- update prompts to describe `~/tmp/` and the explicit send tool

### `src/runner.ts`
Likely changes:
- expose or adapt a tool path that lets QQ message handling register a callable file-send action during a single request
- ensure the active request context can be used safely only during that QQ handling call

### `README.md`
Update docs to describe:
- incoming QQ files download to `~/tmp/`
- Claude can send files under `~/`
- file sending is explicit and reliable via the bot tool
- QQ platform restrictions for file types still apply

---

## User Experience

### Example 1: receive and process a file
User sends a PDF and says:
- "帮我翻译这个文件"

Bot behavior:
- downloads PDF to `~/tmp/...`
- Claude reads it
- Claude writes translated result to some file under `~/`
- Claude calls the file-send tool with that path
- Bot uploads and sends the file back

### Example 2: generate a new document
User says:
- "生成一个 hello world 文档并发给我"

Bot behavior:
- Claude writes `~/tmp/hello_world.txt` or another `~/` path
- Claude calls the file-send tool
- Bot uploads and sends it back

### Example 3: multi-turn continuation
User says:
- "把刚才那个文档再转成 markdown 发我"

Bot behavior:
- Claude can inspect `~/tmp/` or previously generated files under `~/`
- no per-turn cleanup has removed them
- Claude generates the new file and sends it explicitly

---

## Trade-offs

### Benefits
- much simpler than output-directory scanning
- explicit send intent instead of inference
- better multi-turn behavior
- fewer timing and cleanup bugs
- user-facing paths can stay privacy-safe with `~/`

### Costs
- requires plumbing a QQ-specific send capability into the Claude execution path
- requires careful path validation
- requires removing or replacing current scanning-based assumptions

---

## Out of Scope

Not included in this change:
- non-QQ platforms using the same send tool
- automatic file expiration or TTL cleanup jobs
- new slash commands for file management
- full file index/history UI

---

## Acceptance Criteria

1. QQ attachments download into `~/tmp/`
2. Claude is told to use `~/tmp/` as the default QQ file workspace
3. Claude can explicitly send a file by passing a path under `~/`
4. output-directory scanning is no longer required for sending files
5. files are not auto-deleted after each message
6. multi-turn file workflows work without losing prior files
7. user-facing prompts/docs prefer `~/...` instead of absolute home-directory paths
8. files outside `~/` are rejected by the send tool
