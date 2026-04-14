# QQ launch 型定时任务设计

## 背景
当前 `claudeclaw_for_qq` 已有两套相关能力，但没有形成“QQ 对话中创建、到点启动、执行后回发 QQ 文本”的完整闭环：

- 现有 jobs 为 daemon 内轮询模型，适合周期推动类任务。
- 当前线上 QQ Bot 由 PM2 以独立模式运行：`bun run src/index.ts qq`。

目标是在**保留当前 QQ 独立模式**的前提下，新增一类真正的“到点才启动”的定时任务，适合日报、周报、固定提醒等长期低频任务。

## 目标
新增 **launch 型任务**：

- 由 Claude 在 QQ 对话中判断是否需要创建任务，而非关键词硬匹配。
- 在哪个 QQ 对话里创建，就把任务结果回发到哪个对话。
- 调度方式为 Linux `crontab`，做到平时不常驻轮询，到点才启动执行。
- 执行入口为 one-shot runner：`bun run src/index.ts run-job <job-name>`。
- 执行结果以**纯文本**发送到 QQ，成功和失败都通知。

## 非目标
第一版明确不做：

- 非 Linux 平台的 launch 调度后端
- poll 型任务迁移到 QQ 独立模式
- Web UI / CLI 手工指定 QQ 目标创建 launch 任务
- 复杂富媒体、文件回发、自动拆段发送
- 失败重试队列、多目标广播、任务依赖链

## 方案概览
系统保留两类任务语义：

1. `poll`：现有轮询型任务，继续由原有调度链路处理。
2. `launch`：新增启动型任务，由 Linux `crontab` 在到点时直接启动 one-shot runner。

QQ 仍运行在独立模式，负责接收消息、让 Claude 判断用户是否在创建/编辑/删除任务，并生成结构化任务参数。真正的任务落地动作由统一 job service 完成。

## 数据模型
继续沿用 `.claude/claudeclaw/jobs/*.md`，扩展 frontmatter：

```md
---
mode: "launch"
schedule: "0 9 * * *"
recurring: true
notify: true
targetChannel: "qq"
targetType: "private"
targetId: "union_openid_xxx"
createdFrom: "qq"
---
请生成今天的项目日报，直接输出适合发送到 QQ 的纯文本内容。
```

群聊示例：

```md
---
mode: "launch"
schedule: "0 9 * * *"
recurring: true
notify: true
targetChannel: "qq"
targetType: "group"
targetId: "group_openid_xxx"
createdFrom: "qq"
---
请生成今天的项目日报。
```

字段约定：

- `mode`: `poll | launch`。旧任务未写时默认视为 `poll`。
- `targetChannel`: 第一版固定为 `qq`。
- `targetType`: `private | group`。
- `targetId`: 私聊为 `union_openid`，群聊为 `group_openid`。
- `notify`: 保持现有语义；QQ 创建的 launch 任务默认写 `true`。

## 创建流程
### 入口
用户在 QQ 对话中用自然语言表达需求，例如“每天 9 点给我发日报”。

### 意图判定
由 Claude 负责判断：

- 是否是任务管理请求
- 是创建 / 编辑 / 删除 / 运行任务
- 若是创建，应使用 `poll` 还是 `launch`
- 需要的 `schedule`、`prompt`、`recurring` 参数

系统层不做关键词硬编码判定，只消费 Claude 输出的结构化结果。

### 目标绑定
QQ 事件上下文自动注入目标：

- 私聊：`targetType=private` + `targetId=union_openid`
- 群聊：`targetType=group` + `targetId=group_openid`

### 落地
job service 执行以下步骤：

1. 校验平台必须为 Linux。
2. 校验系统存在 `crontab` 命令。
3. 规范化 job name。
4. 写入 job 文件。
5. 读取当前 crontab。
6. 删除同名旧条目（若存在）。
7. 写入新的 cron 条目。
8. 向当前 QQ 对话回复创建成功。

若 job 文件写成功但 crontab 注册失败，需回滚删除 job 文件，避免产生“看起来存在但实际不会执行”的假成功任务。

## crontab 后端
第一版 launch 型任务仅支持 Linux `crontab`。

每个 launch 任务生成一条独立 cron 记录，使用唯一标记便于更新/删除：

```bash
0 9 * * * cd /home/xiao/claudeclaw_for_qq && /home/xiao/.bun/bin/bun run src/index.ts run-job daily-report >> /home/xiao/claudeclaw_for_qq/.claude/claudeclaw/logs/jobs.log 2>&1 # claudeclaw:launch:daily-report
```

约束：

- 使用绝对路径和固定 `cwd`
- 通过尾注释 `# claudeclaw:launch:<job-name>` 标识
- 更新任务时删除旧行再写新行
- 删除任务时同时删除 job 文件与 cron 条目
- 非 Linux 平台创建 launch 任务时直接报不支持，不自动降级为 poll

## one-shot runner
新增 CLI 入口：

```bash
bun run src/index.ts run-job <job-name>
```

runner 执行流程：

1. 读取 `.claude/claudeclaw/jobs/<job-name>.md`
2. 校验 job 存在且 `mode=launch`
3. 提取 prompt 正文
4. 调用现有 Claude 执行通道运行任务
5. 格式化结果为纯文本
6. 通过 QQ 发送模块回发到原对话
7. 若 `recurring=false`，删除对应 cron 条目并清掉 job 的 `schedule`
8. 退出进程

失败策略：

- Claude 执行失败：发送失败文本到原 QQ 对话
- job 文件损坏但仍能读到目标：发送结构化错误文本
- QQ 发送失败：记日志并退出
- job 文件不存在且无法恢复目标：仅记日志

## QQ 发送模块
需要从当前 `src/commands/qq.ts` 中抽出可独立调用的发送能力，形成无状态发送模块，供：

- QQ 常驻模式复用
- `run-job` one-shot runner 复用

第一版只要求支持：

- 发送私聊纯文本
- 发送群聊纯文本
- 独立获取/刷新 access token
- 基本错误返回

明确不做：文件、富文本、长文拆段、重试队列。

## 架构边界
第一版的清晰边界：

- 保留当前 `bun run src/index.ts qq` 独立 QQ 模式
- launch 任务由 QQ 对话创建、crontab 调度、runner 执行
- poll 任务本轮不重构
- 代码结构预留未来多平台调度后端接口，但本轮只实现 `crontab`

## 测试策略
需要覆盖：

1. job frontmatter 新字段解析与旧字段兼容
2. launch 任务创建时 cron 行生成/替换/删除
3. `run-job` 对 launch 任务的执行与一次性收尾逻辑
4. QQ 私聊/群聊文本发送的公共接口
5. 非 Linux / 缺少 `crontab` 时的错误路径
6. job 文件写成功但注册失败时的回滚逻辑

## 预期结果
完成后，用户可以在 QQ 中自然地说出“每天 9 点给我发日报”这类需求，由 Claude 决定并创建 launch 型任务。到时间后系统通过 `crontab` 启动 one-shot runner，执行任务并把结果以纯文本发送回原 QQ 对话，且无需长期依赖应用内轮询。