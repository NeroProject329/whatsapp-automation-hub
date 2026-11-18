import type { NextRequest } from "next/server";
export const dynamic = "force-dynamic";
const heads = [
  "auth",
  "health",
  "dashboard",
  "settings",
  "contacts",
  "imports",
  "connections",
  "templates",
  "campaigns",
  "logs",
  "events",
  "messages",
  "openapi.json",
];
async function proxy(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  if (
    !heads.includes(path[0]) ||
    path.some(
      (p) => !/^[a-zA-Z0-9_.-]{1,80}$/.test(p) || [".", ".."].includes(p),
    )
  )
    return new Response(null, { status: 404 });
  if (Number(req.headers.get("content-length")) > 3_145_728)
    return Response.json(
      { error: { message: "O arquivo ultrapassa o limite." } },
      { status: 413 },
    );
  const base = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4100";
  const headers = new Headers();
  for (const name of ["accept", "content-type", "cookie", "origin"]) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }
  try {
    const upstream = await fetch(
      new URL(
        "/api/" + path.map(encodeURIComponent).join("/") + req.nextUrl.search,
        base,
      ),
      {
        method: req.method,
        headers,
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(25000),
        ...(req.method === "GET" || req.method === "HEAD" || !req.body
          ? {}
          : { body: req.body, duplex: "half" }),
      },
    );
    const clean = new Headers({
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    for (const name of ["content-type", "x-request-id"]) {
      const value = upstream.headers.get(name);
      if (value) clean.set(name, value);
    }
    for (const value of upstream.headers.getSetCookie())
      clean.append("set-cookie", value);
    return new Response(upstream.body, {
      status: upstream.status,
      headers: clean,
    });
  } catch {
    return Response.json(
      {
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "API indisponível. Tente novamente em instantes.",
        },
      },
      { status: 503 },
    );
  }
}
export { proxy as GET, proxy as POST, proxy as PATCH, proxy as DELETE };
