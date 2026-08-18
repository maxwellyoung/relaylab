import { z } from "zod";
import { experimentBehaviors } from "./database.js";

export const experimentInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  behavior: z.enum(experimentBehaviors),
  payload: z.record(z.string(), z.unknown()),
});

export const experimentResponseV1Schema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  behavior: z.enum(experimentBehaviors),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime(),
});

export const experimentRunResponseV1Schema = z.object({
  id: z.number().int().positive(),
  experimentId: z.number().int().positive(),
  outcome: z.enum([
    "success",
    "downstream_error",
    "timeout",
    "invalid_response",
    "unreachable",
  ]),
  httpStatus: z.number().int().min(100).max(599).nullable(),
  durationMs: z.number().int().positive(),
  response: z.union([
    z.record(z.string(), z.unknown()),
    z.string(),
    z.null(),
  ]),
  createdAt: z.iso.datetime(),
});

export const experimentDetailsResponseV1Schema = experimentResponseV1Schema.extend({
  runs: z.array(experimentRunResponseV1Schema),
});
