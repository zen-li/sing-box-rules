# analyze-direct-timeouts

分析 sing-box **旁路由**日志中的 **直连超时** IP，生成完整的 `proxy-ips.txt` 草案供人工审核后发布。

采用 **方案 A（半自动）**：旁路由只检测和生成文件，**不**自动 `git push`；在 Mac 上审核后执行 `npm run publish`。

## 做什么

1. 读取 `sing-box-side-router` 容器日志（或本地日志文件）
2. 提取 `outbound/direct[direct]` + `timeout` / `i/o timeout` 的 IPv4
3. 用 [ip-api.com](http://ip-api.com/) 查询国家（结果缓存在本地）
4. 跳过 `--country-skip` 所列国家（默认 **CN,HK,MO**）的 IP
5. 对非中国 IP，按 **`/24`** 聚合（可 `--prefix-len` 调整），检查是否已被上游 `sources/proxy-ips.txt` 覆盖
6. 达到阈值的 `/24` 追加到 **`reports/proxy-ips.txt`**（完整文件，非 diff）

**粒度说明**：默认 **`/24`** 而非 `/16`，避免把国内 CDN、公共 DNS 等同一 `/16` 内的大量无关 IP 一并走代理（此前 `163.181.0.0/16`、`8.8.0.0/16` 曾导致阿里/腾讯误判为国外或香港）。

**不会计入聚合**的个别 IP：日志里出现的公共 DNS 解析器地址（`8.8.8.8`、`223.5.5.5` 等），不会生成 proxy-ips 条目。

`sources/proxy-ips.txt` **不再存放** `# Auto-detected` 行；自动结果仅出现在 `reports/`，需人工合并后再 `npm run publish`。

## 目录结构

```
analyze-direct-timeouts/
├── README.md           ← 本文件（进 git）
├── analyze.py          ← 主程序（进 git）
├── run.sh              ← cron 包装脚本（进 git）
├── fixtures/           ← 本地测试日志（gitignore）
├── reports/            ← 运行输出（gitignore）
│   ├── proxy-ips.txt
│   ├── history.json
│   ├── geoip-cache.json
│   ├── latest.txt
│   └── YYYY-MM-DD.{json,txt}
└── logs/               ← cron 标准输出（gitignore）
```

## 旁路由部署（Ubuntu）

```bash
# 复制整个目录到旁路由 docker 部署路径
cp -r analyze-direct-timeouts /Bucket/sing-box-side-router-docker/
chmod +x /Bucket/sing-box-side-router-docker/analyze-direct-timeouts/run.sh

# 手动试跑（需 docker 权限）
/Bucket/sing-box-side-router-docker/analyze-direct-timeouts/run.sh
```

### Cron（每日 03:30）

```cron
30 3 * * * /Bucket/sing-box-side-router-docker/analyze-direct-timeouts/run.sh >> /Bucket/sing-box-side-router-docker/analyze-direct-timeouts/logs/cron.log 2>&1
```

### 环境变量（可选）

| 变量 | 默认 | 说明 |
|------|------|------|
| `SING_BOX_CONTAINER` | `sing-box-side-router` | Docker 容器名 |
| `SING_BOX_LOG_SINCE` | `24h` | `docker logs --since` |
| `SING_BOX_MIN_HITS` | `3` | 同一 `/24` 块最少 timeout 次数才追加 |
| `SING_BOX_PREFIX_LEN` | `24` | 聚合前缀长度（建议保持 24，勿用 16） |
| `SING_BOX_COUNTRY_SKIP` | `CN,HK,MO` | 跳过的国家代码（逗号分隔） |
| `OUTPUT_DIR` | `<本目录>/reports` | 报告输出目录 |
| `PROXY_IPS_FILE` | （空，用 GitHub URL） | 本地 proxy-ips 基准文件 |

## Mac 审核与发布

```bash
# 1. 拉取旁路由生成的完整 proxy-ips.txt
scp ubuntu:/Bucket/sing-box-side-router-docker/analyze-direct-timeouts/reports/proxy-ips.txt /tmp/

# 2. 与仓库源文件对比
diff /Users/zen/Data-Save/sing-box-rules/sources/proxy-ips.txt /tmp/proxy-ips.txt

# 3. 确认无误后合并到 sources/proxy-ips.txt，再发布
cd /Users/zen/Data-Save/sing-box-rules
npm run publish
```

旁路由 `proxy-ips` ruleset 的 `update_interval` 为 1h，push 后通常一小时内自动拉取；若仍 timeout 且报告为 **RULESET STALE**，可重启容器或清除 `cache.db`。

## 本地使用

依赖：**Python 3**、**docker**（读容器日志时）、网络（拉取 GitHub proxy-ips 与 GeoIP）。

```bash
cd /Users/zen/Data-Save/sing-box-rules

# 分析旁路由容器最近 24h 日志
npm run analyze-logs

# 用样例日志离线测试（fixtures/ 已 gitignore，可自行放置）
npm run analyze-logs -- --log-file analyze-direct-timeouts/fixtures/sample-direct-timeouts.log

# 只看报告，不写 proxy-ips.txt
npm run analyze-logs -- --report-only
```

### 命令行参数

```bash
python3 analyze-direct-timeouts/analyze.py --help
```

| 参数 | 默认 | 说明 |
|------|------|------|
| `--container` | `sing-box-side-router` | Docker 容器名 |
| `--since` | `24h` | 日志时间窗口 |
| `--log-file` | — | 从文件读日志（不调用 docker） |
| `--output-dir` | `./reports` | 输出目录 |
| `--min-hits` | `3` | 块追加阈值（按 `--prefix-len` 聚合） |
| `--prefix-len` | `24` | 聚合前缀长度（默认 `/24`） |
| `--country-skip` | `CN,HK,MO` | 跳过的国家代码（逗号分隔，如 `CN,HK,MO`） |
| `--report-only` | — | 只写报告，不更新 proxy-ips.txt |
| `--proxy-ips-file` | — | 本地基准文件（Mac 测试时用 `sources/proxy-ips.txt`） |
| `--proxy-ips-url` | GitHub raw | 旁路由默认从 GitHub 拉最新规则 |

## 输出说明

| 文件 | 内容 |
|------|------|
| `reports/proxy-ips.txt` | **完整** proxy-ips（GitHub 上游 + 历史已加 + 本次新增块） |
| `reports/proxy-ips.additions-YYYY-MM-DD.txt` | 仅本次新增的 CIDR（默认 `/24`） |
| `reports/history.json` | 跨日 IP/CIDR 处理历史（防重复追加） |
| `reports/geoip-cache.json` | GeoIP 查询缓存 |
| `reports/latest.txt` | 人类可读摘要 |

### 报告分类

| 分类 | 含义 |
|------|------|
| **ADDED THIS RUN** | 本次新追加的 CIDR 块 |
| **RULESET STALE** | IP 已在 proxy-ips.txt 中但仍直连 timeout → 检查 ruleset 刷新 |
| **Already listed** | 块已被上游规则覆盖 |
| **Below threshold** | 偶发 timeout，继续观察 |

## history.json

旁路由本地维护，**不进 git**。主要字段：

- `seen_ips` — 出现过的 timeout IP 及累计次数
- `cidr_blocks` — 每个 CIDR 块的状态（`added` / `ruleset_stale` / `below_threshold` 等）
- `prefix_len` — 当前使用的聚合前缀（默认 24）
- `runs` — 最近 90 次运行摘要

升级时会自动丢弃旧版 `cidr16` 历史及所有前缀短于 `prefix_len` 的条目（例如历史 `/16`）。

即使 GitHub 上游尚未包含某块，只要本地 `history` 标记为 `added`，下次运行仍会写回 `reports/proxy-ips.txt`。

## 注意事项

- 默认 **`/24`**：比 `/16` 更不易误伤国内 CDN；比 `/32` 更省规则条数
- **不会**自动提交 GitHub；新增块仍需人工 diff 后合并
- ip-api.com 免费接口限非商业用途，约 45 次/分钟；脚本会去重并批量查询
- `fixtures/`、`reports/`、`logs/` 已在仓库 `.gitignore` 中排除
