import { requireAuthenticatedUser } from "../chatgpt-auth";
import SellerDashboard from "./seller-dashboard";
import { redirect } from "next/navigation";
import { hasCurrentLegalAcceptances } from "../../lib/legal";

export const dynamic = "force-dynamic";

export default async function SellerPage() {
  const user = await requireAuthenticatedUser("/seller");
  if (!await hasCurrentLegalAcceptances(user.email, "buyer")) redirect("/register?return_to=/seller");
  return <SellerDashboard email={user.email} />;
}
