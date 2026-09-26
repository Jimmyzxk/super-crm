import { describe, expect, it } from "vitest";
import { parseQuickFollowupText } from "@/core/followup/assistant";

describe("跟进文本智能辅助解析器", () => {
  it("空文本时返回默认兜底", () => {
    const result = parseQuickFollowupText("");
    expect(result.suggestedType).toBe("CALL");
    expect(result.suggestedOutcome).toBe("CONNECTED");
    expect(result.detectedTags).toEqual([]);
  });

  it("识别拜访沟通与意向强烈、预算充足标签", () => {
    const baseDate = new Date("2026-08-18T10:00:00.000Z");
    const result = parseQuickFollowupText("今天上门拜访客户，现场交流顺利，客户意向强，预算充足，约定后天做详细方案展示", baseDate);

    expect(result.suggestedType).toBe("VISIT");
    expect(result.suggestedOutcome).toBe("INTERESTED");
    expect(result.detectedTags).toContain("价格/预算关注");
    expect(result.detectedTags).toContain("需产品演示/测试");
    expect(result.suggestedNextFollowUpDays).toBe(2);
    expect(result.suggestedNextFollowUpAt).toBeDefined();
  });

  it("识别未接通电话与次日跟进", () => {
    const baseDate = new Date("2026-08-18T10:00:00.000Z");
    const result = parseQuickFollowupText("致电客户无人接听，明天再次拨打", baseDate);

    expect(result.suggestedType).toBe("CALL");
    expect(result.suggestedOutcome).toBe("NO_ANSWER");
    expect(result.suggestedNextFollowUpDays).toBe(1);
  });

  it("识别明确拒绝与竞品标签", () => {
    const result = parseQuickFollowupText("电话联系，客户表示暂不考虑，竞品已定，明确拒绝我们", new Date());

    expect(result.suggestedType).toBe("CALL");
    expect(result.suggestedOutcome).toBe("REFUSED");
    expect(result.detectedTags).toContain("竞品对比");
  });

  it("识别微信会议与决策链相关", () => {
    const result = parseQuickFollowupText("腾讯会议开会交流，技术总监和审批领导都在，需要向老板汇报后再定", new Date());

    expect(result.suggestedType).toBe("MEETING");
    expect(result.suggestedOutcome).toBe("CONNECTED");
    expect(result.detectedTags).toContain("决策链涉及");
  });
});
