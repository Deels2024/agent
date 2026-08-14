import { adminEmails } from "../../lib/auth";
import { requireAuthenticatedUser } from "../chatgpt-auth";
import { InternalAccessDenied } from "../internal-access";
import PlatformDashboard from "./platform-dashboard";

export const dynamic = "force-dynamic";

export default async function PlatformPage() {
  const user = await requireAuthenticatedUser("/platform");
  if (!adminEmails().has(user.email.toLowerCase())) return <InternalAccessDenied />;
  return <PlatformDashboard />;
}
