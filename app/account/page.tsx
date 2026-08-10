import { requireChatGPTUser } from "../chatgpt-auth";
import { adminEmails } from "../../lib/auth";
import AccountDashboard from "./account-dashboard";
import { redirect } from "next/navigation";
import { hasCurrentLegalAcceptances } from "../../lib/legal";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await requireChatGPTUser("/account");
  if (!await hasCurrentLegalAcceptances(user.email, "buyer")) redirect("/register?return_to=/account");
  return <AccountDashboard initialName={user.displayName} initialEmail={user.email} initialIsAdmin={adminEmails().has(user.email.toLowerCase())} />;
}
