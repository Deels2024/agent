import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "../../db";
import { ensureMarketplaceSchema } from "../../db/ensure";
import { users } from "../../db/schema";
import { authSignInPath, getAuthenticatedUser, safeRelativeReturnPath } from "../chatgpt-auth";
import { authMode } from "../../lib/standalone-auth";
import LoginForm from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ return_to?: string; mode?: string }> }) {
  const params = await searchParams;
  const returnTo = safeRelativeReturnPath(params.return_to ?? "/account");
  if (authMode() !== "standalone") redirect(authSignInPath(returnTo));
  const user = await getAuthenticatedUser();
  if (user) {
    let destination = returnTo;
    if (returnTo === "/account") {
      try {
        await ensureMarketplaceSchema();
        const [profile] = await getDb().select({ role: users.role }).from(users).where(eq(users.email, user.email)).limit(1);
        if (profile?.role === "seller") destination = "/seller";
      } catch {
        // The requested safe route remains a usable fallback.
      }
    }
    redirect(destination);
  }
  return <LoginForm returnTo={returnTo} initialMode={params.mode === "register" ? "register" : "login"} />;
}
