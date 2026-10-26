import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { HttpError } from "./auth";
import { isLive } from "./env";

export function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, { ...init, headers: { "cache-control": "no-store", ...(init?.headers ?? {}) } });
}

/** Wrap a route handler: demo-mode guard, JSON errors, no stack traces to clients. */
export function route<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    if (!isLive()) return json({ error: "This server runs in demo mode: configure Supabase to use the API." }, { status: 503 });
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, { status: e.status });
      if (e instanceof z.ZodError) return json({ error: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 });
      if (e instanceof Error && e.message === "Task not found") return json({ error: e.message }, { status: 404 });
      console.error(e);
      return json({ error: "Something went wrong on our side. Try again in a moment." }, { status: 500 });
    }
  };
}

const isoInstant = z.iso.datetime({ offset: true }).transform((v) => new Date(v).toISOString());

export const taskInputSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    estimateMinutes: z.number().int().min(5).max(10_000),
    deadline: isoInstant.nullable(),
    notBefore: isoInstant.nullable(),
    priority: z.enum(["low", "medium", "high", "urgent"]),
    splittable: z.boolean(),
    minChunkMinutes: z.number().int().min(5).max(480),
  })
  .refine((t) => !t.deadline || !t.notBefore || t.notBefore < t.deadline, { message: "notBefore must be before deadline" });

export const taskPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    estimateMinutes: z.number().int().min(5).max(10_000),
    deadline: isoInstant.nullable(),
    notBefore: isoInstant.nullable(),
    priority: z.enum(["low", "medium", "high", "urgent"]),
    splittable: z.boolean(),
    minChunkMinutes: z.number().int().min(5).max(480),
    status: z.enum(["open", "done"]),
  })
  .partial();

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const settingsPatchSchema = z
  .object({
    timezone: z.string().refine((tz) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, "Unknown time zone"),
    workingHours: z
      .array(z.array(z.object({ start: hhmm, end: hhmm }).refine((r) => r.start < r.end, "start must be before end")))
      .length(7),
    bufferMinutes: z.number().int().min(0).max(120),
    horizonDays: z.number().int().min(1).max(60),
    slotMinutes: z.number().int().min(5).max(60),
    overrunExtensionMinutes: z.number().int().min(5).max(480),
  })
  .partial();
