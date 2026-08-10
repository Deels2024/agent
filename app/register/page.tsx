import { redirect } from "next/navigation";
import { requireChatGPTUser } from "../chatgpt-auth";
import { hasCurrentLegalAcceptances } from "../../lib/legal";
import RegistrationForm from "./registration-form";

export const dynamic = "force-dynamic";

const allowedReturns = new Set(["/account", "/seller", "/live-search"]);

export default async function RegistrationPage({ searchParams }: { searchParams: Promise<{ return_to?: string }> }) {
  const params = await searchParams;
  const returnTo = allowedReturns.has(params.return_to ?? "") ? params.return_to! : "/account";
  return <RegistrationSession returnTo={returnTo} />;
}

async function RegistrationSession({ returnTo }: { returnTo: string }) {
  const user = await requireChatGPTUser(`/register?return_to=${encodeURIComponent(returnTo)}`);
  try {
    if (await hasCurrentLegalAcceptances(user.email, "buyer")) redirect(returnTo);
  } catch {
    // Форма регистрации сама покажет понятную ошибку, если хранилище недоступно.
  }
  return <RegistrationForm name={user.displayName} email={user.email} returnTo={returnTo} />;
}
