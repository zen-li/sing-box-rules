const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class SrsBuilder {
  constructor() {
    this.tempDir = path.join(__dirname, '../../temp');
  }

  /**
   * 创建临时目录
   */
  ensureTempDir() {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  /**
   * 清理临时目录
   */
  cleanTempDir() {
    if (fs.existsSync(this.tempDir)) {
      const files = fs.readdirSync(this.tempDir);
      for (const file of files) {
        fs.unlinkSync(path.join(this.tempDir, file));
      }
      fs.rmdirSync(this.tempDir);
    }
  }

  /**
   * 使用 sing-box 命令构建 SRS 文件
   * @param {Object} ruleData - 规则数据
   * @param {string} outputFile - 输出文件路径
   * @returns {boolean} 构建是否成功
   */
  buildWithSingBox(ruleData, outputFile) {
    this.ensureTempDir();

    try {
      // 提取规则类型和规则数组
      const ruleType = ruleData.type || Object.keys(ruleData.rules)[0];
      const rules = ruleData.rules[ruleType] || [];

      // 创建 sing-box 期望的 RuleSetCompat 格式
      // 正确格式：将相同类型的规则合并到一个数组中
      const ruleSet = {
        version: 2,
        rules: [
          {
            [ruleType]: rules
          }
        ]
      };

      // 创建临时 JSON 文件
      const tempJsonFile = path.join(this.tempDir, `temp_${Date.now()}.json`);
      fs.writeFileSync(tempJsonFile, JSON.stringify(ruleSet, null, 2));

      // 使用 sing-box 命令行工具转换
      const cmd = `sing-box rule-set compile --output "${outputFile}" "${tempJsonFile}"`;
      console.log(`🔨 Building SRS file: ${outputFile}`);
      execSync(cmd, { stdio: 'pipe', timeout: 30000 });

      // 验证生成的文件
      if (fs.existsSync(outputFile) && fs.statSync(outputFile).size > 0) {
        console.log(`✅ SRS file built successfully: ${outputFile}`);
        return true;
      } else {
        console.warn(`⚠️  SRS file build failed: ${outputFile}`);
        return false;
      }
    } catch (error) {
      console.error(`❌ sing-box build failed: ${error.message}`);
      return false;
    } finally {
      this.cleanTempDir();
    }
  }

  /**
   * 备用方法：直接保存 JSON 格式
   * @param {Object} ruleData - 规则数据
   * @param {string} outputFile - 输出文件路径
   * @returns {boolean} 构建是否成功
   */
  buildFallback(ruleData, outputFile) {
    try {
      const jsonFile = outputFile.replace('.srs', '.json');

      // sing-box 期望的格式：将相同类型的规则合并到一个数组中
      const ruleType = ruleData.type || Object.keys(ruleData.rules)[0];
      const rules = ruleData.rules[ruleType] || [];

      // 创建 sing-box 兼容的规则集合格式
      const singBoxFormat = {
        version: ruleData.version || 2,
        rules: [
          {
            [ruleType]: rules
          }
        ]
      };

      fs.writeFileSync(jsonFile, JSON.stringify(singBoxFormat, null, 2));
      console.log(`⚠️  Built fallback file: ${jsonFile}`);
      return true;
    } catch (error) {
      console.error(`❌ Fallback build failed: ${error.message}`);
      return false;
    }
  }

  /**
   * 构建 SRS 文件
   * @param {Object} ruleData - 规则数据
   * @param {string} outputFile - 输出文件路径
   * @returns {boolean} 构建是否成功
   */
  buildSrsFile(ruleData, outputFile) {
    const outputDir = path.dirname(outputFile);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // 首先尝试使用 sing-box 命令
    if (this.buildWithSingBox(ruleData, outputFile)) {
      return true;
    }

    // 如果失败，使用备用方法
    return this.buildFallback(ruleData, outputFile);
  }

  /**
   * 验证 SRS 文件
   * @param {string} srsFile - SRS 文件路径
   * @returns {boolean} 是否有效
   */
  validateSrsFile(srsFile) {
    if (!fs.existsSync(srsFile)) {
      return false;
    }

    try {
      const stats = fs.statSync(srsFile);
      return stats.size > 0;
    } catch (error) {
      return false;
    }
  }

  /**
   * 获取 SRS 文件信息
   * @param {string} srsFile - SRS 文件路径
   * @returns {Object} 文件信息
   */
  getSrsFileInfo(srsFile) {
    if (!fs.existsSync(srsFile)) {
      return null;
    }

    try {
      const stats = fs.statSync(srsFile);
      return {
        exists: true,
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime,
        path: srsFile
      };
    } catch (error) {
      return { exists: false, error: error.message };
    }
  }
}

module.exports = SrsBuilder;