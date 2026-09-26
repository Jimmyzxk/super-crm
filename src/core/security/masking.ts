/**
 * 三级等保合规数据脱敏工具库 (Level 3 Security Data Masking)
 */

export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const cleaned = phone.trim();
  if (cleaned.length < 7) return "***";
  if (cleaned.length === 11) {
    // 手机号标准掩码 138****1234
    return `${cleaned.slice(0, 3)}****${cleaned.slice(7)}`;
  }
  // 固话或其它长度
  const prefix = cleaned.slice(0, Math.min(3, Math.floor(cleaned.length / 3)));
  const suffix = cleaned.slice(-Math.min(4, Math.floor(cleaned.length / 3)));
  return `${prefix}****${suffix}`;
}

export function maskEmail(email: string | null | undefined): string {
  if (!email) return "";
  const [user, domain] = email.split("@");
  if (!domain) return "***";
  if (user.length <= 2) {
    return `${user[0]}***@${domain}`;
  }
  const prefix = user.slice(0, 2);
  const suffix = user.slice(-1);
  return `${prefix}***${suffix}@${domain}`;
}
