import { redirect } from "next/navigation";
import { requireSession } from "@/core/auth/session";
import { getSalesQuotaAttainmentDashboard, listSalesQuotas } from "@/core/quota/service";
import type { QuotaPeriodType } from "@/core/quota/types";
import QuotasClient from "./QuotasClient";

export const dynamic = "force-dynamic";

export default async function QuotasPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; periodType?: string; periodKey?: string }>;
}) {
  const session = await requireSession().catch(() => null);
  if (!session) redirect("/login");

  const params = await searchParams;
  const now = new Date();
  const currentYear = params.year ? parseInt(params.year, 10) : now.getFullYear();
  const periodType = (params.periodType as QuotaPeriodType) || "MONTHLY";
  const currentMonthNum = now.getMonth() + 1;
  const periodKey = params.periodKey || (periodType === "MONTHLY" ? `${currentYear}-M${String(currentMonthNum).padStart(2, "0")}` : periodType === "QUARTERLY" ? `${currentYear}-Q${Math.ceil(currentMonthNum / 3)}` : `${currentYear}`);

  const [dashboardData, quotaList] = await Promise.all([
    getSalesQuotaAttainmentDashboard(session, {
      year: currentYear,
      periodType,
      periodKey,
    }),
    listSalesQuotas(session, {
      year: currentYear,
      periodType,
      periodKey,
    }),
  ]);

  return (
    <QuotasClient
      role={session.role}
      currentUserId={session.userId}
      initialDashboardData={dashboardData}
      initialQuotas={quotaList}
      initialYear={currentYear}
      initialPeriodType={periodType}
      initialPeriodKey={periodKey}
    />
  );
}
