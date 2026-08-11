import { authMode, closeStandaloneSession } from "../../lib/standalone-auth";
import { safeRelativeReturnPath } from "../chatgpt-auth";

export async function GET(request: Request) {
  const returnTo = safeRelativeReturnPath(new URL(request.url).searchParams.get("return_to") ?? "/");
  if (authMode() !== "standalone") return Response.redirect(new URL("/", request.url), 303);
  const cookie = await closeStandaloneSession(request);
  return new Response(null, { status: 303, headers: { location: new URL(returnTo, request.url).toString(), "set-cookie": cookie, "cache-control": "no-store" } });
}
