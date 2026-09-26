import { sql } from "drizzle-orm";
import { withTenant } from "@/core/tenant";
import type { TenantContext, TenantTransaction } from "@/core/tenant";
import { BusinessError } from "@/core/shared/result";
import { callLlmGatewayService } from "@/core/ai-gateway/client";
import { invalidateAiCacheByTenant } from "@/core/ai-gateway/cache";
import type {
  AiAgentLearningLogItem,
  AiHubOverviewMetrics,
  AiPromptScene,
  AiPromptTemplateItem,
  AiQualityInspectionItem,
  UpsertPromptTemplateInput,
} from "./types";

const DEFAULT_PROMPTS: Array<{
  scene: AiPromptScene;
  name: string;
  description: string;
  systemPrompt: string;
  userPromptTemplate: string;
  variables: string[];
}> = [
  {
    scene: "OPPORTUNITY_DIAGNOSTIC",
    name: "商机成单诊断（看拍板人、报价单与跟进时间）",
    description: "自动检查商机是否已找到拍板人、是否配置了产品报价、最近几天有没有跟进，并给出成单概率与下一步该怎么推进的建议",
    systemPrompt: "你是一名拥有15年大客户打单实战经验的销售总监。请根据商机真实数据（拍板人、产品单、跟进天数），直截了当地指出推进卡点，并给出销售下一步该怎么做的具体实操建议。",
    userPromptTemplate: "【商机名称】：{opportunity_name}\n【客户公司】：{customer_name}\n【当前阶段】：{stage}\n【预估金额】：{expected_amount}\n【关键决策人】：{eb_status}\n【报价配置】：{sku_status}\n【停滞天数】：{stalled_days}天\n【主管协同】：{manager_intervention}\n\n请评估成单概率，指出最关键的卡点，并给出销售下一步具体该找谁、说什么的沟通示范话术。",
    variables: ["opportunity_name", "customer_name", "stage", "expected_amount", "eb_status", "sku_status", "stalled_days", "manager_intervention"],
  },
  {
    scene: "OBJECTION_KILLER",
    name: "客户嫌贵/看竞品/没预算等刁难应对策略",
    description: "针对客户说'太贵了、在看竞品、暂时没预算、等等再看、要再讨论'等常见推脱，生成销冠级实战应对拆解和示范话术",
    systemPrompt: "你是一名顶级销售实战教练。请针对客户的推脱和异议，生成直击痛点、绝不说教的实战回应示范话术，并给出可以跟客户谈判交换的商务条件。",
    userPromptTemplate: "【客户公司】：{customer_name}\n【客户异议】：{objection_type}\n【提及竞品】：{competitor_name}\n\n请输出销冠拆解思路、第一人称示范话术、以及可以跟客户谈的交换筹码。",
    variables: ["customer_name", "objection_type", "competitor_name"],
  },
  {
    scene: "LEAD_OUTREACH",
    name: "新客户加微信/打电话首句破冰策略",
    description: "根据线索所在行业、职位和意向需求，生成加微信好友申请、微信首条消息或电话开场白，提高客户回复率",
    systemPrompt: "你是一名拥有10年大客户与中小企业拓客实战经验的顶级B2B销冠顾问。请为销售生成真实、自然、专业、绝不惹人反感的破冰触达话术。\n【核心禁令】：\n1. 严禁输出任何'[您的公司名称]'、'[您的姓名]'、'[XX]'等方括号占位符！直接使用销售姓名与公司。\n2. 严禁使用'我们欣喜地发现'等生硬虚假的AI套话。\n3. 语气自然干练、平视交流、直击业务痛点、降低客户回复门槛。",
    userPromptTemplate: "【销售顾问】：{sales_rep_name}\n【所属公司】：{company_brand}\n【客户姓名】：{contact_name}\n【客户公司】：{company_name}\n【客户职位】：{title}\n【线索来源】：{source}\n【需求备注】：{demand_note}\n\n请输出加微信验证语、微信首条消息、电话开场白与推荐全文。",
    variables: ["sales_rep_name", "company_brand", "contact_name", "company_name", "title", "source", "demand_note"],
  },
  {
    scene: "DEAL_INSPECTION",
    name: "商机推进漏项与风险检查脑",
    description: "自动扫描商机推进过程，检查是否漏找决策人、是否漏配报价单、是否长期未联系客户，给出0-100分与整改提醒",
    systemPrompt: "你是一名严格的销售质检专家。请客观核对商机数据，指出哪些要素缺失、跟进是否及时，给出质检评分和具体补齐指导。",
    userPromptTemplate: "【商机ID】：{opportunity_id}\n【当前阶段】：{stage}\n【已确认决策人】：{decision_maker_count}位\n【报价产品项】：{line_item_count}项\n【距上次跟进】：{stalled_days}天\n【最新跟进】：{recent_activity_summary}\n\n请输出质检得分(0-100)、核验结论与整改指令。",
    variables: ["opportunity_id", "stage", "decision_maker_count", "line_item_count", "stalled_days", "recent_activity_summary"],
  },
];

export async function listPromptTemplatesService(
  tenant: TenantContext,
): Promise<AiPromptTemplateItem[]> {
  return withTenant(tenant.tenantId, async (tx) => {
    let rows = await tx.execute<{
      id: string;
      scene: string;
      name: string;
      description: string | null;
      system_prompt: string;
      user_prompt_template: string;
      variables: string[];
      is_active: boolean;
      version: number;
      updated_at: string;
    }>(sql`
      select
        id,
        scene,
        name,
        description,
        system_prompt,
        user_prompt_template,
        variables,
        is_active,
        version,
        updated_at::text as updated_at
      from public.ai_prompt_templates
      where tenant_id = ${tenant.tenantId}
      order by scene asc, created_at desc
    `);

    // 若租户未初始化提示词库，自动初始化默认高质量提示词
    if (rows.rows.length === 0) {
      for (const p of DEFAULT_PROMPTS) {
        await tx.execute(sql`
          insert into public.ai_prompt_templates (
            tenant_id,
            scene,
            name,
            description,
            system_prompt,
            user_prompt_template,
            variables,
            is_active,
            version,
            created_at,
            updated_at
          ) values (
            ${tenant.tenantId},
            ${p.scene},
            ${p.name},
            ${p.description},
            ${p.systemPrompt},
            ${p.userPromptTemplate},
            ${JSON.stringify(p.variables)}::jsonb,
            true,
            1,
            now(),
            now()
          )
        `);
      }

      rows = await tx.execute<{
        id: string;
        scene: string;
        name: string;
        description: string | null;
        system_prompt: string;
        user_prompt_template: string;
        variables: string[];
        is_active: boolean;
        version: number;
        updated_at: string;
      }>(sql`
        select
          id,
          scene,
          name,
          description,
          system_prompt,
          user_prompt_template,
          variables,
          is_active,
          version,
          updated_at::text as updated_at
        from public.ai_prompt_templates
        where tenant_id = ${tenant.tenantId}
        order by scene asc, created_at desc
      `);
    }

    return rows.rows.map((r) => ({
      id: r.id,
      scene: r.scene as AiPromptScene,
      name: r.name,
      description: r.description,
      systemPrompt: r.system_prompt,
      userPromptTemplate: r.user_prompt_template,
      variables: Array.isArray(r.variables) ? r.variables : [],
      isActive: r.is_active,
      version: r.version,
      updatedAt: r.updated_at,
    }));
  });
}

export async function upsertPromptTemplateService(
  tenant: TenantContext,
  input: UpsertPromptTemplateInput,
): Promise<AiPromptTemplateItem> {
  if (tenant.role !== "ADMIN") {
    throw new Error("权限不足：仅管理员可调整 AI 提示词策略库");
  }

  return withTenant(tenant.tenantId, async (tx) => {
    if (input.id) {
      const res = await tx.execute<{
        id: string;
        scene: string;
        name: string;
        description: string | null;
        system_prompt: string;
        user_prompt_template: string;
        variables: string[];
        is_active: boolean;
        version: number;
        updated_at: string;
      }>(sql`
        update public.ai_prompt_templates
        set
          name = ${input.name},
          description = ${input.description ?? null},
          system_prompt = ${input.systemPrompt},
          user_prompt_template = ${input.userPromptTemplate},
          variables = ${JSON.stringify(input.variables ?? [])}::jsonb,
          is_active = coalesce(${input.isActive ?? null}, is_active),
          version = version + 1,
          updated_at = now()
        where tenant_id = ${tenant.tenantId} and id = ${input.id}::uuid
        returning
          id,
          scene,
          name,
          description,
          system_prompt,
          user_prompt_template,
          variables,
          is_active,
          version,
          updated_at::text as updated_at
      `);
      if (res.rows.length === 0) throw new Error("提示词模板不存在");
      const r = res.rows[0];
      invalidateAiCacheByTenant(tenant.tenantId);
      return {
        id: r.id,
        scene: r.scene as AiPromptScene,
        name: r.name,
        description: r.description,
        systemPrompt: r.system_prompt,
        userPromptTemplate: r.user_prompt_template,
        variables: Array.isArray(r.variables) ? r.variables : [],
        isActive: r.is_active,
        version: r.version,
        updatedAt: r.updated_at,
      };
    }

    const res = await tx.execute<{
      id: string;
      scene: string;
      name: string;
      description: string | null;
      system_prompt: string;
      user_prompt_template: string;
      variables: string[];
      is_active: boolean;
      version: number;
      updated_at: string;
    }>(sql`
      insert into public.ai_prompt_templates (
        tenant_id,
        scene,
        name,
        description,
        system_prompt,
        user_prompt_template,
        variables,
        is_active,
        version,
        created_at,
        updated_at
      ) values (
        ${tenant.tenantId},
        ${input.scene},
        ${input.name},
        ${input.description ?? null},
        ${input.systemPrompt},
        ${input.userPromptTemplate},
        ${JSON.stringify(input.variables ?? [])}::jsonb,
        ${input.isActive ?? true},
        1,
        now(),
        now()
      )
      returning
        id,
        scene,
        name,
        description,
        system_prompt,
        user_prompt_template,
        variables,
        is_active,
        version,
        updated_at::text as updated_at
    `);
    const r = res.rows[0];
    invalidateAiCacheByTenant(tenant.tenantId);
    return {
      id: r.id,
      scene: r.scene as AiPromptScene,
      name: r.name,
      description: r.description,
      systemPrompt: r.system_prompt,
      userPromptTemplate: r.user_prompt_template,
      variables: Array.isArray(r.variables) ? r.variables : [],
      isActive: r.is_active,
      version: r.version,
      updatedAt: r.updated_at,
    };
  });
}

export async function executeDealInspectionService(
  tenant: TenantContext,
  opportunityId: string,
): Promise<AiQualityInspectionItem> {
  // 1. 快速读取商机事实 (< 5ms)
  const facts = await withTenant(tenant.tenantId, async (tx) => {
    const oppRes = await tx.execute<{
      id: string;
      name: string;
      stage: string;
      expected_amount: number;
      customer_id: string;
      owner_user_id: string;
      customer_name: string;
      is_stalled: boolean;
    }>(sql`
      select
        o.id,
        o.name,
        o.stage,
        o.expected_amount,
        o.customer_id,
        o.owner_user_id,
        c.name as customer_name,
        case when extract(day from (now() - o.updated_at)) > 14 then true else false end as is_stalled
      from public.opportunities o
      join public.customers c on c.id = o.customer_id
      where o.tenant_id = ${tenant.tenantId} and o.id = ${opportunityId}::uuid
    `);

    if (oppRes.rows.length === 0) throw new Error("商机不存在");
    const opp = oppRes.rows[0];

    // 销售角色越权防御：SALES 只能质检本人负责的商机
    if (tenant.role === "SALES" && opp.owner_user_id !== tenant.userId) {
      throw new Error("无权质检非本人负责的商机");
    }

    const contactsRes = await tx.execute<{ role_tag: string }>(sql`
      select role_tag from public.contacts
      where tenant_id = ${tenant.tenantId} and customer_id = ${opp.customer_id}::uuid and deleted_at is null
    `);
    const decisionMakerVerified = contactsRes.rows.some((c) => c.role_tag === "DECISION_MAKER");

    const lineItemsRes = await tx.execute<{ count: number }>(sql`
      select count(*)::integer as count from public.opportunity_line_items
      where tenant_id = ${tenant.tenantId} and opportunity_id = ${opportunityId}::uuid
    `);
    const pricingLineItemsConfigured = (lineItemsRes.rows[0]?.count ?? 0) > 0;

    const activityRes = await tx.execute<{ count: number; days_since_touch: number | null }>(sql`
      select
        count(*)::integer as count,
        extract(day from (now() - coalesce(max(created_at), now())))::integer as days_since_touch
      from public.activities
      where tenant_id = ${tenant.tenantId}
        and (
          opportunity_id = ${opportunityId}::uuid
          or (${opp.customer_id ? sql`customer_id = ${opp.customer_id}::uuid` : sql`false`})
        )
    `);
    const followupCount = activityRes.rows[0]?.count ?? 0;
    const daysSinceTouch = activityRes.rows[0]?.days_since_touch ?? 0;
    const followupSlaHealthy = followupCount > 0 && daysSinceTouch <= 7;

    const guardrailsCompliant = opp.expected_amount > 0 && !opp.is_stalled;

    return {
      opp,
      decisionMakerVerified,
      pricingLineItemsConfigured,
      daysSinceTouch,
      followupSlaHealthy,
      guardrailsCompliant,
    };
  });

  const {
    opp,
    decisionMakerVerified,
    pricingLineItemsConfigured,
    daysSinceTouch,
    followupSlaHealthy,
    guardrailsCompliant,
  } = facts;

  // 计算质检得分与发现
  const findings: string[] = [];
  const actionRecommendations: string[] = [];
  let score = 100;

  if (!decisionMakerVerified) {
    score -= 25;
    findings.push("未识别或未标记企业核心关键拍板人 (EB / Decision Maker)");
    actionRecommendations.push("在客户联系人中补充核心决策者并标记角色为'决策人'");
  } else {
    findings.push("已确认企业核心决策人角色，决策链条清晰");
  }

  if (!pricingLineItemsConfigured) {
    score -= 25;
    findings.push("商机尚未配置关联产品明细与报价清单 (SKU)");
    actionRecommendations.push("在商机工作台中选配标准产品、配置数量及折扣核算");
  } else {
    findings.push("产品明细与报价清单配置完备");
  }

  if (!followupSlaHealthy) {
    score -= 25;
    findings.push(`跟进节奏迟缓：距上次跟进已有 ${daysSinceTouch} 天未触达`);
    actionRecommendations.push("立即记录最新一次拜访/电话沟通并排期下次待办");
  } else {
    findings.push("跟进时效良好，处于正常推进节奏");
  }

  if (!guardrailsCompliant) {
    score -= 25;
    findings.push("商机处于停滞超期状态，可能面临流失风险");
    actionRecommendations.push("发起主管协同介入申请或重新核定商机预期");
  }

  score = Math.max(0, Math.min(100, score));

  const defaultVerdict: AiQualityInspectionItem["verdict"] =
    score >= 80 ? "PASSED" : score >= 50 ? "NEEDS_ATTENTION" : "HIGH_RISK";

  const dimensions = {
    decisionMakerVerified,
    pricingLineItemsConfigured,
    followupSlaHealthy,
    guardrailsCompliant,
  };

  // 2. 外部异步调用真实大模型网关 (无数据库锁)
  const userPrompt = `
【商机名称】：${opp.name}
【客户名称】：${opp.customer_name}
【当前阶段】：${opp.stage}
【商机金额】：${opp.expected_amount / 100} 元
【决策人绑定】：${decisionMakerVerified ? "已绑定" : "未绑定"}
【报价明细配置】：${pricingLineItemsConfigured ? "已配置" : "未配置"}
【距上次跟进】：${daysSinceTouch} 天
【基础质检扣分项】：${findings.join("；")}

请以纯 JSON 格式输出智能质检评估：
{
  "score": ${score},
  "verdict": "${defaultVerdict}",
  "findings": ${JSON.stringify(findings)},
  "actionRecommendations": ${JSON.stringify(actionRecommendations)}
}
`;

  const llmRes = await callLlmGatewayService<{
    score?: number;
    verdict?: AiQualityInspectionItem["verdict"];
    findings?: string[];
    actionRecommendations?: string[];
  }>(tenant, {
    scene: "DEAL_INSPECTION",
    userPrompt,
    fallbackContent: JSON.stringify({
      score,
      verdict: defaultVerdict,
      findings,
      actionRecommendations,
    }),
  });

  const finalScore = llmRes.data?.score ?? score;
  const finalVerdict = llmRes.data?.verdict || defaultVerdict;
  const finalFindings =
    llmRes.data?.findings && llmRes.data.findings.length > 0 ? llmRes.data.findings : findings;
  const finalActions =
    llmRes.data?.actionRecommendations && llmRes.data.actionRecommendations.length > 0
      ? llmRes.data.actionRecommendations
      : actionRecommendations;

  // 3. 快速存盘质检报告 (< 5ms)
  const insertRes = await withTenant(tenant.tenantId, async (tx) => {
    return tx.execute<{ id: string; created_at: string }>(sql`
      insert into public.ai_quality_inspections (
        tenant_id,
        opportunity_id,
        inspector_agent,
        score,
        verdict,
        dimensions,
        findings,
        action_recommendations,
        created_at
      ) values (
        ${tenant.tenantId},
        ${opportunityId}::uuid,
        'DEAL_QUALITY_AGENT',
        ${finalScore},
        ${finalVerdict},
        ${JSON.stringify(dimensions)}::jsonb,
        ${JSON.stringify(finalFindings)}::jsonb,
        ${JSON.stringify(finalActions)}::jsonb,
        now()
      )
      returning id, created_at::text as created_at
    `);
  });

  return {
    id: insertRes.rows[0].id,
    opportunityId,
    opportunityTitle: opp.name,
    customerName: opp.customer_name,
    inspectorAgent: "DEAL_QUALITY_AGENT",
    score: finalScore,
    verdict: finalVerdict,
    dimensions,
    findings: finalFindings,
    actionRecommendations: finalActions,
    createdAt: insertRes.rows[0].created_at,
  };
}

async function listQualityInspectionsTx(
  tx: TenantTransaction,
  tenant: TenantContext,
  opportunityId?: string,
): Promise<AiQualityInspectionItem[]> {
  {

    const res = await tx.execute<{
      id: string;
      opportunity_id: string;
      opportunity_title: string;
      customer_name: string;
      inspector_agent: string;
      score: number;
      verdict: string;
      dimensions: AiQualityInspectionItem["dimensions"];
      findings: string[];
      action_recommendations: string[];
      created_at: string;
    }>(sql`
      select
        q.id,
        q.opportunity_id,
        o.name as opportunity_title,
        c.name as customer_name,
        q.inspector_agent,
        q.score,
        q.verdict,
        q.dimensions,
        q.findings,
        q.action_recommendations,
        q.created_at::text as created_at
      from public.ai_quality_inspections q
      join public.opportunities o on o.id = q.opportunity_id
      join public.customers c on c.id = o.customer_id
      where q.tenant_id = ${tenant.tenantId}
        ${opportunityId ? sql`and q.opportunity_id = ${opportunityId}::uuid` : sql``}
        ${tenant.role === "SALES" ? sql`and o.owner_user_id = ${tenant.userId}::uuid` : sql``}
      order by q.created_at desc
      limit 50
    `);

    return res.rows.map((r) => ({
      id: r.id,
      opportunityId: r.opportunity_id,
      opportunityTitle: r.opportunity_title,
      customerName: r.customer_name,
      inspectorAgent: r.inspector_agent,
      score: r.score,
      verdict: r.verdict as AiQualityInspectionItem["verdict"],
      dimensions: r.dimensions,
      findings: Array.isArray(r.findings) ? r.findings : [],
      actionRecommendations: Array.isArray(r.action_recommendations) ? r.action_recommendations : [],
      createdAt: r.created_at,
    }));
  };
}

export async function listQualityInspectionsService(
  tenant: TenantContext,
  opportunityId?: string,
): Promise<AiQualityInspectionItem[]> {
  return withTenant(tenant.tenantId, (tx) => listQualityInspectionsTx(tx, tenant, opportunityId));
}

async function listAgentLearningLogsTx(
  tx: TenantTransaction,
  tenant: TenantContext,
): Promise<AiAgentLearningLogItem[]> {
  {

    let rows = await tx.execute<{
      id: string;
      source_type: string;
      source_id: string | null;
      topic: string;
      extracted_strategy: string;
      sample_dialogue: string | null;
      effectiveness_score: string;
      is_promoted_to_pool: boolean;
      created_at: string;
    }>(sql`
      select
        id,
        source_type,
        source_id,
        topic,
        extracted_strategy,
        sample_dialogue,
        effectiveness_score,
        is_promoted_to_pool,
        created_at::text as created_at
      from public.ai_agent_learning_logs
      where tenant_id = ${tenant.tenantId}
      order by created_at desc
      limit 50
    `);

    if (rows.rows.length === 0) {
      // 预置经典销冠学习样本
      await tx.execute(sql`
        insert into public.ai_agent_learning_logs (
          tenant_id,
          source_type,
          topic,
          extracted_strategy,
          sample_dialogue,
          effectiveness_score,
          is_promoted_to_pool,
          created_at
        ) values (
          ${tenant.tenantId},
          'EXEMPLAR_PLAYBOOK',
          '高预算客户价值升维与快速锁单',
          '在客户认可交付价值后，主动提出分期部署里程碑，配合首期快速见效承诺降低决策风险',
          '张总，咱们不必一开始全量铺开，先以核心一期上线验收，见效后再启动二期，预算完全可控。',
          98.50,
          true,
          now()
        )
      `);

      rows = await tx.execute<{
        id: string;
        source_type: string;
        source_id: string | null;
        topic: string;
        extracted_strategy: string;
        sample_dialogue: string | null;
        effectiveness_score: string;
        is_promoted_to_pool: boolean;
        created_at: string;
      }>(sql`
        select
          id,
          source_type,
          source_id,
          topic,
          extracted_strategy,
          sample_dialogue,
          effectiveness_score,
          is_promoted_to_pool,
          created_at::text as created_at
        from public.ai_agent_learning_logs
        where tenant_id = ${tenant.tenantId}
        order by created_at desc
        limit 50
      `);
    }

    return rows.rows.map((r) => ({
      id: r.id,
      sourceType: r.source_type as AiAgentLearningLogItem["sourceType"],
      sourceId: r.source_id,
      topic: r.topic,
      extractedStrategy: r.extracted_strategy,
      sampleDialogue: r.sample_dialogue,
      effectivenessScore: Number(r.effectiveness_score) || 0,
      isPromotedToPool: r.is_promoted_to_pool,
      createdAt: r.created_at,
    }));
  };
}

export async function listAgentLearningLogsService(
  tenant: TenantContext,
): Promise<AiAgentLearningLogItem[]> {
  return withTenant(tenant.tenantId, (tx) => listAgentLearningLogsTx(tx, tenant));
}

export async function extractLearningFromWinReviewService(
  tenant: TenantContext,
  winReviewId: string,
): Promise<AiAgentLearningLogItem> {
  return withTenant(tenant.tenantId, async (tx) => {
    const wr = await tx.execute<{
      id: string;
      opportunity_id: string;
      opportunity_name: string;
      summary: string;
      review_reason: string | null;
      data_gaps: string[] | null;
    }>(sql`
      select
        wr.id,
        wr.opportunity_id,
        o.name as opportunity_name,
        wr.summary,
        wr.review_reason,
        wr.data_gaps
      from public.win_reviews wr
      join public.opportunities o on o.id = wr.opportunity_id
      where wr.tenant_id = ${tenant.tenantId} and wr.id = ${winReviewId}::uuid
    `);

    if (wr.rows.length === 0) throw new Error("赢单复盘记录不存在");

    // 发布门禁对齐：只有通过人工审核（REVIEWED）的复盘才允许提炼入
    // 自学习库——否则任意登录用户可把草稿/被拒结论写进策略库污染打法
    const statusRow = await tx.execute<{ status: string }>(sql`
      select status::text as status from public.win_reviews
      where tenant_id = ${tenant.tenantId} and id = ${winReviewId}::uuid
    `);
    if (statusRow.rows[0]?.status !== "REVIEWED") {
      throw new Error("复盘尚未通过人工审核，禁止提炼入自学习库");
    }
    const review = wr.rows[0];

    const strategy = review.summary || "锁定核心决策者诉求，紧扣行业合规要求与ROI测算快速推进闭单";
    const topic = `${review.opportunity_name} 赢单实战打法沉淀`;

    // 客观根据复盘数据完整度（是否有数据缺口）测算打法参考度得分
    const gapsCount = Array.isArray(review.data_gaps) ? review.data_gaps.length : 0;
    const computedScore = Math.max(70, 95 - gapsCount * 5);

    const res = await tx.execute<{
      id: string;
      created_at: string;
    }>(sql`
      insert into public.ai_agent_learning_logs (
        tenant_id,
        source_type,
        source_id,
        topic,
        extracted_strategy,
        sample_dialogue,
        effectiveness_score,
        is_promoted_to_pool,
        created_at
      ) values (
        ${tenant.tenantId},
        'WIN_REVIEW',
        ${winReviewId}::uuid,
        ${topic},
        ${strategy},
        ${review.review_reason ?? null},
        ${computedScore},
        true,
        now()
      )
      returning id, created_at::text as created_at
    `);

    return {
      id: res.rows[0].id,
      sourceType: "WIN_REVIEW",
      sourceId: winReviewId,
      topic,
      extractedStrategy: strategy,
      sampleDialogue: review.review_reason,
      effectivenessScore: computedScore,
      isPromotedToPool: true,
      createdAt: res.rows[0].created_at,
    };
  });
}

export async function getAiHubOverviewService(
  tenant: TenantContext,
): Promise<AiHubOverviewMetrics> {
  return withTenant(tenant.tenantId, async (tx) => {
    const [inspectionsRes, promptCountRes, learningCountRes, recStatsRes] = await Promise.all([
      tx.execute<{
        count: number;
        avg_score: string;
        high_risk_count: number;
      }>(sql`
        select
          count(*)::integer as count,
          coalesce(avg(score), 0)::text as avg_score,
          count(case when verdict = 'HIGH_RISK' then 1 end)::integer as high_risk_count
        from public.ai_quality_inspections
        where tenant_id = ${tenant.tenantId}
      `),
      tx.execute<{ count: number }>(sql`
        select count(*)::integer as count from public.ai_prompt_templates
        where tenant_id = ${tenant.tenantId} and is_active = true
      `),
      tx.execute<{ count: number }>(sql`
        select count(*)::integer as count from public.ai_agent_learning_logs
        where tenant_id = ${tenant.tenantId}
      `),
      tx.execute<{
        total_recs: number;
        applied_recs: number;
      }>(sql`
        select
          count(*)::integer as total_recs,
          count(case when is_applied = true then 1 end)::integer as applied_recs
        from public.ai_recommendations
        where tenant_id = ${tenant.tenantId}
      `),
    ]);

    const totalInspectionsCount = inspectionsRes.rows[0]?.count ?? 0;
    const averageInspectionScore = Math.round(Number(inspectionsRes.rows[0]?.avg_score) || 0);
    const highRiskDealCount = inspectionsRes.rows[0]?.high_risk_count ?? 0;
    const promptTemplateCount = promptCountRes.rows[0]?.count ?? 0;
    const learnedStrategiesCount = learningCountRes.rows[0]?.count ?? 0;

    const totalRecs = recStatsRes.rows[0]?.total_recs ?? 0;
    const appliedRecs = recStatsRes.rows[0]?.applied_recs ?? 0;
    // 真实计算一线采纳率，无样本数据时客观返回 0%，绝不伪造硬编码数据
    const feedbackAdoptionRatePercent = totalRecs > 0 ? Math.round((appliedRecs / totalRecs) * 100) : 0;

    // 概览页复用当前事务连接取最近记录——此前这里嵌套开两个新 withTenant
    // 连接，单请求占 3 条池连接（上限 25），几个管理员并发即可打满
    const recentInspections = await listQualityInspectionsTx(tx, tenant);
    const recentLearnings = await listAgentLearningLogsTx(tx, tenant);

    return {
      totalInspectionsCount,
      averageInspectionScore,
      highRiskDealCount,
      promptTemplateCount,
      learnedStrategiesCount,
      feedbackAdoptionRatePercent,
      recentInspections: recentInspections.slice(0, 5),
      recentLearnings: recentLearnings.slice(0, 5),
    };
  });
}

export interface ClosedOpportunityItem {
  id: string;
  name: string;
  stage: "WON" | "LOST";
  customerId: string;
  customerName: string;
  customerIndustry: string | null;
  expectedAmountYuan: number | null;
  actualAmountYuan: number | null;
  actualCloseAt: string | null;
  lostReason: string | null;
  ownerUserId: string;
  ownerName: string;
}

export async function listClosedOpportunitiesService(
  ctx: TenantContext
): Promise<ClosedOpportunityItem[]> {
  return withTenant(ctx.tenantId, async (tx) => {
    const isSales = ctx.role === "SALES";
    const res = await tx.execute<{
      id: string;
      name: string;
      stage: "WON" | "LOST";
      customerId: string;
      customerName: string;
      customerIndustry: string | null;
      expectedAmount: string | null;
      actualAmount: string | null;
      actualCloseAt: string | null;
      lostReason: string | null;
      ownerUserId: string;
      ownerName: string;
    }>(sql`
      select
        o.id,
        o.name,
        o.stage,
        o.customer_id as "customerId",
        c.name as "customerName",
        c.industry as "customerIndustry",
        o.expected_amount::text as "expectedAmount",
        o.actual_amount::text as "actualAmount",
        o.actual_close_at::text as "actualCloseAt",
        o.lost_reason as "lostReason",
        o.owner_user_id::text as "ownerUserId",
        u.name as "ownerName"
      from opportunities o
      join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
      join users u on u.tenant_id = o.tenant_id and u.id = o.owner_user_id
      where o.tenant_id = ${ctx.tenantId}::uuid
        and o.stage in ('WON', 'LOST')
        and o.deleted_at is null
        ${isSales ? sql`and o.owner_user_id = ${ctx.userId}::uuid` : sql``}
      order by coalesce(o.actual_close_at, o.updated_at::date) desc, o.created_at desc
      limit 50
    `);

    return res.rows.map((row) => ({
      id: row.id,
      name: row.name,
      stage: row.stage,
      customerId: row.customerId,
      customerName: row.customerName,
      customerIndustry: row.customerIndustry,
      expectedAmountYuan: row.expectedAmount ? Number((Number(row.expectedAmount) / 100).toFixed(2)) : null,
      actualAmountYuan: row.actualAmount ? Number((Number(row.actualAmount) / 100).toFixed(2)) : null,
      actualCloseAt: row.actualCloseAt,
      lostReason: row.lostReason,
      ownerUserId: row.ownerUserId,
      ownerName: row.ownerName,
    }));
  });
}

import { localDateValue } from "@/core/shared/date";
import type {
  AiInsightReportItem,
  AiInsightReportKind,
  SaveInsightReportInput,
  OpportunityAttributionTrace,
} from "./types";

export function desensitizeReportForSales(content: string): string {
  return content
    .replace(/¥\s*[\d,]+(\.\d+)?/g, "¥***")
    .replace(/(?:总赢单|成单|签约|贡献|在途|总)?金额[：:\s]*¥?[\d,]+(\.\d+)?/g, (match) => {
      return match.replace(/¥?[\d,]+(\.\d+)?/, "¥***");
    })
    .replace(/(\d+(\.\d+)?)\s*(万|千)?元/g, "***元")
    .replace(/(\d+(\.\d+)?)\s*万元/g, "***万元");
}

export function extractReproducibleActionsSummary(content: string): string {
  const match = content.match(/(?:【?可复制动作(?:假设)?】?|3\.\s*\*\*可复制动作)([\s\S]*?)(?=##|\n\n4\.|\n\n###|$)/i);
  let summary = "";
  if (match && match[1]) {
    summary = match[1]
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("-") || line.startsWith("*") || /^\d+\./.test(line) || line.startsWith("【"))
      .join("； ");
  }
  if (!summary) {
    const lines = content.split("\n").filter((l) => l.includes("动作") || l.includes("建议") || l.includes("模版"));
    summary = lines.slice(0, 3).join("； ");
  }
  if (!summary) {
    summary = content.slice(0, 180);
  }
  const desensitized = desensitizeReportForSales(summary)
    .replace(/\s+/g, " ")
    .replace(/^[；\s]+/, "");
  return desensitized.slice(0, 190);
}

export function stripSensitiveForPublicSummary(content: string): string {
  let s = desensitizeReportForSales(content);
  // 手机号、邮箱、座机等联系方式一律掩码
  s = s.replace(/1[3-9]\d{9}/g, "***");
  s = s.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "***");
  s = s.replace(/0\d{2,3}[- ]?\d{7,8}/g, "***");
  // 兜底：冒号后的纯数字金额（如 营收（万元）：120）也脱敏
  s = s.replace(/[:：]\s*\d+(\.\d+)?/g, ":***");
  // 去除原文残留的敏感关键词上下文数字
  s = s.replace(/营收[^\n]*?\d+/g, (m) => m.replace(/\d+/g, "***"));
  return s;
}

export function buildPublicSafeSummary(content: string): string {
  const raw = extractReproducibleActionsSummary(content);
  let safe = stripSensitiveForPublicSummary(raw);
  safe = safe.replace(/\s+/g, " ").trim();
  // 若提取仍为空，给出通用安全摘要而非原文回退
  if (!safe || safe.length < 5) {
    safe = "可复制打法：持续跟进决策人、明确下一步行动与验证客户需求。";
  }
  return safe.slice(0, 190);
}

export async function saveInsightReportService(
  ctx: TenantContext,
  input: SaveInsightReportInput
): Promise<AiInsightReportItem> {
  const period = input.period || localDateValue(new Date()).slice(0, 7);
  const sampleSize = input.sampleSize ?? 0;
  const confidence = input.confidence ?? (sampleSize >= 20 ? "HIGH" : sampleSize >= 10 ? "MEDIUM" : "LOW");
  const evidence = input.evidence || {};
  // R02: 保存时即生成结构化公共摘要（不含金额/联系方式/原文），SALES 仅读此字段
  const publicSummary = buildPublicSafeSummary(input.content);

  return withTenant(ctx.tenantId, async (tx) => {
    let res: { rows: Array<{ id: string; tenant_id: string; kind: AiInsightReportKind; period: string; content: string; evidence: Record<string, unknown>; sample_size: number; confidence: "HIGH" | "MEDIUM" | "LOW"; public_summary: string | null; created_by: string; created_at: string; updated_at: string }> };
    try {
      res = await tx.execute<{
        id: string;
        tenant_id: string;
        kind: AiInsightReportKind;
        period: string;
        content: string;
        evidence: Record<string, unknown>;
        sample_size: number;
        confidence: "HIGH" | "MEDIUM" | "LOW";
        public_summary: string | null;
        created_by: string;
        created_at: string;
        updated_at: string;
      }>(sql`
      insert into ai_insight_reports (
        tenant_id, kind, period, content, evidence, sample_size, confidence, public_summary, created_by, updated_at
      ) values (
        ${ctx.tenantId}::uuid,
        ${input.kind}::ai_insight_report_kind,
        ${period},
        ${input.content},
        ${JSON.stringify(evidence)}::jsonb,
        ${sampleSize},
        ${confidence}::ai_insight_confidence,
        ${publicSummary},
        ${ctx.userId}::uuid,
        now()
      )
      on conflict (tenant_id, kind, period) do update set
        content = excluded.content,
        evidence = excluded.evidence,
        sample_size = excluded.sample_size,
        confidence = excluded.confidence,
        public_summary = excluded.public_summary,
        updated_at = now()
      returning
        id,
        tenant_id,
        kind,
        period,
        content,
        evidence,
        sample_size,
        confidence,
        public_summary,
        created_by,
        created_at::text as created_at,
        updated_at::text as updated_at
    `);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("public_summary") || msg.includes("publicSummary")) {
        const evidenceWithSummary = { ...(evidence as Record<string, unknown>), public_summary: publicSummary };
        const fallback = await tx.execute<{
          id: string;
          tenant_id: string;
          kind: AiInsightReportKind;
          period: string;
          content: string;
          evidence: Record<string, unknown>;
          sample_size: number;
          confidence: "HIGH" | "MEDIUM" | "LOW";
          created_by: string;
          created_at: string;
          updated_at: string;
        }>(sql`
      insert into ai_insight_reports (
        tenant_id, kind, period, content, evidence, sample_size, confidence, created_by, updated_at
      ) values (
        ${ctx.tenantId}::uuid,
        ${input.kind}::ai_insight_report_kind,
        ${period},
        ${input.content},
        ${JSON.stringify(evidenceWithSummary)}::jsonb,
        ${sampleSize},
        ${confidence}::ai_insight_confidence,
        ${ctx.userId}::uuid,
        now()
      )
      on conflict (tenant_id, kind, period) do update set
        content = excluded.content,
        evidence = excluded.evidence,
        sample_size = excluded.sample_size,
        confidence = excluded.confidence,
        updated_at = now()
      returning
        id,
        tenant_id,
        kind,
        period,
        content,
        evidence,
        sample_size,
        confidence,
        created_by,
        created_at::text as created_at,
        updated_at::text as updated_at
    `);
        res = { rows: fallback.rows.map((r) => ({ ...r, public_summary: (r.evidence as Record<string, unknown>)?.public_summary as string || publicSummary })) } as typeof res;
      } else {
        throw e;
      }
    }

    const reportRow = res.rows[0];

    // R02: 通知一律使用摘要字段，删除“无 *** 就回退全文前200字”的分支
    if (input.kind === "CHAMPION_ANALYSIS") {
      const notificationBody = publicSummary.slice(0, 200);
      const salesUsersRes = await tx.execute<{ id: string }>(sql`
        select id from users
        where tenant_id = ${ctx.tenantId}::uuid
          and role = 'SALES'
          and status = 'ACTIVE'
      `);

      for (const salesUser of salesUsersRes.rows) {
        await tx.execute(sql`
          insert into notifications (
            tenant_id, user_id, type, title, body, link, created_at
          ) values (
            ${ctx.tenantId}::uuid,
            ${salesUser.id}::uuid,
            'CHAMPION_PRACTICE'::notification_type,
            '【销冠打法提炼】最新一期可复制动作已发布',
            ${notificationBody},
            ${`/ai-hub?tab=management&reportId=${reportRow.id}`},
            now()
          )
        `);
      }
    }

    return {
      id: reportRow.id,
      kind: reportRow.kind,
      period: reportRow.period,
      content: reportRow.content,
      evidence: reportRow.evidence || {},
      sampleSize: reportRow.sample_size,
      confidence: reportRow.confidence,
      createdBy: reportRow.created_by,
      createdAt: reportRow.created_at,
      updatedAt: reportRow.updated_at,
    };
  });
}

/**
 * 报告受众矩阵：定义每类报告对 SALES 是否可见
 * F09: 仅 CHAMPION_ANALYSIS 等面向销售的类别对 SALES 开放，其余（如 COMPANY_PROFILE）仅限 ADMIN/MANAGER
 */
export const REPORT_AUDIENCE_MATRIX: Record<AiInsightReportKind, { salesVisible: boolean; description: string }> = {
  CHAMPION_ANALYSIS: { salesVisible: true, description: "销冠打法解构 - 面向一线销售可复制动作" },
  COMPANY_PROFILE: { salesVisible: false, description: "企业画像与客盘分析 - 仅限管理层" },
};

function isReportKindSalesVisible(kind: string): boolean {
  const entry = (REPORT_AUDIENCE_MATRIX as Record<string, { salesVisible: boolean }>)[kind];
  return entry ? entry.salesVisible : false;
}

export async function listInsightReportsService(
  ctx: TenantContext,
  kind?: AiInsightReportKind
): Promise<AiInsightReportItem[]> {
  return withTenant(ctx.tenantId, async (tx) => {
    const isSales = ctx.role === "SALES";
    if (isSales && kind && !isReportKindSalesVisible(kind)) {
      return [];
    }
    const res = await tx.execute<{
      id: string;
      kind: AiInsightReportKind;
      period: string;
      content: string;
      evidence: Record<string, unknown>;
      sample_size: number;
      confidence: "HIGH" | "MEDIUM" | "LOW";
      public_summary: string | null;
      created_by: string;
      created_at: string;
      updated_at: string;
    }>(sql`
      select
        id,
        kind,
        period,
        content,
        evidence,
        sample_size,
        confidence,
        public_summary,
        created_by,
        created_at::text as created_at,
        updated_at::text as updated_at
      from ai_insight_reports
      where tenant_id = ${ctx.tenantId}::uuid
        ${kind ? sql`and kind = ${kind}::ai_insight_report_kind` : sql``}
        ${isSales ? sql`and kind in ('CHAMPION_ANALYSIS')` : sql``}
      order by period desc, created_at desc
      limit 50
    `);

    return res.rows.map((r) => {
      if (!isSales) {
        const truncated = r.content.length > 500 ? r.content.slice(0, 500) + "…（已截断，查看详情请调用 getInsightReportById）" : r.content;
        return {
          id: r.id,
          kind: r.kind,
          period: r.period,
          content: truncated,
          evidence: r.evidence || {},
          sampleSize: r.sample_size,
          confidence: r.confidence,
          createdBy: r.created_by,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        };
      }
      // R02: SALES 列表只读公共摘要字段，不再返回 desensitize 后原文前500字
      const safe = r.public_summary || buildPublicSafeSummary(r.content);
      return {
        id: r.id,
        kind: r.kind,
        period: r.period,
        content: safe,
        evidence: {},
        sampleSize: r.sample_size,
        confidence: r.confidence,
        createdBy: r.created_by,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    });
  });
}

export async function getInsightReportByIdService(
  ctx: TenantContext,
  reportId: string
): Promise<AiInsightReportItem | null> {
  return withTenant(ctx.tenantId, async (tx) => {
    const isSales = ctx.role === "SALES";
    const res = await tx.execute<{
      id: string;
      kind: AiInsightReportKind;
      period: string;
      content: string;
      evidence: Record<string, unknown>;
      sample_size: number;
      confidence: "HIGH" | "MEDIUM" | "LOW";
      public_summary: string | null;
      created_by: string;
      created_at: string;
      updated_at: string;
    }>(sql`
      select
        id,
        kind,
        period,
        content,
        evidence,
        sample_size,
        confidence,
        public_summary,
        created_by,
        created_at::text as created_at,
        updated_at::text as updated_at
      from ai_insight_reports
      where tenant_id = ${ctx.tenantId}::uuid
        and id = ${reportId}::uuid
      limit 1
    `);

    const r = res.rows[0];
    if (!r) return null;

    if (isSales && !isReportKindSalesVisible(r.kind)) {
      return null;
    }

    if (!isSales) {
      return {
        id: r.id,
        kind: r.kind,
        period: r.period,
        content: r.content,
        evidence: r.evidence || {},
        sampleSize: r.sample_size,
        confidence: r.confidence,
        createdBy: r.created_by,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    }

    // R02: SALES 详情只读公共摘要字段，不再以原文推导
    const safe = r.public_summary || buildPublicSafeSummary(r.content);
    return {
      id: r.id,
      kind: r.kind,
      period: r.period,
      content: safe,
      evidence: {},
      sampleSize: r.sample_size,
      confidence: r.confidence,
      createdBy: r.created_by,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  });
}

export async function getLatestOpportunityAttributionService(
  ctx: TenantContext,
  opportunityId: string
): Promise<OpportunityAttributionTrace | null> {
  return withTenant(ctx.tenantId, async (tx) => {
    // 销售隔离：SALES 仅可查询自己负责的商机
    if (ctx.role === "SALES") {
      const oppRes = await tx.execute<{ id: string; owner_user_id: string }>(sql`
        select id, owner_user_id from public.opportunities
        where tenant_id = ${ctx.tenantId}::uuid and id = ${opportunityId}::uuid and deleted_at is null
      `);
      if (oppRes.rows.length === 0 || oppRes.rows[0].owner_user_id !== ctx.userId) {
        throw new BusinessError("FORBIDDEN", "无权查看他人商机的 AI 归因追溯");
      }
    }

    const res = await tx.execute<{
      rounds: number;
      tools_used: string[];
      outcome: string;
      created_at: string;
    }>(sql`
      select
        rounds,
        tools_used,
        outcome,
        created_at::text as created_at
      from ai_agent_traces
      where tenant_id = ${ctx.tenantId}::uuid
        and (
          opportunity_id = ${opportunityId}::uuid
          or (opportunity_id is null and task like '%' || ${opportunityId} || '%')
        )
      order by created_at desc
      limit 1
    `);

    const r = res.rows[0];
    if (!r) return null;

    // 统计工具调用的证据引用
    const evidenceCountMatches = r.outcome.match(/来自\s+(?:get\w+|winLoss\w+|top\w+)/g);
    const evidenceCount = evidenceCountMatches ? evidenceCountMatches.length : (r.tools_used?.length || 0);

    const outcome = ctx.role === "SALES" ? desensitizeReportForSales(r.outcome) : r.outcome;

    return {
      rounds: r.rounds,
      toolsUsed: Array.isArray(r.tools_used) ? r.tools_used : [],
      evidenceCount,
      outcome,
      createdAt: r.created_at,
    };
  });
}


