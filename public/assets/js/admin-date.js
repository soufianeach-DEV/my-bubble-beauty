// Admin : calendrier du site à la place du champ date natif (jj-mm-aaaa). Amélioration progressive : sans JS, le champ natif reste.
// Le champ d'origine garde son nom et sa valeur AAAA-MM-JJ : formulaires et serveur ne changent pas. Clavier : flèches (jour, semaine),
// Début/Fin (semaine), Page préc./suiv. (mois, + Maj : année), Entrée ou Espace (choisir), Échap (fermer).
(() => {
  const fmtBtn = new Intl.DateTimeFormat('fr-BE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const fmtMonth = new Intl.DateTimeFormat('fr-BE', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const fmtFull = new Intl.DateTimeFormat('fr-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const HEADS = ['lu', 'ma', 'me', 'je', 've', 'sa', 'di'];
  const utc = (iso) => new Date(`${iso}T12:00:00Z`);
  const iso = (d) => d.toISOString().slice(0, 10);
  const valid = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(utc(s).getTime());
  const add = (s, n) => { const d = utc(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
  const addMonths = (s, n) => {
    const d = utc(s); const day = d.getUTCDate();
    d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
    return iso(d);
  };
  const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(new Date());
  let uid = 0;

  function enhance(input) {
    if (input.dataset.dpk) return;
    input.dataset.dpk = '1';
    const id = `dpk-${++uid}`;
    const labelText = (input.labels?.[0]?.textContent || 'Date').replace(/\s+/g, ' ').trim();
    const wrap = document.createElement('span');
    wrap.className = 'dpk';
    input.after(wrap);
    wrap.append(input);
    input.classList.add('dpk-native');
    input.tabIndex = -1;
    input.setAttribute('aria-hidden', 'true');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dpk-btn';
    btn.id = `${id}-btn`;
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.setAttribute('aria-expanded', 'false');
    if (input.labels?.[0]) input.labels[0].htmlFor = btn.id;
    const pop = document.createElement('div');
    pop.className = 'dpk-pop';
    pop.id = `${id}-pop`;
    pop.hidden = true;
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', `${labelText} : choisir une date`);
    btn.setAttribute('aria-controls', pop.id);
    wrap.append(btn, pop);

    const min = () => (valid(input.min) ? input.min : null);
    const max = () => (valid(input.max) ? input.max : null);
    const allowed = (d) => (!min() || d >= min()) && (!max() || d <= max());
    let focus = valid(input.value) ? input.value : todayIso();

    const label = () => {
      btn.textContent = valid(input.value) ? fmtBtn.format(utc(input.value)) : 'Choisir une date';
      btn.classList.toggle('dpk-empty', !valid(input.value));
    };
    const set = (d) => {
      input.value = d;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      label();
    };

    function render() {
      const first = `${focus.slice(0, 7)}-01`;
      const lead = (utc(first).getUTCDay() + 6) % 7;
      const count = new Date(Date.UTC(utc(first).getUTCFullYear(), utc(first).getUTCMonth() + 1, 0, 12)).getUTCDate();
      const today = todayIso();
      pop.replaceChildren();
      const head = document.createElement('div');
      head.className = 'dpk-head';
      const nav = (txt, aria, n) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'dpk-nav'; b.textContent = txt; b.setAttribute('aria-label', aria);
        // Le bouton est recréé au rendu : on remet le focus sur son double pour garder la navigation au clavier
        b.addEventListener('click', () => { focus = addMonths(focus, n); render(); pop.querySelector(`.dpk-nav[aria-label="${aria}"]`)?.focus(); });
        return b;
      };
      const title = document.createElement('p');
      title.className = 'dpk-month';
      title.setAttribute('aria-live', 'polite');
      title.textContent = fmtMonth.format(utc(first));
      head.append(nav('‹', 'Mois précédent', -1), title, nav('›', 'Mois suivant', 1));
      const grid = document.createElement('table');
      grid.className = 'dpk-grid';
      grid.setAttribute('role', 'grid');
      grid.setAttribute('aria-label', title.textContent);
      const thead = grid.createTHead().insertRow();
      HEADS.forEach((h) => { const th = document.createElement('th'); th.scope = 'col'; th.textContent = h; thead.append(th); });
      const body = grid.createTBody();
      let row = body.insertRow();
      for (let i = 0; i < lead; i++) row.insertCell();
      for (let n = 1; n <= count; n++) {
        if (row.cells.length === 7) row = body.insertRow();
        const d = `${focus.slice(0, 7)}-${String(n).padStart(2, '0')}`;
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'dpk-day'; b.textContent = String(n);
        b.dataset.day = d;
        b.setAttribute('aria-label', fmtFull.format(utc(d)));
        b.tabIndex = d === focus ? 0 : -1;
        if (d === input.value) b.setAttribute('aria-pressed', 'true');
        if (d === today) b.setAttribute('aria-current', 'date');
        if (!allowed(d)) b.disabled = true;
        b.addEventListener('click', () => { if (allowed(d)) { set(d); close(); btn.focus(); } });
        row.insertCell().append(b);
      }
      while (row.cells.length < 7) row.insertCell();
      const foot = document.createElement('div');
      foot.className = 'dpk-foot';
      const link = (txt, fn, ok = true) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'dpk-link'; b.textContent = txt; b.disabled = !ok; b.addEventListener('click', fn); return b; };
      foot.append(link("Aujourd'hui", () => { set(today); close(); btn.focus(); }, allowed(today)));
      if (!input.required) foot.append(link('Effacer', () => { set(''); close(); btn.focus(); }));
      pop.append(head, grid, foot);
    }

    function move(n, by = 'day') {
      focus = by === 'month' ? addMonths(focus, n) : by === 'year' ? addMonths(focus, 12 * n) : add(focus, n);
      render();
      pop.querySelector(`[data-day="${focus}"]`)?.focus();
    }
    pop.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); btn.focus(); return; }
      if (!e.target.classList.contains('dpk-day')) return;
      const wd = (utc(focus).getUTCDay() + 6) % 7;
      const keys = { ArrowLeft: [-1], ArrowRight: [1], ArrowUp: [-7], ArrowDown: [7], Home: [-wd], End: [6 - wd],
        PageUp: [-1, e.shiftKey ? 'year' : 'month'], PageDown: [1, e.shiftKey ? 'year' : 'month'] };
      if (keys[e.key]) { e.preventDefault(); move(...keys[e.key]); }
    });

    function open() {
      focus = valid(input.value) ? input.value : todayIso();
      render();
      pop.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      wrap.classList.remove('dpk-right');
      if (pop.getBoundingClientRect().right > document.documentElement.clientWidth - 8) wrap.classList.add('dpk-right');
      pop.querySelector(`[data-day="${focus}"]`)?.focus();
    }
    function close() {
      pop.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    }
    btn.addEventListener('click', () => (pop.hidden ? open() : close()));
    btn.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown' && pop.hidden) { e.preventDefault(); open(); } });
    document.addEventListener('pointerdown', (e) => { if (!pop.hidden && !wrap.contains(e.target)) close(); });
    wrap.addEventListener('focusout', (e) => { if (!pop.hidden && e.relatedTarget && !wrap.contains(e.relatedTarget)) close(); });
    // Champ requis vide à l'envoi : le message du navigateur pointe vers le bouton visible
    input.addEventListener('invalid', () => { btn.classList.add('dpk-invalid'); btn.focus(); });
    input.addEventListener('change', () => btn.classList.remove('dpk-invalid'));
    label();
  }

  document.querySelectorAll('.admin input[type="date"]').forEach(enhance);
})();
