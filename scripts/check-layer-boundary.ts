import fs from "fs";
import path from "path";

export interface LayerViolation {
  file: string;
  line: number;
  type: "FORBIDDEN_IMPORT" | "FORBIDDEN_TABLE";
  detail: string;
}

// 分层门禁零豁免：core 与 lib 严禁任何插件表与插件导入
export const LEGACY_EXEMPTIONS = new Set<string>();

// 业务插件表名单模式（禁止在 core 和 lib 中直接出现 plugin_ 表名与字样）
const FORBIDDEN_TABLE_PATTERN = /\bplugin_[a-zA-Z0-9_]*\b/i;

// 禁止从 @/plugins 导入（支持 import ..., from '@plugins', import('@/plugins')）
const FORBIDDEN_IMPORT_PATTERN = /(?:from\s+['"]|import\s*\(\s*['"]|import\s+['"]|import\s+type\s+.*['"]|import\s+.*['"])@\/plugins/;

export function checkContent(filePath: string, content: string): LayerViolation[] {
  const normalizedPath = filePath.replace(/\\/g, "/");
  if (Array.from(LEGACY_EXEMPTIONS).some((exempt) => normalizedPath.endsWith(exempt))) {
    return [];
  }

  const lines = content.split("\n");
  const violations: LayerViolation[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;

    // 检查禁止 import
    if (FORBIDDEN_IMPORT_PATTERN.test(line)) {
      violations.push({
        file: normalizedPath,
        line: lineNumber,
        type: "FORBIDDEN_IMPORT",
        detail: `禁止从 @/plugins 导入: "${line.trim()}"`,
      });
    }

    // 检查禁止直接访问插件表或包含 plugin_ 字样
    const tableMatch = line.match(FORBIDDEN_TABLE_PATTERN);
    if (tableMatch) {
      violations.push({
        file: normalizedPath,
        line: lineNumber,
        type: "FORBIDDEN_TABLE",
        detail: `禁止直接访问插件表或字样 "${tableMatch[0]}": "${line.trim()}"`,
      });
    }
  }

  return violations;
}

function walkDirSync(dir: string, fileList: string[] = []): string[] {
  if (!fs.existsSync(dir)) return fileList;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDirSync(fullPath, fileList);
    } else if (entry.isFile() && /\.(ts|tsx|js|mjs)$/.test(entry.name)) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

export async function scanLayerBoundaries(rootDir: string = process.cwd()): Promise<{
  scannedFiles: number;
  violations: LayerViolation[];
}> {
  const targetDirs = [path.join(rootDir, "src", "core"), path.join(rootDir, "src", "lib")];
  const allFiles: string[] = [];

  for (const dir of targetDirs) {
    walkDirSync(dir, allFiles);
  }

  const allViolations: LayerViolation[] = [];

  for (const filePath of allFiles) {
    const relativePath = path.relative(rootDir, filePath).replace(/\\/g, "/");
    const content = fs.readFileSync(filePath, "utf-8");
    const violations = checkContent(relativePath, content);
    allViolations.push(...violations);
  }

  return {
    scannedFiles: allFiles.length,
    violations: allViolations,
  };
}

// 脚本直接执行逻辑
if (process.argv[1] && process.argv[1].endsWith("check-layer-boundary.ts")) {
  scanLayerBoundaries()
    .then(({ scannedFiles, violations }) => {
      console.log(`[分层门禁检查] 扫描文件数: ${scannedFiles}`);
      if (violations.length > 0) {
        console.error(`[分层门禁检查] 发现 ${violations.length} 处违规:`);
        for (const v of violations) {
          console.error(`  - ${v.file}:${v.line} [${v.type}] ${v.detail}`);
        }
        process.exit(1);
      } else {
        console.log(`[分层门禁检查] 门禁通过，无越层违规。`);
      }
    })
    .catch((err) => {
      console.error("[分层门禁检查] 执行失败:", err);
      process.exit(1);
    });
}
