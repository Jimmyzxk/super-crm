import { redirect } from "next/navigation";
import { requireSession } from "@/core/auth/session";
import { listCustomersService } from "@/core/customer/service";

const customerStatuses = new Set(["all", "active", "stalled", "no-active"]);
const customerSorts = new Set(["recent", "created"]);
import CustomerListClient from "./CustomerListClient";

export const dynamic = "force-dynamic";

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ search?: string; status?: string; sort?: string; cursor?: string }> }) {
  const session = await requireSession().catch(() => null);
  if (!session) redirect("/login");
  const params = await searchParams;
  const status = params.status && customerStatuses.has(params.status) ? params.status : "all";
  const sort = params.sort && customerSorts.has(params.sort) ? params.sort : "recent";
  const result = await listCustomersService(session, { search: params.search, status: status as "all" | "active" | "stalled" | "no-active", sort: sort as "recent" | "created", cursor: params.cursor });
  return <CustomerListClient initial={result} search={params.search ?? ""} status={status} sort={sort} />;
}
