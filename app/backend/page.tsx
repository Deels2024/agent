import { adminEmails } from "../../lib/auth";
import { requireAuthenticatedUser } from "../chatgpt-auth";
import { InternalAccessDenied } from "../internal-access";
import BackendDashboard from "./backend-dashboard";

export const dynamic = "force-dynamic";

export default async function BackendPage() {
  const user = await requireAuthenticatedUser("/backend");
  if (!adminEmails().has(user.email.toLowerCase())) return <InternalAccessDenied />;
  return <BackendDashboard />;
}
