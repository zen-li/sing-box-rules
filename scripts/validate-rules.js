#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const RuleParser = require('./utils/rule-parser');
const FileUtils = require('./utils/file-utils');

class RuleValidator {
  constructor() {
    this.sourcesDir = path.join(__dirname, '../sources');
    this.templatesDir = path.join(__dirname, '../templates');
    this.errors = [];
    this.warnings = [];
  }

  /**
   * 验证源文件
   * @param {string} sourceFile - 源文件名
   * @param {string} type - 规则类型
   * @returns {Object} 验证结果
   */
  validateSourceFile(sourceFile, type) {
    console.log(`\n🔍 Validating: ${sourceFile} (${type})`);

    const result = {
      file: sourceFile,
      type: type,
      valid: true,
      errors: [],
      warnings: [],
      stats: { total: 0, valid: 0, invalid: 0, duplicate: 0 }
    };

    try {
      // 检查文件是否存在
      const filePath = path.join(this.sourcesDir, sourceFile);
      if (!FileUtils.exists(filePath)) {
        result.errors.push(`Source file not found: ${filePath}`);
        result.valid = false;
        return result;
      }

      // 解析规则
      const rules = RuleParser.parseTextFile(filePath);
      result.stats.total = rules.length;

      if (rules.length === 0) {
        result.warnings.push('No rules found in file');
        return result;
      }

      // 验证规则
      const validRules = RuleParser.filterValidRules(rules, type);
      const invalidRules = rules.filter(rule => !validRules.includes(rule));

      result.stats.valid = validRules.length;
      result.stats.invalid = invalidRules.length;

      // 检查重复项
      const uniqueRules = new Set();
      let duplicates = 0;
      for (const rule of rules) {
        if (uniqueRules.has(rule)) {
          duplicates++;
        } else {
          uniqueRules.add(rule);
        }
      }
      result.stats.duplicate = duplicates;

      // 收集错误和警告
      if (invalidRules.length > 0) {
        result.errors.push(`Found ${invalidRules.length} invalid rules`);
        result.valid = false;

        // 显示前10个无效规则作为示例
        const sampleInvalid = invalidRules.slice(0, 10);
        sampleInvalid.forEach(rule => {
          result.warnings.push(`Invalid rule: ${rule}`);
        });

        if (invalidRules.length > 10) {
          result.warnings.push(`... and ${invalidRules.length - 10} more invalid rules`);
        }
      }

      if (duplicates > 0) {
        result.warnings.push(`Found ${duplicates} duplicate rules`);
      }

      console.log(`✅ Valid: ${result.stats.valid}, Invalid: ${result.stats.invalid}, Duplicate: ${result.stats.duplicate}`);

      return result;

    } catch (error) {
      result.errors.push(`Validation failed: ${error.message}`);
      result.valid = false;
      return result;
    }
  }

  /**
   * 验证模板文件
   * @param {string} templateFile - 模板文件名
   * @returns {Object} 验证结果
   */
  validateTemplate(templateFile) {
    console.log(`\n🔍 Validating template: ${templateFile}`);

    const result = {
      file: templateFile,
      valid: true,
      errors: [],
      warnings: []
    };

    try {
      const templatePath = path.join(this.templatesDir, templateFile);

      if (!FileUtils.exists(templatePath)) {
        result.errors.push(`Template file not found: ${templatePath}`);
        result.valid = false;
        return result;
      }

      const template = FileUtils.readJsonFile(templatePath);

      // 检查必需字段
      const requiredFields = ['version', 'rules', 'description', 'type'];
      for (const field of requiredFields) {
        if (!template.hasOwnProperty(field)) {
          result.errors.push(`Missing required field: ${field}`);
          result.valid = false;
        }
      }

      // 检查版本号
      if (template.version !== 1) {
        result.warnings.push(`Unexpected version: ${template.version} (expected: 1)`);
      }

      // 检查类型字段
      if (!template.type || typeof template.type !== 'string') {
        result.errors.push(`Invalid or missing type field`);
        result.valid = false;
      }

      // 检查rules字段
      if (!template.rules || typeof template.rules !== 'object') {
        result.errors.push(`Invalid rules field structure`);
        result.valid = false;
      }

      console.log(`✅ Template validation completed`);

      return result;

    } catch (error) {
      result.errors.push(`Template validation failed: ${error.message}`);
      result.valid = false;
      return result;
    }
  }

  /**
   * 验证所有文件
   * @returns {Object} 总体验证结果
   */
  validateAll() {
    console.log('🚀 Starting validation process...');

    const ruleConfigs = [
      { source: 'direct-domains.txt', type: 'domain-suffix' },
      { source: 'dns-direct-domains.txt', type: 'domain-suffix' },
      { source: 'direct-ips.txt', type: 'ip-cidr' },
      { source: 'direct-process.txt', type: 'process-name' },
      { source: 'proxy-domains.txt', type: 'domain-suffix' },
      { source: 'proxy-domains-private.txt', type: 'domain-suffix' },
      { source: 'proxy-ips.txt', type: 'ip-cidr' },
      { source: 'proxy-process.txt', type: 'process-name' }
    ];

    const templateConfigs = [
      'domain-suffix.json',
      'ip-cidr.json',
      'process-name.json'
    ];

    const results = {
      sources: [],
      templates: [],
      summary: {
        total_files: ruleConfigs.length + templateConfigs.length,
        valid_files: 0,
        invalid_files: 0,
        total_rules: 0,
        valid_rules: 0,
        invalid_rules: 0
      }
    };

    // 验证源文件
    for (const config of ruleConfigs) {
      const result = this.validateSourceFile(config.source, config.type);
      results.sources.push(result);

      if (result.valid) {
        results.summary.valid_files++;
        results.summary.total_rules += result.stats.total;
        results.summary.valid_rules += result.stats.valid;
        results.summary.invalid_rules += result.stats.invalid;
      } else {
        results.summary.invalid_files++;
      }
    }

    // 验证模板文件
    for (const template of templateConfigs) {
      const result = this.validateTemplate(template);
      results.templates.push(result);

      if (result.valid) {
        results.summary.valid_files++;
      } else {
        results.summary.invalid_files++;
      }
    }

    // 生成验证报告
    this.generateValidationReport(results);

    return results;
  }

  /**
   * 生成验证报告
   * @param {Object} results - 验证结果
   */
  generateValidationReport(results) {
    console.log('\n📊 Validation Report:');
    console.log(`✅ Valid files: ${results.summary.valid_files}`);
    console.log(`❌ Invalid files: ${results.summary.invalid_files}`);
    console.log(`📝 Total rules: ${results.summary.total_rules}`);
    console.log(`✅ Valid rules: ${results.summary.valid_rules}`);
    console.log(`❌ Invalid rules: ${results.summary.invalid_rules}`);

    // 显示错误
    const allErrors = [
      ...results.sources.flatMap(r => r.errors.map(e => `${r.file}: ${e}`)),
      ...results.templates.flatMap(r => r.errors.map(e => `${r.file}: ${e}`))
    ];

    if (allErrors.length > 0) {
      console.log('\n❌ Errors:');
      allErrors.forEach(error => console.log(`   ${error}`));
    }

    // 显示警告
    const allWarnings = [
      ...results.sources.flatMap(r => r.warnings.map(w => `${r.file}: ${w}`)),
      ...results.templates.flatMap(r => r.warnings.map(w => `${r.file}: ${w}`))
    ];

    if (allWarnings.length > 0) {
      console.log('\n⚠️  Warnings:');
      allWarnings.forEach(warning => console.log(`   ${warning}`));
    }

    // 保存详细报告
    const reportPath = path.join(__dirname, '../dist/validation-report.json');
    FileUtils.ensureDir(path.dirname(reportPath));
    FileUtils.writeJsonFile(reportPath, results);
    console.log(`\n📄 Detailed report saved to: ${reportPath}`);
  }
}

// 主函数
if (require.main === module) {
  const validator = new RuleValidator();

  const args = process.argv.slice(2);
  const command = args[0] || 'all';

  switch (command) {
    case 'all':
      const results = validator.validateAll();
      process.exit(results.summary.invalid_files > 0 ? 1 : 0);
      break;
    case 'source':
      if (args[1] && args[2]) {
        const result = validator.validateSourceFile(args[1], args[2]);
        process.exit(result.valid ? 0 : 1);
      } else {
        console.log('Usage: node validate-rules.js source <source-file> <type>');
        process.exit(1);
      }
      break;
    case 'template':
      if (args[1]) {
        const result = validator.validateTemplate(args[1]);
        process.exit(result.valid ? 0 : 1);
      } else {
        console.log('Usage: node validate-rules.js template <template-file>');
        process.exit(1);
      }
      break;
    default:
      console.log('Usage: node validate-rules.js [all|source|template] [args...]');
      console.log('  all          - Validate all files (default)');
      console.log('  source <file> <type> - Validate specific source file');
      console.log('  template <file>     - Validate specific template file');
      process.exit(1);
  }
}

module.exports = RuleValidator;