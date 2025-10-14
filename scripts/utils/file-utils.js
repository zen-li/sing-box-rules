const fs = require('fs');
const path = require('path');

class FileUtils {
  static ensureDir(dir) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  static exists(filePath) {
    return fs.existsSync(filePath);
  }

  static readFile(filePath) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    return fs.readFileSync(filePath, 'utf8');
  }

  static writeFile(filePath, content) {
    const dir = path.dirname(filePath);
    this.ensureDir(dir);
    fs.writeFileSync(filePath, content, 'utf8');
  }

  static readJsonFile(filePath) {
    const content = this.readFile(filePath);
    return JSON.parse(content);
  }

  static writeJsonFile(filePath, data) {
    const content = JSON.stringify(data, null, 2);
    this.writeFile(filePath, content);
  }

  static getFileStats(filePath) {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return fs.statSync(filePath);
  }

  static copyFile(src, dest) {
    const destDir = path.dirname(dest);
    this.ensureDir(destDir);
    fs.copyFileSync(src, dest);
  }

  static deleteFile(filePath) {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}

module.exports = FileUtils;