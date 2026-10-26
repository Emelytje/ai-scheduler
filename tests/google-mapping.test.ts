import { describe, expect, it } from "vitest";
import { BLOCK_PROPERTY, blockToGoogleEvent, mapGoogleEvent, type GoogleEvent } from "@/lib/google/mapping";

const TZ = "Europe/Brussels";
const base: GoogleEvent = {
  id: "e1",
  status: "confirmed",
  summary: "Client call",
  start: { dateTime: "2026-10-27T10:00:00+01:00" },
  end: { dateTime: "2026-10-27T11:00:00+01:00" },
};

describe("Google event mapping", () => {
  it("maps a normal meeting as busy, in UTC", () => {
    expect(mapGoogleEvent(base, TZ)).toEqual({
      id: "e1",
      title: "Client call",
      start: "2026-10-27T09:00:00.000Z",
      end: "2026-10-27T10:00:00.000Z",
      busy: true,
      allDay: false,
      source: "google",
    });
  });

  it("treats events marked free as not blocking", () => {
    expect(mapGoogleEvent({ ...base, transparency: "transparent" }, TZ)!.busy).toBe(false);
  });

  it("treats meetings the user declined as not blocking", () => {
    const e = { ...base, attendees: [{ self: true, responseStatus: "declined" }, { responseStatus: "accepted" }] };
    expect(mapGoogleEvent(e, TZ)!.busy).toBe(false);
  });

  it("keeps tentative and accepted meetings busy", () => {
    expect(mapGoogleEvent({ ...base, attendees: [{ self: true, responseStatus: "tentative" }] }, TZ)!.busy).toBe(true);
  });

  it("ignores cancelled events, our own task blocks and working-location markers", () => {
    expect(mapGoogleEvent({ ...base, status: "cancelled" }, TZ)).toBeNull();
    expect(mapGoogleEvent({ ...base, extendedProperties: { private: { [BLOCK_PROPERTY]: "b1" } } }, TZ)).toBeNull();
    expect(mapGoogleEvent({ ...base, eventType: "workingLocation" }, TZ)).toBeNull();
  });

  it("maps all-day events to local midnights", () => {
    const e = mapGoogleEvent({ id: "ooo", summary: "Out of office", eventType: "outOfOffice", start: { date: "2026-10-28" }, end: { date: "2026-10-29" } }, TZ)!;
    expect(e.allDay).toBe(true);
    expect(e.start).toBe("2026-10-27T23:00:00.000Z");
    expect(e.end).toBe("2026-10-28T23:00:00.000Z");
    expect(e.busy).toBe(true);
  });

  it("marks the events we write so they are never read back as meetings", () => {
    const body = blockToGoogleEvent(
      { id: "blk", taskId: "t", start: "2026-10-27T09:00:00.000Z", end: "2026-10-27T10:00:00.000Z" },
      undefined,
      "https://x.test",
    );
    const roundTrip = mapGoogleEvent({ id: "g", ...body, transparency: "opaque" } as GoogleEvent, TZ);
    expect(roundTrip).toBeNull();
  });
});
