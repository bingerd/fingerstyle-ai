import { connection } from "next/server";
import { availableProviders } from "@/lib/llm/providers";

export async function GET() {
  await connection();
  return Response.json(await availableProviders());
}
