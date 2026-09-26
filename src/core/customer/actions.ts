"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/core/auth/session";
import { toResult, type Result } from "@/core/shared/result";
import {
  addContactService, claimCustomerService, convertLeadToCustomerService, createCustomerDirectService, deleteContactService, deleteCustomerService,
  getCustomerDetailCollectionService, getCustomerDetailService, getCustomerTimelineService,
  listCustomersService, listGlobalContactsService, releaseCustomerToPoolService, setPrimaryContactService, updateContactService, updateCustomerService,
} from "./service";

import { contactCreateSchema, contactIdSchema, contactUpdateSchema, convertLeadSchema, customerCreateDirectSchema, customerDetailCollectionSchema, customerUpdateSchema, primaryContactSchema } from "./types";

function invalid<T>(error: z.ZodError): Result<T> {
  const issue = error.issues[0];
  return { ok: false, code: "VALIDATION_ERROR", message: issue.message, field: issue.path.join(".") || undefined };
}

async function run<T>(fn: () => Promise<T>, refresh = false): Promise<Result<T>> {
  try { const data = await fn(); if (refresh) { revalidatePath("/customers", "layout"); revalidatePath("/opportunities", "layout"); revalidatePath("/leads", "layout"); } return { ok: true, data }; }
  catch (error) { return toResult<T>(error); }
}

export async function createCustomerDirectAction(input: unknown) {
  const parsed = customerCreateDirectSchema.safeParse(input); if (!parsed.success) return invalid(parsed.error);
  return run(async () => createCustomerDirectService(await requireSession(), parsed.data), true);
}

export async function convertLeadToCustomer(input: unknown) {
  const parsed = convertLeadSchema.safeParse(input); if (!parsed.success) return invalid(parsed.error);
  return run(async () => convertLeadToCustomerService(await requireSession(), parsed.data), true);
}

export async function updateCustomer(input: unknown) {
  const parsed = customerUpdateSchema.safeParse(input); if (!parsed.success) return invalid(parsed.error);
  return run(async () => updateCustomerService(await requireSession(), parsed.data), true);
}

export async function deleteCustomer(input: unknown) {
  const parsed = z.object({ customerId: z.string().uuid() }).safeParse(input); if (!parsed.success) return invalid(parsed.error);
  return run(async () => deleteCustomerService(await requireSession(), parsed.data.customerId), true);
}

export async function addContact(input: unknown) {
  const parsed = contactCreateSchema.safeParse(input); if (!parsed.success) return invalid(parsed.error);
  return run(async () => addContactService(await requireSession(), parsed.data), true);
}

export async function updateContact(input: unknown) {
  const parsed = contactUpdateSchema.safeParse(input); if (!parsed.success) return invalid(parsed.error);
  return run(async () => updateContactService(await requireSession(), parsed.data), true);
}

export async function deleteContact(input: unknown) {
  const parsed = contactIdSchema.safeParse(input); if (!parsed.success) return invalid(parsed.error);
  return run(async () => deleteContactService(await requireSession(), parsed.data.contactId), true);
}

export async function setPrimaryContact(input: unknown) {
  const parsed = primaryContactSchema.safeParse(input); if (!parsed.success) return invalid(parsed.error);
  return run(async () => setPrimaryContactService(await requireSession(), parsed.data.customerId, parsed.data.contactId), true);
}

export async function getCustomerDetailCollection(input: unknown) {
  const parsed = z.object({
    customerId: z.string().uuid(),
    collection: customerDetailCollectionSchema,
    cursor: z.string().trim().min(1).nullable().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  }).safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return run(async () => getCustomerDetailCollectionService(await requireSession(), parsed.data.customerId, parsed.data.collection, parsed.data));
}

export async function getCustomerDetail(customerId: string) {
  return run(async () => getCustomerDetailService(await requireSession(), customerId));
}

export async function getCustomerTimeline(customerId: string, limit = 50) {
  return run(async () => getCustomerTimelineService(await requireSession(), customerId, limit));
}

export async function listCustomersAction(search?: string) {
  return run(async () => listCustomersService(await requireSession(), { search: search?.trim() || undefined }));
}

export async function listGlobalContactsAction(params: {
  scope?: "MY" | "PUBLIC" | "ALL";
  roleTag?: string;
  search?: string;
} = {}) {
  return run(async () => listGlobalContactsService(await requireSession(), params));
}

export async function claimCustomerAction(customerId: string) {
  return run(async () => claimCustomerService(await requireSession(), customerId), true);
}

export async function releaseCustomerToPoolAction(customerId: string) {
  return run(async () => releaseCustomerToPoolService(await requireSession(), customerId), true);
}


