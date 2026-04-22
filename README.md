# todone

极简 CLI：一个 todo 池 + 一个按天归档的 done log，全都是 Markdown 纯文本。

- `todo.md`：当前待办
- `done.md`：每天做了什么（附可选的每日总结）
- `recurring.md`：月/周/日循环任务，自动回填到 todo

**两份实现，数据互通**：用 Python 或 Node 都行，操作的是同一套 md 文件。

## 快速开始

### Python 版

```bash
git clone https://github.com/<you>/todone.git
cd todone/python

# 复制脚本和模板到你想放 todo 数据的地方
mkdir -p ~/notes/td
cp td.py ~/notes/td/
cp ../template/*.md ~/notes/td/

# 建议加个别名
echo 'alias td="python3 ~/notes/td/td.py"' >> ~/.zshrc && source ~/.zshrc

td add "试试 todone"
td
td done 1
td log
```

### JS 版（Node 18+）

```bash
git clone https://github.com/<you>/todone.git
cd todone/js

mkdir -p ~/notes/td
cp td.js ~/notes/td/
cp ../template/*.md ~/notes/td/

echo 'alias td="node ~/notes/td/td.js"' >> ~/.zshrc && source ~/.zshrc

td add "试试 todone"
td
```

或用 `npm link` 装成全局 `td` 命令：

```bash
cd todone/js
npm link
td add "xxx"   # 注意：这样使用时数据会落在 js/ 目录里
```

## 命令速查

```
td                          列出待办
td add "xxx"                追加一条
td edit <N|关键词> "新内容"  修改
td done <N|关键词>           完成（自动挪到 done.md 今天段）
td did "xxx"                直接记 done，不经过 todo
td rm <N|关键词>             放弃一条
td log [days]               最近 days 天的完成记录（默认 7）
td recur                    查看循环任务
td summary                  写今日总结模板 + 打印参考信息
```

## 文件格式

所有 md 文件都是裸文本，肉眼就能读/改。完整格式规范见 [SPEC.md](./SPEC.md)。

## 循环任务

在 `recurring.md` 里按 `# Monthly / # Weekly / # Daily` 分段写：

```markdown
# Monthly
- 写上月月报

# Weekly
- 周会准备

# Daily
```

脚本每次运行会自动检查并回填到 `todo.md`（每周期只加一次）。状态存在 `.recurring_state.json`，不要手改。

## 自动同步到 GitHub（可选）

如果 `td.py` / `td.js` 所在目录本身是个 git 仓库，每次命令后脚本会**静默** `git add -A && git commit && git push`。  
关闭这行为：`export TD_NOSYNC=1`。

典型用法：把你的数据目录（存放 todo.md / done.md 等）设成一个私有 git 仓库，备份到 GitHub，自己无感同步。

## 实现状态

- ✅ Python（`python/td.py`）— 参考实现
- ✅ JavaScript / Node（`js/td.js`）— 对齐 Python 行为
- 欢迎 PR 其它语言（Go、Rust、Bash……），只要遵循 [SPEC.md](./SPEC.md)

## License

MIT
