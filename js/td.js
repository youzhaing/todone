#!/usr/bin/env node
/**
 * td — 极简 todo + done log（JS / Node 实现）
 *
 * 行为对齐 python/td.py，操作同一份 md 文件格式。完整规范见 SPEC.md。
 *
 * 文件：
 *   todo.md               当前待办池
 *   done.md               按天归档的完成记录
 *   recurring.md          循环任务定义
 *   .recurring_state.json 循环任务触发状态（脚本维护）
 *
 * 命令：见 `td -h` 或仓库 README
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync, spawn } = require('child_process');

const HERE = __dirname;
const TODO_FILE = path.join(HERE, 'todo.md');
const DONE_FILE = path.join(HERE, 'done.md');
const RECUR_FILE = path.join(HERE, 'recurring.md');
const RECUR_STATE = path.join(HERE, '.recurring_state.json');
const WEEK_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const ITEM_RE = /^\s*-\s+(?!\[)(.*\S)\s*$/;

// ---------- 日期工具 ----------

function pad2(n) {
  return String(n).padStart(2, '0');
}

function pyWeekdayIdx(d) {
  // Python weekday: Mon=0, Sun=6；JS getDay: Sun=0, Sat=6
  return (d.getDay() + 6) % 7;
}

function todayDate() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function todayHeading() {
  const d = new Date();
  return `## ${todayDate()} ${WEEK_EN[pyWeekdayIdx(d)]}`;
}

function isoWeekKey(d) {
  // 复制 Python strftime %G-W%V：ISO 周年 + 周号（含 Jan 4 的周是 W01）
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${pad2(weekNum)}`;
}

const RECUR_PERIOD_KEY = {
  monthly: (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`,
  weekly: (d) => isoWeekKey(d),
  daily: (d) => todayDate(),
};

// ---------- 文件 IO ----------

function ensureFile(p, intro) {
  if (!fs.existsSync(p)) fs.writeFileSync(p, intro, 'utf-8');
}

function readLines(p) {
  ensureFile(p, '');
  const raw = fs.readFileSync(p, 'utf-8');
  // 去掉最后可能的尾随换行对应的空行
  return raw.length === 0 ? [] : raw.replace(/\n$/, '').split('\n');
}

function writeLines(p, lines) {
  const text = lines.join('\n').replace(/\s+$/, '') + '\n';
  fs.writeFileSync(p, text, 'utf-8');
}

// ---------- todo 解析 ----------

function loadTodoItems() {
  const lines = readLines(TODO_FILE);
  const idx = [];
  const items = [];
  lines.forEach((line, i) => {
    const m = line.match(ITEM_RE);
    if (m) {
      idx.push(i);
      items.push(m[1]);
    }
  });
  return { lines, idx, items };
}

function resolveTarget(arg, items) {
  if (items.length === 0) die('[td] 当前没有待办。');

  if (/^\d+$/.test(arg)) {
    const n = parseInt(arg, 10);
    if (n < 1 || n > items.length) {
      die(`[td] 编号 ${n} 超范围，当前共 ${items.length} 条。`);
    }
    return n - 1;
  }

  const kw = arg.toLowerCase();
  const hits = [];
  items.forEach((it, i) => {
    if (it.toLowerCase().includes(kw)) hits.push(i);
  });
  if (hits.length === 0) die(`[td] 没有匹配 '${arg}' 的待办。`);
  if (hits.length > 1) {
    const preview = hits.map((i) => `  ${i + 1}. ${items[i]}`).join('\n');
    die(`[td] '${arg}' 命中多条，请用编号：\n${preview}`);
  }
  return hits[0];
}

function die(msg) {
  const err = new Error(msg);
  err.isUserError = true;
  throw err;
}

// ---------- 基础命令 ----------

function cmdLs() {
  const { items } = loadTodoItems();
  if (items.length === 0) {
    console.log('[td] 当前无待办。用 td add "xxx" 加一条。');
  } else {
    const width = String(items.length).length;
    items.forEach((it, i) => {
      console.log(`  ${String(i + 1).padStart(width)}. ${it}`);
    });
  }
  const n = countDoneToday();
  if (n) console.log(`\n今日已完成：${n} 条  (td log 查看)`);
}

function cmdAdd(content) {
  content = content.trim();
  if (!content) die('[td] 内容不能为空：td add "你要做的事"');
  const lines = readLines(TODO_FILE);
  lines.push(`- ${content}`);
  writeLines(TODO_FILE, lines);
  console.log(`[td] 已加入 todo: ${content}`);
}

function cmdDone(arg) {
  const { lines, idx, items } = loadTodoItems();
  const pos = resolveTarget(arg, items);
  const text = items[pos];
  const lineNo = idx[pos];
  lines.splice(lineNo, 1);
  writeLines(TODO_FILE, lines);
  appendToDoneToday(text);
  console.log(`[td] 完成: ${text}`);
}

function cmdEdit(arg, newContent) {
  newContent = newContent.trim();
  if (!newContent) die('[td] 新内容不能为空：td edit <N|关键词> "新内容"');
  const { lines, idx, items } = loadTodoItems();
  const pos = resolveTarget(arg, items);
  const old = items[pos];
  lines[idx[pos]] = `- ${newContent}`;
  writeLines(TODO_FILE, lines);
  console.log(`[td] 已修改:\n     旧: ${old}\n     新: ${newContent}`);
}

function cmdRm(arg) {
  const { lines, idx, items } = loadTodoItems();
  const pos = resolveTarget(arg, items);
  const text = items[pos];
  lines.splice(idx[pos], 1);
  writeLines(TODO_FILE, lines);
  console.log(`[td] 已删除: ${text}`);
}

// ---------- done.md 读写 ----------

const DONE_HEADING_RE = /^## (\d{4}-\d{2}-\d{2})\b.*$/gm;

function splitDoneSections(raw) {
  const matches = [];
  let m;
  const re = new RegExp(DONE_HEADING_RE.source, DONE_HEADING_RE.flags);
  while ((m = re.exec(raw)) !== null) {
    matches.push({ start: m.index, date: m[1] });
  }
  if (matches.length === 0) return { prologue: raw, sections: [] };
  const prologue = raw.slice(0, matches[0].start);
  const sections = [];
  for (let i = 0; i < matches.length; i++) {
    const s = matches[i].start;
    const e = i + 1 < matches.length ? matches[i + 1].start : raw.length;
    sections.push(raw.slice(s, e));
  }
  return { prologue, sections };
}

function sectionDateKey(sec) {
  const m = sec.match(/^## (\d{4}-\d{2}-\d{2})\b/);
  return m ? m[1] : '';
}

function writeDone(prologue, sections) {
  const sorted = sections.slice().sort((a, b) => {
    const ka = sectionDateKey(a);
    const kb = sectionDateKey(b);
    if (!ka && kb) return 1;
    if (ka && !kb) return -1;
    return kb.localeCompare(ka);
  });
  const parts = [];
  const trimmedProl = prologue.trim();
  if (trimmedProl) parts.push(trimmedProl);
  sorted.forEach((s) => parts.push(s.trim()));
  fs.writeFileSync(DONE_FILE, parts.join('\n\n') + '\n', 'utf-8');
}

function appendToDoneToday(text) {
  ensureFile(DONE_FILE, '');
  const raw = fs.readFileSync(DONE_FILE, 'utf-8');
  const { prologue, sections } = splitDoneSections(raw);

  const td = todayDate();
  const newLine = `- ${text}`;
  let merged = false;

  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    if (sec.startsWith(`## ${td}`)) {
      const subMatch = sec.match(/^###\s/m);
      if (subMatch) {
        const subIdx = sec.indexOf(subMatch[0]);
        const before = sec.slice(0, subIdx).replace(/\s+$/, '');
        const after = sec.slice(subIdx);
        sections[i] = `${before}\n${newLine}\n\n${after}`;
      } else {
        sections[i] = `${sec.replace(/\s+$/, '')}\n${newLine}`;
      }
      merged = true;
      break;
    }
  }

  if (!merged) {
    sections.push(`${todayHeading()}\n\n${newLine}`);
  }

  writeDone(prologue, sections);
}

function todayDoneItems() {
  if (!fs.existsSync(DONE_FILE)) return [];
  const raw = fs.readFileSync(DONE_FILE, 'utf-8');
  const td = todayDate();
  const headRe = new RegExp(`^## ${td}\\b.*$`, 'm');
  const h = raw.match(headRe);
  if (!h) return [];
  const start = h.index + h[0].length;
  const after = raw.slice(start);
  const nextM = after.match(/^## \d{4}-\d{2}-\d{2}\b/m);
  let section = nextM ? after.slice(0, nextM.index) : after;
  const subM = section.match(/^###\s/m);
  if (subM) section = section.slice(0, subM.index);
  const out = [];
  section.split('\n').forEach((ln) => {
    const mm = ln.match(ITEM_RE);
    if (mm) out.push(mm[1]);
  });
  return out;
}

function countDoneToday() {
  return todayDoneItems().length;
}

function cmdDid(content) {
  content = content.trim();
  if (!content) die('[td] 内容不能为空：td did "你做了的事"');
  if (todayDoneItems().includes(content)) {
    console.log(`[td] 今天已记过: ${content}`);
    return;
  }
  appendToDoneToday(content);
  console.log(`[td] 已记为今日完成: ${content}`);
}

function cmdLog(daysArg) {
  let days = 7;
  if (daysArg != null) {
    if (!/^\d+$/.test(daysArg)) die('[td] 用法：td log [days]');
    days = parseInt(daysArg, 10);
  }
  if (!fs.existsSync(DONE_FILE)) {
    console.log('[td] 还没有完成记录。');
    return;
  }
  const raw = fs.readFileSync(DONE_FILE, 'utf-8');
  const headingRe = /^## (\d{4}-\d{2}-\d{2})\b.*$/gm;
  const matches = [];
  let mm;
  while ((mm = headingRe.exec(raw)) !== null) {
    matches.push({ start: mm.index, date: mm[1] });
  }
  if (matches.length === 0) {
    console.log('[td] 还没有完成记录。');
    return;
  }
  const now = new Date();
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
  let printed = 0;
  for (let i = 0; i < matches.length; i++) {
    const d = new Date(matches[i].date);
    if (isNaN(d.getTime())) continue;
    if (d < cutoff) break;
    const s = matches[i].start;
    const e = i + 1 < matches.length ? matches[i + 1].start : raw.length;
    let block = raw.slice(s, e);
    const subM = block.match(/^###\s/m);
    if (subM) block = block.slice(0, subM.index);
    console.log(block.replace(/\s+$/, ''));
    console.log();
    printed++;
  }
  if (printed === 0) console.log(`[td] 最近 ${days} 天没有完成记录。`);
}

// ---------- 循环任务 ----------

function parseRecurring() {
  const result = { monthly: [], weekly: [], daily: [] };
  if (!fs.existsSync(RECUR_FILE)) return result;
  let current = null;
  fs.readFileSync(RECUR_FILE, 'utf-8')
    .split('\n')
    .forEach((raw) => {
      const line = raw.trim();
      if (!line) return;
      const mh = line.match(/^#\s*(monthly|weekly|daily)\s*$/i);
      if (mh) {
        current = mh[1].toLowerCase();
        return;
      }
      if (line.startsWith('#')) {
        current = null;
        return;
      }
      if (!current) return;
      const mi = line.match(ITEM_RE);
      if (mi) result[current].push(mi[1]);
    });
  return result;
}

function loadRecurState() {
  if (!fs.existsSync(RECUR_STATE)) return {};
  try {
    return JSON.parse(fs.readFileSync(RECUR_STATE, 'utf-8'));
  } catch {
    return {};
  }
}

function saveRecurState(state) {
  const sorted = Object.keys(state)
    .sort()
    .reduce((acc, k) => {
      acc[k] = state[k];
      return acc;
    }, {});
  fs.writeFileSync(RECUR_STATE, JSON.stringify(sorted, null, 2) + '\n', 'utf-8');
}

function checkRecurring() {
  const rules = parseRecurring();
  const state = loadRecurState();
  const now = new Date();
  let dirty = false;
  const added = [];

  const { items: existing } = loadTodoItems();
  const existingSet = new Set(existing);

  for (const period of Object.keys(rules)) {
    const currentKey = RECUR_PERIOD_KEY[period](now);
    for (const task of rules[period]) {
      const stateKey = `${period}::${task}`;
      if (state[stateKey] === currentKey) continue;
      if (!existingSet.has(task)) {
        const lines = readLines(TODO_FILE);
        lines.push(`- ${task}`);
        writeLines(TODO_FILE, lines);
        existingSet.add(task);
        added.push(`[${period}] ${task}`);
      }
      state[stateKey] = currentKey;
      dirty = true;
    }
  }

  if (dirty) saveRecurState(state);
  if (added.length) {
    console.log('[td] 本周期新加入的循环任务：');
    added.forEach((a) => console.log(`     + ${a}`));
  }
}

function cmdRecur() {
  const rules = parseRecurring();
  const state = loadRecurState();
  const now = new Date();
  const total = Object.values(rules).reduce((s, v) => s + v.length, 0);
  if (total === 0) {
    console.log(
      `[td] ${path.basename(RECUR_FILE)} 里还没有循环任务。按 Monthly / Weekly / Daily 分段填写即可。`
    );
    return;
  }
  for (const period of ['monthly', 'weekly', 'daily']) {
    const tasks = rules[period];
    if (!tasks.length) continue;
    const currentKey = RECUR_PERIOD_KEY[period](now);
    const label = { monthly: 'Monthly', weekly: 'Weekly', daily: 'Daily' }[period];
    console.log(`# ${label}  (当前周期 ${currentKey})`);
    tasks.forEach((task) => {
      const last = state[`${period}::${task}`];
      const mark = last === currentKey ? '✓ 本期已触发' : `· 上次 ${last || '—'}`;
      console.log(`  - ${task}  ${mark}`);
    });
    console.log();
  }
}

// ---------- 每日总结 ----------

const SUMMARY_HEADING = '### 📝 今日总结';
const SUMMARY_TEMPLATE = [SUMMARY_HEADING, '- 改了什么：', '- 为什么：', '- 明天继续：'];

function runCmd(cmd, args) {
  try {
    const r = spawnSync(cmd, args, { timeout: 10000, encoding: 'utf-8' });
    return (r.stdout || '').replace(/\s+$/, '');
  } catch {
    return '';
  }
}

function collectContext() {
  const out = [];
  const toplevel = runCmd('git', ['rev-parse', '--show-toplevel']);
  if (toplevel) {
    out.push(`## Git repo\n${toplevel}`);
    const commits = runCmd('git', [
      'log',
      '--since=midnight',
      '--pretty=format:%h %s',
      '--no-merges',
    ]);
    out.push('\n## 今日 commits');
    out.push(commits || '（还没 commit）');
    const stat = runCmd('git', ['diff', '--stat', 'HEAD']);
    const status = runCmd('git', ['status', '-s']);
    out.push('\n## 未提交改动 (git status -s)');
    out.push(status || '（工作区干净）');
    if (stat) {
      out.push('\n## 未提交改动 diff --stat');
      out.push(stat);
    }
  } else {
    out.push('## Git repo\n（当前目录不在 git 仓库内，跳过 git 信息）');
  }

  const { items: todoItems } = loadTodoItems();
  out.push('\n## 当前未完成 todo');
  out.push(todoItems.length ? todoItems.map((t) => `- ${t}`).join('\n') : '（空）');

  out.push('\n## 今日已完成 done');
  const doneItems = todayDoneItems();
  out.push(doneItems.length ? doneItems.map((t) => `- ${t}`).join('\n') : '（今天还没 done）');

  return out.join('\n');
}

function cmdSummary() {
  ensureFile(DONE_FILE, '');
  const raw = fs.readFileSync(DONE_FILE, 'utf-8');
  const { prologue, sections } = splitDoneSections(raw);

  const td = todayDate();
  const todayIdx = sections.findIndex((sec) => sec.startsWith(`## ${td}`));

  let inserted = false;
  if (todayIdx === -1) {
    sections.push(`${todayHeading()}\n\n${SUMMARY_TEMPLATE.join('\n')}`);
    inserted = true;
  } else {
    const sec = sections[todayIdx];
    if (!sec.includes(SUMMARY_HEADING)) {
      sections[todayIdx] =
        sec.replace(/\s+$/, '') + '\n\n' + SUMMARY_TEMPLATE.join('\n') + '\n';
      inserted = true;
    }
  }

  writeDone(prologue, sections);

  if (inserted) console.log(`[td] 已追加总结模板。文件: ${DONE_FILE}`);
  else console.log(`[td] 今天段已有总结模板，本次未改动。文件: ${DONE_FILE}`);

  console.log();
  console.log(collectContext());
}

// ---------- 自动同步 ----------

function autoSync() {
  if (process.env.TD_NOSYNC) return;
  if (!fs.existsSync(path.join(HERE, '.git'))) return;
  try {
    spawnSync('git', ['-C', HERE, 'add', '-A'], { timeout: 5000 });
    const diffRc = spawnSync('git', ['-C', HERE, 'diff', '--cached', '--quiet'], {
      timeout: 5000,
    }).status;
    if (diffRc === 0) return;
    const d = new Date();
    const ts = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(
      d.getHours()
    )}:${pad2(d.getMinutes())}`;
    spawnSync('git', ['-C', HERE, 'commit', '-m', `auto: td ${ts}`], { timeout: 5000 });
    const child = spawn('git', ['-C', HERE, 'push', '--quiet'], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } catch {
    /* 静默失败 */
  }
}

// ---------- 入口 ----------

const HELP = `td — 极简 todo + done log (JS)

  td                          列出当前 todo
  td add "xxx"                追加一条 todo
  td edit <N|关键词> "新内容"  修改某条 todo 的文字
  td done <N|关键词>          完成某条（挪到 done.md 今天）
  td did "xxx"                直接往 done.md 今天段追加一条（不经过 todo）
  td rm <N|关键词>            放弃某条（从 todo.md 删掉，不记 done）
  td log [days]               查看最近 days 天的完成记录（默认 7）
  td recur                    查看循环任务规则及触发状态
  td summary                  在 done.md 今天段追加总结模板 + 打印参考信息包
  td -h                       帮助
`;

function main(argv) {
  const first = argv[0] || '';
  if (first === '-h' || first === '--help' || first === 'help') {
    console.log(HELP);
    return;
  }

  checkRecurring();

  const rest = argv.slice(1);
  if (!argv.length || first === 'ls' || first === 'list') {
    cmdLs();
  } else if (first === 'recur') {
    cmdRecur();
  } else if (first === 'summary' || first === 'sum') {
    cmdSummary();
  } else if (first === 'add') {
    if (!rest.length) die('[td] 用法：td add "你要做的事"');
    cmdAdd(rest.join(' '));
  } else if (first === 'edit') {
    if (rest.length < 2) die('[td] 用法：td edit <编号|关键词> "新内容"');
    cmdEdit(rest[0], rest.slice(1).join(' '));
  } else if (first === 'done') {
    if (!rest.length) die('[td] 用法：td done <编号|关键词>');
    cmdDone(rest.join(' '));
  } else if (first === 'did') {
    if (!rest.length) die('[td] 用法：td did "你做了的事"');
    cmdDid(rest.join(' '));
  } else if (first === 'rm') {
    if (!rest.length) die('[td] 用法：td rm <编号|关键词>');
    cmdRm(rest.join(' '));
  } else if (first === 'log') {
    cmdLog(rest[0] || null);
  } else {
    die(`[td] 未知命令：${first}\n${HELP}`);
  }

  autoSync();
}

try {
  main(process.argv.slice(2));
} catch (e) {
  if (e && e.isUserError) {
    console.error(e.message);
    process.exit(1);
  }
  throw e;
}
