import { LED_COLORS } from '../model/library';
import type { ParamValue } from '../model/types';

export type SymbolStd = 'ansi' | 'iec';

const L = (x1: number, y1: number, x2: number, y2: number, extra = ''): string =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"${extra}/>`;
const P = (d: string, extra = ''): string => `<path d="${d}"${extra}/>`;
const C = (cx: number, cy: number, r: number, extra = ''): string => `<circle cx="${cx}" cy="${cy}" r="${r}"${extra}/>`;
/** Rotation of the part being drawn, so text inside a symbol can stay upright. */
let turn = 0;
const T = (x: number, y: number, s: string, extra = ''): string => {
  const up = turn ? ` transform="rotate(${-turn * 90} ${x} ${y - 5})"` : '';
  return `<text x="${x}" y="${y}" class="sym-text"${extra}${up}>${s}</text>`;
};

/** Filled arrowhead with its tip at (x2,y2), pointing from (x1,y1). */
function arrowHead(x1: number, y1: number, x2: number, y2: number, size = 7): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const bx = x2 - ux * size;
  const by = y2 - uy * size;
  const px = -uy * size * 0.5;
  const py = ux * size * 0.5;
  const f = (n: number) => n.toFixed(1);
  return `<polygon class="fill" points="${f(x2)},${f(y2)} ${f(bx + px)},${f(by + py)} ${f(bx - px)},${f(by - py)}"/>`;
}

const leads = (a = 20): string => L(-40, 0, -a, 0) + L(a, 0, 40, 0);

function resistorBody(std: SymbolStd): string {
  if (std === 'iec') return `<rect class="heat" x="-20" y="-8" width="40" height="16" rx="1"/>`;
  return (
    `<rect class="heat" x="-20" y="-8" width="40" height="16" rx="3" stroke="none"/>` +
    P('M-20 0 L-17 -8 L-10 8 L-3 -8 L3 8 L10 -8 L17 8 L20 0', ' fill="none"')
  );
}

function diodeBody(extra = ''): string {
  return `<polygon class="fill" points="-10,-10 -10,10 10,0"/>` + L(-40, 0, -10, 0) + L(10, 0, 40, 0) + extra;
}

function gateBody(type: string, std: SymbolStd): string {
  const inv = ['nand', 'nor', 'not', 'xnor'].includes(type);
  const single = type === 'not';
  const inputs = single ? L(-40, 0, -22, 0) : L(-40, -20, -22, -20) + L(-40, 20, -22, 20);
  if (std === 'iec') {
    const sym: Record<string, string> = { and: '&amp;', nand: '&amp;', or: '≥1', nor: '≥1', not: '1', xor: '=1', xnor: '=1' };
    const out = inv ? C(26, 0, 4, ' class="bg"') + L(30, 0, 40, 0) : L(22, 0, 40, 0);
    return `<rect class="bg" x="-22" y="-28" width="44" height="56" rx="2"/>` + inputs + out + T(0, 6, sym[type], ' class="sym-text big"');
  }
  let body: string;
  let tip = 28;
  if (type === 'and' || type === 'nand') body = P('M-22 -26 H2 A26 26 0 0 1 2 26 H-22 Z', ' class="bg"');
  else if (type === 'not') {
    body = P('M-22 -18 L16 0 L-22 18 Z', ' class="bg"');
    tip = 16;
  } else {
    body = P('M-26 -26 Q4 -26 28 0 Q4 26 -26 26 Q-12 0 -26 -26 Z', ' class="bg"');
    if (type === 'xor' || type === 'xnor') body += P('M-33 -26 Q-19 0 -33 26', ' fill="none"');
  }
  const out = inv ? C(tip + 4, 0, 4, ' class="bg"') + L(tip + 8, 0, 40, 0) : L(tip, 0, 40, 0);
  return inputs + body + out;
}


/** Two small arrows pointing at (x, y) from the upper left: light falling on a sensor. */
function lightIn(x: number, y: number): string {
  return L(x - 14, y - 16, x - 4, y - 6) + arrowHead(x - 14, y - 16, x - 3, y - 5, 6) + L(x - 2, y - 18, x + 8, y - 8) + arrowHead(x - 2, y - 18, x + 9, y - 7, 6);
}

/** Clock input triangle on the left edge of an IC body. */
const clockMark = (x: number, y: number): string => `<polyline points="${x},${y - 6} ${x + 8},${y} ${x},${y + 6}" fill="none"/>`;

/** Q̄ drawn as Q with a bar over it. */
const qBar = (x: number, y: number): string => T(x, y, 'Q', ' class="sym-text tiny"') + L(x - 4, y - 10, x + 4, y - 10, ' stroke-width="1.2"');

const SEG_SHAPES: Record<string, [number, number, number, number]> = {
  a: [-3, -33, 26, 5],
  b: [23, -29, 5, 26],
  c: [23, 3, 5, 26],
  d: [-3, 28, 26, 5],
  e: [-7, 3, 5, 26],
  f: [-7, -29, 5, 26],
  g: [-3, -2.5, 26, 5],
};

function icBox(x0: number, y0: number, w: number, h: number, title: string): string {
  return `<rect class="bg ic" x="${x0}" y="${y0}" width="${w}" height="${h}" rx="3"/>` + T(x0 + w / 2, y0 + h / 2 + 5, title, ' class="sym-text ictitle"');
}

/** SVG for a part in its own coordinates (before rotation). Colours come from CSS. */
export function symbolSvg(type: string, params: Record<string, ParamValue>, std: SymbolStd, rot = 0): string {
  turn = rot % 4;
  switch (type) {
    case 'resistor':
      return leads() + resistorBody(std);
    case 'pot':
      return leads() + resistorBody(std) + L(0, -40, 0, -16) + arrowHead(0, -24, 0, -10);
    case 'capacitor':
      return L(-40, 0, -5, 0) + L(5, 0, 40, 0) + L(-5, -14, -5, 14, ' class="plate"') + L(5, -14, 5, 14, ' class="plate"');
    case 'ecap':
      return (
        L(-40, 0, -5, 0) +
        L(3, 0, 40, 0) +
        L(-5, -14, -5, 14, ' class="plate"') +
        P('M9 -14 Q1 0 9 14', ' fill="none" class="plate"') +
        T(-16, -8, '+', ' class="sym-text small"')
      );
    case 'inductor':
      if (std === 'iec') return leads() + `<rect class="fill" x="-20" y="-6" width="40" height="12"/>`;
      return P('M-40 0 H-20 a5 5 0 0 1 10 0 a5 5 0 0 1 10 0 a5 5 0 0 1 10 0 a5 5 0 0 1 10 0 H40', ' fill="none"');
    case 'battery':
      return (
        L(0, -40, 0, -6) +
        L(-16, -6, 16, -6, ' class="plate"') +
        L(-8, 6, 8, 6, ' class="plate thick"') +
        L(0, 6, 0, 40) +
        T(-14, -12, '+', ' class="sym-text small"')
      );
    case 'ac':
      return L(0, -40, 0, -18) + L(0, 18, 0, 40) + C(0, 0, 18, ' class="bg"') + P('M-10 0 C-7 -11 -3 -11 0 0 C3 11 7 11 10 0', ' fill="none"');
    case 'funcgen': {
      const w = String(params.wave);
      const wave =
        w === 'square'
          ? P('M-11 5 V-5 H-4 V5 H4 V-5 H11', ' fill="none"')
          : w === 'triangle'
            ? P('M-12 4 L-6 -6 L2 6 L10 -6 L12 -3', ' fill="none"')
            : P('M-11 0 C-7 -11 -3 -11 0 0 C3 11 7 11 11 0', ' fill="none"');
      return (
        L(0, -40, 0, -22) +
        L(0, 22, 0, 40) +
        `<rect class="bg" x="-22" y="-22" width="44" height="44" rx="6"/>` +
        wave +
        T(0, 17, 'FG', ' class="sym-text tiny"') +
        T(-15, -28, '+', ' class="sym-text small"')
      );
    }
    case 'ground':
      return L(0, 0, 0, 10) + L(-14, 10, 14, 10) + L(-9, 15, 9, 15) + L(-4, 20, 4, 20);
    case 'switch': {
      const closed = Number(params.closed) === 1;
      return (
        L(-40, 0, -16, 0) +
        L(16, 0, 40, 0) +
        C(-16, 0, 3, ' class="bg"') +
        C(16, 0, 3, ' class="bg"') +
        (closed ? L(-16, 0, 16, -1, ' class="lever"') : L(-16, 0, 13, -15, ' class="lever"'))
      );
    }
    case 'button': {
      const down = Number(params.closed) === 1;
      const y = down ? -3 : -12;
      return (
        L(-40, 0, -16, 0) +
        L(16, 0, 40, 0) +
        C(-16, 0, 3, ' class="bg"') +
        C(16, 0, 3, ' class="bg"') +
        L(-18, y, 18, y, ' class="lever"') +
        L(0, y, 0, y - 12) +
        L(-8, y - 12, 8, y - 12)
      );
    }
    case 'fuse':
      return `<rect class="bg" x="-16" y="-6" width="32" height="12" rx="2"/>` + L(-40, 0, 40, 0);
    case 'lamp': {
      const glow = C(0, 0, 20, ' class="glow" fill="#ffd54a"');
      const body = C(0, 0, 14, ' class="bg lampglass"');
      const inner = std === 'iec' ? L(-10, -10, 10, 10) + L(-10, 10, 10, -10) : P('M-14 0 H-6 C-6 -12 6 -12 6 0 H14', ' fill="none"');
      return glow + L(-40, 0, -14, 0) + L(14, 0, 40, 0) + body + inner;
    }
    case 'diode':
      return diodeBody(L(10, -10, 10, 10, ' class="plate"'));
    case 'zener':
      return diodeBody(P('M5 -13 L10 -10 L10 10 L15 13', ' fill="none" class="plate"'));
    case 'schottky':
      return diodeBody(P('M15 -6 V-10 H10 V10 H5 V6', ' fill="none" class="plate"'));
    case 'led': {
      const color = LED_COLORS[String(params.color)]?.hex ?? '#ff3b30';
      return (
        C(0, 0, 17, ` class="glow" fill="${color}"`) +
        `<polygon class="ledbody" points="-10,-10 -10,10 10,0" fill="${color}"/>` +
        L(-40, 0, -10, 0) +
        L(10, 0, 40, 0) +
        L(10, -10, 10, 10, ' class="plate"') +
        L(-1, -12, 7, -20) +
        arrowHead(-1, -12, 9, -22, 6) +
        L(6, -8, 14, -16) +
        arrowHead(6, -8, 16, -18, 6)
      );
    }
    case 'npn':
    case 'pnp': {
      const npn = type === 'npn';
      const arrow = npn ? arrowHead(-6, 6, 13, 17.7, 8) : arrowHead(14, 18.3, -2, 8.5, 8);
      return (
        C(6, 0, 24, ' class="bg"') +
        L(-40, 0, -6, 0) +
        L(-6, -14, -6, 14, ' class="plate thick"') +
        P('M-6 -6 L20 -22 V-40', ' fill="none"') +
        P('M-6 6 L20 22 V40', ' fill="none"') +
        arrow
      );
    }
    case 'nmos':
    case 'pmos': {
      const n = type === 'nmos';
      return (
        C(6, 0, 24, ' class="bg"') +
        L(-40, 0, -12, 0) +
        L(-12, -14, -12, 14, ' class="plate"') +
        L(-4, -16, -4, -8, ' class="plate"') +
        L(-4, -4, -4, 4, ' class="plate"') +
        L(-4, 8, -4, 16, ' class="plate"') +
        P('M-4 -12 H20 V-40', ' fill="none"') +
        P('M-4 12 H20 V40', ' fill="none"') +
        P('M20 12 V0 H6', ' fill="none"') +
        (n ? arrowHead(12, 0, -3, 0, 7) : L(-4, 0, 6, 0) + arrowHead(-2, 0, 13, 0, 7))
      );
    }
    case 'and':
    case 'or':
    case 'not':
    case 'nand':
    case 'nor':
    case 'xor':
    case 'xnor':
      return gateBody(type, std);
    case 'logicin':
      return `<rect class="bg lin" x="-18" y="-14" width="36" height="28" rx="4"/>` + L(18, 0, 40, 0);
    case 'logicout':
      return L(-40, 0, -14, 0) + C(0, 0, 14, ' class="bg lout"') + C(0, 0, 14, ' class="glow" fill="#ff3b30"');
    case 'voltmeter':
    case 'ammeter':
      return (
        leads(18) +
        C(0, 0, 18, ' class="bg"') +
        T(0, 6, type === 'voltmeter' ? 'V' : 'A', ' class="sym-text big"') +
        T(-28, -7, '+', ' class="sym-text small"')
      );
    case 'probe':
      return L(0, 0, 0, -18) + `<polygon class="probe" points="0,-18 -12,-30 -12,-44 12,-44 12,-30"/>`;
    case 'opamp':
      return (
        L(-40, -20, -24, -20) +
        L(-40, 20, -24, 20) +
        P('M-24 -32 L30 0 L-24 32 Z', ' class="bg"') +
        L(30, 0, 40, 0) +
        L(-19, -20, -11, -20, ' stroke-width="1.6"') +
        L(-19, 20, -11, 20, ' stroke-width="1.6"') +
        L(-15, 16, -15, 24, ' stroke-width="1.6"')
      );
    case 'adc':
    case 'dac': {
      const adc = type === 'adc';
      let out = icBox(-40, -52, 80, 84, adc ? 'A/D' : 'D/A');
      if (adc) {
        out += L(-60, -20, -40, -20) + T(-28, -16, 'VIN', ' class="sym-text pin"');
        out += L(-60, 20, -40, 20) + clockMark(-40, 20);
      } else {
        out += L(40, -20, 60, -20) + T(26, -16, 'OUT', ' class="sym-text pin"');
      }
      [-40, -20, 0, 20].forEach((y, i) => {
        out += adc ? L(40, y, 60, y) + T(31, y + 4, `D${i}`, ' class="sym-text pin"') : L(-60, y, -40, y) + T(-31, y + 4, `D${i}`, ' class="sym-text pin"');
      });
      return out;
    }
    case 'tline':
      return (
        L(-60, -20, -40, -20) +
        L(-60, 20, -40, 20) +
        L(40, -20, 60, -20) +
        L(40, 20, 60, 20) +
        `<rect class="bg" x="-40" y="-28" width="80" height="56" rx="10"/>` +
        L(-40, -20, 40, -20, ' class="plate"') +
        L(-40, 20, 40, 20, ' class="plate"') +
        T(0, 5, 'Z0', ' class="sym-text small"')
      );
    case 'lcd7': {
      let out = `<rect class="lcdbody" x="-20" y="-70" width="60" height="140" rx="5"/>`;
      'abcdefg'.split('').forEach((c, i) => {
        const y = -60 + 20 * i;
        out += L(-40, y, -20, y) + T(-30, y - 3, c, ' class="sym-text tiny"');
        const [x, sy, w, h] = SEG_SHAPES[c];
        out += `<rect class="seg lcdseg" data-seg="${c}" x="${x + 2}" y="${sy}" width="${w}" height="${h}" rx="1.5"/>`;
      });
      return out + L(0, 70, 0, 100) + T(14, 90, 'COM', ' class="sym-text pin"');
    }
    case 'irtx':
      return (
        C(0, 0, 17, ' class="glow" fill="#ef4444"') +
        `<polygon class="ledbody" points="-10,-10 -10,10 10,0" fill="#7f1d1d"/>` +
        L(-40, 0, -10, 0) +
        L(10, 0, 40, 0) +
        L(10, -10, 10, 10, ' class="plate"') +
        L(-1, -12, 7, -20) +
        arrowHead(-1, -12, 9, -22, 6) +
        L(6, -8, 14, -16) +
        arrowHead(6, -8, 16, -18, 6) +
        T(-24, -12, 'IR', ' class="sym-text tiny"')
      );
    case 'irrx':
      return diodeBody(L(10, -10, 10, 10, ' class="plate"')) + lightIn(0, -10) + T(24, -12, 'IR', ' class="sym-text tiny"');
    case 'aswitch':
      return (
        L(-40, -20, -24, -20) +
        L(-40, 20, -24, 20) +
        L(24, 0, 40, 0) +
        L(0, 32, 0, 40) +
        `<rect class="bg ic" x="-24" y="-32" width="48" height="64" rx="3"/>` +
        C(-12, -20, 2.5, ' class="fill"') +
        C(-12, 20, 2.5, ' class="fill"') +
        C(12, 0, 2.5, ' class="fill"') +
        L(-24, -20, -12, -20) +
        L(-24, 20, -12, 20) +
        L(12, 0, 24, 0) +
        L(12, 0, -11, -17, ' class="lever"') +
        T(-16, -8, 'A', ' class="sym-text pin"') +
        T(-16, 32 - 4, 'B', ' class="sym-text pin"') +
        T(0, 28, 'SEL', ' class="sym-text pin"')
      );
    case 'psu':
      return (
        L(0, -40, 0, -24) +
        L(0, 24, 0, 40) +
        `<rect class="bg" x="-22" y="-24" width="44" height="48" rx="5"/>` +
        L(-10, -8, 10, -8, ' class="plate"') +
        L(-5, 0, 5, 0, ' class="plate thick"') +
        T(0, 18, 'DC', ' class="sym-text tiny"') +
        T(-14, -12, '+', ' class="sym-text small"')
      );
    case 'ldr':
      return leads() + resistorBody(std) + lightIn(-2, -12);
    case 'photodiode':
      return diodeBody(L(10, -10, 10, 10, ' class="plate"')) + lightIn(0, -10);
    case 'transformer':
      return (
        P('M-40 -40 H-14 V-24', ' fill="none"') +
        P('M-40 40 H-14 V24', ' fill="none"') +
        P('M-14 -24 a6 6 0 0 0 0 12 a6 6 0 0 0 0 12 a6 6 0 0 0 0 12 a6 6 0 0 0 0 12', ' fill="none"') +
        P('M40 -40 H14 V-24', ' fill="none"') +
        P('M40 40 H14 V24', ' fill="none"') +
        P('M14 -24 a6 6 0 0 1 0 12 a6 6 0 0 1 0 12 a6 6 0 0 1 0 12 a6 6 0 0 1 0 12', ' fill="none"') +
        L(-3, -28, -3, 28) +
        L(3, -28, 3, 28) +
        C(-22, -30, 2.5, ' class="fill"') +
        C(22, -30, 2.5, ' class="fill"')
      );
    case 'scr':
      return diodeBody(L(10, -10, 10, 10, ' class="plate"')) + P('M10 5 L20 20 V40', ' fill="none"');
    case 'triac':
      return (
        L(-40, 0, -10, 0) +
        L(10, 0, 40, 0) +
        L(-10, -15, -10, 15, ' class="plate"') +
        L(10, -15, 10, 15, ' class="plate"') +
        `<polygon class="fill" points="-10,-14 -10,-1 10,-7.5"/>` +
        `<polygon class="fill" points="10,1 10,14 -10,7.5"/>` +
        P('M10 10 L20 22 V40', ' fill="none"')
      );
    case 'sevenseg': {
      const color = LED_COLORS[String(params.color)]?.hex ?? '#ff3b30';
      let out = `<rect class="segbody" x="-20" y="-70" width="60" height="140" rx="5"/>`;
      'abcdefg'.split('').forEach((c, i) => {
        const y = -60 + 20 * i;
        out += L(-40, y, -20, y) + T(-30, y - 3, c, ' class="sym-text tiny"');
        const [x, sy, w, h] = SEG_SHAPES[c];
        out += `<rect class="seg" data-seg="${c}" x="${x + 2}" y="${sy}" width="${w}" height="${h}" rx="2" fill="${color}"/>`;
      });
      return out + L(0, 70, 0, 100) + T(12, 90, 'K', ' class="sym-text tiny"');
    }
    case 'timer555':
      return (
        L(-20, -80, -20, -60) +
        L(20, -80, 20, -60) +
        L(-60, -40, -40, -40) +
        L(-60, 0, -40, 0) +
        L(-60, 40, -40, 40) +
        L(0, 60, 0, 80) +
        L(40, 0, 60, 0) +
        L(40, 40, 60, 40) +
        icBox(-40, -60, 80, 120, '555') +
        T(-20, -46, 'VCC', ' class="sym-text pin"') +
        T(20, -46, 'RST', ' class="sym-text pin"') +
        T(-26, -36, 'DIS', ' class="sym-text pin"') +
        T(-26, 4, 'THR', ' class="sym-text pin"') +
        T(-26, 44, 'TRG', ' class="sym-text pin"') +
        T(0, 54, 'GND', ' class="sym-text pin"') +
        T(26, 4, 'OUT', ' class="sym-text pin"') +
        T(28, 44, 'CV', ' class="sym-text pin"')
      );
    case 'dff':
      return (
        L(-40, -20, -24, -20) +
        L(-40, 20, -24, 20) +
        L(24, -20, 40, -20) +
        L(24, 20, 40, 20) +
        `<rect class="bg ic" x="-24" y="-30" width="48" height="60" rx="3"/>` +
        clockMark(-24, 20) +
        T(-15, -16, 'D', ' class="sym-text tiny"') +
        T(15, -16, 'Q', ' class="sym-text tiny"') +
        qBar(15, 24)
      );
    case 'jkff':
      return (
        L(-40, -20, -24, -20) +
        L(-40, 0, -24, 0) +
        L(-40, 20, -24, 20) +
        L(24, -20, 40, -20) +
        L(24, 20, 40, 20) +
        `<rect class="bg ic" x="-24" y="-30" width="48" height="60" rx="3"/>` +
        clockMark(-24, 0) +
        T(-15, -16, 'J', ' class="sym-text tiny"') +
        T(-15, 24, 'K', ' class="sym-text tiny"') +
        T(15, -16, 'Q', ' class="sym-text tiny"') +
        qBar(15, 24)
      );
    case 'counter': {
      let out = L(-60, -40, -40, -40) + L(-60, 40, -40, 40) + icBox(-40, -52, 80, 104, String(params.mod) === '16' ? 'CTR16' : 'CTR10');
      out += clockMark(-40, -40) + T(-26, 44, 'R', ' class="sym-text pin"');
      ['QA', 'QB', 'QC', 'QD'].forEach((q, i) => {
        const y = -40 + 20 * i;
        out += L(40, y, 60, y) + T(31, y + 4, q, ' class="sym-text pin"');
      });
      return out;
    }
    case 'bcd7': {
      let out = icBox(-40, -72, 80, 144, 'BCD/7');
      'ABCD'.split('').forEach((c, i) => {
        const y = -40 + 20 * i;
        out += L(-60, y, -40, y) + T(-32, y + 4, c, ' class="sym-text pin"');
      });
      'abcdefg'.split('').forEach((c, i) => {
        const y = -60 + 20 * i;
        out += L(40, y, 60, y) + T(32, y + 4, c, ' class="sym-text pin"');
      });
      return out;
    }
    case 'multimeter':
      return (
        `<rect class="dmm" x="-30" y="-44" width="60" height="74" rx="8"/>` +
        C(0, 10, 9, ' class="dmmdial"') +
        L(0, 10, 6, 3, ' stroke-width="2"') +
        C(-20, 24, 3.5, ' class="jack-com"') +
        C(20, 24, 3.5, ' class="jack-red"') +
        L(-20, 28, -20, 60, ' class="lead-com"') +
        L(20, 28, 20, 60, ' class="lead-red"')
      );
    case 'bode':
      return (
        `<rect class="bg" x="-34" y="-28" width="68" height="56" rx="6"/>` +
        P('M-26 -12 H-4 Q6 -12 12 0 T26 14', ' fill="none" class="bodecurve"') +
        L(-20, 28, -20, 40) +
        L(20, 28, 20, 40) +
        T(-20, 22, 'IN', ' class="sym-text pin"') +
        T(20, 22, 'OUT', ' class="sym-text pin"')
      );
    default:
      return `<rect x="-20" y="-20" width="40" height="40"/>`;
  }
}
