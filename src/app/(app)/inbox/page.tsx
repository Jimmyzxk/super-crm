import { redirect } from "next/navigation";
import { requireSession } from "@/core/auth/session";
import { listNotificationsService } from "@/core/notification/service";
import NotificationClient from "../notifications/NotificationClient";

export const dynamic = "force-dynamic";

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ limit?: string }>;
}) {
  const session = await requireSession().catch(() => null);
  if (!session) redirect("/login");
  const params = await searchParams;
  const limit = Number(params.limit ?? 20);
  const page = await listNotificationsService(session, Number.isFinite(limit) ? limit : 20);
  return <NotificationClient initial={page} />;
}
