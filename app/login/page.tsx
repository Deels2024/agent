import { redirect } from "next/navigation";
import { authSignInPath, getAuthenticatedUser, safeRelativeReturnPath } from "../chatgpt-auth";
import { authMode } from "../../lib/standalone-auth";
import LoginForm from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ return_to?: string; mode?: string }> }) {
  const params = await searchParams;
  const returnTo = safeRelativeReturnPath(params.return_to ?? "/account");
  if (authMode() !== "standalone") redirect(authSignInPath(returnTo));
  if (await getAuthenticatedUser()) redirect(returnTo);
  return <LoginForm returnTo={returnTo} initialMode={params.mode === "register" ? "register" : "login"} />;
}
