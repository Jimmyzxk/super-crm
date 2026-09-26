/**
 * SQL 查询安全辅助函数库
 */

/**
 * 转义 SQL LIKE / ILIKE 模糊查询中的通配符 %、_ 与转义符 \
 * 避免因用户输入包含 % 或 _ 导致的全表扫描或意外匹配
 */
export function escapeSqlLike(raw: string): string {
  if (!raw) return "";
  return raw.replace(/[%_\\]/g, "\\$&");
}
