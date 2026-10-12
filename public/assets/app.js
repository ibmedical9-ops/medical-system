'use strict';
// كل النصوص القادمة من الخادم أو المستخدم تُدرج عبر textContent فقط، منعاً لهجمات XSS.
(() => {
  const $ = (id) => document.getElementById(id);
  const state = { csrf: '', boot: null, session: null, current: null, lastReveal: null };

  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) {
      if (kid === null || kid === undefined || kid === false) continue;
      n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return n;
  };
  const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); return n; };

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.h);
    toast.h = setTimeout(() => { t.hidden = true; }, 5000);
  }

  async function api(action, { method = 'GET', body, query = {} } = {}) {
    const qs = new URLSearchParams({ action, ...query }).toString();
    const res = await fetch('api.php?' + qs, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrf },
      body: method === 'POST' ? JSON.stringify(body || {}) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch { /* ignore */ }
    if (!res.ok) throw new Error(data.error || 'تعذر تنفيذ الطلب.');
    return data;
  }
  const guard = (btn, fn) => async () => {
    btn.disabled = true;
    try { await fn(); } catch (e) { toast(e.message); } finally { btn.disabled = false; }
  };

  // ---------------------------------------------------------------- تهيئة
  async function init() {
    const b = await api('bootstrap');
    state.boot = b;
    state.csrf = b.csrf;
    renderChrome();

    const sc = clear($('scenarioSel'));
    b.scenarios.forEach((s) => sc.append(el('option', { value: s.id, text: s.title })));
    const sm = clear($('sampleSel'));
    sm.append(el('option', { value: '', text: 'مصدر مخصص (سألصق النص بنفسي)' }));
    b.samples.forEach((s) => sm.append(el('option', { value: s.id, text: s.title })));
    sm.value = b.samples[0] ? String(b.samples[0].id) : '';
    syncSample();
    renderPast();
  }

  function renderChrome() {
    const b = state.boot;
    $('userChip').textContent = b.user.role === 'trainer' ? 'مدرب: ' + b.user.name : b.user.name;
    $('loginBtn').hidden = b.user.role === 'trainer';
    $('logoutBtn').hidden = b.user.role !== 'trainer';
    const nb = $('providerNotice');
    nb.textContent = b.provider.notice;
    $('trainerCard').hidden = b.user.role !== 'trainer';
    if (b.user.role === 'trainer') loadTrainer();
  }

  function syncSample() {
    const id = $('sampleSel').value;
    const s = state.boot.samples.find((x) => String(x.id) === id);
    const ta = $('sourceTxt');
    if (s) { ta.value = s.content; ta.readOnly = true; }
    else { if (ta.readOnly) ta.value = ''; ta.readOnly = false; }
    countSrc();
  }
  function countSrc() {
    const n = $('sourceTxt').value.length, L = state.boot.limits;
    $('srcCount').textContent = `(${n} / ${L.source_max})`;
  }

  function renderPast() {
    const list = clear($('pastList'));
    const ss = state.boot.sessions;
    $('pastCard').hidden = ss.length === 0;
    ss.forEach((s) => list.append(el('li', {},
      el('span', { text: `${s.title} — ${s.attempts} محاولة — ${s.created_at}` }),
      el('button', { class: 'btn small', type: 'button', onclick: () => openSession(s.id).catch((e) => toast(e.message)) }, 'فتح'))));
  }

  // ---------------------------------------------------------------- الجلسة
  async function startSession() {
    const sampleId = $('sampleSel').value;
    const body = { scenario_id: Number($('scenarioSel').value) };
    if (sampleId) body.sample_id = Number(sampleId);
    else body.source_text = $('sourceTxt').value;
    const s = await api('session_create', { method: 'POST', body });
    loadSession(s);
    state.boot.sessions.unshift({ id: s.id, title: s.source.title, attempts: 0, created_at: s.created_at });
    renderPast();
  }
  async function openSession(id) { loadSession(await api('session', { query: { id } })); }

  function loadSession(s) {
    state.session = s;
    state.current = null;
    $('workspace').hidden = false;
    $('sourceView').textContent = s.source.content;
    $('promptTxt').value = '';
    ['resultCard', 'evalPanel', 'improvePanel', 'revealPanel'].forEach((id) => { $(id).hidden = true; });
    renderHistory();
    if (s.attempts.length) showAttempt(s.attempts[s.attempts.length - 1]);
    $('workspace').scrollIntoView({ behavior: 'smooth' });
    $('promptTxt').focus();
  }

  async function run() {
    const prompt = $('promptTxt').value;
    $('runState').textContent = 'جارٍ التنفيذ…';
    try {
      const a = await api('attempt_create', { method: 'POST', body: { session_id: state.session.id, prompt } });
      state.session.attempts.push(a);
      showAttempt(a);
      renderHistory();
    } finally { $('runState').textContent = ''; }
  }

  // ---------------------------------------------------------------- عرض المحاولة
  function showAttempt(a) {
    state.current = a;
    ['evalPanel', 'improvePanel', 'revealPanel'].forEach((id) => { $(id).hidden = true; });
    $('resultCard').hidden = false;
    $('attemptTag').textContent = `— المحاولة ${a.attempt_no}`;
    const badge = $('simBadge');
    badge.textContent = a.output.is_simulation ? 'محاكاة محلية — ليست نموذجاً لغوياً حقيقياً' : 'مزود: ' + a.output.provider;
    badge.className = 'badge ' + (a.output.is_simulation ? 'sim' : 'llm');
    const note = $('outputNote');
    note.hidden = !a.output.note;
    note.textContent = a.output.note || '';
    renderOutput(a.output, []);
    document.querySelectorAll('input[name=verdict]').forEach((r) => { r.checked = r.value === a.verdict; });
    $('promptTxt').value = a.prompt;
    clearHighlights();
    renderHistory();
  }

  function renderOutput(out, errors) {
    const box = clear($('output'));
    box.classList.toggle('all-error', errors.some((e) => e.unit_id === '*'));
    const byUnit = {};
    errors.forEach((e) => { if (e.unit_id && e.unit_id !== '*') (byUnit[e.unit_id] ||= []).push(e); });
    if (!out.units.length) { box.append(el('p', { text: out.text })); return; }
    if (out.style === 'prose') {
      out.units.forEach((u) => box.append(el('p', { class: byUnit[u.id] ? 'has-error' : null }, u.cells[0],
        (byUnit[u.id] || []).map((e) => el('span', { class: 'errtag', text: '#' + e.ordinal })))));
    } else {
      const head = el('tr', {}, out.headers.map((h) => el('th', { text: h })));
      const rows = out.units.map((u) => el('tr', { class: byUnit[u.id] ? 'has-error' : null },
        u.cells.map((c, i) => el('td', {}, c, i === 1 ? (byUnit[u.id] || []).map((e) => el('span', { class: 'errtag', text: '#' + e.ordinal })) : null))));
      box.append(el('table', {}, el('thead', {}, head), el('tbody', {}, rows)));
    }
    if (out.style === 'json') box.append(el('details', { class: 'raw' }, el('summary', { text: 'النص الخام (JSON)' }), el('pre', { text: out.text })));
  }

  // ---------------------------------------------------------------- التقييم
  async function evaluate() {
    const a = needAttempt();
    const r = await api('evaluate', { method: 'POST', body: { attempt_id: a.id } });
    a.evaluated = true; a.score = r.score;
    const p = clear($('evalPanel')); p.hidden = false;
    p.append(el('h2', { text: 'تقييم اكتمال البرومبت' }),
      el('div', { class: 'score' }, el('b', { text: r.score + ' / 100' }), el('span', { class: 'chip', text: r.mode_label })),
      el('ul', { class: 'dims' }, Object.values(r.dimensions).map(dimRow)),
      r.gaps.length ? el('div', {}, el('h3', { text: 'الثغرات القابلة للاستغلال' }),
        el('ul', {}, r.gaps.map((g) => el('li', {}, el('b', { text: g.label + ': ' }), g.detail.split(' — ').pop())))) : el('p', { text: 'لم تُرصد ثغرات جوهرية في التعليمات.' }),
      el('p', { class: 'hint', text: r.disclaimer }));
    renderHistory(); loadCompare();
    p.scrollIntoView({ behavior: 'smooth' });
  }
  const dimRow = (d) => {
    const bar = el('i'); bar.style.width = Math.round(d.level * 100) + '%';
    return el('li', { class: 'dim ' + d.status },
      el('div', {}, el('b', { text: d.label }), ` — ${Math.round(d.level * 100)}%`),
      el('div', { class: 'bar' }, bar), el('small', { text: d.detail }));
  };

  async function improve() {
    const a = needAttempt();
    const r = await api('improve', { method: 'POST', body: { attempt_id: a.id } });
    const p = clear($('improvePanel')); p.hidden = false;
    p.append(el('h2', { text: 'البرومبت المحسّن' }),
      el('div', { class: 'promptbox', text: r.prompt }),
      r.additions.length ? el('ul', {}, r.additions.map((x) => el('li', {}, el('b', { text: x.label + ': ' }), x.clause,
        x.prevents.length ? el('small', { class: 'muted', text: ' (يمنع: ' + x.prevents.join('، ') + ')' }) : null))) : el('p', { text: 'لا إضافات مقترحة.' }),
      el('div', { class: 'actions' },
        el('button', { class: 'btn primary', type: 'button', onclick: () => { $('promptTxt').value = r.prompt; $('promptTxt').focus(); toast_ok('وُضع في حقل البرومبت. اضغط «تنفيذ التعليمات».'); } }, 'استخدمه في المحاولة التالية')),
      el('p', { class: 'hint', text: r.note }));
    p.scrollIntoView({ behavior: 'smooth' });
  }
  function toast_ok(m) { toast(m); }

  // ---------------------------------------------------------------- كشف الأخطاء
  async function reveal() {
    const a = needAttempt();
    const v = document.querySelector('input[name=verdict]:checked');
    const r = await api('reveal', { method: 'POST', body: { attempt_id: a.id, verdict: v ? v.value : undefined } });
    a.revealed = true; a.evaluated = true; a.error_count = r.errors.length; a.score = r.analysis.score;
    state.lastReveal = r;
    renderOutput(a.output, r.errors);
    renderReveal(r);
    renderHistory(); loadCompare();
  }

  function renderReveal(r) {
    const p = clear($('revealPanel')); p.hidden = false;
    const s = r.stats;
    p.append(el('h2', { text: 'كشف الأخطاء' }));
    if (r.verdict.judged_correctly !== null) {
      p.append(el('p', { class: 'meta', text: r.verdict.judged_correctly
        ? '✔ حكمك قبل الكشف كان متوافقاً مع الواقع.'
        : '✘ حكمك قبل الكشف لم يكن متوافقاً مع الواقع — هذا بالضبط ما يتدرب عليه المختبر.' }));
    }
    p.append(el('p', { class: 'meta', text: `بنود صحيحة: ${s.rows_correct} من ${s.rows_expected} متوقعة (${s.accuracy_percent}%) — أخطاء مسجلة: ${s.error_count}` }));
    if (!r.errors.length) p.append(el('div', { class: 'errcard low' }, el('b', { text: r.no_error_note || 'لم تتضمن النتيجة خطأً قابلاً للإثبات.' })));
    r.errors.forEach((e) => p.append(errCard(e)));

    const k = r.key;
    if (k.omitted.length) p.append(el('details', { open: true }, el('summary', { text: 'المعلومات المحذوفة' }),
      el('ul', {}, k.omitted.map((o) => el('li', { text: (o.category ? `[${o.category}] ` : '') + o.text })))));
    if (k.assumptions.length) p.append(el('details', { open: true }, el('summary', { text: 'الافتراضات المضافة من خارج المصدر' }),
      el('ul', {}, k.assumptions.map((o) => el('li', { text: o.value + (o.for ? ' ← ' + o.for : '') })))));

    p.append(el('h3', { text: 'الإجابة الصحيحة المستندة إلى المصدر' }), tableFrom(k.correct.headers, k.correct.units));
    p.append(el('h3', { text: 'البرومبت المحسّن الذي كان يمنع الخطأ' }),
      el('div', { class: 'promptbox', text: k.improved.prompt }),
      k.improved.additions.length ? el('ul', {}, k.improved.additions.map((x) => el('li', {}, el('b', { text: x.label + ': ' }), x.clause,
        x.prevents.length ? el('small', { class: 'muted', text: ' (يمنع: ' + x.prevents.join('، ') + ')' }) : null))) : null,
      el('div', { class: 'actions' }, el('button', { class: 'btn primary', type: 'button', onclick: () => { $('promptTxt').value = k.improved.prompt; $('promptTxt').focus(); toast_ok('وُضع في حقل البرومبت.'); } }, 'جرّبه في محاولة جديدة')),
      el('p', { class: 'hint', text: r.disclaimer }));
    p.scrollIntoView({ behavior: 'smooth' });
  }

  function errCard(e) {
    const ev = e.source_evidence.length
      ? e.source_evidence.map((q) => el('blockquote', { text: q }))
      : [el('p', { text: 'لا يوجد في المصدر ما يدعم هذا البند.' })];
    return el('div', { class: 'errcard ' + e.severity },
      el('header', {}, el('span', { text: `#${e.ordinal} ${e.label}` }),
        el('span', { class: 'chip', text: e.fabricated ? 'مضاف من خارج المصدر' : 'تحريف لما في المصدر' })),
      el('div', { class: 'cmp' },
        el('div', { class: 'bad' }, el('h4', { text: 'ما قاله النموذج' }), el('div', { text: e.claim })),
        el('div', { class: 'good' }, el('h4', { text: e.evidence_from === 'prompt' ? 'ما في البرومبت' : 'ما في المصدر' }), ...ev)),
      el('p', { class: 'meta' }, el('b', { text: 'الصحيح: ' }), e.correct_value),
      el('p', { class: 'meta' }, el('b', { text: 'لماذا أمكن الخطأ: ' }), e.explanation),
      el('div', { class: 'actions' }, e.source_evidence.length
        ? el('button', { class: 'btn small', type: 'button', onclick: () => highlightSource(e.source_evidence) }, 'أظهر في المصدر') : null));
  }

  function tableFrom(headers, units) {
    return el('div', { class: 'output' }, el('table', {},
      el('thead', {}, el('tr', {}, headers.map((h) => el('th', { text: h })))),
      el('tbody', {}, units.map((u) => el('tr', {}, u.cells.map((c) => el('td', { text: c })))))));
  }

  // ---------------------------------------------------------------- تمييز المصدر
  function clearHighlights() { if (state.session) $('sourceView').textContent = state.session.source.content; }
  function highlightSource(quotes) {
    const text = state.session.source.content;
    const spans = [];
    quotes.forEach((q) => { const i = text.indexOf(q); if (i >= 0) spans.push([i, i + q.length]); });
    spans.sort((a, b) => a[0] - b[0]);
    const view = clear($('sourceView'));
    let pos = 0, first = null;
    spans.forEach(([s, e]) => {
      if (s < pos) return;
      view.append(document.createTextNode(text.slice(pos, s)));
      const m = el('mark', { text: text.slice(s, e) });
      first ||= m; view.append(m); pos = e;
    });
    view.append(document.createTextNode(text.slice(pos)));
    if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
    $('sourceView').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ---------------------------------------------------------------- السجل والمقارنة
  function renderHistory() {
    const s = state.session;
    $('historyCard').hidden = !s || s.attempts.length === 0;
    if (!s) return;
    const ol = clear($('attemptList'));
    s.attempts.forEach((a) => {
      const bits = [];
      if (a.score !== undefined) bits.push('الدرجة ' + a.score);
      if (a.error_count !== undefined) bits.push('الأخطاء ' + a.error_count);
      ol.append(el('li', { class: state.current && state.current.id === a.id ? 'cur' : null },
        el('b', { text: 'محاولة ' + a.attempt_no }),
        el('span', { class: 'snip', text: a.prompt }),
        el('span', { class: 'muted', text: bits.join(' — ') }),
        el('button', { class: 'btn small', type: 'button', onclick: () => showAttempt(a) }, 'عرض')));
    });
  }

  async function loadCompare() {
    const box = $('compare');
    if (!state.session || state.session.attempts.length < 2) { box.hidden = true; return; }
    const c = await api('compare', { query: { session_id: state.session.id } });
    clear(box); box.hidden = !c.available;
    if (!c.available) return;
    const d = c.score_delta;
    box.append(el('b', { text: `مقارنة المحاولة ${c.previous.attempt_no} بالمحاولة ${c.latest.attempt_no}` }));
    if (d !== null) box.append(el('p', { class: d >= 0 ? 'up' : 'down', text: `الدرجة: ${c.previous.score} ← ${c.latest.score} (${d >= 0 ? '+' : ''}${d})` }));
    if (c.dimension_changes.length) box.append(el('ul', {}, c.dimension_changes.map((x) => el('li', { class: x.change > 0 ? 'up' : 'down', text: `${x.dimension}: ${x.change > 0 ? '+' : ''}${Math.round(x.change * 100)}%` }))));
    if (c.error_delta !== null) box.append(el('p', { text: `الأخطاء: ${c.previous.errors.length} ← ${c.latest.errors.length}` }));
    if (d === null || c.error_delta === null) box.append(el('p', { class: 'hint', text: c.message }));
  }

  // ---------------------------------------------------------------- المدرب
  async function loadTrainer() {
    const r = await api('trainer_attempts');
    const box = clear($('trainerList'));
    r.attempts.forEach((a) => box.append(el('div', { class: 'item' },
      el('span', { text: `#${a.attempt_id} — ${a.display_name} — ${a.title} — محاولة ${a.attempt_no}` }),
      el('button', { class: 'btn small', type: 'button', onclick: () => viewKey(a.attempt_id).catch((e) => toast(e.message)) }, 'عرض المفتاح'))));
  }
  async function viewKey(id) {
    const r = await api('trainer_key', { query: { attempt_id: id } });
    const box = clear($('trainerKey'));
    box.append(el('h3', { text: 'مفتاح المحاولة #' + id }), el('div', { class: 'promptbox', text: r.key.prompt }),
      ...r.errors.map(errCard), el('h3', { text: 'الإجابة الصحيحة' }), tableFrom(r.key.correct.headers, r.key.correct.units));
    box.scrollIntoView({ behavior: 'smooth' });
  }

  function needAttempt() {
    if (!state.current) throw new Error('نفّذ محاولة أولاً.');
    return state.current;
  }

  // ---------------------------------------------------------------- ربط الأحداث
  $('sampleSel').addEventListener('change', syncSample);
  $('sourceTxt').addEventListener('input', countSrc);
  $('startBtn').addEventListener('click', guard($('startBtn'), startSession));
  $('runBtn').addEventListener('click', guard($('runBtn'), run));
  $('evalBtn').addEventListener('click', guard($('evalBtn'), evaluate));
  $('improveBtn').addEventListener('click', guard($('improveBtn'), improve));
  $('revealBtn').addEventListener('click', guard($('revealBtn'), reveal));
  $('retryBtn').addEventListener('click', () => {
    ['evalPanel', 'improvePanel', 'revealPanel'].forEach((id) => { $(id).hidden = true; });
    clearHighlights();
    $('promptTxt').focus();
    $('promptTxt').scrollIntoView({ behavior: 'smooth', block: 'center' });
    toast_ok('عدّل البرومبت ثم اضغط «تنفيذ التعليمات». ستُسجَّل كمحاولة جديدة منفصلة.');
  });
  $('loginBtn').addEventListener('click', () => $('loginDlg').showModal());
  $('lgOk').addEventListener('click', async () => {
    try {
      const r = await api('login', { method: 'POST', body: { username: $('lgUser').value, password: $('lgPass').value } });
      state.csrf = r.csrf; $('loginDlg').close(); $('lgPass').value = '';
      await init();
    } catch (e) { const m = $('lgErr'); m.textContent = e.message; m.hidden = false; }
  });
  $('logoutBtn').addEventListener('click', async () => {
    await api('logout', { method: 'POST' }).catch(() => {});
    location.reload();
  });

  init().catch((e) => toast(e.message));
})();
