import { leadFieldsSchema, type LeadInput } from "./types";

export type CsvPreviewRow = { row: number; data: LeadInput; duplicate?: boolean };
export type CsvErrorRow = { row: number; message: string };

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      fields.push(field);
      field = "";
    } else if ((char === '\n' || char === '\r') && !quoted) {
      // 处理 \r\n 作为单行分隔
      if (char === '\r' && text[i + 1] === '\n') i++;
      fields.push(field);
      // 跳过空行（全空字段且行内无内容）
      const hasContent = fields.some((f) => f.trim() !== "");
      if (hasContent) rows.push(fields.map((f) => f.trim()));
      fields = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error("CSV 引号未闭合");
  // 末行无换行时收尾
  if (field !== "" || fields.length > 0) {
    fields.push(field);
    const hasContent = fields.some((f) => f.trim() !== "");
    if (hasContent) rows.push(fields.map((f) => f.trim()));
  }
  return rows;
}

function parseLine(line: string): string[] {
  // 兼容旧调用：单行解析（不含换行字段）
  return parseCsvRows(line)[0] ?? [];
}

function decode(bytes: Uint8Array): string {
  const utf8 = new TextDecoder("utf-8", { fatal: true });
  try { return utf8.decode(bytes); }
  catch { return new TextDecoder("gbk", { fatal: true }).decode(bytes); }
}

export function parseLeadCsvBase64(base64: string): { valid: CsvPreviewRow[]; errors: CsvErrorRow[] } {
  const bytes = Uint8Array.from(Buffer.from(base64, "base64"));
  if (bytes.byteLength > 2 * 1024 * 1024) throw new Error("文件大小不能超过 2MB");
  const text = decode(bytes).replace(/^\uFEFF/, "");
  // 手写状态机支持 RFC4180 引号字段含换行（不引第三方库）
  const rows = parseCsvRows(text);
  if (rows.length < 2) throw new Error("CSV 中没有可导入的数据");
  if (rows.length - 1 > 1000) throw new Error("单次最多导入 1000 行");
  const headers = rows[0];
  const expected = ["姓名", "手机号", "公司", "邮箱", "职位", "意向产品", "预算", "备注"];
  const positions = Object.fromEntries(expected.map((name) => [name, headers.indexOf(name)]));
  if (positions["姓名"] < 0 || positions["手机号"] < 0) throw new Error("CSV 必须包含姓名和手机号列");
  const valid: CsvPreviewRow[] = [];
  const errors: CsvErrorRow[] = [];
  rows.slice(1).forEach((fields, index) => {
    const row = index + 2;
    try {
      const phone = fields[positions["手机号"]] ?? "";
      if (/e[+-]?\d+/i.test(phone)) throw new Error("手机号不能使用科学计数法");
      const result = leadFieldsSchema.safeParse({
        contactName: fields[positions["姓名"]], contactPhone: phone,
        companyName: positions["公司"] >= 0 ? fields[positions["公司"]] : undefined,
        contactEmail: positions["邮箱"] >= 0 ? fields[positions["邮箱"]] : undefined,
        title: positions["职位"] >= 0 ? fields[positions["职位"]] : undefined,
        intendedProduct: positions["意向产品"] >= 0 ? fields[positions["意向产品"]] : undefined,
        budget: positions["预算"] >= 0 ? fields[positions["预算"]] : undefined,
        note: positions["备注"] >= 0 ? fields[positions["备注"]] : undefined,
      });
      if (!result.success) throw new Error(result.error.issues[0].message);
      valid.push({ row, data: result.data });
    } catch (error) { errors.push({ row, message: error instanceof Error ? error.message : "格式错误" }); }
  });
  return { valid, errors };
}
