# Ralph - 让 Claude Code 自动完成你的整个需求清单

> 写好需求，喝杯咖啡，回来时代码已经写完了。

Ralph 是一个自动调度工具，它能把你写好的需求清单（PRD）逐条交给 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) 去实现。每完成一条需求，自动检查、提交、推进下一条，全程无需人工干预。

基于 [Geoffrey Huntley 的 Ralph 模式](https://ghuntley.com/ralph/)。

---

## 它是怎么工作的

```
你写 prd.json（需求清单）
        │
        ▼
   ralph 启动
        │
        ├── 第 1 轮：Claude Code 实现需求 1 → 自动提交
        ├── 第 2 轮：Claude Code 实现需求 2 → 自动提交
        ├── 第 3 轮：Claude Code 实现需求 3 → 自动提交
        │   ...
        └── 全部完成 → 自动退出
```

每一轮，Ralph 会启动一个**全新的** Claude Code 会话（干净的上下文），告诉它："只做这一条需求，做完提交"。上一轮的成果通过 git 记录和进度文件传递给下一轮。

---

## 前提条件

你需要先装好这两样东西：

| 工具 | 安装方式 | 验证命令 |
|------|----------|----------|
| **Node.js >= 18** | [nodejs.org 下载](https://nodejs.org/) | `node -v` |
| **Claude Code** | `npm install -g @anthropic-ai/claude-code` | `claude -v` |

确保你的项目是一个 git 仓库（`git init`）。

---

## 三分钟快速开始

### 第 1 步：安装 Ralph

```bash
git clone https://github.com/jidechao/ralph-longtask.git
cd ralph-longtask
npm install
npm link          # 全局注册，之后任何目录都能用 ralph 命令
```

> 不想全局安装？也可以直接用 `node ralph.js` 运行。

### 第 2 步：准备需求文件

在你的项目根目录创建 `prd.json`，把需求拆成小故事：

```json
{
  "project": "my-app",
  "branchName": "feature/user-auth",
  "description": "用户登录注册功能",
  "userStories": [
    {
      "id": "US-001",
      "title": "创建用户数据库表",
      "description": "创建 users 表，包含 email、password_hash、created_at 字段",
      "acceptanceCriteria": [
        "迁移文件正确创建",
        "包含所有必需字段",
        "通过数据库迁移命令"
      ],
      "priority": 1,
      "passes": false,
      "notes": "使用项目的 ORM 方式创建迁移"
    },
    {
      "id": "US-002",
      "title": "实现注册 API",
      "description": "POST /api/register 接口，接收 email 和 password",
      "acceptanceCriteria": [
        "接口返回正确的状态码",
        "密码加密存储",
        "重复邮箱返回 409"
      ],
      "priority": 2,
      "passes": false,
      "notes": ""
    },
    {
      "id": "US-003",
      "title": "实现登录 API",
      "description": "POST /api/login 接口，验证邮箱密码并返回 token",
      "acceptanceCriteria": [
        "正确验证返回 token",
        "密码错误返回 401",
        "token 格式正确"
      ],
      "priority": 3,
      "passes": false,
      "notes": ""
    }
  ]
}
```

### 第 3 步：运行

```bash
cd your-project    # 进入你的项目目录
ralph              # 开始自动开发！
```

Ralph 会依次完成 US-001、US-002、US-003，每完成一条自动 git commit。你会在终端实时看到 Claude Code 的思考和编码过程。

---

## prd.json 字段说明

每个用户故事包含以下字段：

```
id                 ← 唯一编号，如 US-001（用于 git commit 匹配）
title              ← 故事标题（简短描述做什么）
description        ← 详细说明（具体实现什么）
acceptanceCriteria ← 验收标准列表（怎么算做完了）
priority           ← 优先级（数字越小越先做）
passes             ← 是否已完成（初始全部设 false）
notes              ← 给 AI 的额外提示
```

**关键原则：每个故事要小到一轮就能完成。**

| 适合的故事粒度 | 太大的故事（需要拆分） |
|----------------|----------------------|
| 创建一个数据库表 | "搭建整个后端" |
| 添加一个 API 接口 | "实现用户系统" |
| 写一个 UI 组件 | "重构前端架构" |
| 添加一个表单验证 | "完成整个页面" |

---

## 结合 Claude Code 的完整工作流

Ralph 内置了两个 Claude Code 技能（Skill），帮你从零开始自动化整个流程：

| 技能 | 作用 | 触发方式 |
|------|------|----------|
| **prd** | 根据功能描述生成结构化 PRD 文档 | 告诉 Claude Code "帮我创建一个 PRD" |
| **ralph** | 将 PRD 文档转换为 prd.json 格式 | 告诉 Claude Code "把这个 PRD 转为 prd.json" |

### 工作流总览

```
用 prd 技能生成 PRD → 用 ralph 技能转为 prd.json → ralph 自动执行 → 检查结果
```

### 第 1 步：用 prd 技能生成 PRD

在 Claude Code 中，描述你要做的功能：

```
请帮我创建一个 PRD 文档。功能是：[描述你的功能需求]
```

Claude Code 会通过 **prd 技能** 自动：
1. 问你几个关键问题（目标用户、核心功能、范围等），你只需回答如 "1A, 2C, 3B"
2. 根据你的回答生成结构化 PRD 文档
3. 保存到 `tasks/prd-[功能名].md`

> **prd 技能的价值**：自动拆分用户故事、生成可验证的验收标准、明确功能边界，避免需求模糊导致 AI 实现跑偏。

### 第 2 步：用 ralph 技能转为 prd.json

继续在 Claude Code 中：

```
请把这个 PRD 转换为 prd.json 格式
```

Claude Code 会通过 **ralph 技能** 自动：
1. 将每个用户故事转为 JSON 格式，确保粒度足够小（一轮能完成）
2. 按依赖关系排序（数据库 → 后端 → 前端）
3. 为每个故事添加可验证的验收标准
4. 保存为 `prd.json`

> **ralph 技能的价值**：自动处理故事拆分和排序，避免人工编排时遗漏依赖关系或故事过大导致 AI 做不完。

### 第 3 步：运行 Ralph

```bash
ralph
```

### 第 4 步：查看结果

```bash
# 查看哪些故事完成了
cat prd.json | grep -A1 '"id"' | grep passes

# 查看详细的进度和经验记录
cat progress.txt

# 查看 git 提交记录
git log --oneline -10
```

---

## 运行命令参考

```bash
ralph              # 默认最多 10 轮迭代
ralph 20           # 指定最多 20 轮
ralph --config ./path/to/project   # 指定项目目录
node ralph.js      # 不用全局安装，直接运行
```

---

## 每轮迭代发生了什么

```
┌──────────────────────────────────────────────────┐
│  1. 读取 prd.json，找到下一条 passes: false 的故事 │
│  2. 拼装上下文（PRD + 项目约定 + 故事详情）        │
│  3. 启动 Claude Code 会话                         │
│  4. Claude Code 阅读代码 → 实现 → 测试 → 提交     │
│  5. Ralph 验证：                                  │
│     ├─ prd.json 是否被损坏？                      │
│     ├─ 是否有对应的 git commit？                   │
│     └─ 自动标记 passes: true                      │
│  6. 记录进度到 progress.txt                       │
│  7. 等待冷却，进入下一轮                           │
└──────────────────────────────────────────────────┘
```

### 记忆如何在轮次间传递

每轮是全新的 Claude Code 会话，但通过三个文件保持记忆连续：

| 文件 | 作用 |
|------|------|
| `prd.json` | 记录哪些故事已完成（passes: true） |
| `progress.txt` | 记录每轮的成果和经验教训（给下一轮的 AI 看） |
| git 历史 | 所有代码变更都在 git 里，AI 可以 git log 查看 |

---

## 项目文件说明

```
你的项目/
├── prd.json              ← 需求清单（你写的）
├── progress.txt          ← 进度日志（自动生成）
├── RALPH.md              ← AI 行为指令（可选，自定义 AI 规则）
├── CLAUDE.md             ← 项目约定（可选，Claude Code 自动读取）
├── ralph.config.json     ← 配置文件（可选，不创建就用默认值）
└── src/                  ← 你的项目代码

ralph-longtask/           ← Ralph 工具本身
├── skills/
│   ├── prd/SKILL.md      ← PRD 生成技能（Claude Code 自动调用）
│   └── ralph/SKILL.md    ← PRD 转换技能（Claude Code 自动调用）
├── templates/RALPH.md    ← AI 指令模板
└── ...
```

---

## 自定义 AI 行为（可选）

### 方法 1：创建 RALPH.md

复制模板并修改：

```bash
cp templates/RALPH.md ./RALPH.md
```

在 `RALPH.md` 中定义 AI 应该遵守的规则，例如：
- 你的项目用什么测试框架
- 代码风格约定
- 特定的技术栈要求

### 方法 2：创建 ralph.config.json

需要调整默认行为时创建配置文件：

```json
{
  "maxIterations": 20,
  "cooldownSeconds": 5,
  "claude": {
    "maxTurns": 40
  },
  "prompts": {
    "extraContextPaths": ["./CLAUDE.md", "./docs/**/*.md"],
    "extraInstructions": "请使用 TypeScript strict 模式"
  }
}
```

### 配置项速查

| 配置 | 默认值 | 说明 |
|------|--------|------|
| `maxIterations` | 10 | 最大迭代轮数 |
| `cooldownSeconds` | 3 | 每轮之间的等待秒数 |
| `claude.maxTurns` | 50 | 每轮 Claude Code 的最大对话轮次 |
| `permissionsMode` | "full" | Claude 权限模式 |
| `validation.checkGitCommit` | true | 验证是否有 git commit |
| `validation.patchPrdPasses` | true | 自动标记完成的故事 |

也可以用环境变量覆盖（加 `RALPH_` 前缀）：

```bash
RALPH_MAX_ITERATIONS=20 RALPH_COOLDOWN_SECONDS=0 ralph
```

---

## 常见问题

### Q: Ralph 跑了一半卡住了怎么办？

按 `Ctrl+C` 停止。已完成的提交不会丢失，下次运行会从未完成的故事继续。

### Q: 某个故事总是做不完怎么办？

检查这个故事是不是太大了。把它拆成 2-3 个更小的故事，然后更新 prd.json 重新运行。

### Q: AI 写的代码质量不好怎么办？

1. 在 `RALPH.md` 中添加更明确的编码规范
2. 在故事的 `notes` 字段中给出更具体的指导
3. 在 `acceptanceCriteria` 中增加更严格的验收条件
4. 确保项目有测试（类型检查、单元测试等），Ralph 会自动运行这些检查

### Q: 支持 Windows 吗？

支持。Ralph 已经针对 Windows 做了特殊适配，直接使用即可。

### Q: 需要花钱吗？

Ralph 调用 Claude Code，费用由你的 Claude Code 订阅或 API 用量决定。

---

## 调试技巧

```bash
# 查看哪些故事完成了
node -e "import('fs').then(fs => {
  const p = JSON.parse(fs.readFileSync('./prd.json','utf-8'));
  p.userStories.forEach(s => console.log(s.id, s.passes ? '✓' : '✗', s.title));
})"

# 查看历史经验记录
cat progress.txt

# 查看最近的提交
git log --oneline -10
```

---

## 更多文档

- [详细使用指南](doc/USER_GUIDE.md) — 配置文件、环境变量的完整参考
- [架构设计文档](doc/ralph-cli.md) — 技术实现细节和模块架构

## 参考

- [Geoffrey Huntley 的 Ralph 文章](https://ghuntley.com/ralph/)
- [Claude Code 官方文档](https://docs.anthropic.com/en/docs/claude-code)
