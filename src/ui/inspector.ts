import { getLang, nameOf, t } from '../i18n';
import { coerceParam, defOf, type ParamDef } from '../model/library';
import { keyOf, type Part } from '../model/types';
import { canTrace } from '../sim/wasm/engine';
import { fmt, fmtShort, parseValue, prefixesFor, splitValue } from '../units';
import type { App } from './app';
import { multimeterText, type Board } from './board';
import { $, esc, icon } from './dom';
import type { Scope } from './scope';
import { symbolSvg } from './symbols';

type Row = [label: string, get: () => string];

/** A 4-bit code as decimal and binary: 11 (1011). */
const codeText = (n: number): string => `${n} (${Math.round(n).toString(2).padStart(4, '0')})`;

/** The digit a 7-segment display is showing, read back from which segments are lit. */
function shownDigit(x: Record<string, number>): string {
  const bits = 'abcdefg'.split('').reduce((acc, c, i) => acc | ((x[`seg_${c}`] ?? 0) > 0.3 ? 1 << i : 0), 0);
  const i = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f].indexOf(bits);
  return bits === 0 ? '—' : i >= 0 ? String(i) : '?';
}

/** The properties card: what is selected, its values, and live readings. */
export class Inspector {
  private el = $('#inspector');
  private live: { el: HTMLElement; get: () => string }[] = [];
  private key = '';

  constructor(
    private app: App,
    private board: Board,
    private scope: Scope,
  ) {
    app.on('select', () => this.render());
    app.on('doc', () => this.render(true));
    this.render();
  }

  /** Called every frame: refresh only the numbers. */
  tick(): void {
    for (const l of this.live) {
      const s = l.get();
      if (l.el.textContent !== s) l.el.textContent = s;
    }
  }

  render(soft = false): void {
    const app = this.app;
    const el = this.el;
    const s = app.selection;
    const part = s?.kind === 'part' ? app.part(s.id) : undefined;
    // While typing in a field, a document change must not rebuild the form under the cursor.
    const key = `${app.selCount}|${s?.kind}|${s?.id}|${part ? JSON.stringify(part.params) : ''}|${app.broken.has(s?.id ?? '')}|${getLang()}|${part?.label}|${app.std}`;
    if (soft && key === this.key) return;
    const typing = el.contains(document.activeElement) && (document.activeElement as HTMLElement).tagName === 'INPUT';
    if (soft && typing && key.split('|')[2] === this.key.split('|')[2]) return;
    this.key = key;
    this.live = [];

    if (app.selCount > 1) return this.renderMany();
    if (!s || (!part && s.kind === 'part')) return this.renderEmpty();
    if (s.kind === 'wire') return this.renderWire(s.id);
    this.renderPart(part!);
  }

  private renderEmpty(): void {
    const tips: [string, string][] = [
      ['parts', 'tipPlace'],
      ['bolt', 'tipWire'],
      ['grid', 'tipBox'],
      ['eye', 'tipPan'],
      ['keyboard', 'tipKeys'],
    ];
    this.el.innerHTML = `
      <header class="card-head"><h2>${t('inspector')}</h2></header>
      <p class="muted">${t('nothingSelected')}</p>
      <ul class="tips">${tips.map(([ic, k]) => `<li>${icon(ic)}<span>${t(k)}</span></li>`).join('')}</ul>`;
  }

  private renderMany(): void {
    const app = this.app;
    this.el.innerHTML = `
      <header class="card-head"><h2>${t('inspector')}</h2></header>
      <div class="multi">
        <div class="multi-num"><b>${app.sel.parts.size}</b><span>${t('partsWord')}</span></div>
        <div class="multi-num"><b>${app.sel.wires.size}</b><span>${t('wiresWord')}</span></div>
      </div>
      <div class="actions">
        <button class="btn" data-do="duplicate">${icon('copy')}<span>${t('duplicate')}</span></button>
        <button class="btn danger" data-do="delete">${icon('trash')}<span>${t('deleteSelected')}</span></button>
      </div>
      <p class="muted small">${t('tipMulti')}</p>`;
    this.bindActions();
  }

  private renderWire(id: string): void {
    const app = this.app;
    const w = app.doc.wires.find((x) => x.id === id);
    if (!w) return;
    this.el.innerHTML = `
      <header class="card-head"><h2>${t('wire')}</h2></header>
      <div class="tiles" id="readings"></div>
      <div class="actions"><button class="btn danger" data-do="delete">${icon('trash')}<span>${t('delete')}</span></button></div>`;
    this.fillTiles([
      [
        t('nodeVoltage'),
        () => {
          const n = app.engine.net.pointNode.get(keyOf(w.a));
          return n === undefined ? '—' : fmt(app.engine.volt(n), 'V');
        },
      ],
      [t('current'), () => fmt(Math.abs(app.engine.wireCurrents(app.doc).get(w.id) ?? 0), 'A')],
    ]);
    this.bindActions();
  }

  private renderPart(p: Part): void {
    const app = this.app;
    const def = defOf(p.type);
    const broken = app.broken.get(p.id);
    const fields = def.params
      .filter((d) => !d.showIf || d.showIf.values.includes(String(p.params[d.showIf.key])))
      .map((d) => this.field(p, d))
      .join('');
    const b = def.box;
    this.el.innerHTML = `
      <header class="part-head">
        <div class="part-icon"><svg viewBox="${b.x - 6} ${b.y - 6} ${b.w + 12} ${b.h + 12}"><g class="sym">${symbolSvg(p.type, p.params, app.std)}</g></svg></div>
        <div class="part-title"><h2>${esc(nameOf(def))}</h2><span class="part-label">${esc(p.label)}</span></div>
      </header>
      <p class="desc">${esc(nameOf(def.desc))}</p>
      ${broken ? `<div class="broken-card">${icon('flame')}<strong>${t('broken')}</strong><button class="btn small" data-do="repair">${icon('wrench')}<span>${t('repair')}</span></button></div>` : ''}
      ${fields ? `<form class="params" autocomplete="off">${fields}</form>` : ''}
      <h3 class="section-title">${t('readings')}</h3>
      <div class="tiles" id="readings"></div>
      <div class="actions">
        ${canTrace(p.type) ? `<button class="btn" data-do="curve">${icon('scope')}<span>${t('traceCurve')}</span></button>` : ''}
        <button class="btn icon-only" data-do="rotate" title="${t('rotate')} (R)">${icon('rotate')}</button>
        <button class="btn icon-only" data-do="duplicate" title="${t('duplicate')} (Ctrl+D)">${icon('copy')}</button>
        <button class="btn icon-only danger" data-do="delete" title="${t('delete')} (Delete)">${icon('trash')}</button>
      </div>`;
    this.bindFields(p);
    this.fillTiles(this.readings(p));
    if (p.type === 'bode') $('#readings', this.el).insertAdjacentHTML('beforebegin', `<p class="muted small">${t('bodeHint')}</p>`);
    this.bindActions(p);
  }

  private bindActions(p?: Part): void {
    this.el.querySelectorAll<HTMLElement>('[data-do]').forEach((b) =>
      b.addEventListener('click', () => {
        const a = b.dataset.do;
        if (a === 'curve' && p) this.scope.showIv(p);
        if (a === 'rotate') this.board.rotateSelected();
        if (a === 'duplicate') this.board.duplicateSelected();
        if (a === 'delete') this.board.deleteSelected();
        if (a === 'repair' && p) this.app.repair(p.id);
      }),
    );
  }

  private fillTiles(rows: Row[]): void {
    const box = $('#readings', this.el);
    box.innerHTML = rows.map(([label], i) => `<div class="tile"><span>${esc(label)}</span><b data-r="${i}" dir="ltr">—</b></div>`).join('');
    rows.forEach(([, get], i) => this.live.push({ el: $(`[data-r="${i}"]`, box), get }));
    this.tick();
  }

  // ------------------------------------------------------------ fields

  private field(p: Part, d: ParamDef): string {
    const id = `f-${d.key}`;
    const v = p.params[d.key];
    const lbl = `<label for="${id}">${esc(nameOf(d))}</label>`;
    if (d.kind === 'select') {
      const opts = d.options!.map((o) => `<option value="${o.v}"${String(v) === o.v ? ' selected' : ''}>${esc(nameOf(o))}</option>`).join('');
      return `<div class="frow">${lbl}<select class="select" id="${id}" data-key="${d.key}">${opts}</select></div>`;
    }
    if (d.kind === 'slider') {
      const pct = Math.round(Number(v) * 100);
      return `<div class="frow">${lbl}<div class="slider"><input type="range" id="${id}" data-key="${d.key}" min="${d.min}" max="${d.max}" step="${d.step}" value="${v}"><output>${pct}%</output></div></div>`;
    }
    // The student types only the number, then picks kilo, milli, micro... from the list.
    const prefixes = prefixesFor(d.unit);
    const { num, prefix } = splitValue(Number(v), d.unit);
    const unitPart = prefixes.length
      ? `<select class="unitsel" aria-label="${esc(nameOf(d))}">${prefixes
          .map((q) => `<option value="${q.factor}"${q.sym === prefix.sym ? ' selected' : ''}>${q.sym}${d.unit}${q.ar ? ` · ${esc(nameOf(q))}` : ''}</option>`)
          .join('')}</select>`
      : d.unit
        ? `<span class="unit">${d.unit}</span>`
        : '';
    const range = d.max !== undefined ? `<div class="fhint">${fmtShort(d.min ?? 0, d.unit)} – ${fmtShort(d.max, d.unit)}</div>` : '';
    return `<div class="frow">${lbl}<div class="numin"><input type="text" inputmode="decimal" id="${id}" data-key="${d.key}" value="${esc(String(num))}" dir="ltr">${unitPart}</div>${range}<div class="ferr" hidden>${t('invalidValue')}</div></div>`;
  }

  private bindFields(p: Part): void {
    const app = this.app;
    const def = defOf(p.type);
    const form = this.el.querySelector('form');
    if (!form) return;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      (document.activeElement as HTMLElement)?.blur();
    });
    for (const input of form.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-key]')) {
      const d = def.params.find((q) => q.key === input.dataset.key)!;
      if (input instanceof HTMLSelectElement) {
        input.addEventListener('change', () => app.setParam(p.id, d.key, coerceParam(d, input.value)));
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
          const bad = v === null || (d.min !== undefined && v < d.min) || (d.max !== undefined && v > d.max);
          err.hidden = !bad;
          input.classList.toggle('bad', bad);
          if (!bad && v !== Number(p.params[d.key])) app.setParam(p.id, d.key, v!);
        };
        input.addEventListener('change', commit);
        unitSel?.addEventListener('change', commit);
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') commit();
        });
      }
    }
  }

  // ------------------------------------------------------------ readings

  private readings(p: Part): Row[] {
    const app = this.app;
    const r = () => app.engine.reading(p.id);
    const x = (k: string) => r()?.extra[k] ?? 0;
    const node = (i: number) => {
      const d = app.engine.byId.get(p.id);
      return d ? app.engine.volt(d.nodes[i]) : 0;
    };
    const v = () => fmt(Math.abs(r()?.v ?? 0), 'V');
    const i = () => fmt(Math.abs(r()?.i ?? 0), 'A');
    switch (p.type) {
      case 'npn':
      case 'pnp':
        return [
          [t('vbe'), () => fmt(x('vbe'), 'V')],
          [t('vce'), () => fmt(x('vce'), 'V')],
          [t('ib'), () => fmt(x('ib'), 'A')],
          [t('ic'), () => fmt(x('ic'), 'A')],
        ];
      case 'nmos':
      case 'pmos':
        return [
          [t('vgs'), () => fmt(x('vgs'), 'V')],
          [t('vds'), () => fmt(x('vds'), 'V')],
          [t('id'), () => fmt(x('id'), 'A')],
        ];
      case 'voltmeter':
        return [[t('reading'), () => fmt(x('reading'), 'V')]];
      case 'ammeter':
        return [[t('reading'), () => fmt(x('reading'), 'A')]];
      case 'multimeter':
        return [[t('reading'), () => multimeterText(String(p.params.mode), x('reading'))]];
      case 'logicin':
        return [[t('state'), () => String(p.params.state)]];
      case 'logicout':
        return [
          [t('state'), () => String(x('level'))],
          [t('voltage'), () => fmt(r()?.v ?? 0, 'V')],
        ];
      case 'probe':
        return [[t('voltage'), () => fmt(x('v'), 'V')]];
      case 'psu':
        return [
          [t('voltage'), v],
          [t('current'), () => fmt(x('iout'), 'A')],
          [t('mode'), () => (x('cc') ? t('modeCC') : t('modeCV'))],
        ];
      case 'transformer':
        return [
          [t('primaryV'), () => fmt(node(0) - node(1), 'V')],
          [t('secondaryV'), () => fmt(node(2) - node(3), 'V')],
          [t('primaryI'), () => fmt(x('i1'), 'A')],
          [t('secondaryI'), () => fmt(x('i2'), 'A')],
        ];
      case 'scr':
      case 'triac':
        return [
          [t('state'), () => (x('on') ? t('conducting') : t('blocking'))],
          [t('voltage'), v],
          [t('current'), i],
        ];
      case 'timer555':
        return [[t('state'), () => String(x('out'))]];
      case 'dff':
      case 'jkff':
        return [['Q', () => String(x('q'))]];
      case 'counter':
        return [[t('count'), () => String(x('count'))]];
      case 'bcd7':
        return [[t('bcdValue'), () => String(x('value'))]];
      case 'sevenseg':
      case 'lcd7':
        return [[t('digit'), () => shownDigit(r()?.extra ?? {})]];
      case 'aswitch':
        return [[t('connectedTo'), () => (x('sel') ? 'A' : 'B')]];
      case 'irrx':
        return [
          [t('current'), () => fmt(x('light'), 'A')],
          [t('voltage'), v],
        ];
      case 'opamp':
        return [
          [t('vdiff'), () => fmt(x('vd'), 'V')],
          [t('outV'), () => fmt(node(2), 'V')],
        ];
      case 'adc':
        return [[t('code'), () => codeText(x('code'))]];
      case 'dac':
        return [
          [t('code'), () => codeText(x('code'))],
          [t('outV'), () => fmt(x('vout'), 'V')],
        ];
      case 'bode':
        return [[t('cutoff'), () => this.scope.cutoffText || '—']];
    }
    const rows: Row[] = [];
    const pins = defOf(p.type).pins.length;
    if (pins === 2 || p.type === 'pot') {
      rows.push([t('voltage'), v], [t('current'), i]);
      if (!['battery', 'ac', 'funcgen', 'switch', 'button'].includes(p.type)) rows.push([t('power'), () => fmt(Math.abs(r()?.p ?? 0), 'W')]);
    } else if (pins > 2) rows.push([t('state'), () => String(x('out'))]);
    if (p.type === 'ldr') rows.push([t('resistance'), () => fmt(x('r'), 'Ω')]);
    if (p.type === 'lamp' || p.type === 'led') rows.push([t('brightness'), () => `${Math.round(Math.min(1, x('brightness')) * 100)}%`]);
    return rows;
  }
}
