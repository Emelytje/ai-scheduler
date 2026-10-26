"use client";

import { useState } from "react";
import type { CalendarConnection } from "@/lib/client/types";
import type { Settings } from "@/lib/scheduler/types";
import { fmtDateTime } from "@/lib/format";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

interface Props {
  settings: Settings;
  calendar: CalendarConnection;
  mode: "demo" | "live";
  busy: boolean;
  onSave: (patch: Partial<Settings>) => void;
  onReset?: () => void;
  /** URL that starts the Google OAuth flow (live mode only). */
  connectUrl?: string;
  onDisconnect?: () => void;
}

export function SettingsPanel(p: Props) {
  const [draft, setDraft] = useState<Settings>(p.settings);
  const [confirmReset, setConfirmReset] = useState(false);
  const tz = p.settings.timezone;
  const timezones = (() => {
    try {
      return Intl.supportedValuesOf("timeZone");
    } catch {
      return [p.settings.timezone];
    }
  })();

  const setDay = (wd: number, enabled: boolean, start?: string, end?: string) => {
    const current = draft.workingHours[wd][0] ?? { start: "09:00", end: "17:00" };
    const hours = draft.workingHours.map((r, i) =>
      i === wd ? (enabled ? [{ start: start ?? current.start, end: end ?? current.end }] : []) : r,
    );
    setDraft({ ...draft, workingHours: hours });
  };

  const num = (key: "bufferMinutes" | "horizonDays" | "overrunExtensionMinutes", v: string) =>
    setDraft({ ...draft, [key]: Math.max(0, Number(v) || 0) });

  return (
    <section className="as-panel as-settings" aria-label="Settings">
      <div>
        <h3>Calendar</h3>
        {p.mode === "demo" ? (
          <p className="as-hint" style={{ margin: "4px 0 0" }}>
            Demo mode uses a sample calendar stored in this browser. Connect Google Calendar in a deployed workspace to plan around
            your real meetings.
          </p>
        ) : p.calendar.connected ? (
          <div className="as-row" style={{ marginTop: 4 }}>
            <span className="as-chip is-ok">Google connected</span>
            <span className="as-hint">{p.calendar.email}</span>
            {p.calendar.lastSyncAt && <span className="as-hint">Synced {fmtDateTime(p.calendar.lastSyncAt, tz)}</span>}
            {p.onDisconnect && (
              <button className="as-btn is-small" onClick={p.onDisconnect}>
                Disconnect
              </button>
            )}
          </div>
        ) : (
          <div className="as-row" style={{ marginTop: 4 }}>
            {p.calendar.error && <span className="as-chip is-late">{p.calendar.error}</span>}
            <a className="as-btn is-primary" href={p.connectUrl} target="_top">
              Connect Google Calendar
            </a>
          </div>
        )}
      </div>

      <div className="as-hours">
        <h3 style={{ gridColumn: "1 / -1" }}>Working hours</h3>
        {DISPLAY_ORDER.map((wd) => {
          const r = draft.workingHours[wd][0];
          return (
            <div key={wd} style={{ display: "contents" }}>
              <label className="as-check">
                <input id={`wh-on-${wd}`} type="checkbox" checked={!!r} onChange={(e) => setDay(wd, e.target.checked)} />
                {DAY_NAMES[wd]}
              </label>
              <input
                id={`wh-start-${wd}`}
                aria-label={`${DAY_NAMES[wd]} start`}
                className="as-input"
                type="time"
                disabled={!r}
                value={r?.start ?? ""}
                onChange={(e) => setDay(wd, true, e.target.value, undefined)}
              />
              <input
                id={`wh-end-${wd}`}
                aria-label={`${DAY_NAMES[wd]} end`}
                className="as-input"
                type="time"
                disabled={!r}
                value={r?.end ?? ""}
                onChange={(e) => setDay(wd, true, undefined, e.target.value)}
              />
            </div>
          );
        })}
      </div>

      <label className="as-field">
        <span>Time zone</span>
        <input id="set-tz" className="as-input" list="as-tz-list" value={draft.timezone} onChange={(e) => setDraft({ ...draft, timezone: e.target.value })} />
        <datalist id="as-tz-list">
          {timezones.map((z) => (
            <option key={z} value={z} />
          ))}
        </datalist>
      </label>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        <label className="as-field">
          <span>Buffer (min)</span>
          <input id="set-buffer" className="as-input" type="number" min={0} step={5} value={draft.bufferMinutes} onChange={(e) => num("bufferMinutes", e.target.value)} />
        </label>
        <label className="as-field">
          <span>Plan ahead (days)</span>
          <input id="set-horizon" className="as-input" type="number" min={1} max={60} value={draft.horizonDays} onChange={(e) => num("horizonDays", e.target.value)} />
        </label>
        <label className="as-field">
          <span>Overrun (min)</span>
          <input
            id="set-overrun"
            className="as-input"
            type="number"
            min={5}
            step={5}
            value={draft.overrunExtensionMinutes}
            onChange={(e) => num("overrunExtensionMinutes", e.target.value)}
          />
        </label>
      </div>
      <p className="as-hint" style={{ margin: 0 }}>
        Buffer keeps time free around meetings. Overrun is the extra time planned when a task used its estimate but isn't done.
      </p>
      <div className="as-row">
        <button className="as-btn is-primary" disabled={p.busy} onClick={() => p.onSave(draft)}>
          Save and re-plan
        </button>
        {p.onReset &&
          (confirmReset ? (
            <>
              <button className="as-btn is-danger" onClick={p.onReset}>
                Reset sample data
              </button>
              <button className="as-btn" onClick={() => setConfirmReset(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button className="as-btn is-ghost" onClick={() => setConfirmReset(true)}>
              Reset demo…
            </button>
          ))}
      </div>
    </section>
  );
}
