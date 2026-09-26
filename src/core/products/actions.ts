"use server";

import { requireSession } from "@/core/auth/session";
import { toResult, type Result } from "@/core/shared/result";
import {
  archiveProductService,
  createProductService,
  getProductByIdService,
  listOpportunityLineItemsService,
  listProductCategoriesService,
  listProductsService,
  saveOpportunityLineItemsService,
  updateProductService,
} from "./service";
import type {
  CreateProductInput,
  OpportunityLineItem,
  ProductCategorySummary,
  ProductItem,
  ProductStatus,
  SaveLineItemInput,
  UpdateProductInput,
} from "./types";

async function run<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (error) {
    return toResult<T>(error);
  }
}

export async function listProductsAction(params?: {
  category?: string;
  status?: ProductStatus;
  search?: string;
}): Promise<Result<ProductItem[]>> {
  return run(async () => {
    const session = await requireSession();
    return listProductsService(session, params);
  });
}

export async function listProductCategoriesAction(): Promise<Result<ProductCategorySummary[]>> {
  return run(async () => {
    const session = await requireSession();
    return listProductCategoriesService(session);
  });
}

export async function getProductByIdAction(id: string): Promise<Result<ProductItem | null>> {
  return run(async () => {
    const session = await requireSession();
    return getProductByIdService(session, id);
  });
}

import { requirePermission, PERMISSIONS } from "@/core/auth/permissions";

export async function createProductAction(input: CreateProductInput): Promise<Result<ProductItem>> {
  return run(async () => {
    const session = await requireSession();
    await requirePermission(session, PERMISSIONS.PRODUCTS_MANAGE);
    return createProductService(session, input);
  });
}

export async function updateProductAction(
  id: string,
  input: UpdateProductInput,
): Promise<Result<ProductItem>> {
  return run(async () => {
    const session = await requireSession();
    await requirePermission(session, PERMISSIONS.PRODUCTS_MANAGE);
    return updateProductService(session, id, input);
  });
}

export async function archiveProductAction(id: string): Promise<Result<{ success: boolean; message: string }>> {
  return run(async () => {
    const session = await requireSession();
    await requirePermission(session, PERMISSIONS.PRODUCTS_MANAGE);
    return archiveProductService(session, id);
  });
}

export async function listOpportunityLineItemsAction(
  opportunityId: string,
): Promise<Result<OpportunityLineItem[]>> {
  return run(async () => {
    const session = await requireSession();
    return listOpportunityLineItemsService(session, opportunityId);
  });
}

export async function saveOpportunityLineItemsAction(
  opportunityId: string,
  items: SaveLineItemInput[],
): Promise<Result<{ lineItems: OpportunityLineItem[]; totalExpectedAmount: number }>> {
  return run(async () => {
    const session = await requireSession();
    return saveOpportunityLineItemsService(session, opportunityId, items);
  });
}
