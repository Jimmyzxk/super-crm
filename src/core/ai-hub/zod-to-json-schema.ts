import { z } from "zod";

export function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  let curr: z.ZodTypeAny = schema;
  let description: string | undefined = curr.description;
  let hasDefault = false;
  let defaultValue: unknown = undefined;

  // 顶层解包 ZodOptional / ZodDefault / ZodNullable / ZodEffects
  while (
    curr instanceof z.ZodOptional ||
    curr instanceof z.ZodDefault ||
    curr instanceof z.ZodNullable ||
    curr instanceof z.ZodEffects
  ) {
    if (!description && curr.description) {
      description = curr.description;
    }
    if (curr instanceof z.ZodOptional) {
      curr = curr.unwrap();
    } else if (curr instanceof z.ZodDefault) {
      hasDefault = true;
      try {
        defaultValue = curr._def.defaultValue();
      } catch {
        // ignore
      }
      curr = curr._def.innerType;
    } else if (curr instanceof z.ZodNullable) {
      curr = curr.unwrap();
    } else if (curr instanceof z.ZodEffects) {
      curr = curr.innerType();
    }
  }

  if (!description && curr.description) {
    description = curr.description;
  }

  let result: Record<string, unknown>;

  if (curr instanceof z.ZodObject) {
    const shape = curr.shape;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const key in shape) {
      let fieldCurr: z.ZodTypeAny = shape[key];
      let fieldDesc: string | undefined = fieldCurr.description;
      let fieldIsOptional = false;
      let fieldHasDefault = false;
      let fieldDefaultValue: unknown = undefined;

      while (
        fieldCurr instanceof z.ZodOptional ||
        fieldCurr instanceof z.ZodDefault ||
        fieldCurr instanceof z.ZodNullable ||
        fieldCurr instanceof z.ZodEffects
      ) {
        if (!fieldDesc && fieldCurr.description) {
          fieldDesc = fieldCurr.description;
        }
        if (fieldCurr instanceof z.ZodOptional) {
          fieldIsOptional = true;
          fieldCurr = fieldCurr.unwrap();
        } else if (fieldCurr instanceof z.ZodDefault) {
          fieldIsOptional = true;
          fieldHasDefault = true;
          try {
            fieldDefaultValue = fieldCurr._def.defaultValue();
          } catch {
            // ignore
          }
          fieldCurr = fieldCurr._def.innerType;
        } else if (fieldCurr instanceof z.ZodNullable) {
          fieldCurr = fieldCurr.unwrap();
        } else if (fieldCurr instanceof z.ZodEffects) {
          fieldCurr = fieldCurr.innerType();
        }
      }

      if (!fieldDesc && fieldCurr.description) {
        fieldDesc = fieldCurr.description;
      }

      const propSchema = zodToJsonSchema(fieldCurr);
      if (fieldDesc) {
        propSchema.description = fieldDesc;
      }
      if (fieldHasDefault && fieldDefaultValue !== undefined) {
        propSchema.default = fieldDefaultValue;
      }
      properties[key] = propSchema;

      if (!fieldIsOptional) {
        required.push(key);
      }
    }

    result = {
      type: "object",
      properties,
      required: required.length > 0 ? required : undefined,
      additionalProperties: false,
    };
  } else if (curr instanceof z.ZodString) {
    result = { type: "string" };
  } else if (curr instanceof z.ZodNumber) {
    result = { type: "number" };
  } else if (curr instanceof z.ZodBoolean) {
    result = { type: "boolean" };
  } else if (curr instanceof z.ZodArray) {
    result = { type: "array", items: zodToJsonSchema(curr.element) };
  } else if (curr instanceof z.ZodEnum) {
    result = { type: "string", enum: curr.options };
  } else if (curr instanceof z.ZodNativeEnum) {
    result = { type: "string", enum: Object.values(curr.enum) };
  } else {
    result = { type: "string" }; // default fallback
  }

  if (description && !result.description) {
    result.description = description;
  }
  if (hasDefault && defaultValue !== undefined && !result.default) {
    result.default = defaultValue;
  }

  return result;
}
