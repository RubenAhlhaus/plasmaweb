/**
 * Predicates on `linuxcnc_status` `payload`.
 *
 * Strict direction/flood checks (`payloadSpindle0Reverse`, …) only work when the backend fills
 * `spindle[n].direction` / `speed` and `io.flood` like LinuxCNC `stat`. Many setups leave zeros
 * there long-term or drive coolant only via `dout` — then **delta predicates** help (snapshot before/after click).
 */
type StatusPayload = Record<string, unknown>;

function asFiniteNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function normalizeSpindleEntry(s: unknown): Record<string, unknown> | undefined {
  if (s !== null && typeof s === 'object' && !Array.isArray(s)) {
    return s as Record<string, unknown>;
  }
  if (Array.isArray(s) && s.length >= 2) {
    const a = asFiniteNumber(s[0]);
    const b = asFiniteNumber(s[1]);
    if (a === undefined || b === undefined) return undefined;
    const ad = Math.abs(a);
    const bd = Math.abs(b);
    if (ad <= 2 && bd > 2) return { direction: a, speed: b };
    if (bd <= 2 && ad > 2) return { direction: b, speed: a };
    return { speed: a, direction: b };
  }
  return undefined;
}

function allSpindleEntries(payload: StatusPayload): Record<string, unknown>[] {
  const raw = payload.spindle;
  const out: Record<string, unknown>[] = [];
  if (!Array.isArray(raw)) {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const o = raw as Record<string, unknown>;
      const z = o['0'];
      const n = normalizeSpindleEntry(z);
      if (n) out.push(n);
    }
    return out;
  }
  for (const item of raw) {
    const n = normalizeSpindleEntry(item);
    if (n) out.push(n);
  }
  return out;
}

/** Spindle runs reverse — when `stat.spindle` reflects it. */
export function payloadSpindle0Reverse(payload: StatusPayload): boolean {
  return allSpindleEntries(payload).some((sp) => {
    const dir = asFiniteNumber(sp.direction);
    if (dir === -1) return true;
    const speed = asFiniteNumber(sp.speed);
    return speed !== undefined && speed < -0.01;
  });
}

/** Spindle stopped — when all entries are near zero. */
export function payloadSpindle0Stopped(payload: StatusPayload): boolean {
  const entries = allSpindleEntries(payload);
  if (entries.length === 0) return false;
  return entries.every((sp) => {
    const speed = asFiniteNumber(sp.speed);
    const dir = asFiniteNumber(sp.direction);
    const speedStopped = speed === undefined || Math.abs(speed) < 0.5;
    const dirStopped = dir === undefined || dir === 0;
    return speedStopped && dirStopped;
  });
}

/** Spindle runs forward — when `stat.spindle` reflects it. */
export function payloadSpindle0Forward(payload: StatusPayload): boolean {
  return allSpindleEntries(payload).some((sp) => {
    const dir = asFiniteNumber(sp.direction);
    if (dir === 1) return true;
    const speed = asFiniteNumber(sp.speed);
    return speed !== undefined && speed > 0.01;
  });
}

function readFlood(io: unknown): boolean | number | undefined {
  if (typeof io !== 'object' || io === null) return undefined;
  const flood = (io as Record<string, unknown>).flood;
  if (typeof flood === 'boolean') return flood;
  if (typeof flood === 'number' && Number.isFinite(flood)) return flood;
  if (typeof flood === 'string' && flood.trim() !== '') {
    const n = Number(flood);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/** Coolant on/off — when `io.flood` is set. */
export function payloadIoFlood(on: boolean): (payload: StatusPayload) => boolean {
  return (payload) => {
    const f = readFlood(payload.io);
    if (f === undefined) return false;
    if (typeof f === 'boolean') return on ? f : !f;
    return on ? f !== 0 : f === 0;
  };
}

/** JSON of spindle list — for delta comparison. */
export function snapshotSpindle(payload: StatusPayload): string {
  return JSON.stringify(payload.spindle ?? null);
}

/**
 * IO without long din/dout arrays (often noisy), for delta after flood click.
 */
export function snapshotIoSlim(payload: StatusPayload): string {
  const io = payload.io;
  if (typeof io !== 'object' || io === null) return '';
  const o = { ...(io as Record<string, unknown>) };
  delete o.din;
  delete o.dout;
  return JSON.stringify(o);
}

export function payloadSpindleChanged(sinceJson: string): (payload: StatusPayload) => boolean {
  return (p) => snapshotSpindle(p) !== sinceJson;
}

export function payloadIoSlimChanged(sinceJson: string): (payload: StatusPayload) => boolean {
  return (p) => snapshotIoSlim(p) !== sinceJson;
}
