# Ralph CLI 使用指南

## 安装

### 前置要求
- Node.js >= 18
- Claude CLI (`npm install -g @anthropic-ai/claude-code`)

### 全局安装
```bash
cd ralph-longtask
npm install
npm link
```

之后在任意项目目录可直接运行 `ralph` 命令。

### 本地运行（不安装）
```bash
node ralph.js [参数]
```

---

## 快速开始

### 1. 准备 prd.json

在项目根目录创建 `prd.json`：

```json
{
  "project": "my-project",
  "branchName": "feature/my-feature",
  "description": "项目描述",
  "userStories": [
    {
      "id": "US-001",
      "title": "实现用户登录",
      "description": "添加邮箱+密码登录功能",
      "acceptanceCriteria": [
        "用户可以通过邮箱和密码登录",
        "登录失败时显示错误提示",
        "登录成功后跳转到首页"
      ],
      "priority": 1,
      "passes": false,
      "notes": ""
    },
    {
      "id": "US-002",
      "title": "实现用户注册",
      "description": "添加新用户注册功能",
      "acceptanceCriteria": [
        "支持邮箱注册",
        "密码强度校验"
      ],
      "priority": 2,
      "passes": false,
      "notes": ""
    }
  ]
}
```

**字段说明：**
| 字段 | 必填 | 说明 |
|------|------|------|
| `id` | 是 | 故事唯一标识，用于 git commit 匹配 |
| `title` | 是 | 故事标题 |
| `description` | 否 | 详细描述 |
| `acceptanceCriteria` | 否 | 验收标准列表 |
| `priority` | 否 | 优先级（数字越小越优先，默认 Infinity） |
| `passes` | 是 | 是否已完成 |
| `notes` | 否 | 备注信息，为空时不会出现在 prompt 中 |

### 2. 准备 RALPH.md（可选）

创建全局指令文件，定义 AI 的行为规则。可以使用模板：

```bash
cp templates/RALPH.md ./RALPH.md
```

根据项目需要修改内容。

### 3. 运行

```bash
ralph
```

---

## 命令行参数

```
ralph [max_iterations] [--config <path>]
```

| 参数 | 说明 | 示例 |
|------|------|------|
| `max_iterations` | 位置参数，最大迭代次数 | `ralph 5` |
| `--config` | 指定配置文件所在目录 | `ralph --config /path/to/project` |
| `--resume` | 跳过 progress 初始化和 archive 检查，从中断处恢复 | `ralph --resume` |

---

## 配置文件

Ralph 使用三层配置合并策略：

```
默认值 → ralph.config.json（文件） → 环境变量（最高优先级）
```

### 配置文件搜索

Ralph 从当前工作目录开始，向上逐级搜索 `ralph.config.json`，直到找到为止。

例如在 `/project/src/components` 运行时，搜索顺序为：
1. `/project/src/components/ralph.config.json`
2. `/project/src/ralph.config.json`
3. `/project/ralph.config.json` ← 命中

未找到则全部使用默认值。

### 完整配置示例

在项目根目录创建 `ralph.config.json`：

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
    "extraContextPaths": [
      "./openspec/changes/*/design.md",
      "./openspec/changes/*/tasks.md",
      "./CLAUDE.md"
    ],
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

### 配置项详解

#### 基础设置

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `prdPath` | `"./prd.json"` | PRD 文件路径（相对于配置文件所在目录） |
| `progressPath` | `"./progress.txt"` | 进度日志路径 |
| `maxIterations` | `10` | 最大迭代次数，达到后退出码为 1 |
| `cooldownSeconds` | `3` | 迭代间冷却秒数，设为 `0` 禁用 |

#### Claude CLI 设置

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `claude.maxTurns` | `50` | Claude 单次会话最大轮次 |

#### 提示词设置

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `prompts.agentInstructionPath` | `"./RALPH.md"` | 全局指令文件路径（如 RALPH.md），设为空字符串则不加载 |
| `prompts.extraContextPaths` | `["./CLAUDE.md"]` | 额外上下文文件路径数组，支持 glob 模式 |
| `prompts.extraInstructions` | `""` | 自由格式的附加指令文本 |
| `prompts.strictSingleStory` | `true` | 是否注入严格单故事协议头部 |

`extraContextPaths` 的 glob 示例：
```json
{
  "extraContextPaths": [
    "./docs/**/*.md",
    "./openspec/changes/*/design.md",
    "./CLAUDE.md"
  ]
}
```
每个 glob 模式内的匹配结果按字母排序，多个模式按数组顺序拼接。

> **Pipeline 工作流**: 如果你使用 OpenSpec + Superpowers + Ralph 的完整流水线，`extraContextPaths` 中的 OpenSpec 路径会自动让 Ralph 的每一轮迭代读取最新的 design.md 和 tasks.md 作为上下文。详见 [Pipeline 使用指南](PIPELINE_GUIDE.md)。

#### 验证设置

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `validation.checkGitCommit` | `true` | 会话结束后检查是否产生了包含故事 ID 的 git commit |
| `validation.patchPrdPasses` | `true` | 只有在会话成功、检测到 completion signal、并通过验证后才自动修补 `passes` |
| `validation.validatePrdSchema` | `true` | 检查 prd.json 结构完整性 |
| `validation.acceptanceCommands.typecheck` | `""` | 为 `"Typecheck passes"` 配置可执行命令 |
| `validation.acceptanceCommands.tests` | `""` | 为 `"Tests pass"` 配置可执行命令 |

#### 权限设置

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `permissionsMode` | `"full"` | Claude CLI 权限模式：`"full"` 或 `"restricted"` |

- **`"full"`**：传递 `--dangerously-skip-permissions --allowedTools all`，Claude 拥有完全的系统访问权限（文件读写、命令执行等）。**此模式适用于受控环境，请确保你了解风险。**
- **`"restricted"`**：仅传递 `-p`，Claude 的工具使用将受到默认权限限制，某些操作需要手动确认。

> **⚠️ 安全提示：** `full` 模式会跳过所有权限检查，Claude 可以执行任意命令和文件操作。在共享环境或生产环境中建议使用 `restricted` 模式。

环境变量覆盖：`RALPH_PERMISSIONS_MODE=restricted`

### 路径解析规则

- 相对路径基于 **配置文件所在目录**（无配置文件时基于 CWD）
- `~` 展开为用户主目录

```json
{
  "prdPath": "./data/prd.json",
  "prompts": {
    "agentInstructionPath": "~/.ralph/RALPH.md"
  }
}
```

---

## 环境变量覆盖

所有配置项可通过 `RALPH_` 前缀的环境变量覆盖，嵌套键用双下划线分隔。

| 环境变量 | 对应配置 |
|----------|----------|
| `RALPH_PRD_PATH` | `prdPath` |
| `RALPH_PROGRESS_PATH` | `progressPath` |
| `RALPH_MAX_ITERATIONS` | `maxIterations` |
| `RALPH_COOLDOWN_SECONDS` | `cooldownSeconds` |
| `RALPH_PERMISSIONS_MODE` | `permissionsMode` |
| `RALPH_CLAUDE_MAX_TURNS` | `claude.maxTurns` |
| `RALPH_PROMPTS_AGENT_INSTRUCTION_PATH` | `prompts.agentInstructionPath` |
| `RALPH_PROMPTS_EXTRA_INSTRUCTIONS` | `prompts.extraInstructions` |
| `RALPH_PROMPTS_STRICT_SINGLE_STORY` | `prompts.strictSingleStory` |
| `RALPH_VALIDATION_CHECK_GIT_COMMIT` | `validation.checkGitCommit` |
| `RALPH_VALIDATION_PATCH_PRD_PASSES` | `validation.patchPrdPasses` |
| `RALPH_VALIDATION_VALIDATE_PRD_SCHEMA` | `validation.validatePrdSchema` |
| `RALPH_VALIDATION_ACCEPTANCE_COMMANDS_TYPECHECK` | `validation.acceptanceCommands.typecheck` |
| `RALPH_VALIDATION_ACCEPTANCE_COMMANDS_TESTS` | `validation.acceptanceCommands.tests` |

示例：
```bash
RALPH_MAX_ITERATIONS=20 RALPH_COOLDOWN_SECONDS=0 ralph
```

数值类型会自动转换，布尔类型接受 `"true"` / `"false"`。解析失败时会输出警告并使用原值。

---

## Pipeline CLI 子命令

Ralph 支持通过子命令管理 Pipeline 状态：

```
ralph pipeline status [--config <dir>]          # 显示管道状态
ralph pipeline init <feature-name> [--config <dir>]  # 初始化管道
ralph pipeline advance <phase> [--config <dir>]  # 标记阶段完成
ralph pipeline check [--config <dir>]            # 粒度检测
ralph pipeline learnings [--config <dir>]        # 提取经验归档
ralph pipeline reset [--config <dir>]            # 清除状态
```

也可以通过独立命令运行：

```bash
ralph-pipeline status    # 等同于 ralph pipeline status
```

### 阶段顺序

```
spec → review → convert → execute
```

| 命令 | 说明 |
|------|------|
| `ralph pipeline init my-feature` | 创建 `.pipeline-state.json`，检测工具可用性 |
| `ralph pipeline advance spec` | 标记 Phase 1 (OpenSpec) 完成 |
| `ralph pipeline check` | 检查 prd.json 中每个故事的粒度，报告违规和拆分建议 |
| `ralph pipeline advance execute` | 标记 Phase 4 完成（ralph 完成所有故事时自动调用） |
| `ralph pipeline learnings` | 从 progress.txt 提取经验，写入 OpenSpec 或本地归档 |

---

## 运行流程

每次迭代的工作流程：

```
1. 加载 prd.json
2. 找到优先级最高且 passes: false 的故事
3. 备份 prd.json → prd.json.bak
4. 拼装提示词（头部 → 全局指令 → 额外上下文 → 任务详情）
5. 启动 Claude CLI 执行会话（实时流式输出）
6. 会话结束后执行验证管线
   ├── prd.json 结构校验
   ├── git commit 时间窗口检查
   └── passes 字段自动修补
7. 追加进度到 progress.txt
8. 冷却等待 → 进入下一次迭代
```

### 退出码

| 退出码 | 含义 |
|--------|------|
| `0` | 所有故事完成（所有 passes 均为 true） |
| `1` | 达到最大迭代次数未完成 或 致命错误 |
| `130` | 用户 Ctrl+C 中断 |

### 大 Prompt 处理

提示词始终写入临时文件，通过 stream pipe 输入 Claude CLI，避免 shell 参数长度限制：

```
写入临时文件 → createReadStream 管道输入 Claude CLI stdin
```

会话结束后自动清理临时文件。

---

## 典型项目结构

```
my-project/
├── ralph.config.json       ← 项目配置
├── prd.json                ← 用户故事
├── progress.txt            ← 自动生成的进度日志
├── RALPH.md                ← AI 行为指令（可选）
├── CLAUDE.md               ← 项目约定（可选，通过 extraContextPaths 加载）
├── archive/                ← 自动归档（切换 branchName 时保存旧运行数据）
└── openspec/
    └── changes/
        └── my-feature/
            ├── design.md
            └── tasks.md
```

## 最小配置起步

如果不想创建配置文件，只需 `prd.json` 即可运行：

```bash
# 准备 prd.json 后直接运行
ralph

# 指定 5 次迭代
ralph 5

# 关闭冷却，加快速度
RALPH_COOLDOWN_SECONDS=0 ralph
```

---

## 更多信息

- 架构设计和模块详解：参见 [ralph-cli.md](ralph-cli.md)
