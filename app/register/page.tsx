import { redirect } from "next/navigation";
import { authSignInPath, authSignOutPath, getAuthenticatedUser } from "../chatgpt-auth";
import { authMode } from "../../lib/standalone-auth";
import { hasCurrentLegalAcceptances } from "../../lib/legal";
import RegistrationForm from "./registration-form";

export const dynamic = "force-dynamic";

const allowedReturns = new Set(["/account", "/seller", "/live-search"]);

export default async function RegistrationPage({ searchParams }: { searchParams: Promise<{ return_to?: string; role?: string }> }) {
  const params = await searchParams;
  const initialRole = params.role === "seller" ? "seller" : "buyer";
  const requestedReturn = allowedReturns.has(params.return_to ?? "") ? params.return_to! : "/account";
  const returnTo = initialRole === "seller" ? "/seller" : requestedReturn;
  return <RegistrationSession returnTo={returnTo} initialRole={initialRole} />;
}

async function RegistrationSession({ returnTo, initialRole }: { returnTo: string; initialRole: "buyer" | "seller" }) {
  const registrationReturn = `/register?role=${initialRole}&return_to=${encodeURIComponent(returnTo)}`;
  const user = await getAuthenticatedUser();
  if (!user) {
    const signIn = authSignInPath(registrationReturn);
    redirect(authMode() === "standalone" ? `${signIn}&mode=register` : signIn);
  }
  let legalComplete = false;
  try {
    legalComplete = await hasCurrentLegalAcceptances(user.email, "buyer");
  } catch {
    // Форма регистрации сама покажет понятную ошибку, если хранилище недоступно.
  }
  if (legalComplete) redirect(initialRole === "seller" ? "/seller" : returnTo);
  return <RegistrationForm name={user.displayName} email={user.email} returnTo={returnTo} initialRole={initialRole} logoutHref={authSignOutPath(user.provider)} />;
}
