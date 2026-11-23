import { classTabIndex } from "@/lib/classtab";

/** The whole catalogue (~4k small entries); the browser filters it. */
export async function GET() {
  const index = await classTabIndex();
  return Response.json({ available: !!index, entries: index ?? [] });
}
