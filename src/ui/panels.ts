import { EXAMPLES } from '../examples';
import { getLang, nameOf, t } from '../i18n';
import { lessonCtx, LESSONS, type Lesson } from '../lessons/lessons';
import { CATEGORIES, defOf, PARTS, type ParamDef } from '../model/library';
import { keyOf, type Part } from '../model/types';
import { fmt, fmtShort, parseValue, prefixesFor, splitValue } from '../units';
import { SPEEDS, type App } from './app';
import type { Board } from './board';
import { multimeterText } from './board';
import { Scope } from './scope';
import { symbolSvg } from './symbols';
import { canTrace } from '../sim/curves';

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document): T => root.querySelector(sel) as T;

/** The digit a 7-segment display is showing, read back from which segments are lit. */
function shownDigit(x: Record<string, number>): string {
  const bits = 'abcdefg'.split('').reduce((acc, c, i) => acc | ((x[`seg_${c}`] ?? 0) > 0.3 ? 1 << i : 0), 0);
  const i = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f].indexOf(bits);
  return bits === 0 ? '—' : i >= 0 ? String(i) : '?';
}

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const ICON: Record<string, string> = {
  new: 'M6 3h9l4 4v14H6z M14 3v5h5',
  open: 'M3 7h6l2 2h10v10H3z',
  save: 'M12 4v11 M7 10l5 5 5-5 M5 20h14',
  undo: 'M9 7L4 12l5 5 M4 12h11a5 5 0 0 1 0 10h-3',
  redo: 'M15 7l5 5-5 5 M20 12H9a5 5 0 0 0 0 10h3',
  run: 'M7 5v14l12-7z',
  pause: 'M8 5v14 M16 5v14',
  restart: 'M4 12a8 8 0 1 0 3-6.2 M4 4v5h5',
  book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z M4 19V5',
  bulb: 'M9 18h6 M10 21h4 M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z',
  scope: 'M3 5h18v14H3z M3 12h3l2-4 3 8 3-6 2 2h5',
  parts: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z',
  props: 'M4 6h10 M18 6h2 M4 12h4 M12 12h8 M4 18h12 M20 18h0 M14 4v4 M10 10v4 M16 16v4',
  plus: 'M12 5v14 M5 12h14',
  minus: 'M5 12h14',
  fit: 'M4 9V4h5 M15 4h5v5 M20 15v5h-5 M9 20H4v-5',
  rotate: 'M20 12a8 8 0 1 1-2.3-5.7 M20 4v5h-5',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13',
  copy: 'M8 8h12v12H8z M4 16V4h12',
  wrench: 'M14 6a4 4 0 0 0 5 5l-9 9-3-3 9-9a4 4 0 0 0-2-2z',
  close: 'M6 6l12 12 M18 6L6 18',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M3 12h18 M12 3c3 3 3 15 0 18 M12 3c-3 3-3 15 0 18',
};

const icon = (name: string): string =>
  `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON[name]}"/></svg>`;

/** Short beep-like pop when a part burns, made with the Web Audio API. */
function pop(): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const len = ctx.sampleRate * 0.25;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len / 8));
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = 0.35;
    src.connect(g).connect(ctx.destination);
    src.start();
    src.onended = () => ctx.close();
  } catch {
    /* sound is optional */
  }
}

export class Panels {
  private scope: Scope;
  private lesson: LessonRunner;
  private live: { el: HTMLElement; get: () => string }[] = [];
  private lastDoctor = 0;

  constructor(
    private app: App,
    private board: Board,
  ) {
    this.scope = new Scope(app);
    this.lesson = new LessonRunner(app, board, this.scope);
    this.buildToolbar();
    this.buildPalette();
    this.renderInspector();
    this.renderDoctor();
    this.buildZoombar();

    app.on('select', () => this.renderInspector());
    app.on('doc', () => {
      this.renderInspector(true);
      this.updateToolbar();
    });
    app.on('notes', () => this.renderDoctor());
    app.on('settings', () => {
      this.updateToolbar();
      this.scope.sync();
    });
    app.on('frame', () => this.frame());
    app.onDamage = () => pop();
    window.addEventListener('keydown', (e) => this.keys(e));
  }

  // ------------------------------------------------------------ toolbar

  private buildToolbar(): void {
    const el = $('#tools');
    el.innerHTML = `
      <div class="group">
        <button data-act="drawer-parts" class="mobile-only">${icon('parts')}<span>${t('palette')}</span></button>
        <button data-act="new" title="${t('new')}">${icon('new')}<span>${t('new')}</span></button>
        <button data-act="open" title="${t('open')}">${icon('open')}<span>${t('open')}</span></button>
        <button data-act="save" title="${t('save')}">${icon('save')}<span>${t('save')}</span></button>
      </div>
      <div class="group">
        <button data-act="examples" class="menu-btn">${icon('bulb')}<span>${t('examples')}</span></button>
        <button data-act="lessons" class="accent-btn">${icon('book')}<span>${t('lessons')}</span></button>
      </div>
      <div class="group">
        <button data-act="undo" title="${t('undo')} (Ctrl+Z)">${icon('undo')}</button>
        <button data-act="redo" title="${t('redo')} (Ctrl+Y)">${icon('redo')}</button>
      </div>
      <div class="group sim">
        <button data-act="run" class="run-btn"></button>
        <button data-act="restart" title="${t('restart')}">${icon('restart')}</button>
        <label class="field"><span>${t('speed')}</span>
          <select id="speed">${SPEEDS.map((s, i) => `<option value="${i}">${t(s.key)}</option>`).join('')}</select></label>
      </div>
      <div class="group toggles">
        <label class="chk"><input type="checkbox" id="opt-volt"><span>${t('voltColors')}</span></label>
        <label class="chk"><input type="checkbox" id="opt-current"><span>${t('currentDots')}</span></label>
        <label class="field"><span>${t('symbols')}</span>
          <select id="opt-std"><option value="ansi">ANSI</option><option value="iec">IEC</option></select></label>
      </div>
      <div class="group">
        <button data-act="scope" class="toggle-btn">${icon('scope')}<span>${t('scope')}</span></button>
        <button data-act="lang">${icon('globe')}<span>${t('language')}</span></button>
        <button data-act="drawer-side" class="mobile-only">${icon('props')}<span>${t('props')}</span></button>
      </div>
      <input type="file" id="file-in" accept=".nabd,.json" hidden>`;

    el.addEventListener('click', (e) => {
      const b = (e.target as Element).closest('button');
      if (b?.dataset.act) this.act(b.dataset.act, b);
    });
    $<HTMLSelectElement>('#speed').addEventListener('change', (e) => this.app.setOption('speed', Number((e.target as HTMLSelectElement).value)));
    $<HTMLInputElement>('#opt-volt').addEventListener('change', (e) => this.app.setOption('showVolt', (e.target as HTMLInputElement).checked));
    $<HTMLInputElement>('#opt-current').addEventListener('change', (e) => this.app.setOption('showCurrent', (e.target as HTMLInputElement).checked));
    $<HTMLSelectElement>('#opt-std').addEventListener('change', (e) => this.app.setOption('std', (e.target as HTMLSelectElement).value as 'ansi' | 'iec'));
    $<HTMLInputElement>('#file-in').addEventListener('change', async (e) => {
      const input = e.target as HTMLInputElement;
      const f = input.files?.[0];
      input.value = '';
      if (!f) return;
      if (await this.app.importFile(f)) {
        this.board.fit();
        toast(t('opened'));
      } else toast(t('badFile'), true);
    });
    this.updateToolbar();
  }

  private updateToolbar(): void {
    const app = this.app;
    const run = $('[data-act="run"]');
    run.innerHTML = app.running ? `${icon('pause')}<span>${t('pause')}</span>` : `${icon('run')}<span>${t('run')}</span>`;
    run.classList.toggle('is-running', app.running);
    $<HTMLButtonElement>('[data-act="undo"]').disabled = !app.canUndo;
    $<HTMLButtonElement>('[data-act="redo"]').disabled = !app.canRedo;
    $<HTMLSelectElement>('#speed').value = String(app.speed);
    $<HTMLInputElement>('#opt-volt').checked = app.showVolt;
    $<HTMLInputElement>('#opt-current').checked = app.showCurrent;
    $<HTMLSelectElement>('#opt-std').value = app.std;
    $('[data-act="scope"]').classList.toggle('on', app.scopeOpen);
  }

  private async act(a: string, btn: HTMLElement): Promise<void> {
    const app = this.app;
    switch (a) {
      case 'new':
        if (app.doc.parts.length && !(await confirmBox(t('confirmNew')))) return;
        app.load({ version: 1, title: '', parts: [], wires: [] });
        this.board.fit();
        break;
      case 'open':
        $<HTMLInputElement>('#file-in').click();
        break;
      case 'save':
        app.exportFile();
        toast(t('saved'));
        break;
      case 'examples':
        this.examplesMenu(btn);
        break;
      case 'lessons':
        this.lesson.chooser();
        break;
      case 'undo':
        app.undo();
        break;
      case 'redo':
        app.redo();
        break;
      case 'run':
        app.setRunning(!app.running);
        break;
      case 'restart':
        app.restart();
        this.scope.clear();
        break;
      case 'scope':
        app.setOption('scopeOpen', !app.scopeOpen);
        break;
      case 'lang':
        app.setLanguage(getLang() === 'ar' ? 'en' : 'ar');
        this.rebuildAll();
        break;
      case 'drawer-parts':
        document.body.classList.toggle('show-palette');
        document.body.classList.remove('show-side');
        break;
      case 'drawer-side':
        document.body.classList.toggle('show-side');
        document.body.classList.remove('show-palette');
        break;
    }
  }

  private rebuildAll(): void {
    this.buildToolbar();
    this.buildPalette();
    this.buildZoombar();
    this.renderInspector();
    this.renderDoctor();
    this.scope.build();
    this.lesson.render();
  }

  private examplesMenu(anchor: HTMLElement): void {
    const items = [1, 2, 3]
      .map((g) => {
        const list = EXAMPLES.filter((ex) => (ex.grade ?? 1) === g);
        if (!list.length) return '';
        return `<div class="menu-head">${t(`grade${g}`)}</div>${list
          .map((ex) => `<button data-ex="${ex.id}"><span>${esc(nameOf(ex))}</span>${ex.ref ? `<small>${/^\d/.test(ex.ref) ? `${t('exercise')} ` : ''}${ex.ref}</small>` : ''}</button>`)
          .join('')}`;
      })
      .join('');
    popover(anchor, `<div class="menu">${items}</div>`, (el, close) => {
      el.addEventListener('click', (e) => {
        const b = (e.target as Element).closest<HTMLElement>('[data-ex]');
        if (!b) return;
        const ex = EXAMPLES.find((x) => x.id === b.dataset.ex)!;
        this.app.load(ex.build());
        if (ex.scopeWindow) this.scope.setWindow(ex.scopeWindow);
        this.app.restart();
        this.scope.clear();
        this.board.fit();
        close();
      });
    });
  }

  // ------------------------------------------------------------ palette

  private buildPalette(): void {
    const el = $('#palette');
    const groups = CATEGORIES.map((c) => {
      const items = PARTS.filter((p) => p.cat === c.id)
        .map((p) => {
          const b = p.box;
          const pad = 6;
          const params = Object.fromEntries(p.params.map((q) => [q.key, q.def]));
          return `<button class="pitem" data-type="${p.type}" title="${esc(nameOf(p.desc))}">
            <svg class="picon" viewBox="${b.x - pad} ${b.y - pad} ${b.w + pad * 2} ${b.h + pad * 2}"><g class="sym">${symbolSvg(p.type, params, this.app.std)}</g></svg>
            <span class="pname">${esc(nameOf(p))}</span>
            <span class="psub">${esc(getLang() === 'ar' ? p.en : p.ar)}</span>
          </button>`;
        })
        .join('');
      return `<section class="pgroup"><h3>${esc(nameOf(c))}</h3><div class="pgrid">${items}</div></section>`;
    }).join('');
    el.innerHTML = `<div class="phead"><h2>${t('components')}</h2><input id="psearch" type="search" placeholder="${t('search')}" autocomplete="off"></div><div class="plist">${groups}</div>`;

    el.querySelector('.plist')!.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLElement>('.pitem');
      if (!b) return;
      const type = b.dataset.type!;
      this.app.startPlacing(this.app.placing === type ? null : type);
      document.body.classList.remove('show-palette');
    });
    $<HTMLInputElement>('#psearch').addEventListener('input', (e) => {
      const q = (e.target as HTMLInputElement).value.trim().toLowerCase();
      for (const b of el.querySelectorAll<HTMLElement>('.pitem')) {
        const d = defOf(b.dataset.type!);
        b.hidden = !!q && !`${d.ar} ${d.en}`.toLowerCase().includes(q);
      }
      for (const s of el.querySelectorAll<HTMLElement>('.pgroup')) s.hidden = ![...s.querySelectorAll<HTMLElement>('.pitem')].some((b) => !b.hidden);
    });
    this.app.on('mode', () => {
      for (const b of el.querySelectorAll<HTMLElement>('.pitem')) b.classList.toggle('active', b.dataset.type === this.app.placing);
    });
    this.app.on('settings', () => {
      for (const b of el.querySelectorAll<HTMLElement>('.pitem')) {
        const p = defOf(b.dataset.type!);
        const params = Object.fromEntries(p.params.map((q) => [q.key, q.def]));
        b.querySelector('.sym')!.innerHTML = symbolSvg(p.type, params, this.app.std);
      }
    });
  }

  private buildZoombar(): void {
    let z = document.querySelector('.zoombar');
    if (!z) {
      z = document.createElement('div');
      z.className = 'zoombar';
      $('#stage').appendChild(z);
      z.addEventListener('click', (e) => {
        const b = (e.target as Element).closest<HTMLElement>('button');
        if (!b) return;
        if (b.dataset.z === 'in') this.board.setZoom(this.board.zoom * 1.25);
        if (b.dataset.z === 'out') this.board.setZoom(this.board.zoom / 1.25);
        if (b.dataset.z === 'fit') this.board.fit();
      });
    }
    z.innerHTML = `<button data-z="in" title="${t('zoomIn')}">${icon('plus')}</button><button data-z="out" title="${t('zoomOut')}">${icon('minus')}</button><button data-z="fit" title="${t('fit')}">${icon('fit')}</button>`;
  }

  // ------------------------------------------------------------ inspector

  private inspectorKey = '';

  private renderInspector(soft = false): void {
    const app = this.app;
    const el = $('#inspector');
    const s = app.selection;
    const part = s?.kind === 'part' ? app.part(s.id) : undefined;
    // While typing in a field, a document change must not rebuild the form under the cursor.
    const key = `${app.selCount}:${s?.kind}:${s?.id}:${part ? JSON.stringify(part.params) : ''}:${app.broken.has(s?.id ?? '')}:${getLang()}:${part?.label}`;
    if (soft && key === this.inspectorKey) return;
    if (soft && el.contains(document.activeElement) && (document.activeElement as HTMLElement).tagName === 'INPUT' && key.split(':')[2] === this.inspectorKey.split(':')[2]) return;
    this.inspectorKey = key;
    this.live = [];

    if (app.selCount > 1) {
      el.innerHTML = `<h2>${t('inspector')}</h2>
        <p class="multi-count">${t('multiSelected', { parts: app.sel.parts.size, wires: app.sel.wires.size })}</p>
        <div class="actions">
          <button data-do="duplicate">${icon('copy')}<span>${t('duplicate')}</span></button>
          <button data-do="delete" class="danger">${icon('trash')}<span>${t('deleteSelected')}</span></button>
        </div>
        <p class="muted small">${t('tipMulti')}</p>`;
      el.querySelector('.actions')!.addEventListener('click', (e) => {
        const b = (e.target as Element).closest<HTMLElement>('[data-do]');
        if (b?.dataset.do === 'duplicate') this.board.duplicateSelected();
        if (b?.dataset.do === 'delete') this.board.deleteSelected();
      });
      return;
    }

    if (!s || (!part && s.kind === 'part')) {
      el.innerHTML = `<h2>${t('inspector')}</h2>
        <p class="muted">${t('nothingSelected')}</p>
        <ul class="tips"><li>${t('tipPlace')}</li><li>${t('tipWire')}</li><li>${t('tipMove')}</li><li>${t('tipBox')}</li><li>${t('tipPan')}</li><li class="kbd-tip">${t('tipKeys')}</li></ul>`;
      return;
    }

    if (s.kind === 'wire') {
      const w = app.doc.wires.find((x) => x.id === s.id);
      if (!w) return;
      el.innerHTML = `<h2>${t('wire')}</h2>
        <dl class="readings"><dt>${t('nodeVoltage')}</dt><dd data-live="v"></dd><dt>${t('current')}</dt><dd data-live="i"></dd></dl>
        <div class="actions"><button data-do="delete">${icon('trash')}<span>${t('delete')}</span></button></div>`;
      this.live.push(
        {
          el: $('[data-live="v"]', el),
          get: () => {
            const n = app.engine.net.pointNode.get(keyOf(w.a));
            return n === undefined ? '—' : fmt(app.engine.volt(n), 'V');
          },
        },
        { el: $('[data-live="i"]', el), get: () => fmt(Math.abs(app.engine.wireCurrents(app.doc).get(w.id) ?? 0), 'A') },
      );
      el.querySelector('[data-do="delete"]')!.addEventListener('click', () => this.board.deleteSelected());
      return;
    }

    const p = part!;
    const def = defOf(p.type);
    const broken = app.broken.get(p.id);
    const fields = def.params
      .filter((d) => !d.showIf || d.showIf.values.includes(String(p.params[d.showIf.key])))
      .map((d) => this.field(p, d))
      .join('');
    el.innerHTML = `
      <div class="ihead">
        <svg class="iicon" viewBox="${def.box.x - 6} ${def.box.y - 6} ${def.box.w + 12} ${def.box.h + 12}"><g class="sym">${symbolSvg(p.type, p.params, app.std)}</g></svg>
        <div><h2>${esc(nameOf(def))}</h2><div class="ilabel">${esc(p.label)}</div></div>
      </div>
      <p class="desc">${esc(nameOf(def.desc))}</p>
      ${broken ? `<div class="broken-card"><strong>${t('broken')}</strong><button data-do="repair">${icon('wrench')}<span>${t('repair')}</span></button></div>` : ''}
      <form class="params" autocomplete="off">${fields}</form>
      <h3>${t('readings')}</h3>
      <dl class="readings" id="readings"></dl>
      <div class="actions">
        ${canTrace(p.type) ? `<button data-do="curve">${icon('scope')}<span>${t('traceCurve')}</span></button>` : ''}
        <button data-do="rotate">${icon('rotate')}<span>${t('rotate')}</span></button>
        <button data-do="duplicate">${icon('copy')}<span>${t('duplicate')}</span></button>
        <button data-do="delete" class="danger">${icon('trash')}<span>${t('delete')}</span></button>
      </div>`;

    this.bindFields(el, p);
    this.buildReadings(p);
    el.querySelector('.actions')!.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLElement>('[data-do]');
      if (b?.dataset.do === 'curve') this.scope.showIv(p);
      if (b?.dataset.do === 'rotate') this.board.rotateSelected();
      if (b?.dataset.do === 'duplicate') this.board.duplicateSelected();
      if (b?.dataset.do === 'delete') this.board.deleteSelected();
    });
    el.querySelector('[data-do="repair"]')?.addEventListener('click', () => app.repair(p.id));
  }

  private field(p: Part, d: ParamDef): string {
    const id = `f-${d.key}`;
    const v = p.params[d.key];
    const lbl = `<label for="${id}">${esc(nameOf(d))}</label>`;
    if (d.kind === 'select') {
      const opts = d.options!.map((o) => `<option value="${o.v}"${String(v) === o.v ? ' selected' : ''}>${esc(nameOf(o))}</option>`).join('');
      return `<div class="frow">${lbl}<select id="${id}" data-key="${d.key}">${opts}</select></div>`;
    }
    if (d.kind === 'slider') {
      const pct = Math.round(Number(v) * 100);
      return `<div class="frow">${lbl}<div class="slider"><input type="range" id="${id}" data-key="${d.key}" min="${d.min}" max="${d.max}" step="${d.step}" value="${v}"><output>${pct}%</output></div></div>`;
    }
    // The student types only the number, then picks kilo, milli, micro... from the list.
    const prefixes = prefixesFor(d.unit);
    const { num, prefix } = splitValue(Number(v), d.unit);
    const unitPart = prefixes.length
      ? `<select class="unitsel" data-prefix-for="${d.key}" aria-label="${esc(nameOf(d))}">${prefixes
          .map((q) => `<option value="${q.factor}"${q.sym === prefix.sym ? ' selected' : ''}>${q.sym}${d.unit}${q.ar ? ` · ${esc(nameOf(q))}` : ''}</option>`)
          .join('')}</select>`
      : d.unit
        ? `<span class="unit">${d.unit}</span>`
        : '';
    const range = d.max !== undefined ? `<div class="fhint">${fmtShort(d.min ?? 0, d.unit)} – ${fmtShort(d.max, d.unit)}</div>` : '';
    return `<div class="frow">${lbl}<div class="numin"><input type="text" inputmode="decimal" id="${id}" data-key="${d.key}" value="${esc(String(num))}" dir="ltr">${unitPart}</div>${range}<div class="ferr" hidden>${t('invalidValue')}</div></div>`;
  }

  private bindFields(el: HTMLElement, p: Part): void {
    const app = this.app;
    const def = defOf(p.type);
    const form = el.querySelector('form')!;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      (document.activeElement as HTMLElement)?.blur();
    });
    for (const input of form.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-key]')) {
      const d = def.params.find((q) => q.key === input.dataset.key)!;
      if (input instanceof HTMLSelectElement) {
        input.addEventListener('change', () => app.setParam(p.id, d.key, d.options!.every((o) => /^\d+$/.test(o.v)) ? Number(input.value) : input.value));
      } else if (input.type === 'range') {
        const out = input.parentElement!.querySelector('output')!;
        input.addEventListener('input', () => {
          out.textContent = `${Math.round(Number(input.value) * 100)}%`;
          app.setParam(p.id, d.key, Number(input.value), false);
        });
        input.addEventListener('change', () => app.setParam(p.id, d.key, Number(input.value)));
      } else {
        const unitSel = input.parentElement!.querySelector<HTMLSelectElement>('.unitsel');
        const commit = () => {
          const typed = parseValue(input.value);
          // Plain digits take their unit from the list; "4.7k" typed in full still works too.
          const plain = /^\s*[+-]?[\d٠-٩۰-۹.,٫]+(e[+-]?\d+)?\s*$/i.test(input.value);
          const v = typed === null ? null : plain && unitSel ? typed * Number(unitSel.value) : typed;
          const err = input.closest('.frow')!.querySelector<HTMLElement>('.ferr')!;
          if (v === null || (d.min !== undefined && v < d.min) || (d.max !== undefined && v > d.max)) {
            err.hidden = false;
            input.classList.add('bad');
            return;
          }
          err.hidden = true;
          input.classList.remove('bad');
          if (v !== Number(p.params[d.key])) app.setParam(p.id, d.key, v);
        };
        input.addEventListener('change', commit);
        unitSel?.addEventListener('change', commit);
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') commit();
        });
      }
    }
  }

  private buildReadings(p: Part): void {
    const app = this.app;
    const dl = $('#readings');
    const rows: [string, () => string][] = [];
    const r = () => app.engine.reading(p.id);
    const two = defOf(p.type).pins.length === 2;
    const x = (k: string) => r()?.extra[k] ?? 0;
    switch (p.type) {
      case 'npn':
      case 'pnp':
        rows.push([t('vbe'), () => fmt(x('vbe'), 'V')], [t('vce'), () => fmt(x('vce'), 'V')], [t('ib'), () => fmt(x('ib'), 'A')], [t('ic'), () => fmt(x('ic'), 'A')]);
        break;
      case 'nmos':
      case 'pmos':
        rows.push([t('vgs'), () => fmt(x('vgs'), 'V')], [t('vds'), () => fmt(x('vds'), 'V')], [t('id'), () => fmt(x('id'), 'A')]);
        break;
      case 'voltmeter':
        rows.push([t('reading'), () => fmt(x('reading'), 'V')]);
        break;
      case 'ammeter':
        rows.push([t('reading'), () => fmt(x('reading'), 'A')]);
        break;
      case 'logicout':
        rows.push([t('state'), () => String(x('level'))], [t('voltage'), () => fmt(r()?.v ?? 0, 'V')]);
        break;
      case 'probe':
        rows.push([t('voltage'), () => fmt(x('v'), 'V')]);
        break;
      case 'multimeter':
        rows.push([t('reading'), () => multimeterText(String(p.params.mode), x('reading'))]);
        break;
      case 'psu':
        rows.push(
          [t('voltage'), () => fmt(Math.abs(r()?.v ?? 0), 'V')],
          [t('current'), () => fmt(x('iout'), 'A')],
          [t('mode'), () => (x('cc') ? t('modeCC') : t('modeCV'))],
        );
        break;
      case 'transformer': {
        const nv = (i: number) => {
          const d = app.engine.byId.get(p.id);
          return d ? app.engine.volt(d.nodes[i]) : 0;
        };
        rows.push(
          [t('primaryV'), () => fmt(nv(0) - nv(1), 'V')],
          [t('secondaryV'), () => fmt(nv(2) - nv(3), 'V')],
          [t('primaryI'), () => fmt(x('i1'), 'A')],
          [t('secondaryI'), () => fmt(x('i2'), 'A')],
        );
        break;
      }
      case 'scr':
      case 'triac':
        rows.push(
          [t('state'), () => (x('on') ? t('conducting') : t('blocking'))],
          [t('voltage'), () => fmt(Math.abs(r()?.v ?? 0), 'V')],
          [t('current'), () => fmt(Math.abs(r()?.i ?? 0), 'A')],
        );
        break;
      case 'timer555':
        rows.push([t('state'), () => String(x('out'))]);
        break;
      case 'dff':
      case 'jkff':
        rows.push(['Q', () => String(x('q'))]);
        break;
      case 'counter':
        rows.push([t('count'), () => String(x('count'))]);
        break;
      case 'bcd7':
        rows.push([t('bcdValue'), () => String(x('value'))]);
        break;
      case 'sevenseg':
        rows.push([t('digit'), () => shownDigit(r()?.extra ?? {})]);
        break;
      case 'bode':
        rows.push([t('cutoff'), () => this.scope.cutoffText || '—']);
        break;
      default:
        if (two || p.type === 'pot') {
          rows.push([t('voltage'), () => fmt(Math.abs(r()?.v ?? 0), 'V')], [t('current'), () => fmt(Math.abs(r()?.i ?? 0), 'A')]);
          if (!['battery', 'ac', 'funcgen', 'switch', 'button'].includes(p.type)) rows.push([t('power'), () => fmt(Math.abs(r()?.p ?? 0), 'W')]);
        } else if (defOf(p.type).pins.length > 2) {
          rows.push([t('state'), () => String(x('out'))]);
        }
        if (p.type === 'ldr') rows.push([t('resistance'), () => fmt(x('r'), 'Ω')]);
        if (p.type === 'lamp' || p.type === 'led') rows.push([t('brightness'), () => `${Math.round(Math.min(1, x('brightness')) * 100)}%`]);
    }
    if (p.type === 'logicin') rows.splice(0, rows.length, [t('state'), () => String(p.params.state)]);
    if (p.type === 'bode') dl.insertAdjacentHTML('beforebegin', `<p class="muted small">${t('bodeHint')}</p>`);
    dl.innerHTML = rows.map((_, i) => `<dt>${esc(rows[i][0])}</dt><dd data-r="${i}"></dd>`).join('');
    rows.forEach(([, get], i) => this.live.push({ el: $(`[data-r="${i}"]`, dl), get }));
  }

  // ------------------------------------------------------------ doctor

  private renderDoctor(): void {
    const el = $('#doctor');
    const notes = this.app.notes;
    const icons: Record<string, string> = { burn: '🔥', error: '⛔', warn: '⚠', info: 'ℹ' };
    const body = notes.length
      ? `<ul class="notes">${notes
          .map(
            (n, i) =>
              `<li class="note ${n.level}" data-i="${i}" tabindex="0"><span class="nicon" aria-hidden="true">${icons[n.level]}</span><span class="ntext">${esc(n.text)}</span></li>`,
          )
          .join('')}</ul>`
      : `<p class="ok">${t('doctorOk')}</p>`;
    const anyBroken = this.app.broken.size > 1;
    el.innerHTML = `<h2>${t('doctor')}${notes.length ? ` <span class="badge">${notes.length}</span>` : ''}</h2>${body}${
      anyBroken ? `<button class="repair-all" data-do="repair-all">${icon('wrench')}<span>${t('repairAll')}</span></button>` : ''
    }`;
    el.querySelectorAll<HTMLElement>('.note').forEach((li) =>
      li.addEventListener('click', () => {
        const n = this.app.notes[Number(li.dataset.i)];
        if (n?.parts[0] && this.app.part(n.parts[0])) this.app.select({ kind: 'part', id: n.parts[0] });
      }),
    );
    el.querySelector('[data-do="repair-all"]')?.addEventListener('click', () => this.app.repair());
  }

  // ------------------------------------------------------------ per frame

  private frame(): void {
    for (const l of this.live) {
      const s = l.get();
      if (l.el.textContent !== s) l.el.textContent = s;
    }
    const now = performance.now();
    if (now - this.lastDoctor > 600) {
      this.lastDoctor = now;
      const texts = [...document.querySelectorAll<HTMLElement>('#doctor .ntext')];
      this.app.notes.forEach((n, i) => {
        if (texts[i] && texts[i].textContent !== n.text) texts[i].textContent = n.text;
      });
      const st = $('#status');
      const e = this.app.engine;
      st.innerHTML = `<span class="dot ${this.app.running ? 'on' : ''}"></span>${this.app.running ? t('running') : t('paused')} · ${t('time')} <b dir="ltr">${fmt(e.t, 's')}</b>`;
    }
    this.scope.draw();
    this.lesson.check();
  }

  // ------------------------------------------------------------ keyboard

  private keys(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (ctrl && k === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.app.redo();
      else this.app.undo();
    } else if (ctrl && k === 'y') {
      e.preventDefault();
      this.app.redo();
    } else if (ctrl && k === 's') {
      e.preventDefault();
      this.app.exportFile();
    } else if (ctrl && k === 'a') {
      e.preventDefault();
      this.app.selectAll();
    } else if (ctrl && k === 'd') {
      e.preventDefault();
      this.board.duplicateSelected();
    } else if (!ctrl && (k === 'r' || k === 'ق')) this.board.rotateSelected();
    else if (k === 'delete' || k === 'backspace') this.board.deleteSelected();
    else if (k === 'escape') {
      if (!this.board.cancel()) this.app.select(null);
    } else if (k === ' ') {
      e.preventDefault();
      this.app.setRunning(!this.app.running);
    }
  }
}

// ---------------------------------------------------------------- oscilloscope

// ---------------------------------------------------------------- lessons

class LessonRunner {
  private el = $('#lesson');
  private lesson: Lesson | null = null;
  private step = 0;
  private passed = false;
  private hintShown = false;

  constructor(
    private app: App,
    private board: Board,
    private scope: Scope,
  ) {}

  chooser(): void {
    const items = [1, 2, 3]
      .map((g) => {
        const list = LESSONS.filter((l) => l.grade === g);
        if (!list.length) return '';
        return `<h3 class="grade-head">${t(`grade${g}`)}</h3>${list
          .map(
            (l) => `<button class="lesson-item" data-l="${l.id}">
        <span class="lref">${t('exercise')} ${l.ref}</span>
        <strong>${esc(nameOf(l))}</strong>
        <span class="lgoal">${esc(nameOf(l.goal))}</span>
      </button>`,
          )
          .join('')}`;
      })
      .join('');
    modal(`<h2>${t('lessons')}</h2><div class="lesson-list">${items}</div>`, (el, close) => {
      el.addEventListener('click', (e) => {
        const b = (e.target as Element).closest<HTMLElement>('[data-l]');
        if (!b) return;
        close();
        this.start(LESSONS.find((l) => l.id === b.dataset.l)!);
      });
    });
  }

  start(l: Lesson): void {
    this.lesson = l;
    this.step = 0;
    this.passed = false;
    this.hintShown = false;
    this.app.load(l.build());
    this.app.restart();
    if (l.scopeWindow) this.scope.setWindow(l.scopeWindow);
    this.app.setRunning(true);
    this.board.fit();
    this.render();
  }

  render(): void {
    const l = this.lesson;
    if (!l) {
      this.el.hidden = true;
      return;
    }
    const s = l.steps[this.step];
    const last = this.step === l.steps.length - 1;
    const canNext = !s.check || this.passed;
    this.el.hidden = false;
    this.el.innerHTML = `
      <div class="lhead">
        <span class="lref">${t('exercise')} ${l.ref}</span>
        <strong>${esc(nameOf(l))}</strong>
        <button class="icon-btn" data-ls="close" title="${t('close')}">${icon('close')}</button>
      </div>
      <div class="lprogress">${l.steps.map((_, i) => `<span class="${i < this.step ? 'done' : i === this.step ? 'now' : ''}"></span>`).join('')}</div>
      <div class="lstep">${t('step', { n: this.step + 1, total: l.steps.length })}</div>
      <p class="ltext">${esc(nameOf(s))}</p>
      ${s.hint ? (this.hintShown ? `<p class="lhint">${esc(nameOf(s.hint))}</p>` : `<button class="link" data-ls="hint">${t('hint')}</button>`) : ''}
      ${s.check ? `<div class="lcheck ${this.passed ? 'ok' : ''}">${this.passed ? t('checkDone') : t('checkWaiting')}</div>` : ''}
      <div class="lnav">
        <button data-ls="back" ${this.step === 0 ? 'disabled' : ''}>${t('back')}</button>
        <button data-ls="next" class="primary" ${canNext ? '' : 'disabled'}>${last ? t('finish') : t('next')}</button>
      </div>`;
    this.el.onclick = (e) => {
      const b = (e.target as Element).closest<HTMLElement>('[data-ls]');
      if (!b) return;
      const a = b.dataset.ls;
      if (a === 'close') this.close();
      if (a === 'hint') {
        this.hintShown = true;
        this.render();
      }
      if (a === 'back' && this.step > 0) this.go(this.step - 1);
      if (a === 'next') {
        if (last) {
          toast(t('lessonDone'));
          this.close();
        } else this.go(this.step + 1);
      }
    };
  }

  private go(i: number): void {
    this.step = i;
    this.passed = false;
    this.hintShown = false;
    this.render();
  }

  private close(): void {
    this.lesson = null;
    this.render();
  }

  check(): void {
    const s = this.lesson?.steps[this.step];
    if (!s?.check || this.passed) return;
    try {
      if (s.check(lessonCtx(this.app))) {
        this.passed = true;
        this.render();
      }
    } catch {
      /* a half-built circuit can make a check throw; just try again next frame */
    }
  }
}

// ---------------------------------------------------------------- small UI helpers

function toast(msg: string, bad = false): void {
  const el = $('#toast');
  el.textContent = msg;
  el.className = bad ? 'show bad' : 'show';
  clearTimeout((el as unknown as { _t: number })._t);
  (el as unknown as { _t: number })._t = window.setTimeout(() => (el.className = ''), 2600);
}

function modal(html: string, bind: (el: HTMLElement, close: () => void) => void): void {
  const wrap = $('#modal');
  wrap.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true"><button class="icon-btn modal-x" title="${t('close')}">${icon('close')}</button>${html}</div>`;
  wrap.hidden = false;
  const close = () => {
    wrap.hidden = true;
    wrap.innerHTML = '';
  };
  wrap.onclick = (e) => {
    if (e.target === wrap || (e.target as Element).closest('.modal-x')) close();
  };
  bind(wrap.querySelector('.modal-card')!, close);
}

function confirmBox(text: string): Promise<boolean> {
  return new Promise((resolve) => {
    modal(`<p class="confirm-text">${esc(text)}</p><div class="lnav"><button data-c="no">${t('no')}</button><button data-c="yes" class="primary">${t('yes')}</button></div>`, (el, close) => {
      el.addEventListener('click', (e) => {
        const b = (e.target as Element).closest<HTMLElement>('[data-c]');
        if (!b) return;
        close();
        resolve(b.dataset.c === 'yes');
      });
    });
  });
}

function popover(anchor: HTMLElement, html: string, bind: (el: HTMLElement, close: () => void) => void): void {
  document.querySelector('.popover')?.remove();
  const el = document.createElement('div');
  el.className = 'popover';
  el.innerHTML = html;
  document.body.appendChild(el);
  const r = anchor.getBoundingClientRect();
  const rtl = document.documentElement.dir === 'rtl';
  el.style.top = `${r.bottom + 6}px`;
  const w = el.offsetWidth;
  const left = rtl ? r.right - w : r.left;
  el.style.left = `${Math.max(8, Math.min(left, window.innerWidth - w - 8))}px`;
  const close = () => {
    el.remove();
    document.removeEventListener('pointerdown', outside, true);
  };
  const outside = (e: PointerEvent) => {
    if (!el.contains(e.target as Node) && !anchor.contains(e.target as Node)) close();
  };
  setTimeout(() => document.addEventListener('pointerdown', outside, true));
  bind(el, close);
}
