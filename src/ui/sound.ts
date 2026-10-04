/**
 * Sounds of the virtual lab, made with the Web Audio API (no sound files, works offline):
 * speakers play the pitch the circuit really produces, buzzers beep, switches click,
 * burnt parts crackle. One switch in the View menu turns all of it off.
 */
import type { App } from './app';

interface Voice {
  osc: OscillatorNode;
  gain: GainNode;
}

/** Pitch of an active buzzer, as on a typical 5 V piezo buzzer. */
const BUZZER_HZ = 2700;
/** Human hearing, roughly; a speaker driven outside it stays silent. */
const AUDIBLE: [number, number] = [20, 16000];
/** Gain changes glide over this many seconds so tones never click. */
const GLIDE = 0.03;

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private voices = new Map<string, Voice>();

  constructor(private readonly app: App) {
    // Browsers only allow sound after a real gesture; for touch that is the finger lifting,
    // so listen to all of them until the audio is actually running.
    const events = ['pointerdown', 'pointerup', 'touchend', 'keydown'] as const;
    const unlock = () => {
      if (this.ensure()?.state === 'running') for (const ev of events) window.removeEventListener(ev, unlock, true);
    };
    for (const ev of events) window.addEventListener(ev, unlock, true);
    document.addEventListener('visibilitychange', () => this.update());
  }

  private ensure(): AudioContext | null {
    if (!this.ctx) {
      try {
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new Ctx();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.8;
        this.master.connect(this.ctx.destination);
      } catch {
        return null;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private on(): boolean {
    return this.app.sound && !document.hidden;
  }

  /** Called every frame: follow each speaker and buzzer on the board. */
  update(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    // Coming back from the background can leave the audio suspended.
    if (ctx.state === 'suspended' && this.on()) void ctx.resume().catch(() => {});
    const app = this.app;
    const live = new Set<string>();
    const playing = this.on() && app.running && !app.engine?.failure;
    for (const p of app.doc.parts) {
      if (p.type !== 'speaker' && p.type !== 'buzzer') continue;
      live.add(p.id);
      let freq = 0;
      let level = 0;
      if (playing && !app.broken.has(p.id)) {
        const x = app.engine.byId.get(p.id)?.extra() ?? {};
        if (p.type === 'speaker') {
          freq = x.f ?? 0;
          level = freq >= AUDIBLE[0] && freq <= AUDIBLE[1] ? 0.3 * (x.loud ?? 0) : 0;
        } else {
          freq = BUZZER_HZ;
          level = 0.05 * (x.loud ?? 0);
        }
      }
      const v = this.voice(p.id, p.type === 'buzzer' ? 'square' : 'sine');
      const now = ctx.currentTime;
      if (freq > 0) v.osc.frequency.setTargetAtTime(freq, now, GLIDE / 3);
      v.gain.gain.setTargetAtTime(level, now, GLIDE);
    }
    for (const [id, v] of this.voices) {
      if (live.has(id)) continue;
      v.gain.gain.setTargetAtTime(0, ctx.currentTime, GLIDE);
      v.osc.stop(ctx.currentTime + 0.2);
      this.voices.delete(id);
    }
  }

  private voice(id: string, type: OscillatorType): Voice {
    let v = this.voices.get(id);
    if (!v) {
      const ctx = this.ctx!;
      const osc = ctx.createOscillator();
      osc.type = type;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain).connect(this.master!);
      osc.start();
      v = { osc, gain };
      this.voices.set(id, v);
    }
    return v;
  }

  /** Short crackle when a part burns. */
  pop(): void {
    const ctx = this.on() ? this.ensure() : null;
    if (!ctx || !this.master) return;
    const len = Math.floor(ctx.sampleRate * 0.25);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len / 8));
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = 0.4;
    src.connect(g).connect(this.master);
    src.start();
  }

  /** Mechanical click of a switch or push button. */
  click(): void {
    const ctx = this.on() ? this.ensure() : null;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1800, t);
    osc.frequency.exponentialRampToValueAtTime(400, t + 0.03);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.08, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.05);
  }

  /** A bright two-note chime for a finished step or a new badge. */
  chime(): void {
    const ctx = this.on() ? this.ensure() : null;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    [880, 1318.5].forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = f;
      const g = ctx.createGain();
      const t0 = t + i * 0.11;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.12, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.45);
      osc.connect(g).connect(this.master!);
      osc.start(t0);
      osc.stop(t0 + 0.5);
    });
  }
}
