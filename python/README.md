# todone — Python 实现

参考实现。纯标准库，支持 Python 3.9+。

## 安装

```bash
# 准备数据目录
mkdir -p ~/notes/td
cp td.py ~/notes/td/
cp ../template/*.md ~/notes/td/

# 别名
echo 'alias td="python3 ~/notes/td/td.py"' >> ~/.zshrc
source ~/.zshrc
```

或者直接把 `td.py` 软链到某个 `$PATH` 目录：

```bash
chmod +x td.py
ln -s "$(pwd)/td.py" ~/bin/td
```

注意：`td.py` 把数据文件（`todo.md` / `done.md` / `recurring.md`）放在**脚本所在目录**。要把数据放到别处，用别名或软链——脚本本体要挪过去（或和数据文件放一起）。

## 用法

见顶层 [README](../README.md) 或项目 [SPEC](../SPEC.md)。

## 环境变量

- `TD_NOSYNC=1`：关闭自动 git push（离线或测试时用）
