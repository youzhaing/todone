#!/usr/bin/env python3
"""td — 极简 todo + done log。

文件：
    todo/todo.md               当前待办池（纯列表，一行一个 `- xxx`）
    todo/done.md               按天归档的完成记录（`## YYYY-MM-DD Ddd` 分段）
    todo/recurring.md          循环任务定义（Monthly / Weekly / Daily）
    todo/.recurring_state.json 循环任务触发状态（脚本维护）

命令：
    td                  列出当前 todo，带编号
    td add "xxx"        追加一条 todo
    td edit <N|kw> "y"  修改第 N 条（或关键词匹配）为新内容 y
    td done <N|kw>      完成第 N 条 / 模糊匹配关键词；自动挪到 done.md 今天
    td did "xxx"        直接往 done.md 今天段追加一条（不经过 todo）
    td rm <N|kw>        放弃一条 todo，不记 done
    td log [days]       打印最近 days 天（默认 7）的 done 记录
    td recur            查看循环任务规则及触发状态
    td summary          在 done.md 今天段追加总结模板 + 打印参考信息包
    td -h               帮助
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
TODO_FILE = HERE / "todo.md"
DONE_FILE = HERE / "done.md"
RECUR_FILE = HERE / "recurring.md"
RECUR_STATE = HERE / ".recurring_state.json"
WEEK_EN = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

ITEM_RE = re.compile(r"^\s*-\s+(?!\[)(.*\S)\s*$")

RECUR_PERIODS = {
    "monthly": lambda now: now.strftime("%Y-%m"),
    "weekly": lambda now: now.strftime("%G-W%V"),
    "daily": lambda now: now.strftime("%Y-%m-%d"),
}


def today_heading() -> str:
    now = datetime.now()
    return f"## {now.strftime('%Y-%m-%d')} {WEEK_EN[now.weekday()]}"


def today_date() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def ensure_file(p: Path, intro: str) -> None:
    if not p.exists():
        p.write_text(intro, encoding="utf-8")


def read_lines(p: Path) -> list[str]:
    ensure_file(p, "")
    return p.read_text(encoding="utf-8").splitlines()


def write_lines(p: Path, lines: list[str]) -> None:
    text = "\n".join(lines).rstrip() + "\n"
    p.write_text(text, encoding="utf-8")


def load_todo_items() -> tuple[list[str], list[int], list[str]]:
    """读 todo.md，返回 (原始行, 待办项对应的行号 list, 待办项文本 list)。"""
    lines = read_lines(TODO_FILE)
    idx, items = [], []
    for i, line in enumerate(lines):
        m = ITEM_RE.match(line)
        if m:
            idx.append(i)
            items.append(m.group(1))
    return lines, idx, items


def resolve_target(arg: str, items: list[str]) -> int:
    """把 N 或关键词解析为 items 的下标。"""
    if not items:
        raise SystemExit("[td] 当前没有待办。")

    if arg.isdigit():
        n = int(arg)
        if n < 1 or n > len(items):
            raise SystemExit(f"[td] 编号 {n} 超范围，当前共 {len(items)} 条。")
        return n - 1

    kw = arg.lower()
    hits = [i for i, it in enumerate(items) if kw in it.lower()]
    if not hits:
        raise SystemExit(f"[td] 没有匹配 '{arg}' 的待办。")
    if len(hits) > 1:
        preview = "\n".join(f"  {i + 1}. {items[i]}" for i in hits)
        raise SystemExit(f"[td] '{arg}' 命中多条，请用编号：\n{preview}")
    return hits[0]


def cmd_ls() -> None:
    _, _, items = load_todo_items()
    if not items:
        print("[td] 当前无待办。用 td add \"xxx\" 加一条。")
    else:
        width = len(str(len(items)))
        for i, it in enumerate(items, 1):
            print(f"  {str(i).rjust(width)}. {it}")

    done_today = count_done_today()
    if done_today:
        print(f"\n今日已完成：{done_today} 条  (td log 查看)")


def cmd_add(content: str) -> None:
    content = content.strip()
    if not content:
        raise SystemExit("[td] 内容不能为空：td add \"你要做的事\"")

    lines = read_lines(TODO_FILE)
    lines.append(f"- {content}")
    write_lines(TODO_FILE, lines)
    print(f"[td] 已加入 todo: {content}")


def cmd_done(arg: str) -> None:
    lines, idx, items = load_todo_items()
    pos = resolve_target(arg, items)
    text = items[pos]
    line_no = idx[pos]

    del lines[line_no]
    write_lines(TODO_FILE, lines)

    append_to_done_today(text)
    print(f"[td] 完成: {text}")


def cmd_edit(arg: str, new_content: str) -> None:
    new_content = new_content.strip()
    if not new_content:
        raise SystemExit("[td] 新内容不能为空：td edit <N|关键词> \"新内容\"")

    lines, idx, items = load_todo_items()
    pos = resolve_target(arg, items)
    old = items[pos]
    line_no = idx[pos]

    lines[line_no] = f"- {new_content}"
    write_lines(TODO_FILE, lines)
    print(f"[td] 已修改:\n     旧: {old}\n     新: {new_content}")


def cmd_rm(arg: str) -> None:
    lines, idx, items = load_todo_items()
    pos = resolve_target(arg, items)
    text = items[pos]
    line_no = idx[pos]

    del lines[line_no]
    write_lines(TODO_FILE, lines)
    print(f"[td] 已删除: {text}")


def append_to_done_today(text: str) -> None:
    ensure_file(DONE_FILE, "")
    raw = DONE_FILE.read_text(encoding="utf-8")

    heading_re = re.compile(r"(?m)^## (\d{4}-\d{2}-\d{2})\b.*$")
    m_list = list(heading_re.finditer(raw))

    if m_list:
        prologue = raw[: m_list[0].start()]
        sections = [
            raw[mm.start() : (m_list[i + 1].start() if i + 1 < len(m_list) else len(raw))]
            for i, mm in enumerate(m_list)
        ]
    else:
        prologue = raw
        sections = []

    td = today_date()
    new_line = f"- {text}"
    merged = False
    for i, sec in enumerate(sections):
        if sec.startswith(f"## {td}"):
            sub = re.search(r"(?m)^###\s", sec)
            if sub:
                before = sec[: sub.start()].rstrip()
                after = sec[sub.start() :]
                sections[i] = before + "\n" + new_line + "\n\n" + after
            else:
                sections[i] = sec.rstrip() + "\n" + new_line
            merged = True
            break

    if not merged:
        sections.insert(0, today_heading() + "\n\n" + new_line)

    parts = []
    prologue = prologue.strip()
    if prologue:
        parts.append(prologue)
    parts.extend(sec.strip() for sec in sections)
    DONE_FILE.write_text("\n\n".join(parts) + "\n", encoding="utf-8")


def today_done_items() -> list[str]:
    """抓 done.md 今天段里、在 `### ` 子 heading 之前的 `-` 条目。"""
    if not DONE_FILE.exists():
        return []
    raw = DONE_FILE.read_text(encoding="utf-8")
    td = today_date()
    m = re.search(rf"(?m)^## {td}\b.*?$", raw)
    if not m:
        return []
    start = m.end()
    next_m = re.search(r"(?m)^## \d{4}-\d{2}-\d{2}\b", raw[start:])
    section = raw[start : start + next_m.start()] if next_m else raw[start:]
    sub = re.search(r"(?m)^###\s", section)
    if sub:
        section = section[: sub.start()]
    return [m.group(1) for m in (ITEM_RE.match(ln) for ln in section.splitlines()) if m]


def count_done_today() -> int:
    return len(today_done_items())


def cmd_log(days_arg: str | None) -> None:
    days = 7
    if days_arg:
        if not days_arg.isdigit():
            raise SystemExit("[td] 用法：td log [days]")
        days = int(days_arg)

    if not DONE_FILE.exists():
        print("[td] 还没有完成记录。")
        return

    raw = DONE_FILE.read_text(encoding="utf-8")
    heading_re = re.compile(r"(?m)^## (\d{4}-\d{2}-\d{2})\b.*$")
    m_list = list(heading_re.finditer(raw))
    if not m_list:
        print("[td] 还没有完成记录。")
        return

    cutoff = datetime.now().date() - timedelta(days=days - 1)
    printed = 0
    for i, mm in enumerate(m_list):
        date_str = mm.group(1)
        try:
            d = datetime.strptime(date_str, "%Y-%m-%d").date()
        except ValueError:
            continue
        if d < cutoff:
            break
        start = mm.start()
        end = m_list[i + 1].start() if i + 1 < len(m_list) else len(raw)
        block = raw[start:end]
        sub = re.search(r"(?m)^###\s", block)
        if sub:
            block = block[: sub.start()]
        print(block.rstrip())
        print()
        printed += 1

    if printed == 0:
        print(f"[td] 最近 {days} 天没有完成记录。")


# ---------- 循环任务 ----------

def parse_recurring() -> dict[str, list[str]]:
    """解析 recurring.md，返回 {period: [task1, task2, ...]}。"""
    result: dict[str, list[str]] = {"monthly": [], "weekly": [], "daily": []}
    if not RECUR_FILE.exists():
        return result

    current: str | None = None
    for raw in RECUR_FILE.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line:
            continue
        mh = re.match(r"^# \s*(monthly|weekly|daily)\s*$", line, re.IGNORECASE)
        if mh:
            current = mh.group(1).lower()
            continue
        if line.startswith("#"):
            current = None
            continue
        if current is None:
            continue
        mi = ITEM_RE.match(line)
        if mi:
            result[current].append(mi.group(1))
    return result


def load_recur_state() -> dict[str, str]:
    if not RECUR_STATE.exists():
        return {}
    try:
        return json.loads(RECUR_STATE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def save_recur_state(state: dict[str, str]) -> None:
    RECUR_STATE.write_text(
        json.dumps(state, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def check_recurring() -> None:
    """把当前周期内未触发过的循环任务加进 todo.md。静默操作，失败不报错。"""
    rules = parse_recurring()
    state = load_recur_state()
    now = datetime.now()
    dirty = False
    added: list[str] = []

    _, _, existing = load_todo_items()
    existing_set = set(existing)

    for period, tasks in rules.items():
        key_fn = RECUR_PERIODS[period]
        current_key = key_fn(now)
        for task in tasks:
            state_key = f"{period}::{task}"
            if state.get(state_key) == current_key:
                continue
            if task not in existing_set:
                lines = read_lines(TODO_FILE)
                lines.append(f"- {task}")
                write_lines(TODO_FILE, lines)
                existing_set.add(task)
                added.append(f"[{period}] {task}")
            state[state_key] = current_key
            dirty = True

    if dirty:
        save_recur_state(state)
    if added:
        print("[td] 本周期新加入的循环任务：")
        for a in added:
            print(f"     + {a}")


def cmd_recur() -> None:
    rules = parse_recurring()
    state = load_recur_state()
    now = datetime.now()

    total = sum(len(v) for v in rules.values())
    if total == 0:
        print(f"[td] {RECUR_FILE.name} 里还没有循环任务。按 Monthly / Weekly / Daily 分段填写即可。")
        return

    for period in ("monthly", "weekly", "daily"):
        tasks = rules[period]
        if not tasks:
            continue
        current_key = RECUR_PERIODS[period](now)
        label = {"monthly": "Monthly", "weekly": "Weekly", "daily": "Daily"}[period]
        print(f"# {label}  (当前周期 {current_key})")
        for task in tasks:
            last = state.get(f"{period}::{task}")
            mark = "✓ 本期已触发" if last == current_key else f"· 上次 {last or '—'}"
            print(f"  - {task}  {mark}")
        print()


# ---------- 每日总结 ----------

SUMMARY_HEADING = "### 📝 今日总结"
SUMMARY_TEMPLATE = [
    SUMMARY_HEADING,
    "- 改了什么：",
    "- 为什么：",
    "- 明天继续：",
]


def _run(cmd: list[str]) -> str:
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        return (r.stdout or "").rstrip()
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return ""


def collect_context() -> str:
    """拼一份参考信息包给 stdout：git / done / todo。"""
    out: list[str] = []

    toplevel = _run(["git", "rev-parse", "--show-toplevel"])
    if toplevel:
        out.append(f"## Git repo\n{toplevel}")

        commits = _run(
            ["git", "log", "--since=midnight", "--pretty=format:%h %s", "--no-merges"]
        )
        out.append("\n## 今日 commits")
        out.append(commits if commits else "（还没 commit）")

        stat = _run(["git", "diff", "--stat", "HEAD"])
        status = _run(["git", "status", "-s"])
        out.append("\n## 未提交改动 (git status -s)")
        out.append(status if status else "（工作区干净）")
        if stat:
            out.append("\n## 未提交改动 diff --stat")
            out.append(stat)
    else:
        out.append("## Git repo\n（当前目录不在 git 仓库内，跳过 git 信息）")

    _, _, todo_items = load_todo_items()
    out.append("\n## 当前未完成 todo")
    out.append("\n".join(f"- {t}" for t in todo_items) if todo_items else "（空）")

    out.append("\n## 今日已完成 done")
    items = today_done_items()
    out.append("\n".join(f"- {it}" for it in items) if items else "（今天还没 done）")

    return "\n".join(out)


def cmd_summary() -> None:
    ensure_file(DONE_FILE, "")
    raw = DONE_FILE.read_text(encoding="utf-8")

    heading_re = re.compile(r"(?m)^## (\d{4}-\d{2}-\d{2})\b.*$")
    m_list = list(heading_re.finditer(raw))

    td = today_date()
    today_idx = next((i for i, mm in enumerate(m_list) if mm.group(1) == td), None)

    template_inserted = False
    if today_idx is None:
        prologue = raw.rstrip()
        parts = [prologue] if prologue else []
        parts.append(today_heading() + "\n\n" + "\n".join(SUMMARY_TEMPLATE))
        DONE_FILE.write_text("\n\n".join(parts) + "\n", encoding="utf-8")
        template_inserted = True
    else:
        start = m_list[today_idx].start()
        end = (
            m_list[today_idx + 1].start()
            if today_idx + 1 < len(m_list)
            else len(raw)
        )
        section = raw[start:end]
        if SUMMARY_HEADING not in section:
            new_section = section.rstrip() + "\n\n" + "\n".join(SUMMARY_TEMPLATE) + "\n"
            DONE_FILE.write_text(raw[:start] + new_section + raw[end:], encoding="utf-8")
            template_inserted = True

    if template_inserted:
        print(f"[td] 已追加总结模板。文件: {DONE_FILE}")
    else:
        print(f"[td] 今天段已有总结模板，本次未改动。文件: {DONE_FILE}")

    print()
    print(collect_context())


def cmd_did(content: str) -> None:
    """往 done.md 今天段 done 列表直接追加一条（不经过 todo 池）。"""
    content = content.strip()
    if not content:
        raise SystemExit("[td] 内容不能为空：td did \"你做了的事\"")
    if content in today_done_items():
        print(f"[td] 今天已记过: {content}")
        return
    append_to_done_today(content)
    print(f"[td] 已记为今日完成: {content}")


# ---------- 自动同步到 GitHub ----------

def auto_sync() -> None:
    """若 todo/ 是 git repo，静默 commit 本次改动并后台 push。失败无影响。

    通过 `TD_NOSYNC=1` 环境变量可临时关闭（离线或测试时）。
    """
    if os.environ.get("TD_NOSYNC"):
        return
    if not (HERE / ".git").exists():
        return
    try:
        subprocess.run(
            ["git", "-C", str(HERE), "add", "-A"],
            capture_output=True, timeout=5,
        )
        rc = subprocess.run(
            ["git", "-C", str(HERE), "diff", "--cached", "--quiet"],
            capture_output=True, timeout=5,
        ).returncode
        if rc == 0:
            return
        msg = f"auto: td {datetime.now().strftime('%Y-%m-%d %H:%M')}"
        subprocess.run(
            ["git", "-C", str(HERE), "commit", "-m", msg],
            capture_output=True, timeout=5,
        )
        subprocess.Popen(
            ["git", "-C", str(HERE), "push", "--quiet"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
    except Exception:
        pass


HELP = """td — 极简 todo + done log

  td                          列出当前 todo
  td add "xxx"                追加一条 todo
  td edit <N|关键词> "新内容" 修改某条 todo 的文字
  td done <N|关键词>          完成某条（挪到 done.md 今天）
  td did "xxx"                直接往 done.md 今天段追加一条（不经过 todo）
  td rm <N|关键词>            放弃某条（从 todo.md 删掉，不记 done）
  td log [days]               查看最近 days 天的完成记录（默认 7）
  td recur                    查看循环任务规则及触发状态
  td summary                  在 done.md 今天段追加总结模板 + 打印参考信息包
  td -h                       帮助
"""


def main(argv: list[str]) -> None:
    first = argv[0] if argv else ""

    if first in {"-h", "--help", "help"}:
        print(HELP)
        return

    check_recurring()

    rest = argv[1:]

    if not argv or first in {"ls", "list"}:
        cmd_ls()
    elif first == "recur":
        cmd_recur()
    elif first in {"summary", "sum"}:
        cmd_summary()
    elif first == "add":
        if not rest:
            raise SystemExit("[td] 用法：td add \"你要做的事\"")
        cmd_add(" ".join(rest))
    elif first == "edit":
        if len(rest) < 2:
            raise SystemExit("[td] 用法：td edit <编号|关键词> \"新内容\"")
        cmd_edit(rest[0], " ".join(rest[1:]))
    elif first == "done":
        if not rest:
            raise SystemExit("[td] 用法：td done <编号|关键词>")
        cmd_done(" ".join(rest))
    elif first == "did":
        if not rest:
            raise SystemExit("[td] 用法：td did \"你做了的事\"")
        cmd_did(" ".join(rest))
    elif first == "rm":
        if not rest:
            raise SystemExit("[td] 用法：td rm <编号|关键词>")
        cmd_rm(" ".join(rest))
    elif first == "log":
        cmd_log(rest[0] if rest else None)
    else:
        raise SystemExit(f"[td] 未知命令：{first}\n{HELP}")

    auto_sync()


if __name__ == "__main__":
    main(sys.argv[1:])
