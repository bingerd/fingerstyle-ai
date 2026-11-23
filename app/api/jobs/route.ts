import { listJobs } from "@/lib/jobs";

/** Recent jobs without their (large) results. */
export async function GET() {
  return Response.json({ jobs: listJobs().map((j) => ({ ...j, result: undefined })) });
}
