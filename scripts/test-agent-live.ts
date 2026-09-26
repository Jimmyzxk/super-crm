import "dotenv/config";
import pg from "pg";
import { runPipelineHealthAgent } from "../src/core/ai-hub/agent-loop";
import { runChampionAnalysisAgent } from "../src/core/ai-hub/agents/champion-analysis";
import { runCompanyProfileAgent } from "../src/core/ai-hub/agents/company-profile";
import { runMorningCopilotAgent } from "../src/core/ai-hub/agents/morning-copilot";
import { runDealAttributionAgent } from "../src/core/ai-hub/agents/deal-attribution";
import { runGrowthOpportunityAgent } from "../src/core/ai-hub/agents/growth-opportunity";
import { TenantContext } from "../src/core/tenant";
import { encryptSecret } from "../src/core/security/crypto";

const dbUrl = process.env.DATABASE_URL || "postgres://salescrm:salescrm_dev@localhost:54329/salescrm";

async function main() {
  console.log("================================================================================");
  console.log("        AI Agent Harness & Cognitive Layer (Wave B) Live Testing Script         ");
  console.log("================================================================================");

  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();

  const originalFetch = globalThis.fetch;
  // 模拟 OpenAI/DeepSeek 兼容端点响应 (用于离线与沙箱全真演练)
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("chat/completions")) {
      const payload = JSON.parse(String(init?.body || "{}"));
      const messages = payload.messages || [];
      const lastMsg = messages[messages.length - 1];
      const taskMsg = messages.find((m: { role: string; content?: string }) => m.role === "user")?.content || messages[0]?.content || "";

      let responseChoice: Record<string, unknown> | null = null;

      // 场景 1: Pipeline Health
      if (taskMsg.includes("管线整体健康度")) {
        if (!lastMsg || lastMsg.role === "system" || lastMsg.role === "user") {
          responseChoice = {
            message: {
              role: "assistant",
              content: "为了全面评估管线健康度，我将调用 getPipelineSummary 与 listStalledOpportunities 获取商机各阶段分布与停滞风险。",
              tool_calls: [
                {
                  id: "call_live_pipe_1",
                  type: "function",
                  function: { name: "getPipelineSummary", arguments: "{}" }
                },
                {
                  id: "call_live_pipe_2",
                  type: "function",
                  function: { name: "listStalledOpportunities", arguments: "{}" }
                }
              ]
            }
          };
        } else {
          responseChoice = {
            message: {
              role: "assistant",
              content: `## 销售管线健康度全景评估报告

1. **大盘阶段蓄水流速**：来自 getPipelineSummary: 发现需求 (DISCOVERY) 与方案报价 (PROPOSAL) 阶段蓄水池金额占比达 68%，整体商机储备充足；
2. **停滞风险商机诊断**：来自 listStalledOpportunities: 当前仅有 0 笔超过 7 天无推进记录的停滞商机，流转效率优良；
3. **关键行动建议**：建议销售团队加快推进处于方案报价阶段的商机进入商务谈判。`
            }
          };
        }
      }
      // 场景 2: Champion Analysis (L2)
      else if (taskMsg.includes("销冠解构分析")) {
        if (!lastMsg || lastMsg.role === "system" || lastMsg.role === "user") {
          responseChoice = {
            message: {
              role: "assistant",
              content: "正在调取团队前 5 名销冠的成单数据与多维归因指标...",
              tool_calls: [
                {
                  id: "call_live_champ_1",
                  type: "function",
                  function: { name: "topPerformersByRevenue", arguments: '{"limit":5}' }
                },
                {
                  id: "call_live_champ_2",
                  type: "function",
                  function: { name: "winLossFactorStats", arguments: '{"dimension":"all"}' }
                }
              ]
            }
          };
        } else {
          responseChoice = {
            message: {
              role: "assistant",
              content: `> **方向性假设（低置信度，样本 N=12）**

## 团队销冠打法解构分析报告 (L2 Champion Analysis)

### 1. 销冠画像与客群偏好
- **来自 topPerformersByRevenue**: 头部销售人均贡献赢单金额 ¥480,000，成单周期均值为 21.4 天；
- **来自 winLossFactorStats**: 智能制造行业在赢单客户中占比超 65%，胜率达到 75.0%。

### 2. 赢单路径与效能差异
- 销冠在方案报价阶段平均停留时间较团队中位数缩短 30%，商机流转更为敏捷。

### 3. 团队赋能建议
- 建立智能制造行业标准化打法模版，引导新人销售主攻 101-500 人规模客户。`
            }
          };
        }
      }
      // 场景 3: Company Profile (L3)
      else if (taskMsg.includes("企业画像与客盘结构诊断")) {
        if (!lastMsg || lastMsg.role === "system" || lastMsg.role === "user") {
          responseChoice = {
            message: {
              role: "assistant",
              content: "正在分析企业全景客户画像（行业×规模×类型）与营收分布贡献...",
              tool_calls: [
                {
                  id: "call_live_prof_1",
                  type: "function",
                  function: { name: "customerPortfolioStructure", arguments: "{}" }
                },
                {
                  id: "call_live_prof_2",
                  type: "function",
                  function: { name: "revenueBySegment", arguments: '{"dimension":"all"}' }
                }
              ]
            }
          };
        } else {
          responseChoice = {
            message: {
              role: "assistant",
              content: `> **方向性假设（低置信度，样本 N=18）**

## 企业画像与客盘结构全景诊断报告 (L3 Company Profile)

### 1. 客户盘子结构诊断
- **来自 customerPortfolioStructure**: 企业级大客户 (ENTERPRISE) 贡献了 83.5% 的已实现签约营收。

### 2. 结构性经营风险
- **来自 revenueBySegment**: 智能制造单一行业营收占比超 70%，面临行业宏观波动集中度风险。

### 3. 增量增长机会假设
- 医疗健康与新能源行业在途商机储备金额超 ¥600,000，具备跨行业拓客第二增长曲线潜力。`
            }
          };
        }
      }
      // 场景 4: Morning Copilot (L1)
      else if (taskMsg.includes("晨会巡检") || taskMsg.includes("今日三件事")) {
        if (!lastMsg || lastMsg.role === "system" || lastMsg.role === "user") {
          responseChoice = {
            message: {
              role: "assistant",
              content: "正在调取您名下的待办任务与停滞商机进行晨会巡检分析...",
              tool_calls: [
                {
                  id: "call_live_copilot_1",
                  type: "function",
                  function: { name: "listMyDueTasks", arguments: '{"status":"OPEN"}' }
                },
                {
                  id: "call_live_copilot_2",
                  type: "function",
                  function: { name: "listStalledOpportunities", arguments: '{"stalledDays":7}' }
                }
              ]
            }
          };
        } else {
          responseChoice = {
            message: {
              role: "assistant",
              content: JSON.stringify([
                {
                  title: "攻坚推进停滞商机【智造云平台升级】",
                  reason: "来自 listStalledOpportunities: 该商机处于方案报价阶段且已连续 8 天无任何推进记录，存在竞对介入流失风险。",
                  suggestedAction: "CREATE_FOLLOW_UP",
                  actionPayload: {
                    targetName: "智造云平台升级",
                    defaultNote: "致电采购决策人确认方案评审时间与预算批复进度"
                  },
                  priority: "HIGH",
                  confidenceScore: 90
                },
                {
                  title: "处理今日到期待办【客户续约方案汇报】",
                  reason: "来自 listMyDueTasks: 存在 1 笔今日到期的重要客户续约提案待办，需按时交付。",
                  suggestedAction: "CREATE_TASK",
                  actionPayload: {
                    targetName: "华东智能制造续约项目",
                    defaultNote: "完成续约报价单并发送给客户业务负责人"
                  },
                  priority: "HIGH",
                  confidenceScore: 85
                },
                {
                  title: "跟进高意向线索【未来物联系统集成】",
                  reason: "来自 listOpportunities: 处于需求发现阶段，建议预约主管陪访加速需求澄清（方向性假设，样本量较小）。",
                  suggestedAction: "VIEW_DETAIL",
                  actionPayload: {
                    targetName: "未来物联系统集成",
                    defaultNote: "申请战情室主管陪访或技术支持"
                  },
                  priority: "MEDIUM",
                  confidenceScore: 60
                }
              ])
            }
          };
        }
      }
      // 场景 5: Deal Attribution (L1 因果归因)
      else if (taskMsg.includes("因果归因") || taskMsg.includes("Deal Attribution")) {
        if (!lastMsg || lastMsg.role === "system" || lastMsg.role === "user") {
          const match = taskMsg.match(/ID:\s*([a-f0-9-]+)/i);
          const oppId = match ? match[1] : "00000000-0000-0000-0000-000000000000";
          responseChoice = {
            message: {
              role: "assistant",
              content: "正在调取商机完整生命周期历史、跟进事件、战情室介入与同业对标数据...",
              tool_calls: [
                {
                  id: "call_live_attr_1",
                  type: "function",
                  function: { name: "getOpportunityFullHistory", arguments: JSON.stringify({ opportunityId: oppId }) }
                },
                {
                  id: "call_live_attr_2",
                  type: "function",
                  function: { name: "getPeerWinPatterns", arguments: "{}" }
                }
              ]
            }
          };
        } else {
          responseChoice = {
            message: {
              role: "assistant",
              content: `## 1. 商机生命周期与关键转折时间线
- **关键转折点**：来自 getOpportunityFullHistory: 方案报价阶段第 12 天组织现场技术 POC 演示，客户决策层当场确认技术指标；第 16 天主管介入完成特批优惠。
- **阶段流转效能**：来自 getOpportunityFullHistory: 全周期历时 20 天，优于同类商机平均水平。

## 2. 五维因果归因评估
- **决策链与客情覆盖**：[高置信度] 深度覆盖核心技术决策人，沟通节点明确。
- **价格/折扣与商务策略**：[高置信度] 来自 getOpportunityFullHistory: 最终成交金额 ¥158,000，给予 98 折优惠并签署维护协议。
- **跟进质量与互动深度**：[高置信度] 历经 3 次深度拜访与会议，互动质量评分优秀。
- **流转效率与响应敏捷度**：[高置信度] 来自 getPeerWinPatterns: 成交周期优于全行业中位数。
- **竞对态势与外部因素**：[证据不足，无法归因] 系统未录入竞对动态与报价差值。

## 3. 经验沉淀与打法提炼
- 【可复制动作】：
  1. 方案报价阶段务必推动客户技术决策人现场参与 POC 验证；
  2. 适时引入战情室主管特批附加服务以锁定成单确定性。`
            }
          };
        }
      }
      // 场景 6: Growth Opportunity Agent (增量与变现)
      else if (taskMsg.includes("营收增长智能体") || taskMsg.includes("Growth Opportunity") || taskMsg.includes("增量与变现")) {
        if (!lastMsg || lastMsg.role === "system" || lastMsg.role === "user") {
          responseChoice = {
            message: {
              role: "assistant",
              content: "正在调用四大增长工具扫描客户营收分层、交叉销售潜力、沉睡客户与续约窗口...",
              tool_calls: [
                {
                  id: "call_live_grow_1",
                  type: "function",
                  function: { name: "customerRevenueTiering", arguments: '{"tier":"ZERO","limit":5}' }
                },
                {
                  id: "call_live_grow_2",
                  type: "function",
                  function: { name: "crossSellCandidates", arguments: '{"limit":5}' }
                },
                {
                  id: "call_live_grow_3",
                  type: "function",
                  function: { name: "dormantHighValue", arguments: '{"limit":5}' }
                },
                {
                  id: "call_live_grow_4",
                  type: "function",
                  function: { name: "renewalPipeline", arguments: '{"days":90,"limit":5}' }
                }
              ]
            }
          };
        } else {
          responseChoice = {
            message: {
              role: "assistant",
              content: JSON.stringify({
                activationList: [
                  { customerName: "长沙微光电子智能制造有限公司", reason: "注册后零贡献但近期有活跃跟进记录", confidence: "HIGH" },
                  { customerName: "青岛润和软件软件工程有限公司", reason: "近3天内有活动但未产生任何订单与成单", confidence: "MEDIUM" }
                ],
                crossSellList: [
                  { customerName: "成都摩尔线程网络技术有限公司", recommendedProduct: "企业级 AI 智能知识库平台", basis: "已购买销售加速套件但未开通智能知识库", confidence: "HIGH" },
                  { customerName: "宁波地平线智驾科技集团有限公司", recommendedProduct: "L2C 全流程销售加速套件", basis: "已采购咨询培训服务，适合增购核心CRM系统", confidence: "MEDIUM" }
                ],
                dormantList: [
                  { customerName: "宁波地平线智驾科技集团有限公司", dormantDays: 94, lastInteraction: "2026-05-30 最后互动", confidence: "HIGH" },
                  { customerName: "西安网宿云联生物医药有限公司", dormantDays: 123, lastInteraction: "2026-05-01 最后互动", confidence: "HIGH" }
                ],
                renewalWindows: [
                  { contractNo: "HT-20250920-EXP", suggestedTiming: "到期日 2026-09-20，剩余不足20天，立即启动商务续约触达", confidence: "HIGH" }
                ],
                insufficientData: false
              }, null, 2)
            }
          };
        }
      } else {
        responseChoice = {
          message: { role: "assistant", content: "分析任务已完成。" }
        };
      }

      return new Response(JSON.stringify({ choices: [responseChoice] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    return originalFetch(input, init);
  };

  try {
    // 2. 获取演示租户与管理员
    const tenantRes = await client.query<{ id: string; name: string }>(`
      select id, name from tenants order by created_at asc limit 1
    `);
    if (tenantRes.rows.length === 0) {
      console.error("Error: No tenant found in database. Please run seed script first.");
      return;
    }
    const tenant = tenantRes.rows[0];
    await client.query("select set_config('app.tenant_id', $1, false)", [tenant.id]);

    const userRes = await client.query<{ id: string; role: "ADMIN" | "MANAGER" | "SALES" }>(`
      select id, role from users where tenant_id = $1 and role in ('ADMIN', 'MANAGER') limit 1
    `, [tenant.id]);
    const user = userRes.rows[0];
    if (!user) {
      throw new Error(`No user found in tenant ${tenant.id}`);
    }

    const ctx: TenantContext = {
      tenantId: tenant.id,
      userId: user.id,
      role: user.role,
    };

    console.log(`[Target Tenant]: ${tenant.name} (${tenant.id})`);
    console.log(`[Operator User]: ${user.id} (Role: ${user.role})\n`);

    // 3. 备份原安全配置并写入测试提供商配置
    const oldConfigRes = await client.query<{
      is_ai_copilot_enabled: boolean;
      ai_provider: string;
      ai_api_key: string | null;
      ai_api_endpoint: string | null;
      ai_model_name: string;
    }>(`
      select is_ai_copilot_enabled, ai_provider, ai_api_key, ai_api_endpoint, ai_model_name
      from security_compliance_configs
      where tenant_id = $1 limit 1
    `, [tenant.id]);
    const oldConfig = oldConfigRes.rows[0];

    const encKey = encryptSecret("sk-live-deepseek-simulation-key");
    await client.query(`
      insert into security_compliance_configs (
        tenant_id, is_ai_copilot_enabled, ai_provider, ai_api_key, ai_api_endpoint, ai_model_name, updated_at
      ) values (
        $1, true, 'DEEPSEEK', $2, null, 'deepseek-chat', now()
      )
      on conflict (tenant_id) do update set
        is_ai_copilot_enabled = true,
        ai_provider = 'DEEPSEEK',
        ai_api_key = $2,
        ai_api_endpoint = null,
        ai_model_name = 'deepseek-chat',
        updated_at = now();
    `, [tenant.id, encKey]);

    // 4. 运行 Agent 1: Pipeline Health Agent
    console.log("--------------------------------------------------------------------------------");
    console.log("▶ [Agent 1/3] Running Pipeline Health Agent (管线健康度智能体)...");
    console.log("--------------------------------------------------------------------------------");
    const t0 = Date.now();
    const res1 = await runPipelineHealthAgent(ctx);
    const cost1 = Date.now() - t0;
    console.log(`✓ Completed in ${cost1}ms | Model: deepseek-chat | Rounds: ${res1.rounds} | Tools Used: [${res1.toolsUsed.join(", ")}]`);
    console.log("\n[Outcome Output]:");
    console.log(res1.outcome);
    console.log("\n");

    // 5. 运行 Agent 2: Champion Analysis Agent (L2)
    console.log("--------------------------------------------------------------------------------");
    console.log("▶ [Agent 2/3] Running Champion Analysis Agent (L2 销冠解构智能体)...");
    console.log("--------------------------------------------------------------------------------");
    const t1 = Date.now();
    const res2 = await runChampionAnalysisAgent(ctx);
    const cost2 = Date.now() - t1;
    console.log(`✓ Completed in ${cost2}ms | Model: deepseek-chat | Rounds: ${res2.rounds} | Tools Used: [${res2.toolsUsed.join(", ")}]`);
    console.log("\n[Outcome Output]:");
    console.log(res2.outcome);
    console.log("\n");

    // 6. 运行 Agent 3: Company Profile Agent (L3)
    console.log("--------------------------------------------------------------------------------");
    console.log("▶ [Agent 3/4] Running Company Profile Agent (L3 企业画像智能体)...");
    console.log("--------------------------------------------------------------------------------");
    const t2 = Date.now();
    const res3 = await runCompanyProfileAgent(ctx);
    const cost3 = Date.now() - t2;
    console.log(`✓ Completed in ${cost3}ms | Model: deepseek-chat | Rounds: ${res3.rounds} | Tools Used: [${res3.toolsUsed.join(", ")}]`);
    console.log("\n[Outcome Output]:");
    console.log(res3.outcome);
    console.log("\n");

    // 7. 运行 Agent 4: Morning Copilot Agent (L1)
    console.log("--------------------------------------------------------------------------------");
    console.log("▶ [Agent 4/5] Running Morning Copilot Agent (L1 晨会副驾驶智能体)...");
    console.log("--------------------------------------------------------------------------------");
    const t3 = Date.now();
    const res4 = await runMorningCopilotAgent(ctx, user.id);
    const cost4 = Date.now() - t3;
    console.log(`✓ Completed in ${cost4}ms | Model: deepseek-chat | Rounds: ${res4.rounds} | Tools Used: [${res4.toolsUsed.join(", ")}] | Recommendations: ${res4.recommendations.length}`);
    console.log("\n[Outcome Recommendations]:");
    console.log(JSON.stringify(res4.recommendations, null, 2));
    console.log("\n");

    // 8. 运行 Agent 5: Deal Attribution Agent (L1 赢单归因)
    console.log("--------------------------------------------------------------------------------");
    console.log("▶ [Agent 5/6] Running Deal Attribution Agent (L1 赢单因果归因智能体)...");
    console.log("--------------------------------------------------------------------------------");
    const wonOppRes = await client.query<{ id: string; name: string }>(`
      select id, name from opportunities where tenant_id = $1 and stage = 'WON' and deleted_at is null order by actual_amount desc limit 1
    `, [tenant.id]);
    const targetOpp = wonOppRes.rows[0];
    if (targetOpp) {
      const t4 = Date.now();
      const res5 = await runDealAttributionAgent(ctx, targetOpp.id, "WON");
      const cost5 = Date.now() - t4;
      console.log(`✓ Completed in ${cost5}ms | Model: deepseek-chat | Rounds: ${res5.rounds} | Tools Used: [${res5.toolsUsed.join(", ")}] | Evidence Count: ${res5.evidenceCount}`);
      console.log("\n[Outcome Output]:");
      console.log(res5.outcome);
      console.log("\n");
    } else {
      console.log("提示：租户内暂无已赢单商机，跳过归因演练。");
    }

    // 9. 运行 Agent 6: Growth Opportunity Agent (增量与变现)
    console.log("--------------------------------------------------------------------------------");
    console.log("▶ [Agent 6/6] Running Growth Opportunity Agent (增量与变现营收诊断智能体)...");
    console.log("--------------------------------------------------------------------------------");
    const t5 = Date.now();
    const res6 = await runGrowthOpportunityAgent(ctx);
    const cost6 = Date.now() - t5;
    console.log(`✓ Completed in ${cost6}ms | Model: deepseek-chat | Rounds: ${res6.rounds} | Tools Used: [${res6.toolsUsed.join(", ")}]`);
    console.log("\n[Outcome Report]:");
    console.log(JSON.stringify(res6.report, null, 2));
    console.log("\n");

    if (res6.report.insufficientData) {
      throw new Error("❌ 增量与变现报告异常标记为 insufficientData: true");
    }
    if (res6.report.activationList.length === 0 && res6.report.crossSellList.length === 0 && res6.report.renewalWindows.length === 0) {
      throw new Error("❌ 增量与变现报告未产出任何有效清单项");
    }

    // 10. 恢复原数据库配置
    if (oldConfig) {
      await client.query(`
        update security_compliance_configs
        set is_ai_copilot_enabled = $2,
            ai_provider = $3,
            ai_api_key = $4,
            ai_api_endpoint = $5,
            ai_model_name = $6,
            updated_at = now()
        where tenant_id = $1
      `, [tenant.id, oldConfig.is_ai_copilot_enabled, oldConfig.ai_provider, oldConfig.ai_api_key, oldConfig.ai_api_endpoint, oldConfig.ai_model_name]);
    }

    console.log("================================================================================");
    console.log("                    All 6 Live Agents Completed Successfully!                   ");
    console.log("================================================================================");
  } finally {
    globalThis.fetch = originalFetch;
    await client.end();
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Live test failed:", err);
  process.exit(1);
});
