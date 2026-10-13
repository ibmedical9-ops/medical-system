/* Prompt Trap Lab — نسخة JavaScript من المحرك (مطابقة منطقياً لـ src/Domain و src/Support في PHP) */
const PTL = (() => {
'use strict';

// ---------------------------------------------------------------- Text
const MAP = {'أ':'ا','إ':'ا','آ':'ا','ٱ':'ا','ى':'ي','ئ':'ي','ة':'ه','ؤ':'و','٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9','،':',','؛':';','؟':'?'};
const STRIP = /^[ً-ٰٟـ​-‏‪-‮]$/u;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\\/\-]/g, '\\$&');
const Text = {
  normalize(s) {
    const chars = Array.from(s); let norm = ''; const map = [];
    chars.forEach((c, i) => { if (STRIP.test(c)) return; norm += (MAP[c] ?? c.toLowerCase()); map.push(i); });
    return { norm, map, chars };
  },
  norm(s) { return Text.normalize(s).norm; },
  rx(alts, wl = '', wr = '') { return new RegExp(wl + '(?:' + alts.split('|').map((a) => esc(Text.norm(a))).join('|') + ')' + wr, 'u'); },
  has(n, alts) { return Text.rx(alts).test(n); },
  find(n, re) {
    const m = re.exec(n.norm); if (!m || m[0].length === 0) return null;
    const cs = Array.from(n.norm.slice(0, m.index)).length, cl = Array.from(m[0]).length;
    const os = n.map[cs], oe = n.map[cs + cl - 1];
    return { text: n.chars.slice(os, oe + 1).join(''), start: os, end: oe + 1 };
  },
  slice(n, a, b) { return n.chars.slice(a, b === undefined ? n.chars.length : b).join(''); },
  sentences(t) { return t.trim().split(/(?<=[.!?؟…])\s+|\r?\n+/u).map((x) => x.trim()).filter(Boolean); },
  clean(s) { return s.trim().replace(/[\s.!?؟،,;؛…]+$/u, '').trim(); },
  contains(h, n) { return n !== '' && Text.norm(h).includes(Text.norm(n)); },
};
const has = Text.has;

// ---------------------------------------------------------------- Rng
const mul32 = (a, b) => Math.imul(a, b) >>> 0;
class Rng {
  constructor(seed) { this.s = seed >>> 0; }
  float() {
    this.s = (this.s + 0x6D2B79F5) >>> 0;
    let t = this.s;
    t = mul32((t ^ (t >>> 15)) >>> 0, (t | 1) >>> 0);
    t = (t ^ ((t + mul32((t ^ (t >>> 7)) >>> 0, (t | 61) >>> 0)) >>> 0)) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  chance(p) { return p > 0 && this.float() < p; }
  pick(a) { return a[Math.floor(this.float() * a.length)]; }
  shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.float() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
}

// ---------------------------------------------------------------- MeetingParser
const HEADERS = ['الحضور','المشاركون','المشاركين','التاريخ','العنوان','الموضوع','المكان','الجلسة'];
const DAYS = 'الأحد|الاحد|الإثنين|الاثنين|الثلاثاء|الأربعاء|الاربعاء|الخميس|الجمعة|السبت';
const MONTHS = 'يناير|فبراير|مارس|أبريل|ابريل|مايو|يونيو|يوليو|أغسطس|اغسطس|سبتمبر|أكتوبر|اكتوبر|نوفمبر|ديسمبر|كانون الثاني|شباط|آذار|نيسان|أيار|حزيران|تموز|آب|أيلول|تشرين الأول|تشرين الثاني|كانون الأول';

function parseMeeting(source) {
  let participants = [], title = null, date = null, speaker = null; const utt = [];
  for (let line of source.trim().split(/\r?\n|\r/u)) {
    line = line.trim(); if (!line) continue;
    const m = /^([^:：]{1,30})[:：]\s*(.*)$/u.exec(line);
    if (m && (m[1].trim().split(' ').length - 1) <= 2) {
      const label = m[1].trim(), rest = m[2].trim(), nl = Text.norm(label); let isHeader = false;
      for (const h of HEADERS) if (nl === Text.norm(h)) {
        isHeader = true;
        if (['الحضور','المشاركون','المشاركين'].includes(h)) { for (let p of rest.split(/\s*[،,;؛]\s*|\s+و(?=\s)\s*/u)) { p = p.trim(); if (p) participants.push(p); } }
        else if (h === 'التاريخ') date = rest; else if (h === 'العنوان' || h === 'الموضوع') title = rest;
      }
      if (isHeader) continue;
      speaker = label; participants.push(label); line = rest;
    }
    for (const s of Text.sentences(line)) utt.push([speaker, s]);
  }
  participants = [...new Set(participants)];
  const items = []; let lastPending = null;
  for (const [spk, sentence] of utt) {
    const n = Text.normalize(sentence), norm = n.norm;
    if (/^(?:ولكن |لكن )?(?:هذا )?(?:الموعد|التاريخ)(?![ء-ي])/u.test(norm) && has(norm, 'تقريبي|مبدئي|غير نهائي|غير مؤكد|قابل للتغيير') && items.length) {
      const last = items[items.length - 1]; last.due_status = last.due ? 'tentative' : 'none'; last.evidence.push(Text.clean(sentence)); continue;
    }
    const isOpen = has(norm, 'لم يحسم|لم نحسم|لم تحسم|غير محسوم|لم يتم تحديد|لم يتم الاتفاق|لم نتفق|لم يحدد|لم يتحدد|لم تحدد|نؤجل البت|يؤجل البت|نحتاج الي معرفة|نحتاج الي تحديد|نحتاج الي التاكد|لا نعرف|ما زال مفتوح|سنناقش لاحقا|بحاجة الي قرار|بانتظار') && !has(norm, 'تقرر|قررنا');
    const isReject = has(norm, 'رفضنا|تم رفض|تم رفضه|مرفوض|لم نوافق|لا نوافق علي|لم يتم قبول|رفض الاقتراح|رفضت');
    const approveCue = has(norm, 'تمت الموافقه|وافق الجميع|اتفق الجميع|اتفقنا|تم الاتفاق|نوافق جميعا|وافقنا|لا اعتراض|تمت الموافقة');
    const refWord = has(norm, 'ذلك|هذا|الاقتراح|المقترح|ما سبق|الفكره');
    const isApprovalRef = approveCue && !isOpen && (refWord || Array.from(norm).length < 28) && !/علي (?:ان|تاجيل|اعتماد|اختيار)/u.test(norm);
    const isProposal = has(norm, 'اقترح|اقتراح|ماذا لو|ما رايكم|يمكننا ان|هل نستطيع|افضل ان|اري ان|اظن ان|ممكن ان|فكره');
    const isDecision = !isOpen && has(norm, 'تقرر|قررنا|قرر |تم الاتفاق علي|اتفقنا علي|تمت الموافقه علي|وافقنا علي|تم اعتماد|اعتمدنا|تم اختيار|اخترنا|القرار');
    const owner = ownerOf(norm, spk, participants), taskCue = taskCueOf(norm, participants);
    if (isOpen) { items.push(mkItem('open', sentence, spk, null, n)); continue; }
    if (isReject && lastPending !== null) { items[lastPending].status = 'rejected'; items[lastPending].evidence.push(Text.clean(sentence)); lastPending = null; continue; }
    if (isApprovalRef && lastPending !== null) {
      const it = items[lastPending]; it.status = 'approved'; it.kind = (it.owner !== null || it.task_cue) ? 'task' : 'decision';
      it.evidence.push(Text.clean(sentence)); lastPending = null; continue;
    }
    if (isProposal && !isDecision) { const it = mkItem('proposal', sentence, spk, owner, n); it.status = 'pending'; it.task_cue = taskCue; items.push(it); lastPending = items.length - 1; continue; }
    if (isDecision && taskCue) { items.push(mkItem('task', sentence, spk, owner, n)); continue; }
    if (isDecision) { items.push(mkItem('decision', sentence, spk, null, n)); continue; }
    if (taskCue) { items.push(mkItem('task', sentence, spk, owner, n)); continue; }
    if (norm.split(/\s+/u).filter(Boolean).length >= 4) items.push(mkItem('discussion', sentence, spk, null, n));
  }
  items.forEach((it, i) => { it.id = i + 1; });
  return { title, date, participants, items };
}
function mkItem(kind, sentence, speaker, owner, n) {
  const norm = n.norm;
  const hedge = has(norm, 'ربما|قد |اظن|لعل|اتوقع|غالبا|تقريبا|مبدئيا|ان امكن|نحاول|احاول|ساحاول|سنحاول|نامل|لكن هذا الموعد');
  const [due, dueStatus] = deadline(n, hedge), [core, cond] = condition(n, sentence);
  return { id: 0, kind, text: Text.clean(sentence), core: Text.clean(core), condition: cond === null ? null : Text.clean(cond), speaker, owner, due, due_status: dueStatus,
    hedged: hedge && kind === 'task', status: kind === 'proposal' ? 'pending' : null, task_cue: false, evidence: [Text.clean(sentence)] };
}
const SKIP_T = ['سيكون','ستكون','سنكون','سنوات','سنتين','سياره','سيارات','سيناريو','سينما','ستوديو','سيرفر','سيستم','ستايل','ستيف','ساعه','ساعات','ساعتين','ساعتان','سابق','سابقا','ساحه','ساكن','سايق','سالف','سياسه','سياسات','ستين','سنتر'];
function taskCueOf(norm, participants) {
  if (/(?<![ء-ي])(?:يتولي|تتولي|ستتولي|سيتولي|سنتولي|تكليف|كلف|تكلف|يكلف|اسند|تسند|مسوول(?:ه|ين)?|مسووليه)(?![ء-ي])/u.test(norm)) return true;
  if (/(?<![ء-ي])سيتم(?![ء-ي])/u.test(norm)) return true;
  if (/(?<![ء-ي])علي\s+\S+\s+ان\s/u.test(norm)) return true;
  const skip = SKIP_T.concat(participants.map((p) => Text.norm(p.split(' ')[0])));
  for (const tok of norm.match(/(?<![ء-ي])(?:سا|سي|ست|سن)[ء-ي]{2,}(?![ء-ي])/gu) || []) if (!skip.includes(tok) && !tok.startsWith('سنا')) return true;
  return false;
}
function ownerOf(norm, speaker, participants) {
  const skip = participants.map((p) => Text.norm(p.split(' ')[0])).concat(['ساعه','ساعات','ساعتين','سابق','سابقا','ساحه','ساكن','سايق']);
  for (const tok of norm.match(/(?<![ء-ي])سا[ء-ي]{2,}(?![ء-ي])/gu) || []) if (!skip.includes(tok)) return speaker;
  const found = [];
  for (const p of participants) {
    if (p === speaker) continue;
    const m = new RegExp('(?<![ء-ي])(?:و|ل|ب|ك|ف)?' + esc(Text.norm(p.split(' ')[0])) + '(?![ء-ي])', 'u').exec(norm);
    if (m) found.push([m.index, p]);
  }
  if (found.length) { found.sort((a, b) => a[0] - b[0]); return found[0][1]; }
  return null;
}
function deadline(n, hedge) {
  const d = Text.norm(DAYS), mo = Text.norm(MONTHS);
  const core = '(?:' + d + ')|نهايه\\s+(?:الاسبوع|الشهر|الربع|السنه)|الاسبوع\\s+(?:القادم|المقبل)|الشهر\\s+(?:القادم|المقبل)|\\d{1,4}[\\/\\-]\\d{1,2}(?:[\\/\\-]\\d{1,4})?|\\d{1,2}\\s+(?:' + mo + ')(?:\\s+\\d{4})?|(?:' + mo + ')\\s+(?:القادم|المقبل)|بعد\\s+\\d+\\s+(?:ايام|يوم|اسابيع|اسبوع|اشهر|شهر)|بعد\\s+(?:يومين|اسبوعين|شهرين)|غدا|بعد غد|الاسبوع القادم';
  const re = new RegExp('(?<![ء-ي])(?:(?:قبل|بحلول|حتي|خلال|مع|في)\\s+|ب)?(?:يوم\\s+)?(?:' + core + ')(?:\\s+(?:القادم|المقبل))?', 'u');
  const hit = Text.find(n, re); if (!hit) return [null, 'none'];
  return [Text.clean(hit.text), (hedge || has(n.norm, 'تقريبي|مبدئي|غير نهائي|غير مؤكد')) ? 'tentative' : 'confirmed'];
}
function condition(n, sentence) {
  const hit = Text.find(n, /(?<![ء-ي])(?:بشرط|ما لم|الا اذا|شريطه|علي ان يتم|بعد موافقه|بعد اعتماد|بحيث|اذا)(?![ء-ي])/u);
  if (!hit || hit.start < 8) return [sentence, null];
  return [Text.slice(n, 0, hit.start), Text.slice(n, hit.start)];
}

// ---------------------------------------------------------------- PromptAnalyzer
const DIMENSIONS = {
  task: { label: 'وضوح المهمة', weight: 15, gap: 'لم تُحدَّد المهمة بدقة؛ يمكن للنموذج اختيار تفسير واحد من عدة تفسيرات.' },
  source: { label: 'تحديد المصدر', weight: 15, gap: 'لم تُلزم النموذج بالاعتماد على المصدر وحده؛ يمكنه إضافة معلومات من عنده.' },
  scope: { label: 'نطاق المعلومات', weight: 15, gap: 'لم تُحدَّد المعلومات المطلوبة ولا مدى الاكتمال؛ يمكنه الإجابة عن جزء وإسقاط تفاصيل.' },
  format: { label: 'تنسيق المخرجات', weight: 10, gap: 'لم يُحدَّد شكل المخرجات؛ يمكنه اختيار شكل لا يناسب حاجتك.' },
  unknown: { label: 'التعامل مع المجهول', weight: 15, gap: 'لم تحدد ماذا يفعل مع المعلومة الناقصة؛ يمكنه ملؤها بتخمين.' },
  distinction: { label: 'التمييز بين الحقيقة والمقترح والقرار', weight: 15, gap: 'لم تطلب التمييز بين المؤكد والمقترح وغير المحسوم؛ يمكنه الخلط بينها.' },
  verification: { label: 'التحقق مقابل المصدر', weight: 15, gap: 'لم تشترط مراجعة النتائج مقابل المصدر؛ تمر الأخطاء دون فحص.' },
};
const CATEGORIES = {
  decisions: 'قرار|قرارات|اتفاق|اتفاقات|ما تم الاتفاق|ما تقرر|ما تم اعتماده',
  tasks: 'مهمة|مهام|مطلوب|اجراءات|إجراءات|تكليفات|التزامات|اعمال المتابعة|بنود العمل',
  owners: 'مسؤول|مسؤولين|مسؤولية|مسؤوليات|المكلف|المكلفين|من سيقوم|اصحاب المهام',
  deadlines: 'موعد|مواعيد|تاريخ|تواريخ|الموعد النهائي|مهلة|مهل|جدول زمني|متى',
  proposals: 'مقترح|مقترحات|اقتراح|اقتراحات|افكار',
  open: 'غير محسوم|غير المحسومة|معلق|معلقة|نقاط مفتوحة|لم تحسم|لم يحسم|نقاط عالقة|اسئلة مفتوحة',
};
function formatKind(p) {
  if (/json/u.test(p)) return 'json';
  if (/جدول(?!\s+زمني)|اعمده|عمود|csv/u.test(p)) return 'table';
  if (has(p, 'قايمه|نقاط|ترقيم|مرقمه|bullet|بنود')) return 'list';
  if (has(p, 'فقره|فقرات|نثر|سرد')) return 'prose';
  return 'none';
}
const j = (a) => a.filter(Boolean).join('، ');
function analyze(prompt) {
  const p = Text.norm(prompt), requested = [];
  for (const [c, a] of Object.entries(CATEGORIES)) if (has(p, a)) requested.push(c);
  const L = {};
  { const verb = has(p, 'استخرج|لخص|حلل|اكتب|اعرض|حدد|اذكر|رتب|صنف|اسرد|عدد|سجل|قدم|اعطني|اريد|جمع|فرز|ولد|اعد'); const o = requested.length;
    L.task = [Math.min(1, (verb ? .35 : 0) + (o >= 2 ? .65 : o === 1 ? .4 : 0)), j([verb && 'فعل الطلب', o && 'نوع المعلومات المطلوبة (' + o + ')'])]; }
  { const ref = has(p, 'من المصدر|من النص|المحضر|محضر|النص المرفق|المصدر|الوارد في|المذكور في|بناء علي النص|استنادا الي|بالاعتماد علي|وفق النص');
    const only = has(p, 'وحده|وحدها|حصرا|فحسب|دون سواه|دون غيره');
    const excl = only || /(?:من|علي|الي|في|ب)\s*(?:ال)?(?:مصدر|نص|محضر)\S*\s+فقط|فقط\s+(?:من|علي|ب)\s*(?:ال)?(?:مصدر|نص|محضر)/u.test(p) || has(p, 'لا تضف|لا تخترع|لا تستخدم اي معلومات|لا تستخدم معلومات|من خارج|دون اضافه|لا تفترض|لا تعتمد علي اي معلومات|لا تضيف');
    L.source = [(ref ? .5 : 0) + (excl ? .5 : 0), j([ref && 'الإشارة إلى المصدر', excl && 'الحصر في المصدر/منع الإضافة'])]; }
  { const n = requested.length, base = n >= 3 ? .7 : n === 2 ? .5 : n === 1 ? .3 : 0;
    const comp = has(p, 'جميع|كل |كافة|لا تحذف|لا تهمل|دون حذف|حافظ علي|التفاصيل|الشروط|الاستثناءات|شامل|كامل|بالكامل');
    L.scope = [Math.min(1, base + (comp ? .3 : 0)), j([n && 'فئات المعلومات المطلوبة (' + n + ')', comp && 'اشتراط الاكتمال/حفظ التفاصيل'])]; }
  { const k = formatKind(p);
    L.format = k !== 'none' ? [1, 'نوع الشكل (' + k + ')'] : has(p, 'منظم|مرتب|واضح|مختصر|موجز|بسيط') ? [.25, 'وصف عام للشكل دون تحديده'] : [0, '']; }
  { const cond = /(?:اذا|في حال|عند|حين|لو)\s.{0,40}?(?:غير|مجهول|ناقص|لم يذكر|لم تذكر|لم يحدد|مفقود|ما ذكر|غاب|غابت|لم يرد|لم ترد)/u.test(p)
      || /(?:اي|كل)\s+(?:معلومه|مسوول|موعد|اسم|تاريخ|بند)\S*(?:\s+او\s+\S+)?\s+(?:لم يرد|لم ترد|لم يذكر|لم تذكر|لم يحدد|غير مذكور|غير موجود|غير محدد|مفقود)/u.test(p)
      || /(?:المعلومات?|المعلومه|الاسم|الموعد|المسوول)\s+(?:المجهول|الناقص|غير المذكور|غير المحدد|المفقود)/u.test(p);
    const label = has(p, 'غير محدد|غير معروف|غير مذكور|مجهول|ناقص|لم يحدد');
    const action = /(?<![ء-ي])(?:ف|و)?(?:اكتب|اذكر|ضع|اشر|سجل|علم|وضح|بين|قل|صرح|اعلن)/u.test(p);
    const ng = has(p, 'لا تخمن|لا تفترض|لا تخترع|لا تتوقع|لا تضف');
    let s = 0; const f = [];
    if (cond) { s += .5; f.push('حالة المعلومة الناقصة'); if (action) { s += .5; f.push('ما يُكتب عندها'); } }
    else if (label) { s += .3; f.push('ذُكر «غير محدد» دون قاعدة واضحة'); }
    if (ng) { s += .35; f.push('منع التخمين'); }
    L.unknown = [Math.min(1, s), j(f)]; }
  { const verb = has(p, 'ميز|فرق|افصل|صنف|قسم|فصل'), noun = has(p, 'مقترح|قرار|مؤكد|محسوم|افتراض|حقيق|نهائي|معتمد');
    const nc = has(p, 'لا تحول|لا تخلط|لا تعتبر|لا تعامل|لا تجعل') && has(p, 'مقترح|اقتراح');
    const weak = has(p, 'مؤكد|محسوم|نهائي|معتمد|رسمي'); let s = 0; const f = [];
    if (verb && noun) { s += .8; f.push('طلب التمييز بين الأنواع'); }
    if (nc) { s += .4; f.push('منع تحويل المقترح إلى قرار'); }
    if (s === 0 && weak) { s = .35; f.push('إشارة عابرة إلى «المؤكد» دون قاعدة للتمييز'); }
    L.distinction = [Math.min(1, s), j(f)]; }
  { const verb = has(p, 'راجع|تحقق|دقق|قارن|طابق|تاكد|فحص|اختبر');
    const ref = /(?:مقابل|مع|من|في|الي|علي|بالرجوع الي|ب)\s*(?:ال)?(?:مصدر|نص|محضر)/u.test(p);
    L.verification = verb && ref ? [1, 'مراجعة النتائج مقابل المصدر'] : verb ? [.4, 'طلب مراجعة دون ربطها بالمصدر'] : has(p, 'كن دقيق|بدقة|دقيق|بعناية') ? [.1, 'عبارة «دقيق» وحدها لا تحدد أي فحص'] : [0, '']; }

  let score = 0, min = 1; const dims = {}, gaps = [];
  for (const [k, m] of Object.entries(DIMENSIONS)) {
    const [lv, found] = L[k]; score += m.weight * lv; min = Math.min(min, lv);
    const status = lv >= .75 ? 'ok' : lv >= .35 ? 'partial' : 'missing'; if (lv < .75) gaps.push(k);
    dims[k] = { label: m.label, weight: m.weight, level: Math.round(lv * 100) / 100, status,
      detail: status === 'ok' ? 'محدَّد: ' + found : found !== '' ? 'محدَّد جزئياً: ' + found + ' — ' + m.gap : m.gap };
  }
  score = Math.round(score);
  return { score, dimensions: dims, gaps, requested, format: formatKind(p), mode: (score >= 85 && min >= .75) ? 'precise' : 'trap', min_level: Math.round(min * 100) / 100 };
}

// ---------------------------------------------------------------- Simulator
const TYPES = {
  assumption: ['خطأ الافتراض', 'high'], ambiguity: ['خطأ الغموض', 'medium'], omission: ['خطأ الحذف', 'medium'], confusion: ['خطأ الالتباس', 'high'],
  attribution: ['خطأ الإسناد', 'high'], time: ['خطأ الزمن', 'high'], format: ['خطأ التنسيق', 'low'], scope: ['خطأ النطاق', 'medium'],
};
const TRAP_DIMS = { ambiguity: ['task'], scope: ['scope','task'], confusion: ['distinction','verification'], attribution: ['unknown','source','verification'],
  time: ['unknown','verification'], assumption: ['source','unknown','verification'], omission: ['scope','verification'], format: ['format'] };
const CAT_ORDER = { decision: 0, task: 1, proposal: 2, open: 3, discussion: 4 };
const CAT_LABEL = { decision: 'قرار', task: 'مهمة', proposal: 'مقترح', open: 'نقطة مفتوحة', discussion: 'نقطة نقاش' };
const PROSE_TITLE = { decision: 'القرارات', task: 'المهام', proposal: 'المقترحات', open: 'النقاط المفتوحة', discussion: 'النقاش' };
const REQ_TO_CAT = { decisions: 'decision', tasks: 'task', proposals: 'proposal', open: 'open' };

function dueCell(r) { if (r.due === null) return r.cat === 'task' ? 'غير محدد' : '—'; return r.due_status === 'tentative' ? r.due + ' (تقريبي — غير مؤكد)' : r.due; }
function render(rows, style, cols) {
  if (style === 'prose') {
    const groups = {}; rows.forEach((r) => (groups[r.cat] ||= []).push(r));
    const units = [], map = {}, paras = []; let n = 0;
    for (const cat of ['decision','task','proposal','open','discussion']) {
      if (!groups[cat]) continue; const id = 'u' + (++n);
      const parts = groups[cat].map((r) => { let s = r.text; if (r.owner !== null) s += ' (المسؤول: ' + r.owner + ')'; if (r.due !== null) s += ' — الموعد: ' + r.due; map[r.key] = id; return s; });
      const para = PROSE_TITLE[cat] + ': ' + parts.join('؛ ') + '.'; paras.push(para); units.push({ id, cat, cells: [para] });
    }
    return { headers: [], units, text: paras.length ? paras.join('\n\n') : 'لا توجد بنود مطابقة في المصدر.', key_to_unit: map };
  }
  const headers = ['النوع', 'البند']; if (cols.owner) headers.push('المسؤول'); if (cols.due) headers.push('الموعد'); headers.push('الحالة');
  const units = [], map = {};
  rows.forEach((r, i) => {
    const id = 'u' + (i + 1), cells = [CAT_LABEL[r.cat] ?? r.cat, r.text];
    if (cols.owner) cells.push(r.owner ?? (r.cat === 'task' ? 'غير محدد' : '—')); if (cols.due) cells.push(dueCell(r)); cells.push(r.status);
    units.push({ id, cat: r.cat, cells }); map[r.key] = id;
  });
  if (!units.length) return { headers, units: [], text: 'لا توجد بنود مطابقة في المصدر.', key_to_unit: {} };
  let text;
  if (style === 'json') text = JSON.stringify(units.map((u) => Object.fromEntries(headers.map((h, i) => [h, u.cells[i]]))), null, 4);
  else if (style === 'table') text = ['| ' + headers.join(' | ') + ' |', '|' + ' --- |'.repeat(headers.length), ...units.map((u) => '| ' + u.cells.map((c) => c.replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ') + ' |')].join('\n');
  else text = units.map((u) => '- ' + u.cells[0] + ': ' + u.cells[1] + ' — ' + headers.slice(2).map((h, i) => h + ': ' + u.cells.slice(2)[i]).join(' — ')).join('\n');
  return { headers, units, text, key_to_unit: map };
}

class Simulator {
  run(truth, analysis, source, seed) {
    this.seq = 0; this.errors = []; this.omitted = []; this.assumptions = []; this.touched = {};
    const rng = new Rng(seed), vague = !analysis.requested.length;
    const cats = this.effectiveCats(analysis.requested), cols = this.columns(analysis.requested);
    let rows = this.project(truth, cats); const baseCount = rows.length, baseKeys = rows.map((r) => r.key);
    let style = analysis.format === 'none' ? 'list' : analysis.format, forceProse = false;
    const ctx = { rows, truth, cats, rng, baseCount, source };
    const self = this;
    if (analysis.mode === 'trap') {
      const p = this.probabilities(analysis.dimensions), force = analysis.score < 50;
      const lowest = (ds) => Math.min(...ds.map((d) => analysis.dimensions[d].level));
      let discussionMode = false;
      if (vague && rng.chance(p.ambiguity)) discussionMode = this.ambiguity(ctx);
      if (!discussionMode) {
        if (!this.hasError('ambiguity') && rng.chance(p.scope)) this.scope(ctx);
        if (rng.chance(p.confusion)) { const n = lowest(TRAP_DIMS.confusion) < .25 && rng.chance(.6) ? 2 : 1; for (let i = 0; i < n; i++) this.confusion(ctx); }
        if (rng.chance(p.attribution)) this.attribution(ctx);
        if (rng.chance(p.time)) { const n = lowest(TRAP_DIMS.time) < .25 && rng.chance(.5) ? 2 : 1; for (let i = 0; i < n; i++) this.time(ctx); }
        if (rng.chance(p.assumption)) this.assumption(ctx, lowest(TRAP_DIMS.assumption) < .25);
        if (rng.chance(p.omission)) this.omission(ctx);
        if (force && !this.errors.length) {
          for (const t of ['confusion','time','assumption','attribution','omission','scope']) {
            const before = this.errors.length;
            ({ confusion: () => self.confusion(ctx), time: () => self.time(ctx), assumption: () => self.assumption(ctx, false), attribution: () => self.attribution(ctx), omission: () => self.omission(ctx), scope: () => self.scope(ctx) })[t]();
            if (this.errors.length > before) break;
          }
        }
      }
      if (analysis.format === 'none' && rng.chance(p.format) && ctx.rows.length >= 2) forceProse = true;
    }
    rows = ctx.rows;
    rows.sort((a, b) => (CAT_ORDER[a.cat] - CAT_ORDER[b.cat]) || (a.order - b.order));
    style = forceProse ? 'prose' : style;
    const out = render(rows, style, cols);
    if (forceProse) this.addError('format', null, '*', 'عُرضت النتيجة كفقرات متصلة دون جدول، وسقطت منها خانة الحالة (قرار/مقترح/غير محسوم).', ['البرومبت لم يحدد شكل المخرجات'],
      'جدول بأعمدة النوع والبند والمسؤول والموعد والحالة، يبقي الفروق بين المؤكد وغير المؤكد ظاهرة.',
      'لم يحدد البرومبت صيغة المخرجات، فاختار النموذج أسلوباً سردياً يخفي حالة كل بند ويخلط المسؤول والموعد داخل الجملة.', 'format', false, 'prompt');
    for (const e of this.errors) { if (e.row_key !== null && out.key_to_unit[e.row_key]) e.unit_id = out.key_to_unit[e.row_key]; delete e.row_key; }
    const correct = render(this.project(truth, ['decision','task','proposal','open']), 'table', { owner: true, due: true });
    const untouched = baseKeys.filter((k) => !this.touched[k]).length;
    return { style, headers: out.headers, units: out.units, text: out.text, errors: this.errors, omitted: this.omitted, assumptions: this.assumptions,
      correct: { headers: correct.headers, units: correct.units, text: correct.text },
      stats: { mode: analysis.mode, rows_in_output: out.units.length, rows_expected: baseCount, rows_with_errors: baseCount - untouched, rows_correct: untouched, error_count: this.errors.length,
        accuracy_percent: baseCount > 0 ? Math.round(100 * untouched / baseCount) : 100 },
      no_error_note: this.errors.length ? null : 'لم تتضمن النتيجة خطأً قابلاً للإثبات بالمقارنة مع المصدر.' };
  }
  effectiveCats(req) {
    if (!req.length) return ['decision', 'task'];
    const c = []; req.forEach((r) => { if (REQ_TO_CAT[r]) c.push(REQ_TO_CAT[r]); });
    if (req.includes('owners') || req.includes('deadlines')) c.push('task');
    return [...new Set(c.length ? c : ['decision', 'task'])];
  }
  columns(req) { const t = req.includes('tasks') || !req.length; return { owner: t || req.includes('owners'), due: t || req.includes('deadlines') }; }
  project(truth, cats) { const rows = []; for (const it of truth.items) if (cats.includes(it.kind)) rows.push(this.rowFromItem(it, rows.length)); return rows; }
  rowFromItem(it, order) {
    const status = it.kind === 'decision' ? 'قرار مؤكد' : (it.kind === 'task' && it.hedged) ? 'التزام غير مؤكد' : it.kind === 'task' ? 'مهمة مؤكدة'
      : (it.kind === 'proposal' && it.status === 'rejected') ? 'مقترح مرفوض' : it.kind === 'proposal' ? 'مقترح — لم يُعتمد' : it.kind === 'open' ? 'غير محسوم' : 'نقطة نقاش';
    return { key: ++this.seq, order, cat: it.kind, text: it.text, owner: it.owner, due: it.due, due_status: it.due_status, status, item_id: it.id, item: it, evidence: it.evidence, fabricated: false, owner_assumed: false };
  }
  probabilities(dims) { const f = (l) => l < .5 ? .9 : l < .75 ? .4 : 0; const p = {}; for (const [t, ds] of Object.entries(TRAP_DIMS)) p[t] = Math.max(...ds.map((d) => f(dims[d].level))); return p; }
  canTouch(base) { return Object.keys(this.touched).length < Math.max(1, Math.floor(.6 * base)); }
  hasError(t) { return this.errors.some((e) => e.type === t); }
  touch(r) { this.touched[r.key] = true; }
  addError(type, rowKey, unit, claim, evidence, correct, why, dim, fab, from = 'source') {
    this.errors.push({ type, label: TYPES[type][0], severity: TYPES[type][1], row_key: rowKey, unit_id: unit, claim, source_evidence: [...evidence], evidence_from: from, correct_value: correct, explanation: why, cause_dim: dim, fabricated: fab });
  }
  ambiguity(c) {
    const by = {}; c.rows.forEach((r) => (by[r.cat] ||= []).push(r)); const opts = {};
    if (by.decision && by.task) { opts.decisions_only = [by.task, 'استخراج القرارات فقط']; opts.tasks_only = [by.decision, 'استخراج المهام فقط']; }
    const disc = c.truth.items.filter((i) => i.kind === 'discussion');
    if (disc.length && c.rows.length) opts.discussion = [c.rows, 'تلخيص مجريات النقاش'];
    const keys = Object.keys(opts); if (!keys.length) return false;
    const choice = c.rng.pick(keys), [dropped, label] = opts[choice];
    if (choice === 'decisions_only') c.rows = c.rows.filter((r) => r.cat === 'decision');
    else if (choice === 'tasks_only') c.rows = c.rows.filter((r) => r.cat === 'task');
    else c.rows = disc.slice(0, 4).map((d, i) => this.rowFromItem(d, i));
    const ev = [];
    for (const d of dropped) { ev.push(d.evidence[0]); this.omitted.push({ reason: 'ambiguity', category: d.cat, text: d.text, evidence: d.evidence }); this.touch(d); }
    this.addError('ambiguity', null, null, 'فُسِّر الطلب على أنه «' + label + '».', ev.slice(0, 3),
      'الطلب «مخرجات الاجتماع» يحتمل عدة معانٍ؛ المطلوب غالباً: القرارات والمهام (مع المسؤول والموعد) ومعها المقترحات والنقاط غير المحسومة.',
      'العبارة «مخرجات الاجتماع» لا تحدد أي معلومات تُستخرج، فاختار النموذج تفسيراً واحداً دون سؤالك، وأسقط ' + dropped.length + ' بنداً موجوداً في المصدر.', 'task', false, 'prompt+source');
    return choice === 'discussion';
  }
  scope(c) {
    const by = {}; c.rows.forEach((r) => (by[r.cat] ||= []).push(r)); if (Object.keys(by).length < 2) return;
    for (const cat of c.rng.shuffle(Object.keys(by))) {
      const dropped = by[cat]; if (Object.keys(this.touched).length + dropped.length > Math.max(1, Math.floor(.6 * c.baseCount))) continue;
      c.rows = c.rows.filter((r) => r.cat !== cat); const ev = [];
      for (const d of dropped) { ev.push(d.evidence[0]); this.touch(d); this.omitted.push({ reason: 'scope', category: cat, text: d.text, evidence: d.evidence }); }
      this.addError('scope', null, null, 'غابت فئة «' + CAT_LABEL[cat] + '» كلياً من المخرجات (' + dropped.length + ' بنداً).', ev.slice(0, 3), 'تغطية فئة «' + CAT_LABEL[cat] + '» أيضاً.',
        'لم يحدد البرومبت نطاق المعلومات المطلوبة ولا اشترط الاكتمال، فأجاب النموذج عن جزء من المهمة وأهمل الباقي.', 'scope', false);
      return;
    }
  }
  confusion(c) {
    const target = c.cats.includes('decision') ? 'decision' : c.cats.includes('task') ? 'task' : null; if (target === null) return;
    const done = this.errors.map((e) => e.item_id ?? null), cands = {};
    for (const it of c.truth.items) {
      if (done.includes(it.id)) continue;
      const g = (it.kind === 'proposal' && it.status === 'pending') ? 0 : it.kind === 'open' ? 1 : (it.kind === 'proposal' && it.status === 'rejected') ? 2 : (it.kind === 'task' && it.hedged) ? 3 : null;
      if (g !== null) (cands[g] ||= []).push(it);
    }
    for (const g of Object.keys(cands).map(Number).sort((a, b) => a - b)) for (const it of c.rng.shuffle(cands[g])) {
      let ex = null; c.rows.forEach((r, i) => { if (r.item_id === it.id) ex = i; });
      if (ex !== null && this.touched[c.rows[ex].key]) continue;
      let row;
      if (ex !== null) { if (!this.canTouch(c.baseCount)) return; row = c.rows[ex]; }
      else { c.rows.push(this.rowFromItem(it, 10000 + it.id)); row = c.rows[c.rows.length - 1]; }
      const before = row.status;
      row.cat = (it.kind === 'task' || (it.owner !== null && target === 'task')) ? 'task' : target; if (it.kind === 'task') row.cat = 'task';
      row.status = row.cat === 'task' ? 'مهمة مؤكدة' : 'قرار مؤكد'; if (row.due !== null) row.due_status = 'confirmed';
      this.touch(row);
      const correct = (it.kind === 'proposal' && it.status === 'rejected') ? 'مقترح رُفض صراحة ولم يُعتمد.' : it.kind === 'proposal' ? 'مقترح لم تتم الموافقة عليه.' : it.kind === 'open' ? 'نقطة غير محسومة.' : 'التزام غير مؤكد (المتحدث تحفّظ في صياغته).';
      this.errors.push({ type: 'confusion', label: TYPES.confusion[0], severity: 'high', row_key: row.key, unit_id: null, item_id: it.id, claim: row.text + ' — ' + row.status,
        source_evidence: it.evidence, evidence_from: 'source', correct_value: correct + ' (الحالة في الإخراج: «' + before + '» → «' + row.status + '»)',
        explanation: 'لم يطلب البرومبت التمييز بين المؤكد والمقترح وغير المحسوم، فعاملها النموذج كأنها بند نهائي.', cause_dim: 'distinction', fabricated: false });
      return;
    }
  }
  attribution(c) {
    const cands = []; c.rows.forEach((r, i) => { if (r.cat === 'task' && r.owner !== null && !this.touched[r.key]) cands.push(i); });
    if (!cands.length || !this.canTouch(c.baseCount)) return;
    const row = c.rows[c.rng.pick(cands)];
    const others = c.truth.participants.filter((p) => p !== row.owner && !Text.contains(row.text, p.split(' ')[0])); if (!others.length) return;
    const wrong = c.rng.pick(others), real = row.owner; row.owner = wrong; this.touch(row);
    this.errors.push({ type: 'attribution', label: TYPES.attribution[0], severity: 'high', row_key: row.key, unit_id: null, item_id: row.item_id, claim: 'المسؤول: ' + wrong + ' — ' + row.text,
      source_evidence: row.evidence, evidence_from: 'source', correct_value: 'المسؤول وفق المصدر: ' + real,
      explanation: 'لم يشترط البرومبت الرجوع إلى المصدر لكل اسم ولا مراجعة الإسناد، فنُسبت المهمة إلى شخص غير مذكور فيها.', cause_dim: 'verification', fabricated: false });
  }
  time(c) {
    const tent = [], none = [];
    c.rows.forEach((r, i) => { if (this.touched[r.key]) return; if (r.due !== null && r.due_status === 'tentative') tent.push(i); else if (r.cat === 'task' && r.due === null) none.push(i); });
    if (!this.canTouch(c.baseCount)) return;
    if (tent.length) {
      const row = c.rows[c.rng.pick(tent)]; row.due_status = 'confirmed'; this.touch(row);
      this.errors.push({ type: 'time', label: TYPES.time[0], severity: 'high', row_key: row.key, unit_id: null, item_id: row.item_id, claim: 'الموعد: ' + row.due + ' (عُرض كموعد نهائي) — ' + row.text,
        source_evidence: row.evidence, evidence_from: 'source', correct_value: 'الموعد «' + row.due + '» تقريبي/غير مؤكد في المصدر.',
        explanation: 'لم يحدد البرومبت كيف تُعامَل المعلومات غير المؤكدة، فأسقط النموذج التحفظ الزمني وقدّم الموعد كأنه نهائي.', cause_dim: 'unknown', fabricated: false });
      return;
    }
    if (none.length) {
      const ph = ['نهاية الأسبوع القادم', 'الأحد القادم', 'خلال أسبوعين', '15 من الشهر القادم'].filter((p) => !Text.contains(c.source, p)); if (!ph.length) return;
      const row = c.rows[c.rng.pick(none)], phrase = c.rng.pick(ph); row.due = phrase; row.due_status = 'confirmed'; this.touch(row);
      this.errors.push({ type: 'time', label: TYPES.time[0], severity: 'high', row_key: row.key, unit_id: null, item_id: row.item_id, claim: 'الموعد: ' + phrase + ' — ' + row.text,
        source_evidence: row.evidence, evidence_from: 'source', correct_value: 'لا يذكر المصدر موعداً لهذه المهمة (غير محدد).',
        explanation: 'لم يحدد البرومبت ما يُكتب عند غياب الموعد، فاخترع النموذج موعداً وعرضه كحقيقة. التاريخ «' + phrase + '» مضاف من خارج المصدر.', cause_dim: 'unknown', fabricated: true });
      this.assumptions.push({ kind: 'fabricated_deadline', value: phrase, for: row.text });
    }
  }
  assumption(c, extra) {
    const un = []; c.rows.forEach((r, i) => { if (r.cat === 'task' && r.owner === null && !this.touched[r.key] && r.item.speaker) un.push(i); });
    if (un.length && this.canTouch(c.baseCount)) {
      const row = c.rows[c.rng.pick(un)]; row.owner = row.item.speaker; row.owner_assumed = true; this.touch(row);
      this.errors.push({ type: 'assumption', label: TYPES.assumption[0], severity: 'medium', row_key: row.key, unit_id: null, item_id: row.item_id, claim: 'المسؤول: ' + row.owner + ' — ' + row.text,
        source_evidence: row.evidence, evidence_from: 'source', correct_value: 'المسؤول غير محدد في المصدر؛ ' + row.owner + ' هو المتحدث فقط وليس مكلَّفاً بالمهمة.',
        explanation: 'لم يقصر البرومبت الإجابة على ما ورد في المصدر ولا طلب كتابة «غير محدد»، فافترض النموذج أن المتحدث هو المنفّذ.', cause_dim: 'source', fabricated: false });
      this.assumptions.push({ kind: 'assumed_owner', value: row.owner, for: row.text });
      if (!extra) return;
    }
    let tpl = [['decision', 'عقد اجتماع متابعة أسبوعي لمراجعة التقدم', null], ['task', 'إرسال محضر الاجتماع إلى جميع الحاضرين', c.truth.participants.length ? c.rng.pick(c.truth.participants) : null]];
    tpl = tpl.filter((t) => !Text.contains(c.source, t[1]) && c.cats.includes(t[0]));
    if (!tpl.length) tpl = [['decision', 'عقد اجتماع متابعة أسبوعي لمراجعة التقدم', null]].filter((t) => !Text.contains(c.source, t[1]));
    if (!tpl.length) return;
    const [cat, text, owner] = c.rng.pick(tpl);
    const row = { key: ++this.seq, order: 20000, cat, text, owner, due: null, due_status: 'none', status: cat === 'task' ? 'مهمة مؤكدة' : 'قرار مؤكد', item_id: null, item: { speaker: null }, evidence: [], fabricated: true, owner_assumed: false };
    c.rows.push(row);
    this.errors.push({ type: 'assumption', label: TYPES.assumption[0], severity: 'high', row_key: row.key, unit_id: null, item_id: null, claim: text + (owner ? ' (المسؤول: ' + owner + ')' : ''),
      source_evidence: [], evidence_from: 'source', correct_value: 'لا يوجد هذا البند في المصدر إطلاقاً.',
      explanation: 'لم يقصر البرومبت الإجابة على المصدر ولم يشترط مراجعة كل بند، فأضاف النموذج بنداً مألوفاً في الاجتماعات يبدو منطقياً لكن لا سند له.', cause_dim: 'source', fabricated: true });
    this.assumptions.push({ kind: 'fabricated_item', value: text, for: null });
  }
  omission(c) {
    const cands = []; c.rows.forEach((r, i) => { if (r.item.condition && !this.touched[r.key]) cands.push(i); });
    if (!cands.length || !this.canTouch(c.baseCount)) return;
    const row = c.rows[c.rng.pick(cands)], full = row.text; row.text = row.item.core; this.touch(row);
    this.omitted.push({ reason: 'omission', category: row.cat, text: row.item.condition, evidence: row.evidence });
    this.errors.push({ type: 'omission', label: TYPES.omission[0], severity: 'medium', row_key: row.key, unit_id: null, item_id: row.item_id, claim: row.text,
      source_evidence: row.evidence, evidence_from: 'source', correct_value: full + ' — المحذوف: «' + row.item.condition + '»',
      explanation: 'لم يشترط البرومبت الحفاظ على الشروط والتفاصيل، فاختصر النموذج البند وأسقط شرطاً جوهرياً فبدا التنفيذ غير مشروط.', cause_dim: 'scope', fabricated: false });
  }
}

// ---------------------------------------------------------------- Improved prompt
const CLAUSES = {
  task: 'استخرج القرارات المؤكدة والمهام (مع المسؤول عن كل مهمة وموعدها) والمقترحات غير المعتمدة والنقاط غير المحسومة من محضر الاجتماع.',
  source: 'اعتمد على نص المحضر فقط، ولا تضف أي معلومة أو اسم أو تاريخ من خارجه.',
  scope: 'اشمل جميع البنود دون حذف، وحافظ على الشروط والتفاصيل المهمة المرتبطة بكل بند.',
  format: 'اعرض النتيجة في جدول بأعمدة: النوع | البند | المسؤول | الموعد | الحالة.',
  unknown: 'إذا كانت أي معلومة (مسؤول أو موعد) غير مذكورة أو غير مؤكدة في المحضر فاكتب «غير محدد» أو «تقريبي» ولا تخمّنها.',
  distinction: 'ميّز بين القرارات المؤكدة والمقترحات غير المعتمدة والنقاط غير المحسومة، ولا تحوّل أي مقترح أو نقطة مفتوحة إلى قرار.',
  verification: 'قبل تقديم الإجابة راجع كل بند مقابل نص المحضر واحذف أي بند أو معلومة لا يسندها المصدر.',
};
function improve(prompt, analysis, errors = []) {
  const prev = {}; errors.forEach((e) => (prev[e.cause_dim] ||= []).push(e.label));
  const order = Object.keys(CLAUSES), dims = [...new Set([...Object.keys(prev), ...analysis.gaps])].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  let text = prompt.trim(); if (text && !/[.!؟?]$/u.test(text)) text += '.'; const additions = [];
  for (const d of dims) {
    if (!CLAUSES[d]) continue; const lv = analysis.dimensions[d]?.level ?? 0; if (lv >= .75 && !prev[d]) continue;
    text += ' ' + CLAUSES[d]; additions.push({ dimension: d, label: DIMENSIONS[d].label, clause: CLAUSES[d], prevents: [...new Set(prev[d] || [])] });
  }
  return { prompt: text.trim(), additions };
}


// ---------------------------------------------------------------- فصل المحضر عن التعليمات (صندوق إدخال واحد)
// قاعدة: السطر «تسمية: كلام» يُعدّ من المحضر إن كانت التسمية عنواناً معروفاً (الحضور/التاريخ...) أو اسم متحدث
// (وارداً في «الحضور» أو متكرراً أو، عند غياب ذلك، تسميات قصيرة متعددة). الفقرات (يفصلها سطر فارغ) ذات الأغلبية من هذه الأسطر
// تذهب إلى المحضر وما عداها إلى التعليمات. سطر --- أو === يحدد الفصل صراحةً ويتفوق على التخمين.
function splitInput(raw) {
  const text = String(raw || '').replace(/\r\n?/g, '\n').trim();
  if (!text) return { source: '', prompt: '', how: 'empty' };
  const lines = text.split('\n');
  const labelOf = (l) => { const m = /^\s*([^:：\n]{1,30})[:：]\s*(\S.*)?$/u.exec(l); if (!m) return null; const lab = m[1].trim(); return lab.split(/\s+/).length > 3 ? null : { lab, rest: m[2] || '' }; };
  const hdr = HEADERS.map(Text.norm), att = ['الحضور', 'المشاركون', 'المشاركين'].map(Text.norm);
  const counts = {}, known = new Set();
  for (const l of lines) {
    const x = labelOf(l); if (!x) continue; const n = Text.norm(x.lab);
    if (hdr.includes(n)) { if (att.includes(n)) x.rest.split(/\s*[،,;؛]\s*|\s+و(?=\s)\s*/u).forEach((a) => { const t = Text.norm(a.trim()); if (t) known.add(t.split(' ')[0]); }); }
    else counts[n] = (counts[n] || 0) + 1;
  }
  for (const [k, v] of Object.entries(counts)) if (v >= 2) known.add(k.split(' ')[0]);
  if (!known.size && Object.keys(counts).length >= 2) for (const k of Object.keys(counts)) if (k.split(' ').length <= 2 && k.length <= 14) known.add(k.split(' ')[0]);
  const isSrc = (l) => { const x = labelOf(l); if (!x) return false; const n = Text.norm(x.lab); return hdr.includes(n) || known.has(n) || known.has(n.split(' ')[0]); };
  const frac = (blk) => { const ls = blk.split('\n').filter((l) => l.trim()); return ls.length ? ls.filter(isSrc).length / ls.length : 0; };
  const di = lines.findIndex((l) => /^\s*(?:-{3,}|={3,}|#{3,}|\*{3,})\s*$/.test(l));
  if (di >= 0) {
    const a = lines.slice(0, di).join('\n').trim(), b = lines.slice(di + 1).join('\n').trim();
    return frac(a) >= frac(b) ? { source: a, prompt: b, how: 'delimiter' } : { source: b, prompt: a, how: 'delimiter' };
  }
  const src = [], prm = [];
  for (const para of text.split(/\n\s*\n/)) {
    const ls = para.split('\n').filter((l) => l.trim());
    if (!ls.length) continue;
    if (ls.filter(isSrc).length / ls.length >= 0.5) {
      let a = 0, b = ls.length; while (a < b && !isSrc(ls[a])) a++; while (b > a && !isSrc(ls[b - 1])) b--;
      if (a > 0) prm.push(ls.slice(0, a).join('\n')); src.push(ls.slice(a, b).join('\n')); if (b < ls.length) prm.push(ls.slice(b).join('\n'));
    } else prm.push(ls.join('\n'));
  }
  return { source: src.join('\n\n'), prompt: prm.join('\n').trim(), how: src.length ? 'auto' : 'none' };
}

return { Text, Rng, parseMeeting, analyze, Simulator, improve, DIMENSIONS, splitInput };
})();
if (typeof module !== 'undefined') module.exports = PTL;
