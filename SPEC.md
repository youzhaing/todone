# todone — 文件格式规范

所有实现（Python / JS / …）共享下面这套纯文本格式。只要行为对齐，任何实现都可互换使用同一份数据。

## 文件清单

| 文件 | 作用 |
|---|---|
| `todo.md` | 当前待办池 |
| `done.md` | 按天归档的完成记录 + 每日总结 |
| `recurring.md` | 循环任务定义（月/周/日） |
| `.recurring_state.json` | 循环任务触发状态（脚本维护，不入库） |

文件和脚本默认放在**同一个目录**。

---

## 1. `todo.md`

纯列表。一行一条，`- ` 开头，后面是任务文本。**不支持子任务、复选框**。

```markdown
- 写上月月报
- 改 ltv 模型
- 补 cbr 单元测试
```

可以有空行、HTML 注释、或任意其它行——解析时只看匹配 `^\s*-\s+(?!\[)(.*\S)\s*$` 的行。

**不匹配的行**（保证不会被解析为待办）：

- `- [ ] xxx`（复选框，特意被排除，避免和别人家的 todo 风格冲突）
- 空行、注释、heading

---

## 2. `done.md`

按天分段，每段是一个 `## YYYY-MM-DD Ddd` heading（`Ddd` 是英文三字母周名 Mon/Tue/.../Sun，Monday=Mon）。

段内结构：

```markdown
## 2026-04-21 Tue

- 某件完成的事
- 另一件完成的事

### 📝 今日总结
- 改了什么：xxx
- 为什么：xxx
- 明天继续：xxx
```

规则：

- `### 📝 今日总结` **是固定字面量**，解析器用它定位今日总结子段
- 子段之前的所有 `- xxx` 行都算"今日已完成条目"（供 `td log`、`td summary` 使用）
- 新增 done 条目时：插入到 `### 📝 今日总结` 子段**之前**（如果今天段已存在），或新建今天段

日期段按**倒序**排列（最新的在顶部），方便肉眼和 `td log` 读。

---

## 3. `recurring.md`

按大 heading 分段：`# Monthly` / `# Weekly` / `# Daily`（大小写不敏感）。每段下一行一条 `- xxx`。

```markdown
# Monthly

- 写上月月报
- 异常子渠道核查

# Weekly

- 周会准备

# Daily
```

- 空段允许
- HTML 注释允许
- 段外内容被忽略

触发规则：

- **Monthly**：每个自然月（`YYYY-MM`）把每条任务自动加一次到 `todo.md`
- **Weekly**：每个 ISO 周（`YYYY-Www`）加一次
- **Daily**：每个自然日（`YYYY-MM-DD`）加一次

---

## 4. `.recurring_state.json`

记录每条循环任务"上次触发的周期键"，避免重复注入。

```json
{
  "monthly::写上月月报": "2026-04",
  "weekly::周会准备": "2026-W17",
  "daily::站会": "2026-04-21"
}
```

键格式：`{period}::{task}`  
值：当前周期对应的字符串（`YYYY-MM` / `YYYY-Www` / `YYYY-MM-DD`）

脚本在每次启动时做一次 `check_recurring`：对每条 recurring 任务，如果 state 里的周期键 ≠ 当前周期键，就把任务加进 `todo.md` 并更新 state。

---

## 5. 命令语义

任何实现都应提供下面这些命令，行为一致：

| 命令 | 行为 |
|---|---|
| `td` / `td ls` | 打印当前待办（带编号） |
| `td add "x"` | 往 `todo.md` 末尾追加 `- x` |
| `td edit <N\|kw> "y"` | 把第 N 条（或关键词命中的那条）改写成 `- y` |
| `td done <N\|kw>` | 从 `todo.md` 删掉，同时追加到 `done.md` 今天段 |
| `td did "x"` | 直接往 `done.md` 今天段追加，不经过 todo |
| `td rm <N\|kw>` | 从 `todo.md` 删掉，不记 done |
| `td log [days]` | 打印最近 days 天（默认 7）的 done 段 |
| `td recur` | 打印 recurring.md 里的任务及触发状态 |
| `td summary` | 在 `done.md` 今天段追加总结模板（幂等）+ 打印参考信息包 |

关键词解析：

- 全数字 → 编号
- 否则 → 在 items 里做 substring（lowercase）匹配，命中多条要提示用编号

---

## 6. 可选行为

- **自动同步**：如果脚本所在目录是 git 仓库，每次命令结束后 `git add -A && git commit -m "auto: td ..."`，再后台 `git push`（失败不报错）。`TD_NOSYNC=1` 环境变量可关闭。
- **参考信息包**：`td summary` 执行后从 stdout 打印当前 git 状态、未提交改动、待办、今日 done，供 AI / 人肉复盘用。
