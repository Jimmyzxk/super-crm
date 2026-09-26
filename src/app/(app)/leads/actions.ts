"use server";

import {
  assignLead,
  assignLeadsBulk,
  createLead,
  discardLead,
  getLeadDetail,
  importLeadsCommit,
  importLeadsPreview,
  listLeads,
  mergeLead,
  qualifyLead,
  restoreLead,
  updateLead,
} from "@/core/leads/actions";
import { logActivity, rescheduleTask } from "@/core/followup/actions";
import type {
  ActionResult,
  CreateLeadResult,
  ImportCommitResult,
  ImportPreview,
  Lead,
  LeadDetail,
  LeadFilter,
  LeadPage,
  LeadSort,
} from "./types";

export async function listLeadsAction(input: {
  filter?: LeadFilter;
  sort?: LeadSort;
  search?: string;
  cursor?: string;
  includeConverted?: boolean;
  includeDiscarded?: boolean;
}): Promise<ActionResult<LeadPage>> {
  try {
    const result = await listLeads({
      ...input,
      filter: input.filter === "high-score" ? "high" : input.filter,
    });
    if (!result.ok) return result;
    const items: Lead[] = result.data.items.map((lead) => ({
      ...lead,
      openTask: lead.taskId && lead.dueAt
        ? { id: lead.taskId, type: "FIRST_RESPONSE", dueAt: lead.dueAt }
        : null,
    }));
    return { ok: true, data: { items, nextCursor: result.data.nextCursor, counts: result.data.counts, countCeiling: result.data.countCeiling } };
  } catch (error) {
    return fail(error);
  }
}

function fail(error: unknown): { ok: false; code: string; message: string } {
  return {
    ok: false,
    code: "INTERNAL_ERROR",
    message: error instanceof Error ? error.message : "操作失败，请稍后重试",
  };
}

export async function createLeadAction(
  input: Parameters<typeof createLead>[0],
): Promise<ActionResult<CreateLeadResult>> {
  try {
    return (await createLead(input)) as ActionResult<CreateLeadResult>;
  } catch (error) {
    return fail(error);
  }
}

export async function logActivityAction(
  input: Parameters<typeof logActivity>[0],
): Promise<ActionResult<unknown>> {
  try {
    return (await logActivity(input)) as ActionResult<unknown>;
  } catch (error) {
    return fail(error);
  }
}

export async function discardLeadAction(
  input: Parameters<typeof discardLead>[0],
): Promise<ActionResult<unknown>> {
  try {
    return (await discardLead(input)) as ActionResult<unknown>;
  } catch (error) {
    return fail(error);
  }
}

export async function qualifyLeadAction(
  input: Parameters<typeof qualifyLead>[0],
): Promise<ActionResult<unknown>> {
  try {
    return (await qualifyLead(input)) as ActionResult<unknown>;
  } catch (error) {
    return fail(error);
  }
}

export async function assignLeadAction(
  input: Parameters<typeof assignLead>[0],
): Promise<ActionResult<unknown>> {
  try {
    return (await assignLead(input)) as ActionResult<unknown>;
  } catch (error) {
    return fail(error);
  }
}

export async function assignLeadsBulkAction(
  input: Parameters<typeof assignLeadsBulk>[0],
): Promise<ActionResult<unknown>> {
  try {
    return (await assignLeadsBulk(input)) as ActionResult<unknown>;
  } catch (error) {
    return fail(error);
  }
}

export async function rescheduleTaskAction(
  input: Parameters<typeof rescheduleTask>[0],
): Promise<ActionResult<unknown>> {
  try {
    return (await rescheduleTask(input)) as ActionResult<unknown>;
  } catch (error) {
    return fail(error);
  }
}

export async function getLeadDetailAction(leadId: string): Promise<ActionResult<LeadDetail>> {
  try {
    return (await getLeadDetail({ leadId })) as ActionResult<LeadDetail>;
  } catch (error) {
    return fail(error);
  }
}

export async function updateLeadAction(
  input: Parameters<typeof updateLead>[0],
): Promise<ActionResult<unknown>> {
  try {
    return (await updateLead(input)) as ActionResult<unknown>;
  } catch (error) {
    return fail(error);
  }
}

export async function restoreLeadAction(
  input: Parameters<typeof restoreLead>[0],
): Promise<ActionResult<unknown>> {
  try {
    return (await restoreLead(input)) as ActionResult<unknown>;
  } catch (error) {
    return fail(error);
  }
}

export async function mergeLeadAction(
  input: Parameters<typeof mergeLead>[0],
): Promise<ActionResult<unknown>> {
  try {
    return (await mergeLead(input)) as ActionResult<unknown>;
  } catch (error) {
    return fail(error);
  }
}

export async function importLeadsPreviewAction(
  input: Parameters<typeof importLeadsPreview>[0],
): Promise<ActionResult<ImportPreview>> {
  try {
    return (await importLeadsPreview(input)) as ActionResult<ImportPreview>;
  } catch (error) {
    return fail(error);
  }
}

export async function importLeadsCommitAction(
  input: Parameters<typeof importLeadsCommit>[0],
): Promise<ActionResult<ImportCommitResult>> {
  try {
    return (await importLeadsCommit(input)) as ActionResult<ImportCommitResult>;
  } catch (error) {
    return fail(error);
  }
}
