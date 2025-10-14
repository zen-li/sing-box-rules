#!/bin/bash

# 本地构建和发布脚本
# 用于构建规则并推送到 GitHub

set -e

echo "🚀 Starting sing-box rules build and publish process..."

# 检查是否在正确的目录
if [ ! -f "package.json" ]; then
    echo "❌ Error: package.json not found. Please run this script from the root directory."
    exit 1
fi

# 检查是否有未提交的更改
if [ -n "$(git status --porcelain)" ]; then
    echo "⚠️  You have uncommitted changes:"
    git status --short
    read -p "Do you want to continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "❌ Build cancelled."
        exit 1
    fi
fi

# 构建规则
echo "📦 Building rules..."
npm run build:full

# 检查构建结果
if [ ! -d "dist" ] || [ -z "$(ls -A dist/*.srs 2>/dev/null)" ]; then
    echo "❌ Build failed - no .srs files found in dist/"
    exit 1
fi

# 显示构建结果
echo "📊 Build completed. Generated files:"
ls -la dist/*.srs 2>/dev/null || echo "No .srs files found"

# 生成构建摘要
echo "📋 Generating build summary..."
node -e "
const fs = require('fs');
const files = fs.readdirSync('dist').filter(f => f.endsWith('.srs'));
console.log('\\n📦 Build Summary:');
console.log('Total .srs files:', files.length);
let totalSize = 0;
files.forEach(file => {
  const stats = fs.statSync('dist/' + file);
  totalSize += stats.size;
  console.log('  -', file + ':', stats.size, 'bytes');
});
console.log('Total size:', totalSize, 'bytes (' + (totalSize/1024).toFixed(2) + ' KB)');
"

# 添加文件到 Git
echo "📝 Adding dist files to git..."
git add dist/*.srs dist/*.json 2>/dev/null || echo "No JSON files to add"

# 提交更改
echo "💾 Committing changes..."
COMMIT_MSG="Update rule files - $(date '+%Y-%m-%d %H:%M:%S')

# 检查是否有实际更改
if [ -n "$(git diff --cached --name-only)" ]; then
    git commit -m "$COMMIT_MSG"

    # 推送到 GitHub
    echo "🚀 Pushing to GitHub..."
    git push origin main

    echo "✅ Successfully built and pushed rules to GitHub!"
    echo ""
    echo "📝 Files are now available at:"
    echo "https://github.com/zen-li/sing-box-rules/tree/main/dist"
else
    echo "ℹ️  No changes to commit - files are already up to date."
fi

echo ""
echo "🎉 Build and publish process completed!"
echo ""
echo "📋 Next steps:"
echo "1. Update your sing-box configuration to use the new rule files"
echo "2. URLs format: https://raw.githubusercontent.com/zen-li/sing-box-rules/main/dist/[filename].srs"
echo "3. Example sing-box config:"
echo '   {"rule_set": [{"tag": "direct-domains", "type": "remote", "format": "binary", "url": "https://raw.githubusercontent.com/zen-li/sing-box-rules/main/dist/direct-domains.srs"}]}'