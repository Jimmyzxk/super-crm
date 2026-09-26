import { redirect } from "next/navigation";
import { requireSession } from "@/core/auth/session";
import { listReviewedWinSamplesService, listSalesPlaybooksService } from "@/core/playbook/service";
import PlaybooksClient from "./PlaybooksClient";

export const dynamic = "force-dynamic";

export default async function PlaybooksPage() {
  const session = await requireSession().catch(() => null);
  if (!session) redirect("/login");
  const [playbooks, samples] = await Promise.all([
    listSalesPlaybooksService(session),
    session.role === "SALES" ? Promise.resolve([]) : listReviewedWinSamplesService(session),
  ]);
  return <PlaybooksClient role={session.role} initialPlaybooks={playbooks} initialSamples={samples} />;
}
