import { describe, it, expect } from "vitest";
import { z } from "zod";
import { zodToJsonSchema } from "@/core/ai-hub/zod-to-json-schema";

interface SchemaObject {
  type: string;
  required?: string[];
  properties: Record<string, Record<string, unknown>>;
}

describe("zodToJsonSchema recursive unwrapping", () => {
  it("unwraps ZodDefault preserving default value, type, and optional status", () => {
    const schema = z.object({
      count: z.number().default(10).describe("数量"),
      note: z.string().optional().describe("备注"),
      requiredStr: z.string().describe("必填项"),
    });

    const json = zodToJsonSchema(schema) as unknown as SchemaObject;
    expect(json.type).toBe("object");
    expect(json.required).toEqual(["requiredStr"]);
    expect(json.properties.count).toEqual({
      type: "number",
      description: "数量",
      default: 10,
    });
    expect(json.properties.note).toEqual({
      type: "string",
      description: "备注",
    });
    expect(json.properties.requiredStr).toEqual({
      type: "string",
      description: "必填项",
    });
  });

  it("handles nullable, optional, and nested wrappers without losing type or description", () => {
    const schema = z.object({
      tags: z.array(z.string()).default([]).describe("标签列表"),
      status: z.enum(["OPEN", "CLOSED"]).optional().describe("状态"),
      nullableVal: z.string().nullable().describe("可空字段"),
    });

    const json = zodToJsonSchema(schema) as unknown as SchemaObject;
    expect(json.required).toEqual(["nullableVal"]);
    expect(json.properties.tags).toEqual({
      type: "array",
      items: { type: "string" },
      description: "标签列表",
      default: [],
    });
    expect(json.properties.status).toEqual({
      type: "string",
      enum: ["OPEN", "CLOSED"],
      description: "状态",
    });
    expect(json.properties.nullableVal).toEqual({
      type: "string",
      description: "可空字段",
    });
  });
});
