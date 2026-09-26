import { redirect } from "next/navigation";
import { requireSession } from "@/core/auth/session";
import { listGlobalContactsService } from "@/core/customer/service";
import ContactsClient from "./ContactsClient";

export const dynamic = "force-dynamic";

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; roleTag?: string; search?: string }>;
}) {
  const session = await requireSession().catch(() => null);
  if (!session) redirect("/login");

  const params = await searchParams;
  const scope = (params.scope as "MY" | "PUBLIC" | "ALL") || (session.role === "SALES" ? "MY" : "ALL");

  const contacts = await listGlobalContactsService(session, {
    scope,
    roleTag: params.roleTag,
    search: params.search,
  });

  return (
    <ContactsClient
      role={session.role}
      currentUserId={session.userId}
      initialContacts={contacts}
      initialScope={scope}
      initialRoleTag={params.roleTag ?? "ALL"}
      initialSearch={params.search ?? ""}
    />
  );
}
