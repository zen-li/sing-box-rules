#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const FileUtils = require('./utils/file-utils');
const RuleParser = require('./utils/rule-parser');

class MetadataGenerator {
  constructor() {
    this.sourcesDir = path.join(__dirname, '../sources');
    this.distDir = path.join(__dirname, '../dist');
    this.repoDir = path.join(__dirname, '..');
  }

  /**
   * 获取规则文件的统计信息
   * @param {string} sourceFile - 源文件名
   * @param {string} type - 规则类型
   * @returns {Object} 文件统计信息
   */
  getFileStats(sourceFile, type) {
    const filePath = path.join(this.sourcesDir, sourceFile);
    const stats = {
      file: sourceFile,
      type: type,
      exists: false,
      size: 0,
      lastModified: null,
      rules: { total: 0, valid: 0, invalid: 0, duplicate: 0 },
      checksum: null
    };

    try {
      if (FileUtils.exists(filePath)) {
        stats.exists = true;
        const fileStats = fs.statSync(filePath);
        stats.size = fileStats.size;
        stats.lastModified = fileStats.mtime.toISOString();

        // 解析规则并获取统计信息
        const rules = RuleParser.parseTextFile(filePath);
        stats.rules.total = rules.length;
        stats.rules.valid = RuleParser.filterValidRules(rules, type).length;
        stats.rules.invalid = stats.rules.total - stats.rules.valid;

        // 计算重复项
        const uniqueRules = new Set();
        let duplicates = 0;
        for (const rule of rules) {
          if (uniqueRules.has(rule)) {
            duplicates++;
          } else {
            uniqueRules.add(rule);
          }
        }
        stats.rules.duplicate = duplicates;

        // 计算校验和（简单哈希）
        const content = fs.readFileSync(filePath, 'utf8');
        stats.checksum = this.simpleHash(content);
      }
    } catch (error) {
      console.warn(`Warning: Failed to get stats for ${sourceFile}: ${error.message}`);
    }

    return stats;
  }

  /**
   * 简单哈希函数
   * @param {string} str - 输入字符串
   * @returns {string} 哈希值
   */
  simpleHash(str) {
    let hash = 0;
    if (str.length === 0) return hash.toString(16);

    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // 转换为32位整数
    }

    return Math.abs(hash).toString(16);
  }

  /**
   * 获取已构建文件的统计信息
   * @param {string} outputFile - 输出文件名
   * @returns {Object} 文件统计信息
   */
  getBuiltFileStats(outputFile) {
    const filePath = path.join(this.distDir, outputFile);
    const stats = {
      file: outputFile,
      exists: false,
      size: 0,
      lastModified: null,
      checksum: null
    };

    try {
      if (FileUtils.exists(filePath)) {
        stats.exists = true;
        const fileStats = fs.statSync(filePath);
        stats.size = fileStats.size;
        stats.lastModified = fileStats.mtime.toISOString();

        // 计算校验和
        const content = fs.readFileSync(filePath);
        stats.checksum = this.simpleHash(content.toString());
      }
    } catch (error) {
      console.warn(`Warning: Failed to get stats for ${outputFile}: ${error.message}`);
    }

    return stats;
  }

  /**
   * 获取Git信息
   * @returns {Object} Git信息
   */
  getGitInfo() {
    const gitInfo = {
      branch: null,
      commit: null,
      commitTime: null,
      remoteUrl: null,
      isDirty: false
    };

    try {
      // 获取当前分支
      const branch = require('child_process').execSync('git rev-parse --abbrev-ref HEAD', {
        encoding: 'utf8',
        stdio: 'pipe'
      }).trim();
      gitInfo.branch = branch;

      // 获取最新提交
      const commit = require('child_process').execSync('git rev-parse HEAD', {
        encoding: 'utf8',
        stdio: 'pipe'
      }).trim();
      gitInfo.commit = commit;

      // 获取提交时间
      const commitTime = require('child_process').execSync('git log -1 --format=%cI', {
        encoding: 'utf8',
        stdio: 'pipe'
      }).trim();
      gitInfo.commitTime = commitTime;

      // 检查是否有未提交的更改
      try {
        require('child_process').execSync('git diff --quiet', { stdio: 'pipe' });
        require('child_process').execSync('git diff --cached --quiet', { stdio: 'pipe' });
      } catch (error) {
        gitInfo.isDirty = true;
      }

      // 获取远程URL
      try {
        const remoteUrl = require('child_process').execSync('git config --get remote.origin.url', {
          encoding: 'utf8',
          stdio: 'pipe'
        }).trim();
        gitInfo.remoteUrl = remoteUrl;
      } catch (error) {
        // 忽略获取远程URL失败
      }

    } catch (error) {
      console.warn(`Warning: Failed to get git info: ${error.message}`);
    }

    return gitInfo;
  }

  /**
   * 生成完整的元数据
   * @returns {Object} 元数据对象
   */
  generateMetadata() {
    console.log('🔍 Generating metadata...');

    const ruleConfigs = [
      { source: 'direct-domains.txt', type: 'domain-suffix', output: 'direct-domains.srs' },
      { source: 'direct-ips.txt', type: 'ip-cidr', output: 'direct-ips.srs' },
      { source: 'direct-process.txt', type: 'process-name', output: 'direct-process.srs' },
      { source: 'proxy-domains.txt', type: 'domain-suffix', output: 'proxy-domains.srs' },
      { source: 'proxy-domains-private.txt', type: 'domain-suffix', output: 'proxy-domains-private.srs' },
      { source: 'proxy-ips.txt', type: 'ip-cidr', output: 'proxy-ips.srs' },
      { source: 'proxy-process.txt', type: 'process-name', output: 'proxy-process.srs' }
    ];

    const metadata = {
      version: '1.0.0',
      generated: new Date().toISOString(),
      repository: {
        url: null,
        branch: null,
        commit: null,
        commitTime: null,
        isDirty: false
      },
      rules: {
        source: [],
        built: [],
        summary: {
          totalSourceFiles: 0,
          validSourceFiles: 0,
          totalRules: 0,
          validRules: 0,
          builtFiles: 0
        }
      },
      format: {
        version: 1,
        specification: 'sing-box-rule-set'
      }
    };

    // 获取Git信息
    const gitInfo = this.getGitInfo();
    metadata.repository = {
      url: gitInfo.remoteUrl,
      branch: gitInfo.branch,
      commit: gitInfo.commit,
      commitTime: gitInfo.commitTime,
      isDirty: gitInfo.isDirty
    };

    // 收集源文件统计信息
    for (const config of ruleConfigs) {
      const sourceStats = this.getFileStats(config.source, config.type);
      sourceStats.output = config.output;
      metadata.rules.source.push(sourceStats);

      if (sourceStats.exists) {
        metadata.rules.summary.totalSourceFiles++;
        metadata.rules.summary.totalRules += sourceStats.rules.total;
        metadata.rules.summary.validRules += sourceStats.rules.valid;
      }

      // 收集构建文件统计信息
      const builtStats = this.getBuiltFileStats(config.output);
      builtStats.source = config.source;
      metadata.rules.built.push(builtStats);

      if (builtStats.exists) {
        metadata.rules.summary.builtFiles++;
      }
    }

    metadata.rules.summary.validSourceFiles = metadata.rules.source.filter(s => s.exists).length;

    console.log(`✅ Generated metadata for ${metadata.rules.summary.totalSourceFiles} source files`);
    console.log(`📊 Total rules: ${metadata.rules.summary.totalRules}, Valid: ${metadata.rules.summary.validRules}`);
    console.log(`📦 Built files: ${metadata.rules.summary.builtFiles}`);

    return metadata;
  }

  /**
   * 保存元数据文件
   * @param {Object} metadata - 元数据对象
   * @param {string} filename - 文件名
   */
  saveMetadata(metadata, filename = 'metadata.json') {
    const outputPath = path.join(this.distDir, filename);
    FileUtils.ensureDir(this.distDir);
    FileUtils.writeJsonFile(outputPath, metadata);
    console.log(`💾 Metadata saved to: ${outputPath}`);
  }

  /**
   * 生成版本信息文件
   * @param {Object} metadata - 元数据对象
   */
  generateVersionFile(metadata) {
    const versionInfo = {
      version: metadata.version,
      buildTime: metadata.generated,
      gitCommit: metadata.repository.commit,
      gitBranch: metadata.repository.branch,
      rulesSummary: metadata.rules.summary
    };

    const versionPath = path.join(this.distDir, 'version.json');
    FileUtils.writeJsonFile(versionPath, versionInfo);
    console.log(`📋 Version info saved to: ${versionPath}`);
  }

  /**
   * 生成规则清单文件
   * @param {Object} metadata - 元数据对象
   */
  generateManifest(metadata) {
    const manifest = {
      format: 'sing-box-rule-set-manifest',
      version: '1.0',
      generated: metadata.generated,
      rules: metadata.rules.source.map(source => ({
        name: source.file.replace('.txt', ''),
        type: source.type,
        file: source.output,
        size: source.size,
        rules: source.rules,
        checksum: source.checksum,
        lastModified: source.lastModified,
        description: this.getRuleDescription(source.file)
      }))
    };

    const manifestPath = path.join(this.distDir, 'manifest.json');
    FileUtils.writeJsonFile(manifestPath, manifest);
    console.log(`📜 Manifest saved to: ${manifestPath}`);
  }

  /**
   * 获取规则描述
   * @param {string} filename - 文件名
   * @returns {string} 描述
   */
  getRuleDescription(filename) {
    const descriptions = {
      'direct-domains.txt': 'Direct connection domain rules',
      'direct-ips.txt': 'Direct connection IP CIDR rules',
      'direct-process.txt': 'Direct connection process name rules',
      'proxy-domains.txt': 'Proxy connection domain rules',
      'proxy-domains-private.txt': 'Private proxy domain rules',
      'proxy-ips.txt': 'Proxy connection IP CIDR rules',
      'proxy-process.txt': 'Proxy connection process name rules'
    };

    return descriptions[filename] || `Rules from ${filename}`;
  }

  /**
   * 生成所有元数据文件
   */
  generateAll() {
    const metadata = this.generateMetadata();

    this.saveMetadata(metadata);
    this.generateVersionFile(metadata);
    this.generateManifest(metadata);

    return metadata;
  }
}

// 主函数
if (require.main === module) {
  const generator = new MetadataGenerator();

  const args = process.argv.slice(2);
  const command = args[0] || 'all';

  switch (command) {
    case 'all':
      generator.generateAll();
      break;
    case 'metadata':
      const metadata = generator.generateMetadata();
      generator.saveMetadata(metadata);
      break;
    case 'version':
      const meta = generator.generateMetadata();
      generator.generateVersionFile(meta);
      break;
    case 'manifest':
      const m = generator.generateMetadata();
      generator.generateManifest(m);
      break;
    default:
      console.log('Usage: node generate-metadata.js [all|metadata|version|manifest]');
      console.log('  all      - Generate all metadata files (default)');
      console.log('  metadata - Generate metadata.json');
      console.log('  version  - Generate version.json');
      console.log('  manifest - Generate manifest.json');
  }
}

module.exports = MetadataGenerator;