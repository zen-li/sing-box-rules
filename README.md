# sing-box Custom Rules

[![Build Status](https://github.com/zen-li/sing-box-rules/workflows/Build%20Rules/badge.svg)](https://github.com/zen-li/sing-box-rules/actions)
[![Release](https://img.shields.io/github/release/zen-li/sing-box-rules.svg)](https://github.com/zen-li/sing-box-rules/releases)

Sing-box 自定义规则仓库，提供易于维护的规则文件和自动化的构建发布流程。

## 📋 规则类型

### 直连规则
- **direct-domains**: 需要直连的域名规则
- **direct-ips**: 需要直连的IP规则
- **direct-process**: 需要直连的进程规则

### 代理规则
- **proxy-domains**: 需要代理的域名规则
- **proxy-domains-private**: 需要代理的私有域名规则
- **proxy-ips**: 需要代理的IP规则
- **proxy-process**: 需要代理的进程规则

## 🚀 快速开始

### 本地构建

```bash
# 安装依赖
npm install

# 构建规则
npm run build

# 验证规则
npm run validate

# 生成元数据
npm run generate-metadata
```

### 格式说明

规则文件使用纯文本格式，每行一个规则，支持注释：

```txt
# 这是一个注释
example.com
test.com

# 私有域名
private.example.com
```

## 📁 目录结构

```
sing-box-rules/
├── sources/                    # 规则源文件
│   ├── direct-domains.txt
│   ├── direct-ips.txt
│   ├── direct-process.txt
│   ├── proxy-domains.txt
│   ├── proxy-domains-private.txt
│   ├── proxy-ips.txt
│   └── proxy-process.txt
├── templates/                  # 规则配置模板
│   ├── domain-suffix.json
│   ├── ip-cidr.json
│   └── process-name.json
├── scripts/                    # 构建脚本
│   ├── build-rules.js
│   ├── validate-rules.js
│   ├── generate-metadata.js
│   └── utils/
├── dist/                       # 构建输出
│   ├── *.srs                  # sing-box 规则集文件
│   └── metadata.json
└── .github/workflows/          # 自动化工作流
```

## 🔄 自动化流程

规则更新会自动触发以下流程：

1. **规则编辑** → 修改 `sources/` 目录下的文件
2. **Git 提交** → 推送到 GitHub 仓库
3. **自动构建** → GitHub Actions 构建规则集
4. **自动发布** → 发布到 GitHub Releases
5. **自动下载** → sing-box 自动下载更新

## 📊 规则统计

- 总规则数量：动态统计
- 更新频率：6小时
- 支持热更新：✅
- 支持版本控制：✅

## 🔧 使用方法

### 在 sing-box 配置中引用

```json
{
  "route": {
    "rule_set": [
      {
        "type": "remote",
        "tag": "custom-direct-domains",
        "format": "binary",
        "url": "https://github.com/zen-li/sing-box-rules/releases/latest/download/direct-domains.srs",
        "download_detour": "direct",
        "update_interval": "6h"
      }
    ]
  }
}
```

### 配置模板

每个规则类型都有对应的配置模板：

```json
{
  "version": 1,
  "rules": {
    "domain_suffix": []
  },
  "description": "Domain suffix rules",
  "type": "domain_suffix"
}
```

## 🛠️ 开发指南

### 添加新规则类型

1. 在 `sources/` 目录创建新的规则文件
2. 在 `templates/` 目录创建对应的模板
3. 更新 `scripts/build-rules.js` 中的规则配置
4. 提交更改触发自动构建

### 自定义构建脚本

构建脚本位于 `scripts/` 目录：

- `build-rules.js`: 主要构建逻辑
- `validate-rules.js`: 规则验证
- `generate-metadata.js`: 元数据生成

## 📝 贡献指南

1. Fork 本仓库
2. 创建功能分支
3. 修改规则文件
4. 提交 Pull Request
5. 等待审核和合并

## 📄 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件

## 🤝 支持

如有问题或建议，请：

- 提交 [Issue](https://github.com/zen-li/sing-box-rules/issues)
- 发起 [Pull Request](https://github.com/zen-li/sing-box-rules/pulls)

---

**注意**：本仓库专注于规则管理，不包含 sing-box 配置模板。配置模板请参考 [sing-box-config](https://github.com/zen-li/sing-box) 仓库。