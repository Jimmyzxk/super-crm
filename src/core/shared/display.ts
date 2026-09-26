export function stageLabel(stage: string): string {
  return ({ DISCOVERY: "初步接触", PROPOSAL: "方案沟通", NEGOTIATION: "商务谈判", WON: "赢单", LOST: "丢单" } as Record<string, string>)[stage] ?? stage;
}

export function taskLabel(type: string): string {
  return ({ FIRST_RESPONSE: "首次响应", FOLLOW_UP: "下次跟进", STAGE_PUSH: "阶段推进" } as Record<string, string>)[type] ?? type;
}

export function formatAmountInCents(value: string | number | bigint | null | undefined, empty = "未填写"): string {
  if (value === null || value === undefined) return empty;
  try {
    const amount = typeof value === "bigint" ? value : BigInt(Math.round(Number(value)));
    const isNegative = amount < 0n;
    const abs = isNegative ? -amount : amount;
    const yuan = abs / 100n;
    const cents = (abs % 100n).toString().padStart(2, "0");
    const formatted = `¥${yuan.toLocaleString("zh-CN")}.${cents}`;
    return isNegative ? `-${formatted}` : formatted;
  } catch {
    return empty;
  }
}

export function formatBoundedCount(value: number, ceiling: number): string {
  return value > ceiling ? `${ceiling}+` : String(value);
}
