# QQ `/task` 子会话设计

## 目标

让 QQ 中的 `/task <model>` 不再只是单次模型覆盖，而是在**同一个 QQ 对话目标内按模型维持独立持久会话**。普通消息继续走原有主会话，不与 `/task` 子会话互相污染。

## 问题与根因

当前 `/task` 的行为有两个核心问题：

1. `/task` 每次都是独立调用，不会回到同一个 Claude session。
2. 用户虽然看到了流式编辑中的首条回复，但 `/task` 本质上没有自己的持久会话键，因此后续同模型消息无法继续上下文。

根因在 `src/runner.ts`：当存在 `/task` 模型覆盖时，当前逻辑会跳过 `--resume`，因为全局主会话不能安全切换到另一个模型。与此同时，现有 `src/sessions.ts` 只有一个全局 `session.json`，无法按“QQ 对话目标 + 模型”保存独立会话。

## 用户确认的行为规则

- 普通消息继续走原主会话。
- `/task <model>` 在同一个 QQ 对话目标内按模型维持独立子会话。
- `/task haiku ...` 后再发 `/task haiku ...`，必须回到同一个 haiku 子会话。
- `/task sonnet ...` 与 `/task haiku ...` 必须分离。
- 对话隔离粒度为：
  - 私聊：`user_openid + model`
  - 群聊：`group_openid + model`
  - 频道：`channel_id + model`
- 普通消息不影响 `/task` 子会话，`/task` 子会话也不影响普通消息。

## 方案选择

### 方案 A：按“QQ 对话目标 + 模型”持久化 task session（采用）

为 QQ `/task` 构造稳定的 task session key，并把它映射到独立的 Claude session。每次 `/task` 请求都根据 key 查找已有 session，存在则 `--resume`，不存在则新建。

优点：
- 与用户心智一致。
- 复用现有 Claude `--resume` 能力，不需要常驻进程池。
- 对当前架构侵入小，风险可控。

### 方案 B：只保留一个最近 `/task` 会话（不采用）

会破坏“按模型精确回到对应子会话”的要求。

### 方案 C：真常驻 Claude 子进程池（不采用）

复杂度和维护成本明显更高，当前没有必要。

## 架构设计

### 1. 新增 task session 存储模块

新增 `src/taskSessions.ts`，职责：
- 根据 `taskSessionKey` 读取/创建/更新子会话
- 持久化到 `.claude/claudeclaw/task-sessions.json`
- 维护字段：
  - `sessionId`
  - `taskSessionKey`
  - `channel`
  - `targetType`
  - `targetId`
  - `model`
  - `createdAt`
  - `lastUsedAt`
  - `turnCount`
  - `compactWarned`

该模块与 `src/sessions.ts` 分离，避免影响现有主会话逻辑。

### 2. runner 支持显式 session scope

扩展 `src/runner.ts`，让 `streamUserMessage` / `runUserMessage` 支持传入显式 session scope，而不是只依赖：
- 全局主会话
- Discord thread 会话

新增一个统一的会话解析入口，例如：
- `global`
- `thread`
- `task`

对于 `task` scope：
- 如果存在对应 task session，则使用该 sessionId 执行 `--resume`
- 即使有 `/task` 模型覆盖，也允许 resume，因为 resume 的对象正是同模型子会话
- 如果不存在，则以指定模型创建新 session，并在成功后写入 task session 存储

### 3. QQ 侧生成 task session key

在 `src/commands/qq.ts` 中新增 key 构造函数：
- 私聊：`qq:private:<user_openid>:<model>`
- 群聊：`qq:group:<group_openid>:<model>`
- 频道：`qq:channel:<channel_id>:<model>`

只要消息命中 `/task <model>`：
- 继续沿用现有流式回包路径
- 但调用 runner 时传入 `task` scope 和对应 key

普通消息：
- 不传 task scope
- 保持原行为

### 4. 流式体验

这次不做真正的常驻子进程。

用户体感上的“持续监听”和“有上下文”由以下两点保证：
- QQ 现有 `streamUserMessage(...)` 仍负责流式编辑消息
- 相同 `/task <model>` 命中同一个 Claude session 并 `--resume`

因此用户看到的效果会与“进入同一个子进程”非常接近，但实现上更简单、更稳。

## 数据流

### 私聊 `/task haiku 帮我找找日志`

1. QQ 收到 C2C 消息。
2. `parseTaskOverride` 解析出 `model=haiku`。
3. QQ 构造 key：`qq:private:<user_openid>:haiku`。
4. `streamUserMessage` 以 `task` scope 执行。
5. runner 查询 `task-sessions.json`：
   - 无记录 → 新建 Claude session
   - 保存 `sessionId`
6. 流式输出照常编辑 QQ 消息。

### 再发 `/task haiku 日志找好了吗`

1. 解析出同样的 key。
2. runner 查到已有 sessionId。
3. 使用 `--resume <sessionId>` 继续执行。
4. 流式输出继续回到 QQ。

### 发 `/task sonnet 帮我总结一下`

1. key 变为 `qq:private:<user_openid>:sonnet`。
2. 命中另一条 task session。
3. 与 haiku 子会话完全隔离。

## 文件边界

### 新增
- `src/taskSessions.ts`
  - task 子会话的加载、保存、读取、创建、计数、compact 标记

### 修改
- `src/runner.ts`
  - 支持 task scope
  - `/task` 在 task scope 下允许 resume
  - 统一 session 读写入口
- `src/commands/qq.ts`
  - 构造 QQ task session key
  - `/task` 路径传入 task scope
  - 普通消息保持原逻辑
- `src/commands/qq.test.ts`
  - 增加 key 构造与路由测试
- `src/runner` 相关测试文件（如已有适合位置则复用，否则新建）
  - 验证 task scope 的 resume / create 行为

## 测试策略

至少覆盖：

1. 同一私聊中相同模型命中同一 task session key。
2. 同一私聊中不同模型命中不同 task session key。
3. 私聊 / 群聊 / 频道 key 彼此隔离。
4. task scope 下：
   - 首次调用创建 session
   - 再次调用 resume 已有 session
5. 普通消息不走 task scope。
6. `/task` 仍走现有流式调用路径。

## 风险与约束

- 不能破坏现有普通消息主会话。
- 不能让不同模型错误共享同一个 session。
- 不能让群聊和私聊共享 task session。
- 如果 task session 持久化文件损坏，应只影响 `/task` 子会话，不影响普通消息。

## 非目标

这次不做：
- 真正的常驻 Claude 子进程池
- Telegram / Discord 接入同样的 task 子会话机制
- 普通消息自动接管最近一次 `/task` 子会话
- `/task` 子会话的管理命令（列出、清理、重置）

## 实现建议

采用最小增量方式：
1. 先引入 task session 存储与 key 规则。
2. 再让 runner 支持 task scope。
3. 最后把 QQ `/task` 接到新 scope。
4. 全程用 TDD，优先写会失败的回归测试。
