const fs = require('fs');

class RuleParser {
  /**
   * 解析文本规则文件
   * @param {string} filePath - 文件路径
   * @returns {string[]} 规则数组
   */
  static parseTextFile(filePath) {
    if (!fs.existsSync(filePath)) {
      console.warn(`Source file not found: ${filePath}`);
      return [];
    }

    const content = fs.readFileSync(filePath, 'utf8');
    return content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#') && !line.startsWith('//'));
  }

  /**
   * 验证域名规则
   * @param {string} domain - 域名
   * @returns {boolean} 是否有效
   */
  static isValidDomain(domain) {
    if (!domain || typeof domain !== 'string') {
      return false;
    }

    // 去除开头的点
    const cleanDomain = domain.startsWith('.') ? domain.slice(1) : domain;

    // 基本域名格式验证
    const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*$/;

    return domainRegex.test(cleanDomain);
  }

  /**
   * 验证IP CIDR规则
   * @param {string} cidr - CIDR 表示
   * @returns {boolean} 是否有效
   */
  static isValidCidr(cidr) {
    if (!cidr || typeof cidr !== 'string') {
      return false;
    }

    // IPv4 CIDR 正则
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;

    // IPv6 CIDR 正则（更完整版）
    const ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))\/\d{1,3}$/;

    return ipv4Regex.test(cidr) || ipv6Regex.test(cidr);
  }

  /**
   * 验证进程名规则
   * @param {string} processName - 进程名
   * @returns {boolean} 是否有效
   */
  static isValidProcessName(processName) {
    if (!processName || typeof processName !== 'string') {
      return false;
    }

    // 进程名通常只包含字母、数字、下划线、点号和连字符
    const processNameRegex = /^[a-zA-Z0-9_\-\.]+$/;
    return processNameRegex.test(processName);
  }

  /**
   * 过滤无效规则
   * @param {string[]} rules - 规则数组
   * @param {string} type - 规则类型
   * @returns {string[]} 有效规则数组
   */
  static filterValidRules(rules, type) {
    return rules.filter(rule => {
      switch (type) {
        case 'domain-suffix':
          return this.isValidDomain(rule);
        case 'ip-cidr':
          return this.isValidCidr(rule);
        case 'process-name':
          return this.isValidProcessName(rule);
        default:
          return true; // 未知类型默认通过
      }
    });
  }

  /**
   * 获取规则统计信息
   * @param {string[]} rules - 规则数组
   * @returns {Object} 统计信息
   */
  static getRuleStats(rules) {
    const stats = {
      total: rules.length,
      empty: 0,
      duplicate: 0,
      valid: 0
    };

    const uniqueRules = new Set();

    for (const rule of rules) {
      if (!rule || rule.trim() === '') {
        stats.empty++;
      } else if (uniqueRules.has(rule)) {
        stats.duplicate++;
      } else {
        uniqueRules.add(rule);
        stats.valid++;
      }
    }

    return stats;
  }
}

module.exports = RuleParser;