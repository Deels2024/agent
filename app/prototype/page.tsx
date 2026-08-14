import { PrototypeExperience } from "../page";
import { adminEmails } from "../../lib/auth";
import { requireAuthenticatedUser } from "../chatgpt-auth";
import { InternalAccessDenied } from "../internal-access";

export const dynamic = "force-dynamic";

export default async function PrototypePage() {
  const user = await requireAuthenticatedUser("/prototype");
  if (!adminEmails().has(user.email.toLowerCase())) return <InternalAccessDenied />;
  return <PrototypeExperience />;
}
