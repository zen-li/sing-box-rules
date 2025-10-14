# 发布指南

本指南介绍如何本地构建规则并推送到 GitHub，适合包含私有规则的工作流。

## 🔄 工作流程

### 1. 本地构建

```bash
# 完整构建（清理 + 构建 + 元数据 + 验证）
npm run build:full

# 或者单独执行各个步骤
npm run clean
npm run build
npm run metadata
npm run validate
```

### 2. 检查构建结果

```bash
# 查看生成的文件
npm run status

# 手动查看 dist 目录
ls -la dist/
```

### 3. 推送到 GitHub

```bash
# 自动化发布脚本（推荐）
npm run publish

# 或者手动发布
npm run publish:local
git add dist/
git commit -m "Update rule files"
git push origin main
```

## 📁 文件结构

```
sing-box-rules/
├── sources/
│   ├── direct-domains.txt          # 公开直连域名
│   ├── direct-ips.txt              # 公开直连IP
│   ├── direct-process.txt          # 公开直连进程
│   ├── proxy-domains.txt           # 公开代理域名
│   ├── proxy-ips.txt               # 公开代理IP
│   ├── proxy-process.txt           # 公开代理进程
│   └── proxy-domains-private.txt   # 私有代理域名（不提交到git）
├── dist/                           # 构建输出目录
│   ├── *.srs                      # sing-box 规则文件
│   └── *.json                     # 元数据文件
└── scripts/
    └── publish.sh                  # 发布脚本
```

## 🔧 私有规则管理

`proxy-domains-private.txt` 包含敏感规则，不会提交到 Git：

- ✅ 本地构建时包含
- ❌ Git 版本控制中排除
- ✅ 构建到 .srs 文件中
- ✅ 通过 GitHub 分发

## 📦 Sing-box 配置示例

在你的 sing-box 配置中使用以下格式：

```json
{
  "rule_set": [
    {
      "tag": "direct-domains",
      "type": "remote",
      "format": "binary",
      "url": "https://raw.githubusercontent.com/zen-li/sing-box-rules/main/dist/direct-domains.srs",
      "download_detour": "direct"
    },
    {
      "tag": "proxy-domains",
      "type": "remote",
      "format": "binary",
      "url": "https://raw.githubusercontent.com/zen-li/sing-box-rules/main/dist/proxy-domains.srs",
      "download_detour": "proxy"
    },
    {
      "tag": "proxy-domains-private",
      "type": "remote",
      "format": "binary",
      "url": "https://raw.githubusercontent.com/zen-li/sing-box-rules/main/dist/proxy-domains-private.srs",
      "download_detour": "proxy"
    }
  ]
}
```

## 🚀 快速开始

1. **克隆仓库**
   ```bash
   git clone https://github.com/zen-li/sing-box-rules.git
   cd sing-box-rules
   npm install
   ```

2. **编辑规则文件**
   ```bash
   # 编辑源文件
   vim sources/proxy-domains-private.txt

   # 添加你的私有域名规则
   echo "my-private-domain.com" >> sources/proxy-domains-private.txt
   ```

3. **构建和发布**
   ```bash
   # 构建所有规则
   npm run build:full

   # 发布到 GitHub
   npm run publish
   ```

4. **更新 sing-box 配置**
   - 添加规则集 URL 到你的 sing-box 配置
   - 重启 sing-box 服务

## 📋 NPM 脚本说明

| 脚本 | 功能 |
|------|------|
| `npm run build` | 构建 .srs 文件 |
| `npm run validate` | 验证规则格式 |
| `npm run metadata` | 生成元数据 |
| `npm run build:full` | 完整构建流程 |
| `npm run status` | 查看构建结果 |
| `npm run publish` | 自动发布到 GitHub |
| `npm run clean` | 清理构建文件 |

## ⚠️ 注意事项

1. **私有文件**：`proxy-domains-private.txt` 不会提交到 Git
2. **本地构建**：必须在本地环境构建以包含私有规则
3. **权限设置**：确保 GitHub 仓库有写入权限
4. **冲突解决**：推送前先拉取最新更改 `git pull origin main`

## 🔍 故障排除

### 构建失败
```bash
# 检查源文件格式
npm run validate

# 查看详细错误信息
node scripts/build-rules.js
```

### 推送失败
```bash
# 检查 Git 状态
git status

# 解决冲突
git pull origin main --rebase
git push origin main
```

### 规则不生效
- 检查 sing-box 配置中的 URL 是否正确
- 确认 sing-box 可以访问 GitHub
- 检查规则文件是否成功构建