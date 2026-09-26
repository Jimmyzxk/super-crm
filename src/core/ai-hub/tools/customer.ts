import { z } from "zod";
import { AgentTool } from "./types";
import { getCustomerDetailCollectionService } from "@/core/customer/service";

export const listCustomerContactsTool: AgentTool = {
  name: "listCustomerContacts",
  description: "列出特定客户的联系人列表（包含决策链角色）。",
  parameters: z.object({
    customerId: z.string().uuid().describe("客户 ID")
  }),
  execute: async (ctx, args) => {
    const coll = await getCustomerDetailCollectionService(ctx, args.customerId, "contacts");
    return { result: coll.items };
  }
};
