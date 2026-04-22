# daily-summary — Cursor Skill

让 Cursor 在你说「日报 / 总结今天 / summary」时，**自动**：

1. 跑 `td summary` 收集当天的 git 改动 + todo / done 状态
2. 总结一条核心产出 → `td did "..."`
3. 写一段 3 行的「今日总结」覆盖 `done.md` 里的模板占位符
4. 把"明天继续"同步进 `todo.md`

## 安装

需要 Cursor IDE。复制这个目录到你的 Cursor skills 路径：

```bash
mkdir -p ~/.cursor/skills
cp -r daily-summary ~/.cursor/skills/
```

确认装好：在 Cursor chat 里跟 AI 说"日报"或"summary"，它应该会按 SKILL.md 的流程跑。

## 前置条件

- 已安装 `todone`（参见仓库根 [README](../../../../README.md)）
- `td` 命令在 PATH 里能直接调用（用别名或 `npm link`）；否则 skill 会改用绝对路径

## 自定义

`SKILL.md` 是纯文本，自己改：

- 想加更多触发词 → 改 frontmatter 的 `description`
- 想改总结模板（比如改成 4 行、加"风险提醒"）→ 改"写总结（三行精简版）"那节
- 想跳过 `td did` 那步（不加 done 条目，只写总结）→ 删掉第 2 节即可
