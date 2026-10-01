/**
 * What the student has achieved, kept on this device (browser storage, or the app's own data
 * folder in the installed app). Nothing is sent anywhere.
 */
const KEY = 'nabd.progress';

interface Saved {
  version: 1;
  /** Badge id → time it was earned (ms since 1970). */
  badges: Record<string, number>;
  /** Lesson id → time it was finished. */
  lessons: Record<string, number>;
  /** Example ids opened at least once. */
  examples: string[];
  /** Repair challenge id → best stars (1–3). */
  challenges: Record<string, number>;
}

const isRecord = (v: unknown): v is Record<string, number> => typeof v === 'object' && v !== null && !Array.isArray(v);

export class ProgressStore {
  private data: Saved = { version: 1, badges: {}, lessons: {}, examples: [], challenges: {} };
  private listeners: ((badge: string) => void)[] = [];

  constructor() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Saved> | null;
      if (raw && typeof raw === 'object') {
        this.data = {
          version: 1,
          badges: isRecord(raw.badges) ? raw.badges : {},
          lessons: isRecord(raw.lessons) ? raw.lessons : {},
          examples: Array.isArray(raw.examples) ? raw.examples.filter((x) => typeof x === 'string') : [],
          challenges: isRecord(raw.challenges) ? raw.challenges : {},
        };
      }
    } catch {
      /* unreadable progress starts fresh */
    }
  }

  private save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* storage may be full or blocked; progress just won't persist */
    }
  }

  /** Called with the id of every newly earned badge. */
  onUnlock(fn: (badge: string) => void): void {
    this.listeners.push(fn);
  }

  has(badge: string): boolean {
    return badge in this.data.badges;
  }

  earnedAt(badge: string): number | undefined {
    return this.data.badges[badge];
  }

  /** Award a badge once. Returns true the first time. */
  unlock(badge: string): boolean {
    if (this.has(badge)) return false;
    this.data.badges[badge] = Date.now();
    this.save();
    for (const fn of this.listeners) fn(badge);
    return true;
  }

  lessonDone(id: string): void {
    this.data.lessons[id] ??= Date.now();
    this.save();
  }

  lessonsDone(): string[] {
    return Object.keys(this.data.lessons);
  }

  exampleOpened(id: string): void {
    if (!this.data.examples.includes(id)) this.data.examples.push(id);
    this.save();
  }

  /** Keep the best result of a repair challenge. */
  challengeDone(id: string, stars: number): void {
    this.data.challenges[id] = Math.max(this.data.challenges[id] ?? 0, stars);
    this.save();
  }

  challengeStars(id: string): number {
    return this.data.challenges[id] ?? 0;
  }

  challengesDone(): string[] {
    return Object.keys(this.data.challenges);
  }

  examplesOpened(): number {
    return this.data.examples.length;
  }
}
