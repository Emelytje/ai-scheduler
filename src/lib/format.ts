import { TZDate } from "@date-fns/tz";

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = tz + JSON.stringify(opts);
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, ...opts });
    fmtCache.set(key, f);
  }
  return f;
}

export const fmtTime = (t: string | number, tz: string) =>
  fmt(tz, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t));

export const fmtDay = (t: string | number, tz: string) =>
  fmt(tz, { weekday: "short", day: "numeric", month: "short" }).format(new Date(t));

export const fmtWeekday = (t: string | number, tz: string) => fmt(tz, { weekday: "short" }).format(new Date(t));

export const fmtDayNum = (t: string | number, tz: string) => fmt(tz, { day: "numeric" }).format(new Date(t));

export const fmtMonth = (t: string | number, tz: string) => fmt(tz, { month: "long", year: "numeric" }).format(new Date(t));

export const fmtDateTime = (t: string | number, tz: string) => `${fmtDay(t, tz)}, ${fmtTime(t, tz)}`;

export function fmtDuration(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

/** Midnight (local to tz) of the day containing t, as epoch ms. */
export function startOfLocalDay(t: number, tz: string): number {
  const d = new TZDate(t, tz);
  return new TZDate(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, tz).getTime();
}

export function addLocalDays(t: number, days: number, tz: string): number {
  const d = new TZDate(t, tz);
  return new TZDate(d.getFullYear(), d.getMonth(), d.getDate() + days, d.getHours(), d.getMinutes(), 0, tz).getTime();
}

export function startOfLocalWeek(t: number, tz: string): number {
  const day = new TZDate(t, tz).getDay();
  return startOfLocalDay(addLocalDays(t, -((day + 6) % 7), tz), tz);
}

/** Minutes since local midnight. */
export function localMinutes(t: number, tz: string): number {
  const d = new TZDate(t, tz);
  return d.getHours() * 60 + d.getMinutes();
}

export function localWeekday(t: number, tz: string): number {
  return new TZDate(t, tz).getDay();
}

export function sameLocalDay(a: number, b: number, tz: string): boolean {
  return startOfLocalDay(a, tz) === startOfLocalDay(b, tz);
}

/** ISO instant → value for <input type="datetime-local"> in tz. */
export function toLocalInput(iso: string | null, tz: string): string {
  if (!iso) return "";
  const d = new TZDate(new Date(iso).getTime(), tz);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** <input type="datetime-local"> value in tz → ISO instant. */
export function fromLocalInput(value: string, tz: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  return new Date(new TZDate(y, mo - 1, d, h, mi, 0, tz).getTime()).toISOString();
}
