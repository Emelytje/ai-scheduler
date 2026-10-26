import { describe, expect, it } from "vitest";
import { deriveSecret } from "@/lib/server/derive";

describe("derived secrets", () => {
  const master = "service-role-key-" + "x".repeat(40);
  it("is stable for the same master and purpose", () => {
    expect(deriveSecret(master, "embed-signing").equals(deriveSecret(master, "embed-signing"))).toBe(true);
  });
  it("gives independent keys per purpose and per master", () => {
    expect(deriveSecret(master, "embed-signing").equals(deriveSecret(master, "token-encryption"))).toBe(false);
    expect(deriveSecret(master, "embed-signing").equals(deriveSecret(master + "y", "embed-signing"))).toBe(false);
  });
  it("produces 32-byte keys usable for AES-256 and HMAC", () => {
    expect(deriveSecret(master, "token-encryption")).toHaveLength(32);
    expect(deriveSecret(master, "embed-signing").toString("hex")).toHaveLength(64);
  });
  it("refuses an empty master", () => {
    expect(() => deriveSecret("", "x")).toThrow();
  });
});
