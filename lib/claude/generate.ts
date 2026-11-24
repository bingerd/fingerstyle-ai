import { z } from "zod";
import { errorsOnly, formatIssues, type Issue } from "@/lib/theory/validate";
import { ProviderError, runStructured, type Effort, type ProviderId } from "@/lib/llm/providers";

const MAX_REPAIRS = 2;

export { ProviderError as GenerationError };

/**
 * Ask the chosen model for JSON matching `schema`, then run the deterministic validator.
 * On validation errors, send the previous answer and the errors back for a repair round.
 * (The CLIs are stateless one-shot calls, so the repair context is carried in the prompt.)
 */
export async function generateValidated<S extends z.ZodType>(opts: {
  provider: ProviderId;
  schema: S;
  system: string;
  prompt: string;
  validate: (value: z.infer<S>) => Issue[];
  effort: Effort;
  /** Full-rewrite repair rounds (default 2). */
  maxRepairs?: number;
}): Promise<{ value: z.infer<S>; warnings: Issue[]; repairs: number }> {
  const jsonSchema = z.toJSONSchema(opts.schema) as object;
  let prompt = opts.prompt;
  let last: { value: z.infer<S>; issues: Issue[] } | null = null;

  const maxRepairs = opts.maxRepairs ?? MAX_REPAIRS;
  for (let attempt = 0; attempt <= maxRepairs; attempt++) {
    const raw = await runStructured(opts.provider, { system: opts.system, prompt, schema: jsonSchema, effort: opts.effort });
    const parsed = opts.schema.safeParse(raw);
    if (!parsed.success) throw new ProviderError("The model returned JSON that doesn't match the song format.", 502);
    const value = parsed.data as z.infer<S>;

    const issues = opts.validate(value);
    last = { value, issues };
    const errors = errorsOnly(issues);
    if (!errors.length) return { value, warnings: issues, repairs: attempt };

    prompt = `${opts.prompt}

---
Your previous answer:
${JSON.stringify(value)}

A deterministic checker found these problems in it:
${formatIssues(errors)}

Return the complete corrected JSON. Fix every error; keep everything that was fine unchanged.`;
  }

  // Out of repair attempts: return the best effort with its issues surfaced as warnings.
  return { value: last!.value, warnings: last!.issues, repairs: maxRepairs };
}
