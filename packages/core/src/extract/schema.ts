/** The `record_requirements` output (BUILD_PROMPT Appendix B.1). IDs from the model are provisional. */
import { z } from 'zod';
import { RequirementKindSchema } from '../contracts/index.js';

export const ExtractedRequirementSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  quote: z.string().min(1),
  source: z.object({
    kind: z.enum(['title', 'body', 'comment', 'tasklist']),
    commentId: z.string().optional(),
  }),
  kind: RequirementKindSchema,
  explicitness: z.enum(['explicit', 'implied']),
  priority: z.enum(['must', 'should', 'could']),
  examples: z.array(z.object({ input: z.string(), expected: z.string(), quote: z.string() })),
  checkableInCode: z.boolean(),
  supersededBy: z.string().optional(),
});
export type ExtractedRequirement = z.infer<typeof ExtractedRequirementSchema>;

export const OpenQuestionSchema = z.object({
  requirementId: z.string().optional(),
  question: z.string().min(1),
  readings: z.array(z.string()).max(2),
});
export type OpenQuestion = z.infer<typeof OpenQuestionSchema>;

export const ExtractionOutputSchema = z.object({
  requirements: z.array(ExtractedRequirementSchema),
  openQuestions: z.array(OpenQuestionSchema),
});
export type ExtractionOutput = z.infer<typeof ExtractionOutputSchema>;
