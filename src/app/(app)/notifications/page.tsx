import { redirect } from "next/navigation";
export default function LegacyNotificationsPage() {
  redirect("/inbox" as never);
}
