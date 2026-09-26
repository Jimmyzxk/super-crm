export type ActivityType = "CALL" | "MEETING" | "VISIT" | "MESSAGE" | "NOTE";
export type ActivityOutcome = "CONNECTED" | "NO_ANSWER" | "REFUSED" | "INTERESTED";

export interface ParsedFollowupSuggestion {
  suggestedType: ActivityType;
  suggestedOutcome?: ActivityOutcome;
  detectedTags: string[];
  suggestedNextFollowUpDays?: number;
  suggestedNextFollowUpAt?: string; // ISO string
  cleanSummary: string;
  confidence: number;
}

export function parseQuickFollowupText(rawText: string, baseDate: Date = new Date()): ParsedFollowupSuggestion {
  const text = (rawText || "").trim();
  if (!text) {
    return {
      suggestedType: "CALL",
      suggestedOutcome: "CONNECTED",
      detectedTags: [],
      cleanSummary: "",
      confidence: 0,
    };
  }

  // 1. Detect Activity Type
  let type: ActivityType = "CALL";
  if (/(拜访|上门|去客户现场|出差|现场交流)/i.test(text)) {
    type = "VISIT";
  } else if (/(会议|腾讯会议|zoom|面谈|开会|线上会|演示会)/i.test(text)) {
    type = "MEETING";
  } else if (/(微信|发微信|短信|邮件|发了资料|发了方案|发消息|企微)/i.test(text)) {
    type = "MESSAGE";
  } else if (/(内部记录|备忘|备注|内部讨论|归档)/i.test(text)) {
    type = "NOTE";
  } else {
    type = "CALL";
  }

  // 2. Detect Outcome (if not NOTE)
  let outcome: ActivityOutcome | undefined = undefined;
  if (type !== "NOTE") {
    if (/(未接|无人接听|占线|关机|停机|没接|打不通|挂了)/i.test(text)) {
      outcome = "NO_ANSWER";
    } else if (/(拒绝|不需要|没需求|不考虑|暂不考虑|已买别家|竞品已定|反感|请勿打扰)/i.test(text)) {
      outcome = "REFUSED";
    } else if (/(有意向|意向强|很感兴趣|认可|想了解|准备采购|要报价|要方案|约了演示|推进顺利|需求明确)/i.test(text)) {
      outcome = "INTERESTED";
    } else {
      outcome = "CONNECTED";
    }
  }

  // 3. Detect Objections and Business Tags
  const detectedTags: string[] = [];
  if (/(预算|太贵|价格高|降价|优惠|折扣|没钱|成本)/i.test(text)) {
    detectedTags.push("价格/预算关注");
  }
  if (/(竞品|友商|对比|别家|现有系统|替换)/i.test(text)) {
    detectedTags.push("竞品对比");
  }
  if (/(领导|老板|审批|总监|汇报|决策人|签字|上会)/i.test(text)) {
    detectedTags.push("决策链涉及");
  }
  if (/(周期长|下半年|不急|后期|明年|待定)/i.test(text)) {
    detectedTags.push("紧迫度较低");
  }
  if (/(演示|展示|demo|试用|poc|测试)/i.test(text)) {
    detectedTags.push("需产品演示/测试");
  }


  // 4. Detect & Calculate Next Follow-up Date
  let nextDays: number | undefined = undefined;
  const now = new Date(baseDate);

  if (/(明天|次日)/i.test(text)) {
    nextDays = 1;
  } else if (/(后天)/i.test(text)) {
    nextDays = 2;
  } else if (/(大后天|3天后|三天后)/i.test(text)) {
    nextDays = 3;
  } else if (/(下周一|周一)/i.test(text)) {
    const currentDay = now.getDay(); // 0 is Sunday, 1 is Monday...
    const daysUntilNextMonday = ((1 + 7 - currentDay) % 7) || 7;
    nextDays = daysUntilNextMonday;
  } else if (/(下周二|周二)/i.test(text)) {
    const currentDay = now.getDay();
    const daysUntilNextTue = ((2 + 7 - currentDay) % 7) || 7;
    nextDays = daysUntilNextTue;
  } else if (/(下周三|周三)/i.test(text)) {
    const currentDay = now.getDay();
    const daysUntilNextWed = ((3 + 7 - currentDay) % 7) || 7;
    nextDays = daysUntilNextWed;
  } else if (/(下周四|周四)/i.test(text)) {
    const currentDay = now.getDay();
    const daysUntilNextThu = ((4 + 7 - currentDay) % 7) || 7;
    nextDays = daysUntilNextThu;
  } else if (/(下周五|周五)/i.test(text)) {
    const currentDay = now.getDay();
    const daysUntilNextFri = ((5 + 7 - currentDay) % 7) || 7;
    nextDays = daysUntilNextFri;
  } else if (/(下周|一周后|7天后|七天后)/i.test(text)) {
    nextDays = 7;
  } else if (/(两周后|半个月后)/i.test(text)) {
    nextDays = 14;
  } else {
    // Default smart suggestion based on outcome
    if (outcome === "INTERESTED") {
      nextDays = 2; // high priority, follow up in 2 days
    } else if (outcome === "NO_ANSWER") {
      nextDays = 1; // retry next day
    } else if (outcome === "CONNECTED") {
      nextDays = 3; // follow up in 3 days
    }
  }

  let suggestedNextFollowUpAt: string | undefined = undefined;
  if (nextDays !== undefined && nextDays > 0) {
    const targetDate = new Date(now.getTime() + nextDays * 24 * 60 * 60 * 1000);
    targetDate.setHours(10, 0, 0, 0); // Default 10:00 AM
    suggestedNextFollowUpAt = targetDate.toISOString();
  }

  // 5. Format clean summary (max 200 chars)
  let cleanSummary = text.replace(/^(跟进记录[:：]|跟进[:：]|沟通记录[:：])/i, "").trim();
  if (cleanSummary.length > 200) {
    cleanSummary = cleanSummary.slice(0, 197) + "...";
  }

  return {
    suggestedType: type,
    suggestedOutcome: outcome,
    detectedTags,
    suggestedNextFollowUpDays: nextDays,
    suggestedNextFollowUpAt,
    cleanSummary,
    confidence: text.length > 10 ? 0.9 : 0.6,
  };
}
