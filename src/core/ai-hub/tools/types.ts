import { z } from "zod";
import { type TenantContext } from "@/core/tenant";

export interface AgentTool<TArgs extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  parameters: TArgs;
  execute: (ctx: TenantContext, args: z.infer<TArgs>) => Promise<{ result: string | object }>;
}
