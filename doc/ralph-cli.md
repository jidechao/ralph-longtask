# Ralph CLI — 自主迭代式 AI 编码调度器

## 一句话介绍

Ralph CLI 是一个 Node.js 命令行工具，通过循环调度 Claude CLI，将 `prd.json` 中的用户故事逐个交给 AI 自主完成，无需人工干预。

> **快速开始请参阅 [USER_GUIDE.md](USER_GUIDE.md)**

---

## 解决什么问题

在大型功能开发中，PRD 通常包含十几个用户故事。手动逐个交给 Claude Code 实现——等待、检查、提交、推进——耗时且需要人一直在场。

Ralph 把这个过程完全自动化：

```
prd.json (16 个故事) → ralph → 人去喝咖啡 → 回来时 16 个故事全部完成
```

---

## 核心流程

```
┌─────────────────────────────────────────────┐
│  for i = 1 to maxIterations                 │
│                                             │
│    1. 加载 prd.json                         │
│    2. 找到优先级最高且 passes:false 的故事   │
│    3. 备份 prd.json → prd.json.bak          │
│    4. 拼装提示词（6 层拼接）                │
│    5. 启动 Claude CLI 子进程                │
│    6. 会话结束后执行验证管线                │
│    7. 写入 progress.txt                     │
│    8. 冷却等待 → 下一轮                     │
│                                             │
│    若所有故事 passes:true → 退出（码 0）    │
└─────────────────────────────────────────────┘
```

---

## 功能亮点

### 1. 六层提示词拼装

每轮迭代的提示词由六个层次按固定顺序拼接，保证 AI 拿到完整的上下文：

| 层次 | 来源 | 作用 |
|------|------|------|
| 1. 项目上下文 | `prd.json` 的 project / branchName / description | 告知 AI 当前项目和分支 |
| 2. 严格协议头 | `strictSingleStory` 配置 | 强制 AI 只做一个故事 |
| 3. 全局指令 | `RALPH.md` 文件 | 定义 AI 行为规则和质量标准 |
| 4. 额外上下文 | `extraContextPaths`（支持 glob） | 注入设计文档、任务清单、CLAUDE.md 等 |
| 5. 自由指令 | `extraInstructions` 字符串 | 补充任意文本指令 |
| 6. 当前任务 | 故事的 id / title / description / acceptanceCriteria / notes | 精确的任务描述和验收标准 |

其中 `extraContextPaths` 支持 glob 模式，例如：

```json
"extraContextPaths": [
  "./openspec/changes/*/design.md",
  "./openspec/changes/*/tasks.md",
  "./CLAUDE.md"
]
```

自动按字母排序、按数组顺序拼接，无需手动维护文件列表。

### 2. 三层配置合并

配置优先级：**默认值 < ralph.config.json < 环境变量**

- **默认值**：开箱即用，零配置即可运行
- **ralph.config.json**：项目级持久配置，从 CWD 向上搜索
- **环境变量**（`RALPH_*`）：临时覆盖，适合 CI/CD 场景

```bash
# 示例：临时提高 maxTurns，跳过冷却
RALPH_CLAUDE_MAX_TURNS=80 RALPH_COOLDOWN_SECONDS=0 ralph
```

数值和布尔类型自动转换，解析失败时输出警告并回退原值。

### 3. 验证管线

每个会话结束后执行三步验证，确保工作真实完成：

```
JSON 结构校验 → Git Commit 检查 → Completion Signal 检查 → Acceptance 命令检查 → Passes 自动修补
```

**关键设计**：只有当 Claude 会话正常退出（exit code 0）、检测到 `<promise>COMPLETE</promise>`、并且通过 git / acceptance 验证时，才执行 `passes` 自动修补。即使存在 git commit，只要 completion signal 缺失或验收命令失败，也不会标记为通过。

验证失败的原因码：

| reason | 含义 |
|--------|------|
| `invalid-json` | prd.json 被破坏（自动从 .bak 恢复） |
| `missing-userStories` | 缺少 userStories 数组 |
| `missing-field` | 故事缺少必填字段 |
| `no-commit` | 时间窗口内未找到包含故事 ID 的 commit |
| `no-completion-signal` | Claude 输出中未检测到 `<promise>COMPLETE</promise>` |
| `acceptance-check-failed` | `Typecheck passes` / `Tests pass` 对应命令执行失败 |
| `session-failed` | Claude 会话非正常退出（如 maxTurns 耗尽） |

### 4. PRD 防护机制

- **启动前备份**：每次迭代前将 `prd.json` 备份为 `prd.json.bak`
- **损坏自动恢复**：若 AI 修改导致 JSON 格式错误，下轮迭代自动从备份恢复
- **原子写入**：通过先写临时文件再替换的方式保证写入安全（Windows 用 copy+unlink，Unix 用 rename）

### 5. Windows 原生适配

Ralph 在 Windows 上做了特殊处理，绕过 `cmd.exe` 的限制：

- **直接调用 Node.js**：解析 `claude.cmd` 找到实际的 JS 脚本路径，spawn node 进程而非 cmd 子进程
- **stdin 直写**：将 prompt 直接写入 Claude CLI 的 stdin，避免额外的临时文件生命周期问题
- **进程树终止**：Ctrl+C 时使用 `taskkill /T /F` 终止整个进程树

### 6. 实时流式输出

Claude CLI 的 stdout/stderr 会实时转发到终端，同时 Ralph 也会保留输出副本用于检测 completion signal 和后续验证。

### 7. 进度追踪

自动维护 `progress.txt` 文件，记录每次迭代的时间戳、故事 ID、完成状态。

progress.txt 包含两种来源的条目：

1. **Ralph 自动写入的验证摘要**（简洁格式）：
```
## 2026-04-17T14:30:22 - US-001
Completed successfully (auto-patched)

## 2026-04-17T14:35:18 - US-002 [FAILED]
Validation failed: no-commit
```

2. **AI 写入的详细进度和经验记录**（详细格式，由 CLAUDE.md / RALPH.md 中的指令控制）：
```
## 2026-04-17T14:30:22 - US-001
- 添加了 notifications 表
- 文件变更: db/migrations/001_notifications.sql
- **Learnings for future iterations:**
  - 此项目使用 PostgreSQL，迁移用 raw SQL
---
```

### 8. Prompt 管道输入

提示词会直接写入 Claude CLI 的 stdin，避免 shell 参数长度限制，同时减少临时文件管理复杂度。

---

## 模块架构

```
ralph.js              ← 入口，主循环
ralph-pipeline.js     ← Pipeline CLI 独立入口
├── lib/config.js     ← 三层配置加载（默认 → 文件 → 环境变量）
├── lib/prd.js        ← PRD 加载 / 保存 / 结构校验 / 故事选择
├── lib/prompt-builder.js  ← 六层提示词拼装
├── lib/executor.js   ← Claude CLI 子进程管理，Windows 适配
├── lib/validator.js  ← 会话后验证管线
├── lib/progress.js   ← 进度日志管理
├── lib/archive.js    ← 分支变更归档（branchName 变化时自动归档旧运行数据）
├── lib/pipeline-state.js  ← 管道状态管理（spec→review→convert→execute）
├── lib/pipeline-cli.js    ← Pipeline 子命令处理（status/init/advance/check/learnings/reset）
├── lib/granularity.js     ← 故事粒度检测（5 规则）与拆分
└── lib/learnings.js       ← 经验提取与归档
```

各模块职责单一，通过配置对象解耦，可独立测试。

### lib/granularity.js

故事粒度检测与拆分模块。

| 导出函数 | 签名 | 说明 |
|----------|------|------|
| `checkStoryGranularity(story)` | `(object) → { pass, violations[] }` | 检查故事是否符合粒度规则 |
| `splitStoryByLayer(story)` | `(object) → object[]` | 按架构层拆分故事 |
| `suggestSplit(story, violations)` | `(object, object[]) → { strategies[], suggestedStories[] }` | 根据违规建议拆分策略 |

规则：TOO_MANY_SENTENCES(>3句)、TOO_MANY_CRITERIA(>6条)、CROSS_LAYER(跨层)、VAGUE_LANGUAGE(模糊词)、TOO_BROAD(模块>3)

### lib/pipeline-state.js

管道状态管理模块。

| 导出函数 | 签名 | 说明 |
|----------|------|------|
| `loadPipelineState(projectDir)` | `(string) → object\|null` | 读取管道状态文件 |
| `savePipelineState(projectDir, state)` | `(string, object) → void` | 写入管道状态 |
| `advancePhase(projectDir, phase, metadata?)` | `(string, string, object?) → object` | 推进到下一阶段 |
| `clearPipelineState(projectDir)` | `(string) → void` | 清除状态文件 |
| `getCurrentPhase(state)` | `(object\|null) → string\|null` | 获取当前阶段名 |

状态文件：`.pipeline-state.json`，阶段：spec → review → convert → execute

### lib/learnings.js

经验提取与归档模块。

| 导出函数 | 签名 | 说明 |
|----------|------|------|
| `extractLearnings(progressPath)` | `(string) → { patterns[], gotchas[], recommendations[] }` | 从 progress.txt 提取经验 |
| `formatLearningsMarkdown(feature, learnings)` | `(string, object) → string` | 格式化为 Markdown |
| `writeLearnings(projectDir, feature, learnings)` | `(string, string, object) → string` | 写入归档文件 |

写入路径：优先 `openspec/changes/archive/`，降级到 `archive/`

### lib/pipeline-cli.js

Pipeline 子命令 CLI 处理模块。

| 导出函数 | 签名 | 说明 |
|----------|------|------|
| `runPipelineCommand(args)` | `(string[]) → void` | 主调度函数 |
| `detectOpenSpec(projectDir)` | `(string) → { cliAvailable, skillsAvailable, changesDir }` | 检测 OpenSpec |
| `detectSuperpowers()` | `() → { available, skills[] }` | 检测 Superpowers |

CLI 命令：status、init、advance、check、learnings、reset

### 权限模式

`lib/executor.js` 根据 `config.permissionsMode` 构建不同的 CLI 参数：

| 模式 | 传递参数 | 行为 |
|------|----------|------|
| `"full"` (默认) | `-p --dangerously-skip-permissions --allowedTools all` | 无限制访问 |
| `"restricted"` | `-p` | 遵循 Claude CLI 默认权限策略 |

可通过配置文件或 `RALPH_PERMISSIONS_MODE` 环境变量设置。

---

## prd.json 格式

```json
{
  "project": "jetlog",
  "branchName": "feature/media-library",
  "description": "媒体库功能开发",
  "userStories": [
    {
      "id": "US-001",
      "title": "创建媒体文件实体",
      "description": "创建 MediaFile 实体类...",
      "acceptanceCriteria": [
        "实体包含所有必需字段",
        "通过编译检查"
      ],
      "priority": 1,
      "passes": false,
      "notes": ""
    }
  ]
}
```

故事按 `priority` 升序处理（数字越小越优先），完成后 `passes` 设为 `true`。

---

## 快速开始

```bash
# 安装依赖
cd ralph-longtask && npm install

# 全局安装（可选）
npm link

# 准备 prd.json 后运行
ralph

# 指定 5 次迭代上限
ralph 5

# 指定项目目录
ralph --config /path/to/project
```

最小运行只需要一个 `prd.json` 文件，零配置。

---

## 完整配置参考

```json
{
  "prdPath": "./prd.json",
  "progressPath": "./progress.txt",
  "maxIterations": 10,
  "cooldownSeconds": 3,
  "permissionsMode": "full",

  "claude": {
    "maxTurns": 50,
  },

  "prompts": {
    "agentInstructionPath": "./RALPH.md",
    "extraContextPaths": ["./CLAUDE.md"],
    "extraInstructions": "",
    "strictSingleStory": true
  },

  "validation": {
    "checkGitCommit": true,
    "patchPrdPasses": true,
    "validatePrdSchema": true,
    "acceptanceCommands": {
      "typecheck": "",
      "tests": ""
    }
  }
}
```

环境变量覆盖：`RALPH_PERMISSIONS_MODE`、`RALPH_CLAUDE_MAX_TURNS`、`RALPH_MAX_ITERATIONS`、`RALPH_COOLDOWN_SECONDS` 等，详见 `USER_GUIDE.md`。

---

## 典型项目结构

```
my-project/
├── ralph.config.json       ← 项目级配置
├── prd.json                ← 用户故事列表
├── progress.txt            ← 自动生成的进度日志
├── RALPH.md                ← AI 行为指令
├── CLAUDE.md               ← 项目约定（通过 extraContextPaths 注入）
├── archive/                ← 自动归档（切换 branchName 时保存旧运行数据）
└── src/                    ← 项目源代码
```

