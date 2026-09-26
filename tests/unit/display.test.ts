import { describe, expect, it } from "vitest";
import { formatAmountInCents, formatBoundedCount, stageLabel, taskLabel } from "@/core/shared/display";

describe("阶段 4 页面展示格式", () => {
  it("展示阶段和任务中文文案", () => {
    expect(stageLabel("NEGOTIATION")).toBe("商务谈判");
    expect(stageLabel("WON")).toBe("赢单");
    expect(taskLabel("FIRST_RESPONSE")).toBe("首次响应");
    expect(taskLabel("FOLLOW_UP")).toBe("下次跟进");
    expect(taskLabel("STAGE_PUSH")).toBe("阶段推进");
  });

  it("用 BigInt 格式化金额，不因超过安全整数而失真", () => {
    expect(formatAmountInCents("9007199254740991")).toBe("¥90,071,992,547,409.91");
    expect(formatAmountInCents("0")).toBe("¥0.00");
    expect(formatAmountInCents(null, "金额未填写")).toBe("金额未填写");
  });

  it("只在有限计数真正超过 ceiling 时显示加号", () => {
    expect(formatBoundedCount(999, 1000)).toBe("999");
    expect(formatBoundedCount(1000, 1000)).toBe("1000");
    expect(formatBoundedCount(1001, 1000)).toBe("1000+");
  });
});
