import { describe, expect, it } from "vitest";
import { supabaseEnv } from "@/lib/supabase-env";

const URL = "https://abcdefgh.supabase.co";

describe("finding Supabase settings", () => {
  it("reads the standard names", () => {
    expect(supabaseEnv({ NEXT_PUBLIC_SUPABASE_URL: URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "svc" })).toEqual({
      url: URL,
      anonKey: "anon",
      serviceKey: "svc",
    });
  });

  it("reads names with a custom integration prefix", () => {
    expect(
      supabaseEnv({ STORAGE_SUPABASE_URL: URL, STORAGE_SUPABASE_ANON_KEY: "anon", STORAGE_SUPABASE_SERVICE_ROLE_KEY: "svc", APP_URL: "https://x" }),
    ).toEqual({ url: URL, anonKey: "anon", serviceKey: "svc" });
  });

  it("handles a prefix that replaces the provider name", () => {
    expect(
      supabaseEnv({ STORAGE_URL: URL, STORAGE_ANON_KEY: "anon", STORAGE_SERVICE_ROLE_KEY: "svc", VERCEL_URL: "x.vercel.app", APP_URL: "https://x" }),
    ).toEqual({ url: URL, anonKey: "anon", serviceKey: "svc" });
  });

  it("returns empty values in demo mode", () => {
    expect(supabaseEnv({ APP_URL: "https://x", GOOGLE_CLIENT_SECRET: "g" })).toEqual({ url: "", anonKey: "", serviceKey: "" });
  });
});
