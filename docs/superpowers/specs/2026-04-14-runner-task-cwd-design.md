# Runner Task CWD 设计

## 目标
让 `claudeclaw_for_qq` 仓库内所有通过 `runner.ts` 启动的 Claude 子进程，都可以按任务显式指定工作目录，而不是固定使用 `homedir()`。

## 背景
当前主进程从 `/home/xiao` 启动，`runner.ts` 又把 Claude 子进程固定到 `homedir()`，导致子进程不在具体项目 git 仓库中运行。结果是 subagent/worktree 功能会报 `not in a git repository`。

## 方案
采用“任务级 cwd 参数化”方案：
- 在 `runner.ts` 为 Claude 子进程增加可选 `taskCwd`
- `Bun.spawn(..., { cwd })` 使用该任务目录
- 不传时保持兼容默认值
- 仓库内所有入口在已知项目目录时显式传入该目录

## 范围
本次只修 `claudeclaw_for_qq` 仓库内通过 `runner.ts` 启动 Claude 的入口，不处理当前独立 Claude 会话本身的项目切换。

## 设计细节
1. 在 `src/runner.ts` 增一个小 helper，例如 `resolveTaskWorkDir(taskCwd?: string)`。
2. `runClaudeOnce(...)`、`streamUserMessage(...)` 等内部启动点统一接收该参数。
3. QQ 入口先接入项目目录 `/home/xiao/claudeclaw_for_qq`。
4. 其他仓库内入口如果也直接走 runner，同步改为传入项目目录。
5. 新增安全约束：显式传入的 `taskCwd` 必须位于 `homedir()` 之下；如果超出 `homedir()`，则回退到默认安全目录并拒绝使用越界路径。
6. 不修改主进程启动目录，不依赖全局 cwd 切换。

## 测试
按 TDD 增加最小测试：
- 传入项目目录时返回该目录
- 不传时返回兼容默认值
- 传入空白字符串时回退默认值
- 传入超出 `homedir()` 的路径时拒绝并回退默认值
- 跑聚焦测试和构建验证

## 风险
- 会改变子进程默认相对路径行为，但只发生在显式传入 `taskCwd` 的任务上。
- 不做自动猜测项目目录，避免多项目场景下误判。
- 必须严格限制 `taskCwd` 不得越出 `homedir()`，否则会引入子进程越权访问风险。
