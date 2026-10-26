import { describe, expect, it } from "vitest";
import { signEmbedToken, verifyEmbedToken } from "@/lib/server/embed-token";

const SECRET = "x".repeat(40);

describe("embed tokens", () => {
  it("round-trips the user id", async () => {
    const t = await signEmbedToken("user-1", SECRET);
    expect(await verifyEmbedToken(t, SECRET)).toBe("user-1");
  });

  it("rejects a token signed with another secret", async () => {
    const t = await signEmbedToken("user-1", "y".repeat(40));
    expect(await verifyEmbedToken(t, SECRET)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const t = await signEmbedToken("user-1", SECRET, -10);
    expect(await verifyEmbedToken(t, SECRET)).toBeNull();
  });

  it("rejects garbage and tampered tokens", async () => {
    expect(await verifyEmbedToken("not-a-token", SECRET)).toBeNull();
    const t = await signEmbedToken("user-1", SECRET);
    const [h, , s] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ sub: "admin", aud: "ai-scheduler-embed", iss: "ai-scheduler", exp: 9999999999 })).toString("base64url");
    expect(await verifyEmbedToken(`${h}.${forged}.${s}`, SECRET)).toBeNull();
  });
});
