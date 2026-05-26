import { z } from "zod";

export const categoryNameSchema = z
  .string()
  .trim()
  .min(1, "Category name is required")
  .max(80, "Category name is too long");

export const headersSchema = z
  .array(z.string().trim().min(1, "Header cannot be empty"))
  .min(1, "At least one header is required");

export const confidenceScoreSchema = z.number().min(0).max(1);

export const sheetRowValueSchema = z.union([z.string(), z.number(), z.null()]);

export const sheetRowSchema = z.record(z.string(), sheetRowValueSchema);

export const createCategorySchema = z.object({
  category: categoryNameSchema,
  headers: headersSchema,
});

export const categoryPayloadSchema = z.object({
  category: categoryNameSchema,
});

export const appendRowSchema = z.object({
  category: categoryNameSchema,
  values: sheetRowSchema,
  user: z.string().trim().min(1).default("Admin User"),
  sourcePortalUrl: z.string().url().optional(),
  confidence: confidenceScoreSchema.optional(),
  missingFields: z.array(z.string()).optional(),
  saveAnyway: z.boolean().default(false),
  dryRun: z.boolean().default(false),
});

export const updateRowSchema = appendRowSchema.extend({
  rowIndex: z.number().int().min(0),
  confirmedFields: z.array(z.string()).optional(),
});

export const duplicateCheckSchema = z.object({
  category: categoryNameSchema,
  values: sheetRowSchema,
});

export const aiMapFieldsSchema = z.object({
  category: categoryNameSchema,
  headers: headersSchema,
  sampleRows: z.array(sheetRowSchema).default([]),
  portalText: z.string().min(1, "Portal text is required"),
});

export const extractedOutputSchema = aiMapFieldsSchema
  .extend({
    matchedFields: sheetRowSchema,
    missingFields: z.array(z.string()),
    confidence: confidenceScoreSchema,
    notes: z.array(z.string()),
  })
  .superRefine((value, context) => {
    const headerSet = new Set(value.headers);
    for (const key of Object.keys(value.matchedFields)) {
      if (!headerSet.has(key)) {
        context.addIssue({
          code: "custom",
          message: `Matched field "${key}" is not part of the selected sheet headers`,
          path: ["matchedFields", key],
        });
      }
    }
  });

export const askDatabaseSchema = z.object({
  question: z.string().trim().min(1, "Question is required"),
  category: categoryNameSchema.optional(),
});

export const auditLogSchema = z.object({
  user: z.string().trim().min(1).default("Admin User"),
  actionType: z.enum(["add", "update", "category_created", "analysis", "capture", "duplicate_check", "cleaning"]),
  category: z.string().optional(),
  facilityName: z.string().optional(),
  affectedRow: z.number().int().optional(),
  missingFields: z.array(z.string()).optional(),
  confidenceScore: confidenceScoreSchema.optional(),
  sourcePortalUrl: z.string().url().optional(),
  status: z.enum(["success", "warning", "failed"]),
  details: z.string().optional(),
});
