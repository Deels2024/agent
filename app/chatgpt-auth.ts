import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { authMode, standaloneUserFromHeaders, type AuthenticatedUser } from "../lib/standalone-auth";
import { runtimeValue } from "../lib/runtime";

export type AppUser = AuthenticatedUser;

const USER_EMAIL_HEADER = "oai-authenticated-user-email";
const USER_FULL_NAME_HEADER = "oai-authenticated-user-full-name";
const USER_FULL_NAME_ENCODING_HEADER = "oai-authenticated-user-full-name-encoding";
const PERCENT_ENCODED_UTF8 = "percent-encoded-utf-8";
const CHATGPT_SIGN_IN_PATH = "/signin-with-chatgpt";
const CHATGPT_SIGN_OUT_PATH = "/signout-with-chatgpt";
const CALLBACK_PATH = "/callback";
const STANDALONE_SIGN_IN_PATH = "/login";
const STANDALONE_SIGN_OUT_PATH = "/logout";

export async function getAuthenticatedUser(): Promise<AppUser | null> {
  const requestHeaders = new Headers(await headers());
  if (authMode() === "standalone") return standaloneUserFromHeaders(requestHeaders);

  const email = requestHeaders.get(USER_EMAIL_HEADER) ?? (process.env.NODE_ENV === "production" ? null : runtimeValue("DEV_USER_EMAIL"));
  if (!email) return null;
  const encodedFullName = requestHeaders.get(USER_FULL_NAME_HEADER);
  const fullName = encodedFullName && requestHeaders.get(USER_FULL_NAME_ENCODING_HEADER) === PERCENT_ENCODED_UTF8
    ? safeDecodeURIComponent(encodedFullName)
    : null;
  return { displayName: fullName ?? email, email: email.toLowerCase(), fullName, provider: "chatgpt", emailVerified: true };
}

export async function requireAuthenticatedUser(returnTo: string): Promise<AppUser> {
  const user = await getAuthenticatedUser();
  if (user) return user;
  redirect(authSignInPath(returnTo));
}

// Kept as aliases so existing imports remain compatible while the application
// supports both ChatGPT Sites and a standalone server.
export const getChatGPTUser = getAuthenticatedUser;
export const requireChatGPTUser = requireAuthenticatedUser;

export function authSignInPath(returnTo: string): string {
  const safeReturnTo = safeRelativeReturnPath(returnTo);
  const path = authMode() === "standalone" ? STANDALONE_SIGN_IN_PATH : CHATGPT_SIGN_IN_PATH;
  return `${path}?return_to=${encodeURIComponent(safeReturnTo)}`;
}

export function authSignOutPath(provider: AppUser["provider"], returnTo = "/"): string {
  const safeReturnTo = safeRelativeReturnPath(returnTo);
  const path = provider === "standalone" ? STANDALONE_SIGN_OUT_PATH : CHATGPT_SIGN_OUT_PATH;
  return `${path}?return_to=${encodeURIComponent(safeReturnTo)}`;
}

export const chatGPTSignInPath = authSignInPath;

export function chatGPTSignOutPath(returnTo = "/"): string {
  return authSignOutPath(authMode(), returnTo);
}

export function safeRelativeReturnPath(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  let url: URL;
  try {
    url = new URL(value, "https://app.local");
  } catch {
    return "/";
  }
  if (url.origin !== "https://app.local" || isReservedAuthPath(url.pathname)) return "/";
  return `${url.pathname}${url.search}${url.hash}`;
}

function isReservedAuthPath(pathname: string) {
  return [CHATGPT_SIGN_IN_PATH, CHATGPT_SIGN_OUT_PATH, STANDALONE_SIGN_IN_PATH, STANDALONE_SIGN_OUT_PATH, CALLBACK_PATH].includes(pathname);
}

function safeDecodeURIComponent(value: string): string | null {
  try { return decodeURIComponent(value); }
  catch { return null; }
}
