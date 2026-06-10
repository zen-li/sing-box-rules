#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const FileUtils = require('./utils/file-utils');
const RuleParser = require('./utils/rule-parser');
const SrsBuilder = require('./utils/srs-builder');

class RuleBuilder {
  constructor() {
    this.sourcesDir = path.join(__dirname, '../sources');
    this.templatesDir = path.join(__dirname, '../templates');
    this.distDir = path.join(__dirname, '../dist');
    this.srsBuilder = new SrsBuilder();

    FileUtils.ensureDir(this.distDir);
  }

  /**
   * 加载规则模板
   * @param {string} outputFile - 输出文件名
   * @param {string} type - 规则类型
   * @returns {Object} 模板数据
   */
  loadTemplate(outputFile, type) {
    // 首先尝试加载特定文件的模板
    const baseName = path.basename(outputFile, '.srs');
    let templateFile = path.join(this.templatesDir, `${baseName}.json`);

    if (!FileUtils.exists(templateFile)) {
      // 如果没有特定模板，使用通用类型模板
      templateFile = path.join(this.templatesDir, `${type}.json`);
    }

    if (!FileUtils.exists(templateFile)) {
      throw new Error(`Template not found: ${templateFile}`);
    }

    const template = FileUtils.readJsonFile(templateFile);
    console.log(`📋 Using template: ${templateFile}`);
    return template;
  }

  /**
   * 构建单个规则
   * @param {string} type - 规则类型
   * @param {string} sourceFile - 源文件名
   * @param {string} outputFile - 输出文件名
   * @returns {Object|null} 构建结果
   */
  buildRule(type, sourceFile, outputFile) {
    console.log(`\n📦 Building rule: ${type} from ${sourceFile}`);

    try {
      // 解析规则源文件
      const rules = RuleParser.parseTextFile(path.join(this.sourcesDir, sourceFile));
      console.log(`📖 Found ${rules.length} rules in ${sourceFile}`);

      if (rules.length === 0) {
        console.warn(`⚠️  No rules found in ${sourceFile}, skipping...`);
        return null;
      }

      // 验证规则
      const validRules = RuleParser.filterValidRules(rules, type);
      console.log(`✅ Valid rules: ${validRules.length}, invalid: ${rules.length - validRules.length}`);

      if (validRules.length === 0) {
        console.warn(`⚠️  No valid rules found in ${sourceFile}, skipping...`);
        return null;
      }

      // 获取规则统计
      const stats = RuleParser.getRuleStats(rules);
      console.log(`📊 Rule stats: total=${stats.total}, empty=${stats.empty}, duplicate=${stats.duplicate}, valid=${stats.valid}`);

      // 加载模板
      const template = this.loadTemplate(outputFile, type);

      // 构建规则数据
      const ruleData = {
        version: template.version,
        rules: {
          [template.type]: validRules
        },
        description: template.description,
        type: template.type,
        metadata: {
          count: validRules.length,
          built_at: new Date().toISOString(),
          source: sourceFile,
          stats: stats
        }
      };

      // 构建 SRS 文件
      const outputPath = path.join(this.distDir, outputFile);
      const success = this.srsBuilder.buildSrsFile(ruleData, outputPath);

      if (success) {
        return {
          type,
          source: sourceFile,
          output: outputFile,
          rules: validRules,
          metadata: ruleData.metadata
        };
      } else {
        return null;
      }

    } catch (error) {
      console.error(`❌ Failed to build ${type} from ${sourceFile}:`, error.message);
      return null;
    }
  }

  /**
   * 构建所有规则
   */
  buildAll() {
    console.log('🚀 Starting rule building process...');

    const ruleConfigs = [
      { type: 'domain-suffix', source: 'direct-domains.txt', output: 'direct-domains.srs' },
      { type: 'domain-suffix', source: 'dns-direct-domains.txt', output: 'dns-direct-domains.srs' },
      { type: 'ip-cidr', source: 'direct-ips.txt', output: 'direct-ips.srs' },
      { type: 'process-name', source: 'direct-process.txt', output: 'direct-process.srs' },
      { type: 'domain-suffix', source: 'proxy-domains.txt', output: 'proxy-domains.srs' },
      { type: 'domain-suffix', source: 'proxy-domains-private.txt', output: 'proxy-domains-private.srs' },
      { type: 'ip-cidr', source: 'proxy-ips.txt', output: 'proxy-ips.srs' },
      { type: 'process-name', source: 'proxy-process.txt', output: 'proxy-process.srs' }
    ];

    const results = {
      success: [],
      failed: [],
      skipped: [],
      summary: {}
    };

    let totalRules = 0;

    for (const config of ruleConfigs) {
      try {
        const result = this.buildRule(config.type, config.source, config.output);
        if (result) {
          results.success.push(result);
          totalRules += result.rules.length;
        } else {
          results.skipped.push(config);
        }
      } catch (error) {
        console.error(`❌ Failed to build ${config.source}:`, error.message);
        results.failed.push({
          config: config,
          error: error.message
        });
      }
    }

    // 生成构建报告
    results.summary = {
      total_configs: ruleConfigs.length,
      success: results.success.length,
      failed: results.failed.length,
      skipped: results.skipped.length,
      total_rules: totalRules
    };

    // 保存构建报告
    this.generateBuildReport(results);

    return results;
  }

  /**
   * 生成构建报告
   * @param {Object} results - 构建结果
   */
  generateBuildReport(results) {
    const report = {
      timestamp: new Date().toISOString(),
      summary: results.summary,
      files: {
        success: results.success,
        failed: results.failed,
        skipped: results.skipped
      }
    };

    const reportPath = path.join(this.distDir, 'build-report.json');
    FileUtils.writeJsonFile(reportPath, report);

    console.log('\n📊 Build Report:');
    console.log(`✅ Success: ${results.summary.success}`);
    console.log(`❌ Failed: ${results.summary.failed}`);
    console.log(`⚠️  Skipped: ${results.summary.skipped}`);
    console.log(`📝 Total rules: ${results.summary.total_rules}`);
    console.log(`📄 Report saved to: ${reportPath}`);

    if (results.summary.failed > 0) {
      console.log('\n❌ Failed Rules:');
      results.failed.forEach(item => {
        console.log(`   ${item.config.source}: ${item.error}`);
      });
    }
  }

  /**
   * 清理旧文件
   */
  clean() {
    console.log('🧹 Cleaning old files...');

    if (FileUtils.exists(this.distDir)) {
      const files = fs.readdirSync(this.distDir);
      for (const file of files) {
        const filePath = path.join(this.distDir, file);
        FileUtils.deleteFile(filePath);
      }
    }

    console.log('✅ Clean completed');
  }
}

// 主函数
if (require.main === module) {
  const builder = new RuleBuilder();

  const args = process.argv.slice(2);
  const command = args[0] || 'build';

  switch (command) {
    case 'build':
      builder.buildAll();
      console.log('\n🎉 Rule building completed!');
      break;
    case 'clean':
      builder.clean();
      console.log('\n🧹 Clean completed!');
      break;
    case 'single':
      if (args.length >= 4) {
        const type = args[1];
        const sourceFile = args[2];
        const outputFile = args[3];
        const result = builder.buildRule(type, sourceFile, outputFile);
        if (result) {
          console.log('\n✅ Single rule building completed!');
        } else {
          console.log('\n❌ Single rule building failed!');
          process.exit(1);
        }
      } else {
        console.log('Usage: node build-rules.js single <type> <source-file> <output-file>');
        console.log('  type - Rule type (domain-suffix, ip-cidr, process-name)');
        console.log('  source-file - Source file name');
        console.log('  output-file - Output file name');
        process.exit(1);
      }
      break;
    default:
      console.log('Usage: node build-rules.js [build|clean|single]');
      console.log('  build - Build all rules (default)');
      console.log('  clean - Clean old files');
      console.log('  single <type> <source-file> <output-file> - Build single rule');
  }
}

module.exports = RuleBuilder;