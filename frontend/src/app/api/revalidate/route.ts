import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

/**
 * Public pages are cached for five minutes, which is right for visitors but
 * wrong for an editor who just pressed save. The API calls this route after a
 * successful admin write so the affected pages refresh immediately. The shared
 * secret lives only on the two servers, never in the browser.
 */
export async function POST(request: Request) {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret) return NextResponse.json({ revalidated: false, reason: "not configured" }, { status: 503 });
  if (request.headers.get("x-revalidate-secret") !== secret) {
    return NextResponse.json({ revalidated: false }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as { paths?: unknown } | null;
  const paths = Array.isArray(body?.paths) ? body.paths.filter((path): path is string => typeof path === "string") : [];
  // Only site-relative paths, so this can never be pointed at another origin.
  const safe = paths.filter((path) => path.startsWith("/") && !path.startsWith("//")).slice(0, 20);
  safe.forEach((path) => revalidatePath(path));
  return NextResponse.json({ revalidated: true, paths: safe });
}
