# todone — JS / Node 实现

纯 Node 内建模块（`fs` / `path` / `child_process`），**零依赖**。需要 Node 18+。

行为严格对齐 [`../python/td.py`](../python/td.py)，操作同一份 md 格式，见 [SPEC.md](../SPEC.md)。

## 安装

### 方案 A：复制到数据目录，起别名（推荐）

```bash
mkdir -p ~/notes/td
cp td.js ~/notes/td/
cp ../template/*.md ~/notes/td/

echo 'alias td="node ~/notes/td/td.js"' >> ~/.zshrc
source ~/.zshrc

td add "试试 todone"
```

### 方案 B：npm link 全局命令

```bash
cd path/to/todone/js
npm link   # 把 td 命令软链到全局
td -h
```

注意：`td.js` 把数据文件放在**脚本所在目录**。用 `npm link` 的话，数据会落在这个 repo 的 `js/` 目录里——适合快速试用，长期用还是建议方案 A（自己挑个数据目录）。

## 环境变量

- `TD_NOSYNC=1`：关闭命令结束后的自动 `git commit / push`

## 测试用法

```bash
cd js
cp ../template/*.md .
node td.js add "hello"
node td.js
node td.js done 1
node td.js log
```
