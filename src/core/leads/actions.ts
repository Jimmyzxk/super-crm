"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/core/auth/session";
import { toResult, type Result } from "@/core/shared/result";
import { createLeadSchema, discardSchema, leadFieldsSchema, updateLeadSchema, type LeadInput } from "./types";
import { parseLeadCsvBase64 } from "./csv";
import { assignLeadService, assignLeadsBulkService, classifyImportRowsService, createLeadService, discardLeadService,
  getAssignableUsersService, importLeadsService, listLeadsService, mergeLeadService,
  getLeadDetailService, listLeadSourceKeysService, qualifyLeadService, restoreLeadService,
  updateLeadService, createLeadSourceKeyService, revokeLeadSourceKeyService } from "./service";

function invalid<T>(error: z.ZodError): Result<T> {
  const issue = error.issues[0];
  return { ok: false, code: "VALIDATION_ERROR", message: issue.message, field: issue.path.join(".") || undefined };
}

async function run<T>(fn: () => Promise<T>, refresh = false): Promise<Result<T>> {
  try { const data = await fn(); if (refresh) revalidatePath("/leads"); return { ok: true, data }; }
  catch (error) { return toResult<T>(error); }
}

export async function createLead(input: unknown) {
  const parsed = createLeadSchema.safeParse(input); if (!parsed.success) return invalid(parsed.error);
  return run(async () => createLeadService(await requireSession(), parsed.data), true);
}
export async function listLeads(input: { search?: string; filter?: string; sort?: string; cursor?: string } = {}) {
  return run(async () => listLeadsService(await requireSession(), input));
}
export async function getLeadDetail(input: unknown) {
  const parsed = z.object({ leadId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return run(async () => getLeadDetailService(await requireSession(), parsed.data.leadId));
}
export async function getAssignableUsers() { return run(async () => getAssignableUsersService(await requireSession())); }
export async function updateLead(input: unknown) {
  const parsed = updateLeadSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error); const { leadId, ...fields } = parsed.data;
  return run(async () => updateLeadService(await requireSession(), leadId, fields), true);
}
export async function assignLead(input: unknown) {
  const parsed = z.object({ leadId: z.string().uuid(), assigneeUserId: z.string().uuid().optional() }).safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return run(async () => {
    const session = await requireSession();
    const targetUserId = parsed.data.assigneeUserId || session.userId;
    return assignLeadService(session, parsed.data.leadId, targetUserId);
  }, true);
}
export async function assignLeadsBulk(input: unknown) {
  const parsed = z.object({ leadIds: z.array(z.string().uuid()).min(1).max(50), assigneeUserId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return invalid(parsed.error); return run(async () => assignLeadsBulkService(await requireSession(), parsed.data.leadIds, parsed.data.assigneeUserId), true);
}
export async function qualifyLead(input: unknown) {
  const parsed = z.object({ leadId: z.string().uuid(), note: z.string().trim().min(1, "请填写确认了什么需求").max(200) }).safeParse(input);
  if (!parsed.success) return invalid(parsed.error); return run(async () => qualifyLeadService(await requireSession(), parsed.data.leadId, parsed.data.note), true);
}
export async function discardLead(input: unknown) {
  const parsed = discardSchema.safeParse(input); if (!parsed.success) return invalid(parsed.error);
  return run(async () => discardLeadService(await requireSession(), parsed.data), true);
}
export async function restoreLead(input: unknown) {
  const parsed = z.object({ leadId: z.string().uuid() }).safeParse(input); if (!parsed.success) return invalid(parsed.error);
  return run(async () => restoreLeadService(await requireSession(), parsed.data.leadId), true);
}
export async function mergeLead(input: unknown) {
  const parsed = z.object({ sourceLeadId: z.string().uuid(), targetLeadId: z.string().uuid() }).safeParse(input); if (!parsed.success) return invalid(parsed.error);
  return run(async () => mergeLeadService(await requireSession(), parsed.data.sourceLeadId, parsed.data.targetLeadId), true);
}
export async function importLeadsPreview(input: { base64: string }) {
  return run(async () => {
    const ctx = await requireSession();
    const parsed = parseLeadCsvBase64(input.base64);
    const classified = await classifyImportRowsService(ctx, parsed.valid);
    return { ...classified, errors: parsed.errors };
  });
}
export async function importLeadsCommit(input: { rows: LeadInput[]; skipDuplicates: boolean }) {
  const parsed = z.object({ rows: z.array(leadFieldsSchema).max(1000), skipDuplicates: z.boolean() }).safeParse(input); if (!parsed.success) return invalid(parsed.error);
  return run(async () => importLeadsService(await requireSession(), parsed.data.rows, parsed.data.skipDuplicates), true);
}

export async function createLeadSourceKey(input: unknown) {
  const parsed = z.object({
    name: z.string().trim().min(1, "请填写来源名称").max(50, "来源名称不超过 50 字"),
    sourceKey: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{1,48}[a-z0-9]$/, "来源标识格式不正确"),
  }).safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return run(async () => createLeadSourceKeyService(await requireSession(), parsed.data));
}

export async function listLeadSourceKeys() {
  return run(async () => listLeadSourceKeysService(await requireSession()));
}

export async function revokeLeadSourceKey(input: unknown) {
  const parsed = z.object({ sourceKeyId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return run(async () => revokeLeadSourceKeyService(await requireSession(), parsed.data.sourceKeyId));
}
