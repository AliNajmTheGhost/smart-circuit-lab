import { EXAMPLES } from '../examples';
import { getLang, nameOf, t } from '../i18n';
import { openCircuitFile, onIncomingFile } from '../platform/files';
import { fmt } from '../units';
import { SPEEDS, type App, type Theme } from './app';
import type { Board } from './board';
import { showAbout } from './about';
import { $, confirmBox, esc, icon, modal, popover, toast } from './dom';
import type { Scope } from './scope';

const THEMES: Theme[] = ['system', 'light', 'dark'];
const THEME_ICON: Record<Theme, string> = { system: 'auto', light: 'sun', dark: 'moon' };

interface Hooks {
  openLessons(): void;
  openWelcome(): void;
  openAchievements(): void;
  openChallenges(): void;
  /** An example was opened from the gallery. */
  exampleOpened?(id: string): void;
  /** Rebuild every panel, e.g. after switching language. */
  rebuild(): void;
}

/** Top bar (file, examples, lessons, view settings) and the floating simulation dock. */
export class Toolbar {
  constructor(
    private app: App,
    private board: Board,
    private scope: Scope,
    private hooks: Hooks,
  ) {
    app.on('doc', () => this.update());
    app.on('settings', () => this.update());
    this.build();
    // Once only: build() runs again on every language switch.
    void onIncomingFile((f) => void this.openText(f.text));
  }

  build(): void {
    const tools = $('#tools');
    tools.innerHTML = `
      <div class="tgroup">
        <button class="tbtn accent mobile-only parts-btn" data-act="drawer-parts" title="${t('palette')}">${icon('plus')}<span class="lbl">${t('addPart')}</span></button>
        <button class="tbtn mobile-only" data-act="drawer-side" title="${t('props')}">${icon('props')}</button>
        <button class="tbtn wide-only" data-act="new" title="${t('new')}">${icon('new')}<span class="lbl">${t('new')}</span></button>
        <button class="tbtn wide-only" data-act="open" title="${t('open')}">${icon('open')}<span class="lbl">${t('open')}</span></button>
        <button class="tbtn wide-only" data-act="save" title="${t('save')} (Ctrl+S)">${icon('save')}<span class="lbl">${t('save')}</span></button>
      </div>
      <div class="tgroup wide-only">
        <button class="tbtn soft" data-act="examples">${icon('bulb')}<span class="lbl">${t('examples')}</span></button>
        <button class="tbtn accent" data-act="lessons">${icon('book')}<span class="lbl">${t('lessons')}</span></button>
        <button class="tbtn soft" data-act="challenges" title="${t('challenges')}">${icon('wrench')}<span class="lbl">${t('challenges')}</span></button>
        <button class="tbtn soft" data-act="achievements" title="${t('achievements')}">${icon('trophy')}<span class="lbl">${t('achievements')}</span></button>
      </div>
      <div class="tspacer"></div>
      <div class="tgroup">
        <button class="tbtn" data-act="undo" title="${t('undo')} (Ctrl+Z)">${icon('undo')}</button>
        <button class="tbtn" data-act="redo" title="${t('redo')} (Ctrl+Y)">${icon('redo')}</button>
      </div>
      <div class="tgroup wide-only">
        <button class="tbtn" data-act="view" title="${t('viewMenu')}">${icon('eye')}<span class="lbl">${t('viewMenu')}</span></button>
        <button class="tbtn" data-act="theme" title="${t('theme')}"></button>
        <button class="tbtn" data-act="lang" title="${t('language')}">${icon('globe')}<span class="lbl">${t('language')}</span></button>
      </div>
      <div class="tgroup mobile-only">
        <button class="tbtn" data-act="more" title="${t('more')}">${icon('more')}</button>
      </div>`;
    tools.onclick = (e) => {
      const b = (e.target as Element).closest<HTMLElement>('button[data-act]');
      if (b) void this.act(b.dataset.act!, b);
    };
    $('.brand').onclick = () => this.hooks.openWelcome();
    this.buildDock();
    this.update();
  }

  private buildDock(): void {
    let dock = document.querySelector<HTMLElement>('.dock');
    if (!dock) {
      dock = document.createElement('div');
      dock.className = 'dock';
      $('#stage').appendChild(dock);
    }
    dock.innerHTML = `
      <button class="dock-run" data-act="run"></button>
      <button class="dock-btn" data-act="restart" title="${t('restart')}">${icon('restart')}</button>
      <div class="seg" role="radiogroup" aria-label="${t('speed')}">
        ${SPEEDS.map((s, i) => `<button role="radio" data-speed="${i}">${t(s.key)}</button>`).join('')}
      </div>
      <div class="dock-time"><span class="live-dot"></span><b dir="ltr" data-time>0 s</b></div>
      <button class="dock-btn" data-act="scope" title="${t('scope')}">${icon('scope')}<span class="lbl">${t('scope')}</span></button>`;
    dock.onclick = (e) => {
      const b = (e.target as Element).closest<HTMLElement>('button');
      if (!b) return;
      if (b.dataset.speed) this.app.setOption('speed', Number(b.dataset.speed));
      else if (b.dataset.act) void this.act(b.dataset.act, b);
    };

    let zoom = document.querySelector<HTMLElement>('.zoombar');
    if (!zoom) {
      zoom = document.createElement('div');
      zoom.className = 'zoombar';
      $('#stage').appendChild(zoom);
    }
    zoom.innerHTML = `<button data-z="in" title="${t('zoomIn')}">${icon('plus')}</button><button data-z="out" title="${t('zoomOut')}">${icon('minus')}</button><button data-z="fit" title="${t('fit')}">${icon('fit')}</button>`;
    zoom.onclick = (e) => {
      const b = (e.target as Element).closest<HTMLElement>('button');
      if (b?.dataset.z === 'in') this.board.setZoom(this.board.zoom * 1.25);
      if (b?.dataset.z === 'out') this.board.setZoom(this.board.zoom / 1.25);
      if (b?.dataset.z === 'fit') this.board.fit();
    };
  }

  update(): void {
    const app = this.app;
    const run = document.querySelector<HTMLElement>('.dock-run');
    if (run) {
      run.innerHTML = `${icon(app.running ? 'pause' : 'run')}<span>${app.running ? t('pause') : t('run')}</span>`;
      run.classList.toggle('running', app.running);
      run.title = `${app.running ? t('pause') : t('run')} (Space)`;
    }
    document.querySelectorAll<HTMLElement>('[data-speed]').forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.speed) === app.speed)));
    document.querySelector('.dock [data-act="scope"]')?.classList.toggle('on', app.scopeOpen);
    document.querySelector('.dock-time')?.classList.toggle('on', app.running);
    const undo = document.querySelector<HTMLButtonElement>('[data-act="undo"]');
    const redo = document.querySelector<HTMLButtonElement>('[data-act="redo"]');
    if (undo) undo.disabled = !app.canUndo;
    if (redo) redo.disabled = !app.canRedo;
    const theme = document.querySelector<HTMLElement>('[data-act="theme"]');
    if (theme) theme.innerHTML = `${icon(THEME_ICON[app.theme])}<span class="lbl">${t(`theme_${app.theme}`)}</span>`;
  }

  /** Called every frame. */
  tick(): void {
    const el = document.querySelector<HTMLElement>('[data-time]');
    const s = fmt(this.app.engine.t, 's');
    if (el && el.textContent !== s) el.textContent = s;
  }

  /** Load a circuit from file text, with a message either way. */
  private async openText(text: string): Promise<void> {
    if (await this.app.importText(text)) {
      this.board.fit();
      toast(t('opened'));
    } else toast(t('badFile'), true);
  }

  async act(a: string, btn: HTMLElement): Promise<void> {
    const app = this.app;
    switch (a) {
      case 'new':
        if (app.doc.parts.length && !(await confirmBox(t('confirmNew')))) return;
        app.load({ version: 1, title: '', parts: [], wires: [] });
        this.board.fit();
        break;
      case 'open':
        try {
          const f = await openCircuitFile();
          if (f) await this.openText(f.text);
        } catch (err) {
          console.error(err);
          toast(t('fileError'), true);
        }
        break;
      case 'save':
        try {
          if (await app.exportFile()) toast(t('saved'));
        } catch (err) {
          console.error(err);
          toast(t('fileError'), true);
        }
        break;
      case 'examples':
        this.examples();
        break;
      case 'lessons':
        this.hooks.openLessons();
        break;
      case 'challenges':
        this.hooks.openChallenges();
        break;
      case 'achievements':
        this.hooks.openAchievements();
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
      case 'view':
        this.viewMenu(btn);
        break;
      case 'more':
        this.moreMenu(btn);
        break;
      case 'about':
        showAbout();
        break;
      case 'theme':
        app.setOption('theme', THEMES[(THEMES.indexOf(app.theme) + 1) % THEMES.length]);
        break;
      case 'lang':
        app.setLanguage(getLang() === 'ar' ? 'en' : 'ar');
        this.hooks.rebuild();
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

  /** On a phone the top bar has room for a few buttons only; everything else lives here. */
  private moreMenu(anchor: HTMLElement): void {
    const item = (act: string, ic: string, label: string) => `<button class="menu-item" data-more="${act}">${icon(ic)}<span>${label}</span></button>`;
    popover(
      anchor,
      `<div class="menu more-menu">
        ${item('new', 'new', t('new'))}
        ${item('open', 'open', t('open'))}
        ${item('save', 'save', t('save'))}
        <hr>
        ${item('lessons', 'book', t('lessons'))}
        ${item('examples', 'bulb', t('examples'))}
        ${item('challenges', 'wrench', t('challenges'))}
        ${item('achievements', 'trophy', t('achievements'))}
        <hr>
        ${item('view', 'eye', t('viewMenu'))}
        ${item('theme', 'sun', t('theme'))}
        ${item('lang', 'globe', t('language'))}
        ${item('about', 'info', t('about'))}
      </div>`,
      (el, close) => {
        el.addEventListener('click', (e) => {
          const act = (e.target as Element).closest<HTMLElement>('[data-more]')?.dataset.more;
          if (!act) return;
          close();
          void this.act(act, anchor);
        });
      },
    );
  }

  private viewMenu(anchor: HTMLElement): void {
    const app = this.app;
    const sw = (key: string, label: string, on: boolean) =>
      `<label class="switch-row"><span>${label}</span><input type="checkbox" role="switch" data-opt="${key}"${on ? ' checked' : ''}><i></i></label>`;
    popover(
      anchor,
      `<div class="menu view-menu">
        <div class="menu-head">${t('viewMenu')}</div>
        ${sw('showVolt', t('voltColors'), app.showVolt)}
        ${sw('showCurrent', t('currentDots'), app.showCurrent)}
        ${sw('sound', t('soundOpt'), app.sound)}
        <div class="menu-head">${t('symbols')}</div>
        <div class="seg small">
          <button data-std="ansi" aria-checked="${app.std === 'ansi'}">ANSI · ${t('bookStd')}</button>
          <button data-std="iec" aria-checked="${app.std === 'iec'}">IEC</button>
        </div>
      </div>`,
      (el) => {
        el.addEventListener('change', (e) => {
          const i = e.target as HTMLInputElement;
          if (i.dataset.opt === 'showVolt' || i.dataset.opt === 'showCurrent' || i.dataset.opt === 'sound') app.setOption(i.dataset.opt, i.checked);
        });
        el.addEventListener('click', (e) => {
          const b = (e.target as Element).closest<HTMLElement>('[data-std]');
          if (!b) return;
          app.setOption('std', b.dataset.std as 'ansi' | 'iec');
          el.querySelectorAll('[data-std]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
        });
      },
    );
  }

  /** Example gallery, grouped by school year. */
  examples(): void {
    const grades = [1, 2, 3]
      .map((g) => {
        const list = EXAMPLES.filter((ex) => (ex.grade ?? 1) === g);
        if (!list.length) return '';
        return `<section class="grade"><h3 class="grade-head"><span>${t(`grade${g}`)}</span><small>${list.length}</small></h3><div class="ex-grid">${list
          .map(
            (ex) => `<button class="ex-card" data-ex="${ex.id}">
              <strong>${esc(nameOf(ex))}</strong>
              ${ex.ref ? `<span class="lref">${/^\d/.test(ex.ref) ? `${t('exercise')} ` : ''}${esc(ex.ref)}</span>` : ''}
            </button>`,
          )
          .join('')}</div></section>`;
      })
      .join('');
    modal(
      `<header class="modal-head">${icon('bulb', 'ico big')}<div><h2>${t('examples')}</h2><p class="muted">${t('examplesIntro')}</p></div></header><div class="lesson-list">${grades}</div>`,
      (el, close) => {
        el.addEventListener('click', (e) => {
          const b = (e.target as Element).closest<HTMLElement>('[data-ex]');
          if (!b) return;
          this.openExample(b.dataset.ex!);
          this.hooks.exampleOpened?.(b.dataset.ex!);
          close();
        });
      },
      'wide',
    );
  }

  openExample(id: string): void {
    const ex = EXAMPLES.find((x) => x.id === id);
    if (!ex) return;
    this.app.load(ex.build());
    if (ex.scopeWindow) this.scope.setWindow(ex.scopeWindow);
    this.app.restart();
    this.scope.clear();
    this.board.fit();
  }
}
