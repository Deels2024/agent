export function rejectUntrustedMutation(request: Request): Response | null {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) return null;

  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (origin) {
    try {
      if (new URL(origin).origin !== new URL(request.url).origin) {
        return Response.json({ error: "Запрос отклонён защитой источника", code: "untrusted_origin" }, { status: 403 });
      }
    } catch {
      return Response.json({ error: "Некорректный источник запроса", code: "untrusted_origin" }, { status: 403 });
    }
  }
  if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) {
    return Response.json({ error: "Запрос с другого сайта запрещён", code: "cross_site_request" }, { status: 403 });
  }
  return null;
}
