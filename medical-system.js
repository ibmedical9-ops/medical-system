// ══════════════════════════════════════════════
//  ⚙️  CONFIG — غيّر هذين فقط
// ══════════════════════════════════════════════
// يكتشف تلقائياً إذا هو على version-test أو live
const IS_TEST = window.location.href.includes("version-test");
const BASE_URL = IS_TEST
  ? "https://patient-care-system.bubbleapps.io/version-test/api/1.1/obj"
  : "https://patient-care-system.bubbleapps.io/api/1.1/obj";
const TOKEN = (typeof window._BTOKEN !== "undefined" && window._BTOKEN) ? window._BTOKEN : "YOUR_BUBBLE_TOKEN";

// ══════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════
const S = {
  patients:     [],
  medical:      [],
  medications:  [],
  labs:         [],
  appointments: [],
};
const filtered = { patients:[], medical:[], medications:[], labs:[], appointments:[] };
const pages    = { patients:1, medical:1, medications:1, labs:1, appointments:1 };
const PER_PAGE = 15;
let medGrouped = false;

// ══════════════════════════════════════════════
//  API HELPERS
// ══════════════════════════════════════════════
const headers = () => ({
  "Content-Type": "application/json",
  "Authorization": `Bearer ${TOKEN}`,
});

async function bubbleGet(type, constraints = [], cursor = 0, limit = 100) {
  let url = `${BASE_URL}/${type}?limit=${limit}&cursor=${cursor}`;
  if (constraints.length)
    url += `&constraints=${encodeURIComponent(JSON.stringify(constraints))}`;
  const r = await fetch(url, { headers: headers() });
  if (!r.ok) throw new Error(`${type}: ${r.status}`);
  const d = await r.json();
  return d.response;
}

async function bubbleGetAll(type) {
  let all = [], cursor = 0, remaining = 1;
  while (remaining > 0) {
    const r = await bubbleGet(type, [], cursor, 100);
    all = all.concat(r.results || []);
    remaining = (r.remaining != null) ? r.remaining : 0;
    cursor += (r.results || []).length;
    if (!r.results || r.results.length === 0) break;
  }
  return all;
}

async function bubbleCreate(type, data) {
  const r = await fetch(`${BASE_URL}/${type}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(data),
  });
  if (!r.ok) {
    const errText = await r.text();
    throw new Error(`Create ${type}: ${r.status} — ${errText}`);
  }
  return await r.json();
}

async function bubbleUpdate(type, id, data) {
  // Use TYPE_MAP if a stateKey was passed
  const bubbleType = TYPE_MAP[type] || type;
  const r = await fetch(`${BASE_URL}/${bubbleType}/${id}`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify(data),
  });
  if (!r.ok) {
    const errText = await r.text().catch(()=>"");
    throw new Error(`Update ${bubbleType}: ${r.status} — ${errText}`);
  }
  // PATCH returns 204 sometimes (no body)
  if (r.status === 204) return {};
  return await r.json().catch(()=>({}));
}

async function bubbleDelete(type, id) {
  const r = await fetch(`${BASE_URL}/${type}/${id}`, {
    method: "DELETE",
    headers: headers(),
  });
  if (!r.ok) throw new Error(`Delete ${type}: ${r.status}`);
}

// ══════════════════════════════════════════════
//  LOAD DATA
// ══════════════════════════════════════════════
async function loadAll() {
  showLoading(true);
  // Show/hide config banner
  const cb = document.getElementById("config-banner"); if (cb) cb.classList.toggle("hidden", TOKEN !== "YOUR_BUBBLE_TOKEN");
  try {
    const [p, m, med, l, a] = await Promise.all([
      bubbleGetAll("A - 01 Patients"),
      bubbleGetAll("A - 02 Medical Records"),
      bubbleGetAll("A - 03 Medications And Sponsorships"),
      bubbleGetAll("A - 04 Tests"),
      bubbleGetAll("A - 05 Appointments"),
    ]);
    const byDate = (a,b) => new Date(b["Created Date"]||b._id||0) - new Date(a["Created Date"]||a._id||0);
    S.patients    = p.sort(byDate);
    S.medical     = m.sort((a,b) => new Date(b["Date"]||0) - new Date(a["Date"]||0));
    S.medications = med.sort(byDate);
    S.labs        = l.sort((a,b) => new Date(b["Date"]||0) - new Date(a["Date"]||0));
    S.appointments= a.sort((a,b) => new Date(b["Appointment Date & Tir"]||0) - new Date(a["Appointment Date & Tir"]||0));



    updateStats();
    populateProvinceFilters();
    populatePatientSelects();
    filterPatients();
    filterMedical();
    filterMedications();
    filterLabs();
    filterAppointments();
    showToast("تم تحميل البيانات بنجاح ✅", "success");
  } catch (e) {
    console.error(e);
    showToast("خطأ في الاتصال: " + e.message, "error");
  }
  showLoading(false);
}

async function refreshAll() {
  const icon = document.getElementById("syncIcon");
  if (icon) icon.classList.add("spinning");
  await loadAll();
  if (icon) icon.classList.remove("spinning");
}

// ══════════════════════════════════════════════
//  STATS & SELECTS
// ══════════════════════════════════════════════
function updateStats() {
  ["patients","medical","medications","labs","appointments"].forEach(k => {
    document.getElementById("s-"+k).textContent  = S[k].length;
    document.getElementById("cnt-"+k).textContent = S[k].length;
  });
}

function populateProvinceFilters() {
  const provs = [...new Set(S.patients.map(p => p["city"] || "").filter(Boolean))].sort();
  ["f-pat-province","f-med-province"].forEach(id => {
    const sel = document.getElementById(id);
    const cur = sel.value;
    sel.innerHTML = `<option value="">جميع المحافظات</option>`;
    provs.forEach(v => sel.innerHTML += "<option "+(v===cur?"selected":"")+">"+v+"</option>");
  });
}

function populatePatientSelects() {
  const opts = S.patients.map(p => {
    const name = p["Name"] || p._id;
    return "<option value=\""+p._id+"\">"+name+"</option>";
  }).join("");
  ["nm-patient","nmed-patient","nl-patient","na-patient"].forEach(id => {
    const el = document.getElementById(id);
    el.innerHTML = `<option value="">— اختر مريضاً —</option>` + opts;
  });
}

// ══════════════════════════════════════════════
//  FIELD HELPERS (Bubble field names may vary)
// ══════════════════════════════════════════════
function pf(obj, ...keys) {
  if (!obj) return "";
  for (const k of keys) {
    const v = obj[k];
    if (v != null && v !== "") return v;
  }
  return "";
}
function pfs(obj, ...keys) {
  // Always returns a string (safe for toLowerCase)
  const v = pf(obj, ...keys);
  return v == null ? "" : String(v);
}

function findPatient(patientId) {
  if (!patientId) return null;
  // Handle object reference or string
  const sid = typeof patientId === "object" ? String(patientId._id||"") : String(patientId);
  if (!sid) return null;
  // Exact match first (fastest)
  let found = S.patients.find(x => String(x._id) === sid);
  // Fallback: Bubble sometimes returns ID without trailing zeros
  if (!found) found = S.patients.find(x => sid.startsWith(x._id) || String(x._id).startsWith(sid));
  return found || null;
}

function getPatientName(patientId) {
  if (!patientId) return "—";
  const p = findPatient(patientId);
  if (!p) return "—";
  return pf(p, "Name") || "—";
}

function getPatientProvince(patientId) {
  if (!patientId) return "—";
  const p = findPatient(patientId);
  if (!p) return "—";
  return pf(p, "city") || "—";
}

function resolvePatientId(raw) {
  if (!raw) return null;
  if (typeof raw === "string") return raw;
  if (typeof raw === "object" && raw._id) return raw._id;
  return String(raw);
}

// ══════════════════════════════════════════════
//  FILTER + RENDER: PATIENTS
// ══════════════════════════════════════════════
function filterPatients() {
  const q    = (document.getElementById("q-patients").value || "").toLowerCase();
  const prov = document.getElementById("f-pat-province").value;
  const need = document.getElementById("f-pat-need").value;
  const stat = document.getElementById("f-pat-status").value;
  filtered.patients = S.patients.filter(p => {
    const name  = pfs(p,"Name","").toLowerCase();
    const phone = pfs(p,"Phone Number","").toLowerCase();
    const pid   = pfs(p,"Case Number","").toLowerCase();
    const matchQ = !q || name.includes(q) || phone.includes(q) || pid.includes(q);
    const matchP = !prov || pf(p,"city") === prov;
    const matchN = !need || (pf(p,"helping type")||"").split(",").map(s=>s.trim()).includes(need);
    const matchS = !stat || pf(p,"final state") === stat;
    return matchQ && matchP && matchN && matchS;
  });
  pages.patients = 1;
  renderPatients();
}

function renderPatients() {
  const tbody = document.getElementById("tbody-patients");
  const list  = paginate(filtered.patients, pages.patients);
  if (!list.length) { tbody.innerHTML = emptyRow(9); renderPag("patients"); return; }
  tbody.innerHTML = list.map((p, i) => {
    const name   = pf(p,"Name") || "—";
    const phone  = pf(p,"Phone Number") || "—";
    const prov   = pf(p,"city") || "—";
    const need   = pf(p,"helping type") || "—";
    const status = pf(p,"final state") || "—";
    const notes  = pf(p,"notes") || "—";
    const caseId = pf(p,"Case Number") || "—";
    const row = offset("patients") + i + 1;
    return `<tr>
      <td>${row}</td>
      <td><code style="font-size:11px;background:#f1f5f9;padding:2px 7px;border-radius:5px;">${caseId}</code></td>
      <td><strong>${name}</strong></td>
      <td dir="ltr">${phone}</td>
      <td>${prov}</td>
      <td>${needBadge(need)}</td>
      <td>${statusBadge(status)}</td>
      <td style="color:#94a3b8;font-size:12px;">${notes}</td>
      <td><div class="td-actions">
        <button class="btn btn-outline btn-sm btn-icon" onclick='viewPatient("${p._id}")' title="تفاصيل">👁️</button>
        <button class="btn btn-primary btn-sm btn-icon" onclick='openEditModal("patient","${p._id}")' title="تعديل">✏️</button>
        <button class="btn btn-danger btn-sm btn-icon" onclick='deleteRecord("patients","${p._id}","patients")' title="حذف">🗑️</button>
      </div></td>
    </tr>`;
  }).join("");
  renderPag("patients");
}

// ══════════════════════════════════════════════
//  FILTER + RENDER: MEDICAL CASES
// ══════════════════════════════════════════════
function filterMedical() {
  const q    = (document.getElementById("q-medical").value || "").toLowerCase();
  const from = document.getElementById("f-med-from").value;
  const to   = document.getElementById("f-med-to").value;
  filtered.medical = S.medical.filter(m => {
    const det = pfs(m,"Status Update","Notes").toLowerCase();
    const matchQ = !q || det.includes(q);
    const date = pf(m,"Date") || "";
    const matchFrom = !from || date >= from;
    const matchTo   = !to   || date <= to;
    return matchQ && matchFrom && matchTo;
  });
  pages.medical = 1;
  renderMedical();
}

function renderMedical() {
  const tbody = document.getElementById("tbody-medical");
  const list  = paginate(filtered.medical, pages.medical);
  if (!list.length) { tbody.innerHTML = emptyRow(5); renderPag("medical"); return; }
  tbody.innerHTML = list.map((m, i) => {
    const date    = formatDate(pf(m,"Date"));
    const details = pf(m,"Status Update") || pf(m,"Notes") || "—";
    const patId   = pf(m,"Patient");
    const patName = getPatientName(patId);
    const row = offset("medical") + i + 1;
    return `<tr>
      <td>${row}</td>
      <td>${date}</td>
      <td><strong>${patName}</strong></td>
      <td style="max-width:280px;font-size:12px;">${details}</td>
      <td><div class="td-actions">
        <button class="btn btn-danger btn-sm" onclick='deleteRecord("A - 02 Medical Records","${m._id}","medical")'>🗑️</button>
      </div></td>
    </tr>`;
  }).join("");
  renderPag("medical");
}

// ══════════════════════════════════════════════
//  FILTER + RENDER: MEDICATIONS
// ══════════════════════════════════════════════
function filterMedications() {
  const q       = (document.getElementById("q-medications")  ? document.getElementById("q-medications").value  : "").toLowerCase();
  const prov    = document.getElementById("f-med-province")  ? document.getElementById("f-med-province").value  : "";
  const avail   = document.getElementById("f-med-avail")     ? document.getElementById("f-med-avail").value     : "";
  const covered = document.getElementById("f-med-covered")   ? document.getElementById("f-med-covered").value   : "";
  filtered.medications = S.medications.filter(m => {
    const name    = pfs(m,"Medication Name","").toLowerCase();
    const patId   = resolvePatientId(pf(m,"Patient"));
    const patName = String(getPatientName(patId) || "").toLowerCase();
    const matchQ  = !q     || name.includes(q) || patName.includes(q);
    const medCity2 = pf(m,"city");
    const patProv = medCity2 || getPatientProvince(patId);
    const matchP  = !prov  || patProv === prov;
    const availVal   = pf(m,"availability");
    const sponsVal   = pf(m,"Sponsorsed");
    const matchA  = !avail   || String(availVal) === avail;
    const matchC  = !covered || sponsVal === covered;
    return matchQ && matchP && matchA && matchC;
  });
  pages.medications = 1;
  renderMedications();
}

function renderMedications() {
  if (medGrouped) { renderMedGrouped(); return; }
  const tbody = document.getElementById("tbody-medications");
  if (!tbody) return;
  const list = paginate(filtered.medications, pages.medications);
  if (!list.length) { tbody.innerHTML = emptyRow(10); renderPag("medications"); return; }
  tbody.innerHTML = list.map((m, i) => {
    const name    = pf(m,"Medication Name") || "—";
    const qty     = pf(m,"Dosage") || "—";
    const price   = pf(m,"price") != null ? pf(m,"price") : 0;
    const patId   = resolvePatientId(pf(m,"Patient"));
    const pat     = getPatientName(patId);
    // Use medication's own city field first, then lookup from patient
    const medCity = pf(m,"city");
    const patProv = medCity || getPatientProvince(patId);
    const covered = pf(m,"Sponsorsed");   // نعم / لا
    const avail   = pf(m,"availability"); // boolean
    const notes   = pf(m,"notes") || "—";
    const photoUrl= pf(m,"photo") || "";
    const row     = offset("medications") + i + 1;
    const avail2  = pf(m,"availability 2");
    const isAvail = avail===true || avail==="true" || avail2==="yes";
    return `<tr>
      <td>${row}</td>
      <td><strong>${name}</strong></td>
      <td>${qty}</td>
      <td>${price} د.ع</td>
      <td>${pat}</td>
      <td>${patProv}</td>
      <td><button class="pharm-avail-btn ${isAvail?'yes':'no'}" onclick="toggleAvailability('${m._id}',${isAvail})" title="تغيير التوفر">${isAvail?'✓':'✗'}</button></td>
      <td style="font-size:12px;color:#94a3b8;">${notes}</td>
      <td><div class="td-actions">
        ${photoUrl ? "<button class=\"btn btn-outline btn-sm btn-icon\" onclick=\"openPhoto(\'"+photoUrl+"\',\'"+name.replace(/'/g,"&apos;")+"\')\">🖼️</button>" : ""}
        <button class="btn btn-outline btn-sm btn-icon" onclick="openEditModal('medication','${m._id}')">✏️</button>
        <button class="btn btn-danger btn-sm btn-icon" onclick="deleteRecord('medications','${m._id}','medications')">🗑️</button>
      </div></td>
    </tr>`;
  }).join("");
  renderPag("medications");
}

function renderMedGrouped() {
  const container = document.getElementById("med-group-view");
  if (!container) return;
  const groups = {};
  filtered.medications.forEach(m => {
    const patId = resolvePatientId(pf(m,"Patient"));
    if (!groups[patId]) groups[patId] = [];
    groups[patId].push(m);
  });
  if (!Object.keys(groups).length) {
    container.innerHTML = `<div class="table-card"><div style="padding:40px;text-align:center;color:#94a3b8;">لا توجد نتائج 🔍</div></div>`;
    return;
  }
  container.innerHTML = Object.entries(groups).map(([patId, meds]) => {
    const patName = getPatientName(patId);
    const patProv = getPatientProvince(patId);
    const rows = meds.map((m,i) => {
      const name    = pf(m,"Medication Name") || "—";
      const qty     = pf(m,"Dosage") || "—";
      const price   = pf(m,"price") || 0;
      const avail    = pf(m,"availability");
      const isAvail  = avail===true||avail==="true";
      const isCovered = pf(m,"Sponsorsed") === "نعم";
      const notes   = pf(m,"notes") || "—";
      const photoUrl= pf(m,"photo") || "";
      return `<tr>
        <td>${i+1}</td>
        <td><strong>${name}</strong></td>
        <td>${qty}</td>
        <td>${price} د.ع</td>
        <td style="font-size:12px;color:#64748b;">${notes}</td>
        <td>${isCovered ? '<span class="avail yes">✓</span>' : '<span class="avail no">✗</span>'}</td>
        <td><button class="pharm-avail-btn ${isAvail?'yes':'no'}" onclick="toggleAvailability('${m._id}',${isAvail})">${isAvail?'✓':'✗'}</button></td>
        <td>${photoUrl ? "<button class=\"btn btn-outline btn-sm btn-icon\" onclick=\"openPhoto(\'"+photoUrl+"\',\'"+name.replace(/'/g,"&apos;")+"\')\">🖼️</button>" : ""}</td>
      </tr>`;
    }).join("");
    return `<div class="patient-group">
      <div class="pg-header">
        <div><h4>${patName}</h4><span>${patProv}</span></div>
        <span class="badge badge-info">💊 ${meds.length} أدوية</span>
      </div>
      <div class="table-wrap">
        <table style="min-width:500px;">
          <thead><tr><th>#</th><th>الدواء</th><th>الكمية</th><th>السعر</th><th>ملاحظات</th><th>مكفول</th><th>التوفر</th><th>صورة</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
  }).join("");
}

function filterLabs() {
  const q = (document.getElementById("q-labs").value || "").toLowerCase();
  filtered.labs = S.labs.filter(l => {
    const name = pfs(l,"Test Name","").toLowerCase();
    const patId = pf(l,"Patient");
    const patName = String(getPatientName(patId) || "").toLowerCase();
    return !q || name.includes(q) || patName.includes(q);
  });
  pages.labs = 1;
  renderLabs();
}

function renderLabs() {
  const tbody = document.getElementById("tbody-labs");
  const list  = paginate(filtered.labs, pages.labs);
  if (!list.length) { tbody.innerHTML = emptyRow(7); renderPag("labs"); return; }
  tbody.innerHTML = list.map((l, i) => {
    const name   = pf(l,"Test Name") || "—";
    const result = pf(l,"Results") || "—";
    const date   = formatDate(pf(l,"Date"));
    const patId  = pf(l,"patient","patient-id","patient_id");
    const patName = getPatientName(patId);
    const notes  = pf(l,"note") || "—";
    const row = offset("labs") + i + 1;
    return `<tr>
      <td>${row}</td>
      <td><strong>${name}</strong></td>
      <td>${result}</td>
      <td>${date}</td>
      <td>${patName}</td>
      <td style="color:#94a3b8;font-size:12px;">${notes}</td>
      <td><div class="td-actions">
        <button class="btn btn-danger btn-sm" onclick='deleteRecord("A - 04 Tests","${l._id}","labs")'>🗑️</button>
      </div></td>
    </tr>`;
  }).join("");
  renderPag("labs");
}

// ══════════════════════════════════════════════
//  FILTER + RENDER: APPOINTMENTS
// ══════════════════════════════════════════════
function filterAppointments() {
  const q    = (document.getElementById("q-appointments").value || "").toLowerCase();
  const stat = document.getElementById("f-appt-status").value;
  const from = document.getElementById("f-appt-from").value;
  const to   = document.getElementById("f-appt-to").value;
  filtered.appointments = S.appointments.filter(a => {
    const patId   = resolvePatientId(pf(a,"Patient"));
    const patName = String(getPatientName(patId)||"").toLowerCase();
    const entity  = pfs(a,"Follow-Up Entity","").toLowerCase();
    const details = pfs(a,"Appointment Type","").toLowerCase();
    const matchQ  = !q || patName.includes(q) || entity.includes(q) || details.includes(q);
    const status  = pf(a,"Status");
    const matchS  = !stat || String(status) === stat;
    const date    = pf(a,"Appointment Date & Tir") || "";
    const matchFrom = !from || date >= from;
    const matchTo   = !to   || date <= to;
    return matchQ && matchS && matchFrom && matchTo;
  });
  pages.appointments = 1;
  renderAppointments();
}

function renderAppointments() {
  const tbody = document.getElementById("tbody-appointments");
  const list  = paginate(filtered.appointments, pages.appointments);
  if (!list.length) { tbody.innerHTML = emptyRow(8); renderPag("appointments"); return; }
  tbody.innerHTML = list.map((a, i) => {
    const patId   = resolvePatientId(pf(a,"Patient"));
    const patName = getPatientName(patId);
    const details = pf(a,"Appointment Type") || "—";
    const date    = formatDate(pf(a,"Appointment Date & Tir"));
    const rawStat = pf(a,"Status"); const status = (rawStat === true || rawStat === "true") ? "مكتمل" : "بانتظار";
    const entity  = pf(a,"Follow-Up Entity") || "—";
    const notes   = pf(a,"note") || "—";
    const row = offset("appointments") + i + 1;
    return `<tr>
      <td>${row}</td>
      <td><strong>${patName}</strong></td>
      <td>${details}</td>
      <td>${date}</td>
      <td>${apptStatusBadge(status)}</td>
      <td>${entity}</td>
      <td style="color:#94a3b8;font-size:12px;">${notes}</td>
      <td><div class="td-actions">
        ${(pf(a,"Status") !== true && pf(a,"Status") !== "true") ? "<button class=\"btn btn-success btn-sm\" onclick=\"completeAppt(\'"+a._id+"\')\">✅</button>" : ""}
        <button class="btn btn-danger btn-sm" onclick='deleteRecord("A - 05 Appointments","${a._id}","appointments")'>🗑️</button>
      </div></td>
    </tr>`;
  }).join("");
  renderPag("appointments");
}

// ══════════════════════════════════════════════
//  SAVE ACTIONS
// ══════════════════════════════════════════════
async function savePatient() {
  const name = document.getElementById("np-name").value.trim();
  if (!name) { showToast("اسم المريض مطلوب", "error"); return; }
  const needs = [...document.querySelectorAll('#modal-patient .chk-item input:checked')].map(c => c.value).join(", ");
  const data = {
    "Name":           name,
    "Case Number":    document.getElementById("np-id").value.trim(),
    "Date of Birth":  document.getElementById("np-dob").value,
    "Phone Number":   document.getElementById("np-phone").value.trim(),
    "Gender":         document.getElementById("np-gender").value,
    "Marital Status": document.getElementById("np-marital").value,
    "city":           document.getElementById("np-province").value,
    "Address":        document.getElementById("np-address").value.trim(),
    "helping type":   needs,
    "final state":    document.getElementById("np-status").value,
    "notes":          document.getElementById("np-notes").value.trim(),
  };
  try {
    await bubbleCreate("A - 01 Patients", data);
    showToast("تم إضافة المريض بنجاح ✅", "success");
    closeModal("patient");
    await loadAll();
  } catch (e) { showToast("خطأ: " + e.message, "error"); }
}

async function saveMedical() {
  const patId   = document.getElementById("nm-patient").value;
  const date    = document.getElementById("nm-date").value;
  const details = document.getElementById("nm-details").value.trim();
  if (!patId || !details) { showToast("المريض والتفاصيل مطلوبة", "error"); return; }
  try {
    await bubbleCreate("A - 02 Medical Records", { "Patient": patId, "Date": date, "Status Update": details });
    showToast("تم إضافة الحالة ✅", "success");
    closeModal("medical");
    await loadAll();
  } catch (e) { showToast("خطأ: " + e.message, "error"); }
}

async function saveMedication() {
  const patId = document.getElementById("nmed-patient").value;
  const name  = document.getElementById("nmed-name").value.trim();
  if (!patId || !name) { showToast("المريض واسم الدواء مطلوبان", "error"); return; }
  try {
    await bubbleCreate("A - 03 Medications And Sponsorships", {
      "Patient":          patId,
      "Medication Name":  name,
      "Dosage":           document.getElementById("nmed-qty").value,
      "Sponsorsed":       document.getElementById("nmed-covered").value === "true" ? "نعم" : "لا",
      "availability":     false,
      "price":            parseFloat(document.getElementById("nmed-price").value) || 0,
      "notes":            document.getElementById("nmed-notes").value.trim(),
    });
    showToast("تم إضافة الدواء ✅", "success");
    closeModal("medication");
    await loadAll();
  } catch (e) { showToast("خطأ: " + e.message, "error"); }
}

async function saveLab() {
  const patId = document.getElementById("nl-patient").value;
  const name  = document.getElementById("nl-name").value.trim();
  if (!patId || !name) { showToast("المريض واسم التحليل مطلوبان", "error"); return; }
  try {
    await bubbleCreate("A - 04 Tests", {
      "Patient":   patId,
      "Test Name": name,
      "Results":   document.getElementById("nl-result").value.trim(),
      "Date":      document.getElementById("nl-date").value,
      "note":      document.getElementById("nl-notes").value.trim(),
    });
    showToast("تم إضافة التحليل ✅", "success");
    closeModal("lab");
    await loadAll();
  } catch (e) { showToast("خطأ: " + e.message, "error"); }
}

async function saveAppointment() {
  const patId   = document.getElementById("na-patient").value;
  const date    = document.getElementById("na-date").value;
  const details = document.getElementById("na-details").value.trim();
  if (!patId || !details) { showToast("المريض والتفاصيل مطلوبة", "error"); return; }
  const apptData = {
      "Patient":                  patId,
      "Appointment Date & Tir":   date || null,
      "Appointment Type":          details,
      "Follow-Up Entity":          document.getElementById("na-entity").value.trim() || null,
      "Status":                    document.getElementById("na-status").value === "true",
      "note":                      document.getElementById("na-notes").value.trim() || null,
    };
  // Remove null fields (Bubble rejects some null values)
  Object.keys(apptData).forEach(k => { if (apptData[k] === null) delete apptData[k]; });
  try {
    await bubbleCreate("A - 05 Appointments", apptData);
    showToast("تم إضافة الموعد ✅", "success");
    closeModal("appointment");
    await loadAll();
  } catch (e) { showToast("خطأ: " + e.message, "error"); }
}

async function completeAppt(id) {
  try {
    await bubbleUpdate("A - 05 Appointments", id, { "Status": true });
    showToast("تم إتمام الموعد ✅", "success");
    const idx = S.appointments.findIndex(a => a._id === id);
    if (idx > -1) S.appointments[idx]["status"] = "مكتمل";
    filterAppointments();
  } catch (e) { showToast("خطأ: " + e.message, "error"); }
}

const TYPE_MAP = {
  patients:     "A - 01 Patients",
  medical:      "A - 02 Medical Records",
  medications:  "A - 03 Medications And Sponsorships",
  labs:         "A - 04 Tests",
  appointments: "A - 05 Appointments",
};

async function deleteRecord(type, id, stateKey) {
  if (!confirm("هل أنت متأكد من الحذف؟")) return;
  // type can be passed as the Bubble type name or as the stateKey
  const bubbleType = TYPE_MAP[type] || type;
  try {
    await bubbleDelete(bubbleType, id);
    S[stateKey] = S[stateKey].filter(r => r._id !== id);
    updateStats();
    const fn = { patients: filterPatients, medical: filterMedical, medications: filterMedications, labs: filterLabs, appointments: filterAppointments };
    if (fn[stateKey]) fn[stateKey]();
    showToast("تم الحذف بنجاح 🗑️", "success");
  } catch (e) { showToast("خطأ: " + e.message, "error"); }
}

// ══ CURRENT PATIENT ══
let currentPatientId = null;

function viewPatient(id) {
  currentPatientId = id;
  const p = S.patients.find(x => x._id === id);
  if (!p) return;

  // Header
  const name = pf(p,"Name") || "—";
  const initial = name.trim()[0] || "م";
  const el = (i) => document.getElementById(i);

  if (el("pd-avatar")) el("pd-avatar").textContent = initial;
  if (el("pd-name"))   el("pd-name").textContent   = name;
  if (el("pd-sub"))    el("pd-sub").textContent =
    `${pf(p,"city")||"—"} | ${pf(p,"Phone Number")||"—"} | ${pf(p,"final state")||"—"}`;

  // Meta counts
  const patMeds   = S.medications.filter(m => resolvePatientId(pf(m,"Patient")) === id).length;
  const patAppts  = S.appointments.filter(a => resolvePatientId(pf(a,"Patient")) === id).length;
  const patLabs   = S.labs.filter(l => resolvePatientId(pf(l,"Patient")) === id).length;
  const patRecs   = S.medical.filter(m => resolvePatientId(pf(m,"Patient")) === id).length;
  if (el("pd-meta")) el("pd-meta").innerHTML = `
    <div class="pat-meta-item"><div class="val">${patRecs}</div><div class="lbl">حالات</div></div>
    <div class="pat-meta-item"><div class="val">${patMeds}</div><div class="lbl">أدوية</div></div>
    <div class="pat-meta-item"><div class="val">${patLabs}</div><div class="lbl">تحاليل</div></div>
    <div class="pat-meta-item"><div class="val">${patAppts}</div><div class="lbl">مواعيد</div></div>
  `;

  // Info Grid
  const fields = [
    { l:"رقم الحالة",         v: pf(p,"Case Number") },
    { l:"تاريخ الميلاد",      v: formatDate(pf(p,"Date of Birth")) },
    { l:"الجنس",              v: pf(p,"Gender") },
    { l:"الحالة الاجتماعية",  v: pf(p,"Marital Status") },
    { l:"المدينة",            v: pf(p,"city") },
    { l:"العنوان",            v: pf(p,"Address") },
    { l:"نوع المساعدة",       v: pf(p,"helping type") },
    { l:"الحالة النهائية",    v: pf(p,"final state") },
    { l:"ملاحظات",            v: pf(p,"notes") },
  ];
  if (el("pd-info-grid")) el("pd-info-grid").innerHTML = fields.map(f =>
    `<div class="info-item"><div class="lbl">${f.l}</div><div class="val">${f.v||"—"}</div></div>`
  ).join("");

  // Load sub-data and render tabs
  renderDetailMedical();
  renderDetailMedications();
  renderDetailLabs();
  renderDetailAppts();

  // Switch to detail page
  switchPage("patient-detail");

  // Reset to first tab
  switchDetailTab("dt-medical");
}

function backToList() {
  currentPatientId = null;
  switchPage("patients");
}

function switchDetailTab(tabId) {
  document.querySelectorAll(".detail-tab").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".detail-tab-pane").forEach(p => p.classList.remove("active"));
  const pane = document.getElementById(tabId);
  if (pane) pane.classList.add("active");
  // find matching button by onclick
  document.querySelectorAll(".detail-tab").forEach(b => {
    if (b.getAttribute("onclick") && b.getAttribute("onclick").includes(tabId))
      b.classList.add("active");
  });
}

// ── RENDER DETAIL TABLES ──────────────────────────────────────
function renderDetailMedical() {
  const el = document.getElementById("dt-medical-body");
  if (!el || !currentPatientId) return;
  const recs = S.medical.filter(m => resolvePatientId(pf(m,"Patient")) === currentPatientId);
  if (!recs.length) { el.innerHTML = emptyDetail("لا توجد حالات مرضية مسجلة"); return; }
  el.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>#</th><th>تاريخ المراجعة</th><th>تفاصيل الحالة</th><th>ملاحظات</th><th>إجراء</th></tr></thead>
    <tbody>${recs.map((r,i) => `<tr>
      <td>${i+1}</td>
      <td>${formatDate(pf(r,"Date"))}</td>
      <td style="max-width:280px;font-size:12px;">${pf(r,"Status Update")||"—"}</td>
      <td style="font-size:12px;color:#94a3b8;">${pf(r,"Notes")||"—"}</td>
      <td><button class="btn btn-danger btn-sm" onclick="deleteDetailRecord('A - 02 Medical Records','${r._id}','medical')">🗑️</button></td>
    </tr>`).join("")}</tbody>
  </table></div>`;
}

function renderDetailMedications() {
  const el = document.getElementById("dt-medications-body");
  if (!el || !currentPatientId) return;
  const meds = S.medications.filter(m => resolvePatientId(pf(m,"Patient")) === currentPatientId);
  if (!meds.length) { el.innerHTML = emptyDetail("لا توجد أدوية مسجلة"); return; }
  el.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>#</th><th>اسم الدواء</th><th>الكمية شهرياً</th><th>السعر</th><th>ضمن الكفالات</th><th>ملاحظات</th><th>إجراء</th></tr></thead>
    <tbody>${meds.map((m,i) => {
      const avail    = pf(m,"availability");
      const isCov    = pf(m,"Sponsorsed") === "نعم";
      return `<tr>
        <td>${i+1}</td>
        <td><strong>${pf(m,"Medication Name")||"—"}</strong></td>
        <td>${pf(m,"Dosage")||"—"}</td>
        <td style="font-size:12px;">${pf(m,"price")||0} د.ع</td>
        <td>${isCov ? '<span class="avail yes">✓</span>' : '<span class="avail no">✗</span>'}</td>
        <td style="font-size:12px;color:#94a3b8;">${pf(m,"notes")||"—"}</td>
        <td><div class="td-actions">
          ${pf(m,"photo") ? "<button class=\"btn btn-outline btn-sm btn-icon\" onclick=\"openPhoto(\'"+pf(m,"photo")+"\',\'"+String(pf(m,"Medication Name")||"").replace(/'/g,"&apos;")+"\')\">🖼️</button>" : ""}
          <button class="btn btn-outline btn-sm btn-icon" onclick="openEditModal('medication','${m._id}')">✏️</button>
          <button class="btn btn-danger btn-sm btn-icon" onclick="deleteDetailRecord('A - 03 Medications And Sponsorships','${m._id}','medications')">🗑️</button>
        </div></td>
      </tr>`;
    }).join("")}</tbody>
  </table></div>`;
}

function renderDetailLabs() {
  const el = document.getElementById("dt-labs-body");
  if (!el || !currentPatientId) return;
  const labs = S.labs.filter(l => resolvePatientId(pf(l,"Patient")) === currentPatientId);
  if (!labs.length) { el.innerHTML = emptyDetail("لا توجد تحاليل مسجلة"); return; }
  el.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>#</th><th>اسم التحليل</th><th>النتيجة</th><th>التاريخ</th><th>ملاحظات</th><th>إجراء</th></tr></thead>
    <tbody>${labs.map((l,i) => `<tr>
      <td>${i+1}</td>
      <td><strong>${pf(l,"Test Name")||"—"}</strong></td>
      <td>${pf(l,"Results")||"—"}</td>
      <td>${formatDate(pf(l,"Date"))}</td>
      <td style="font-size:12px;color:#94a3b8;">${pf(l,"note")||"—"}</td>
      <td><button class="btn btn-danger btn-sm" onclick="deleteDetailRecord('A - 04 Tests','${l._id}','labs')">🗑️</button></td>
    </tr>`).join("")}</tbody>
  </table></div>`;
}

function renderDetailAppts() {
  const el = document.getElementById("dt-appointments-body");
  if (!el || !currentPatientId) return;
  const appts = S.appointments.filter(a => resolvePatientId(pf(a,"Patient")) === currentPatientId);
  if (!appts.length) { el.innerHTML = emptyDetail("لا توجد مواعيد مسجلة"); return; }
  el.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>#</th><th>تفاصيل الموعد</th><th>التاريخ</th><th>حالة الموعد</th><th>جهة المتابعة</th><th>ملاحظات</th><th>إجراء</th></tr></thead>
    <tbody>${appts.map((a,i) => {
      const done = pf(a,"Status") === true;
      return `<tr>
        <td>${i+1}</td>
        <td>${pf(a,"Appointment Type")||"—"}</td>
        <td>${formatDate(pf(a,"Appointment Date & Tir"))}</td>
        <td>${done ? '<span class="badge badge-success">✅ مكتمل</span>' : '<span class="badge badge-warning">⏳ بانتظار</span>'}</td>
        <td>${pf(a,"Follow-Up Entity")||"—"}</td>
        <td style="font-size:12px;color:#94a3b8;">${pf(a,"note")||"—"}</td>
        <td><div class="td-actions">
          ${!done ? "<button class=\"btn btn-success btn-sm\" onclick=\"completeDetailAppt(\'"+a._id+"\')\">✅</button>" : ""}
          <button class="btn btn-danger btn-sm" onclick="deleteDetailRecord('A - 05 Appointments','${a._id}','appointments')">🗑️</button>
        </div></td>
      </tr>`;
    }).join("")}</tbody>
  </table></div>`;
}

function emptyDetail(msg) {
  return `<div style="text-align:center;padding:32px;color:#94a3b8;font-size:13px;">📭 ${msg}</div>`;
}

// ── DETAIL MODAL OPEN/CLOSE ───────────────────────────────────
function openDetailModal(name) {
  const today = new Date().toISOString().split("T")[0];
  const m = document.getElementById("modal-" + name);
  if (!m) return;
  m.classList.add("active");
  const dateMap = { dmed:"dmed-date", dlab:"dlab-date", dappt:"dappt-date" };
  if (dateMap[name]) { const d = document.getElementById(dateMap[name]); if(d) d.value = today; }
}
function closeDetailModal(name) {
  const m = document.getElementById("modal-" + name);
  if (m) m.classList.remove("active");
}

// ── DETAIL SAVE FUNCTIONS ─────────────────────────────────────
async function saveDetailMedical() {
  if (!currentPatientId) return;
  const details = document.getElementById("dmed-details").value.trim();
  if (!details) { showToast("تفاصيل الحالة مطلوبة", "error"); return; }
  try {
    const rec = await bubbleCreate("A - 02 Medical Records", {
      "Patient":       currentPatientId,
      "Date":          document.getElementById("dmed-date").value,
      "Status Update": details,
      "Notes":         document.getElementById("dmed-notes").value.trim(),
    });
    S.medical.push(rec.body || { _id: rec.id, "Patient": currentPatientId,
      "Date": document.getElementById("dmed-date").value,
      "Status Update": details, "Notes": document.getElementById("dmed-notes").value.trim() });
    showToast("تم إضافة الحالة ✅", "success");
    closeDetailModal("dmed");
    document.getElementById("dmed-details").value = "";
    document.getElementById("dmed-notes").value = "";
    // refresh from server
    S.medical = await bubbleGetAll("A - 02 Medical Records");
    renderDetailMedical();
    updateStats();
  } catch(e) { showToast("خطأ: " + e.message, "error"); }
}

async function saveDetailMedication() {
  if (!currentPatientId) return;
  const name = document.getElementById("dmed-name").value.trim();
  if (!name) { showToast("اسم الدواء مطلوب", "error"); return; }
  try {
    await bubbleCreate("A - 03 Medications And Sponsorships", {
      "Patient":         currentPatientId,
      "Medication Name": name,
      "Dosage":          document.getElementById("dmed-dosage").value.trim(),
      "Sponsorsed":      document.getElementById("dmed-avail").value === "true" ? "نعم" : "لا",
      "availability":    false,
      "price":           parseFloat(document.getElementById("dmed-price") ? document.getElementById("dmed-price").value : 0) || 0,
      "notes":           document.getElementById("dmed-mnotes").value.trim(),
    });
    showToast("تم إضافة الدواء ✅", "success");
    closeDetailModal("dmedication");
    document.getElementById("dmed-name").value = "";
    document.getElementById("dmed-dosage").value = "";
    document.getElementById("dmed-mnotes").value = "";
    S.medications = await bubbleGetAll("A - 03 Medications And Sponsorships");
    renderDetailMedications();
    updateStats();
  } catch(e) { showToast("خطأ: " + e.message, "error"); }
}

async function saveDetailLab() {
  if (!currentPatientId) return;
  const name = document.getElementById("dlab-name").value.trim();
  if (!name) { showToast("اسم التحليل مطلوب", "error"); return; }
  try {
    await bubbleCreate("A - 04 Tests", {
      "Patient":   currentPatientId,
      "Test Name": name,
      "Results":   document.getElementById("dlab-result").value.trim(),
      "Date":      document.getElementById("dlab-date").value,
      "note":      document.getElementById("dlab-notes").value.trim(),
    });
    showToast("تم إضافة التحليل ✅", "success");
    closeDetailModal("dlab");
    document.getElementById("dlab-name").value = "";
    document.getElementById("dlab-result").value = "";
    document.getElementById("dlab-notes").value = "";
    S.labs = await bubbleGetAll("A - 04 Tests");
    renderDetailLabs();
    updateStats();
  } catch(e) { showToast("خطأ: " + e.message, "error"); }
}

async function saveDetailAppt() {
  if (!currentPatientId) return;
  const details = document.getElementById("dappt-details").value.trim();
  if (!details) { showToast("تفاصيل الموعد مطلوبة", "error"); return; }
  try {
    const dapptData = {
      "Patient":                 currentPatientId,
      "Appointment Type":         details,
      "Appointment Date & Tir":   document.getElementById("dappt-date").value || null,
      "Follow-Up Entity":         document.getElementById("dappt-entity").value.trim() || null,
      "note":                     document.getElementById("dappt-notes").value.trim() || null,
      "Status":                   false,
    };
    Object.keys(dapptData).forEach(k => { if (dapptData[k] === null) delete dapptData[k]; });
    await bubbleCreate("A - 05 Appointments", dapptData);
    showToast("تم إضافة الموعد ✅", "success");
    closeDetailModal("dappt");
    document.getElementById("dappt-details").value = "";
    document.getElementById("dappt-entity").value = "";
    document.getElementById("dappt-notes").value = "";
    S.appointments = await bubbleGetAll("A - 05 Appointments");
    renderDetailAppts();
    updateStats();
  } catch(e) { showToast("خطأ: " + e.message, "error"); }
}

async function completeDetailAppt(id) {
  try {
    await bubbleUpdate("A - 05 Appointments", id, { "Status": true });
    showToast("تم إتمام الموعد ✅", "success");
    const idx = S.appointments.findIndex(a => a._id === id);
    if (idx > -1) S.appointments[idx]["Status"] = true;
    renderDetailAppts();
  } catch(e) { showToast("خطأ: " + e.message, "error"); }
}

async function deleteDetailRecord(type, id, stateKey) {
  if (!confirm("هل أنت متأكد من الحذف؟")) return;
  try {
    await bubbleDelete(type, id);
    S[stateKey] = S[stateKey].filter(r => r._id !== id);
    const renders = {
      medical: renderDetailMedical,
      medications: renderDetailMedications,
      labs: renderDetailLabs,
      appointments: renderDetailAppts,
    };
    renders[stateKey]();
    updateStats();
    showToast("تم الحذف 🗑️", "success");
  } catch(e) { showToast("خطأ: " + e.message, "error"); }
}

// ══════════════════════════════════════════════
//  PAGINATION
// ══════════════════════════════════════════════
function paginate(arr, page) {
  const start = (page - 1) * PER_PAGE;
  return arr.slice(start, start + PER_PAGE);
}
function offset(key) { return (pages[key] - 1) * PER_PAGE; }

function renderPag(key) {
  const total = Math.ceil(filtered[key].length / PER_PAGE);
  const cur   = pages[key];
  const el    = document.getElementById("pag-" + key);
  if (total <= 1) { el.innerHTML = ""; return; }
  let html = `<button class="page-btn" onclick="goPage('${key}',${cur-1})" ${cur===1?"disabled":""}>‹</button>`;
  for (let i = 1; i <= total; i++) {
    if (total > 7 && Math.abs(i - cur) > 2 && i !== 1 && i !== total) {
      if (i === 2 || i === total - 1) html += `<span style="padding:0 4px;color:#94a3b8;">…</span>`;
      continue;
    }
    html += `<button class="page-btn ${i===cur?'active':''}" onclick="goPage('${key}',${i})">${i}</button>`;
  }
  html += `<button class="page-btn" onclick="goPage('${key}',${cur+1})" ${cur===total?"disabled":""}>›</button>`;
  html += `<span class="page-info">${filtered[key].length} نتيجة</span>`;
  el.innerHTML = html;
}

function goPage(key, page) {
  const total = Math.ceil(filtered[key].length / PER_PAGE);
  if (page < 1 || page > total) return;
  pages[key] = page;
  const fn = { patients: renderPatients, medical: renderMedical, medications: renderMedications, labs: renderLabs, appointments: renderAppointments };
  fn[key]();
}

// ══════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════
function switchPage(id) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".nav-tab").forEach(t => t.classList.remove("active"));
  const pg = document.getElementById("page-" + id);
  const tb = document.getElementById("tab-" + id);
  if (pg) pg.classList.add("active");
  if (tb) tb.classList.add("active");
  if (id === "permissions") { renderPermissions(); loadBubbleUsers(); }
}

function clearFilter(key) {
  document.querySelectorAll(`#page-${key} input, #page-${key} select`).forEach(el => { el.value = ""; });
  const fn = { patients: filterPatients, medical: filterMedical, medications: filterMedications, labs: filterLabs, appointments: filterAppointments };
  fn[key]();
}

function toggleMedGroup() {
  medGrouped = !medGrouped;
  document.getElementById("med-table-view").style.display = medGrouped ? "none" : "block";
  document.getElementById("med-group-view").style.display = medGrouped ? "block" : "none";
  document.getElementById("toggleGroupBtn").textContent   = medGrouped ? "📋 عرض الجدول" : "👥 عرض حسب العوائل";
  renderMedications();
}

function openModal(name) {
  const m = document.getElementById("modal-" + name);
  if (!m) return;
  m.classList.add("active");
  // set today's date on date fields
  const today = new Date().toISOString().split("T")[0];
  const map = { medical:"nm-date", lab:"nl-date", appointment:"na-date" };
  if (map[name]) document.getElementById(map[name]).value = today;
}
function closeModal(name) {
  const m = document.getElementById("modal-" + name);
  if (m) m.classList.remove("active");
}

function formatDate(d) {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString("ar-IQ", { year:"numeric", month:"2-digit", day:"2-digit" }); }
  catch { return d; }
}

function emptyRow(cols) {
  return `<tr><td colspan="${cols}" style="text-align:center;padding:40px;color:#94a3b8;font-size:13px;">لا توجد نتائج مطابقة 🔍</td></tr>`;
}

function showLoading(on) {
  const el = document.getElementById("loadingOverlay");
  if (el) el.classList.toggle("active", on);
}

function showToast(msg, type = "") {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "show " + type;
  setTimeout(() => t.className = "", 3000);
}

function needBadge(n) {
  const map   = { "أدوية وعلاجات":"info","عملية جراحية":"warning","مراجعة طبية":"success","غيرها":"gray" };
  const icons = { "أدوية وعلاجات":"💊","عملية جراحية":"🏥","مراجعة طبية":"🩺","غيرها":"📌" };
  const type  = map[n] || "gray";
  return `<span class="badge badge-${type}">${icons[n]||"📌"} ${n||"—"}</span>`;
}

function statusBadge(s) {
  if (s === "قيد العمل") return `<span class="badge badge-success">🟢 ${s}</span>`;
  if (s === "متوقفة")    return `<span class="badge badge-danger">🔴 ${s}</span>`;
  if (s === "مكتملة")   return `<span class="badge badge-gray">⚪ ${s}</span>`;
  return `<span class="badge badge-gray">${s}</span>`;
}

function apptStatusBadge(s) {
  if (s === "بانتظار") return `<span class="badge badge-warning">⏳ ${s}</span>`;
  if (s === "مؤكد")   return `<span class="badge badge-info">🔵 ${s}</span>`;
  if (s === "مكتمل")  return `<span class="badge badge-success">✅ ${s}</span>`;
  return `<span class="badge badge-gray">${s}</span>`;
}

// Close modal on background click - deferred
function attachModalClose() {
  document.querySelectorAll(".modal-bg").forEach(bg => {
    bg.addEventListener("click", e => { if (e.target === bg) bg.classList.remove("active"); });
  });
}
setTimeout(attachModalClose, 300);



// ══════════════════════════════════════════════
//  PHOTO VIEWER
// ══════════════════════════════════════════════
function openPhoto(url, name) {
  if (!url) { showToast("لا توجد صورة لهذا الدواء", "error"); return; }
  const img = document.getElementById("photo-img");
  const cap = document.getElementById("photo-caption");
  if (img) img.src = url;
  if (cap) cap.textContent = name || "";
  openModal("photo");
}

// ══════════════════════════════════════════════
//  PERMISSIONS
// ══════════════════════════════════════════════
const ROLES = {
  admin:      { label:"مدير",     patients:true,  medical:true,  medications:true, labs:true, appointments:true, permissions:true  },
  viewer:     { label:"مشاهد",    patients:true,  medical:true,  medications:true, labs:true, appointments:true, permissions:false },
  pharmacist: { label:"صيدلاني", patients:false, medical:false, medications:true, labs:false,appointments:false,permissions:false },
  doctor:     { label:"طبيب",     patients:true,  medical:true,  medications:true, labs:true, appointments:true, permissions:false },
};

let permUsers = JSON.parse(localStorage.getItem("perm_users") || "[]");

async function loadBubbleUsers() {
  try {
    // Fetch from Bubble User type - uses built-in "User" type
    const r = await fetch(`${BASE_URL}/user?limit=100`, { headers: headers() });
    if (!r.ok) return;
    const d = await r.json();
    const bubbleUsers = d.response?.results || [];
    // Merge with existing permUsers - add new ones, keep saved perms
    bubbleUsers.forEach(u => {
      const email = u["email"] || u["Email"] || "";
      const name  = u["name"] || u["Name"] || email || u._id;
      const role  = u["role"] || u["Role"] || "viewer";
      const existing = permUsers.find(p => p.bubbleId === u._id);
      if (!existing) {
        const r = ROLES[role] || ROLES.viewer;
        const perms = {};
        Object.keys(r).forEach(k => { if(k!=="label") perms[k]=r[k]; });
        permUsers.push({ name, email, role, perms, bubbleId: u._id });
      }
    });
    localStorage.setItem("perm_users", JSON.stringify(permUsers));
    renderPermissions();
  } catch(e) {
    console.log("Could not load Bubble users:", e.message);
    renderPermissions();
  }
}

function renderPermissions() {
  const tbody = document.getElementById("tbody-permissions");
  if (!tbody) return;
  if (!permUsers.length) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:30px;color:#94a3b8;">لا يوجد مستخدمون مضافون. أضف مستخدماً للبدء.</td></tr>`;
    return;
  }
  const pages_keys = ["patients","medical","medications","labs","appointments","permissions"];
  const labels     = ["المرضى","الحالات","الأدوية","التحاليل","المواعيد","الصلاحيات"];
  tbody.innerHTML = permUsers.map((u,i) => {
    const role = ROLES[u.role] || ROLES.viewer;
    const perms = pages_keys.map((k,j) =>
      `<button class="perm-btn ${u.perms[k]!==false&&role[k]?'on':'off'}"
        onclick="togglePerm(${i},'${k}')">${labels[j]}</button>`
    ).join("");
    return `<tr>
      <td><strong>${u.name}</strong>${u.email?`<br><span style="font-size:11px;color:#94a3b8;">${u.email}</span>`:""}</td>
      <td>
        <select onchange="changeUserRole(${i},this.value)" style="font-size:12px;padding:3px 6px;border:1px solid #e2e8f0;border-radius:6px;font-family:Cairo,sans-serif;">
          ${Object.entries(ROLES).map(([k,v])=>"<option value=\""+k+"\" "+(u.role===k?"selected":"")+">"+v.label+"</option>").join("")}
        </select>
      </td>
      <td colspan="6"><div class="perm-toggle">${perms}</div></td>
      <td><button class="btn btn-danger btn-sm" onclick="removePermUser(${i})">🗑️</button></td>
    </tr>`;
  }).join("");
}

function changeUserRole(idx, role) {
  permUsers[idx].role = role;
  const r = ROLES[role] || ROLES.viewer;
  Object.keys(r).forEach(k => { if(k!=="label") permUsers[idx].perms[k] = r[k]; });
  localStorage.setItem("perm_users", JSON.stringify(permUsers));
  renderPermissions();
}

function togglePerm(idx, key) {
  if (!permUsers[idx].perms) permUsers[idx].perms = {};
  permUsers[idx].perms[key] = !permUsers[idx].perms[key];
  localStorage.setItem("perm_users", JSON.stringify(permUsers));
  renderPermissions();
}

function addPermUser() {
  const name = document.getElementById("au-name").value.trim();
  const role = document.getElementById("au-role").value;
  if (!name) { showToast("الاسم مطلوب","error"); return; }
  const r = ROLES[role] || ROLES.viewer;
  const perms = {};
  Object.keys(r).forEach(k => { if(k!=="label") perms[k] = r[k]; });
  permUsers.push({ name, role, perms });
  localStorage.setItem("perm_users", JSON.stringify(permUsers));
  closeModal("adduser");
  document.getElementById("au-name").value = "";
  renderPermissions();
  showToast("تم إضافة المستخدم ✅","success");
}

function removePermUser(idx) {
  if (!confirm("حذف هذا المستخدم؟")) return;
  permUsers.splice(idx,1);
  localStorage.setItem("perm_users", JSON.stringify(permUsers));
  renderPermissions();
}

// ══════════════════════════════════════════════
//  EDIT PATIENT
// ══════════════════════════════════════════════
function openEditModal(type, id) {
  if (type === "patient") {
    const p = S.patients.find(x => x._id === id);
    if (!p) return;
    document.getElementById("ep-id").value      = id;
    document.getElementById("ep-caseno").value  = pf(p,"Case Number") || "";
    document.getElementById("ep-name").value    = pf(p,"Name") || "";
    document.getElementById("ep-dob").value     = pf(p,"Date of Birth") ? pf(p,"Date of Birth").split("T")[0] : "";
    document.getElementById("ep-phone").value   = pf(p,"Phone Number") || "";
    document.getElementById("ep-address").value = pf(p,"Address") || "";
    document.getElementById("ep-notes").value   = pf(p,"notes") || "";
    // Set selects
    const setSelect = (id, val) => { const el=document.getElementById(id); if(el&&val) el.value=val; };
    setSelect("ep-gender",  pf(p,"Gender"));
    setSelect("ep-marital", pf(p,"Marital Status"));
    setSelect("ep-city",    pf(p,"city"));
    setSelect("ep-status",  pf(p,"final state"));
    // Checkboxes
    const needs = (pf(p,"helping type") || "").split(",").map(s=>s.trim());
    document.querySelectorAll("#ep-needs input").forEach(cb => {
      cb.checked = needs.includes(cb.value);
    });
    openModal("edit-patient");
  } else if (type === "medication") {
    const m = S.medications.find(x => x._id === id);
    if (!m) return;
    document.getElementById("emed-id").value       = id;
    document.getElementById("emed-name").value     = pf(m,"Medication Name") || "";
    document.getElementById("emed-dosage").value   = pf(m,"Dosage") || "";
    document.getElementById("emed-price").value    = pf(m,"price") || 0;
    document.getElementById("emed-notes").value    = pf(m,"notes") || "";
    const setS = (id,val) => { const el=document.getElementById(id); if(el) el.value=String(val); };
    setS("emed-avail",     pf(m,"availability"));
    setS("emed-available", pf(m,"availability"));
    // Show photo preview if exists
    const photoUrl = pf(m,"photo");
    const previewDiv = document.getElementById("emed-photo-preview");
    const previewImg = document.getElementById("emed-photo-img");
    if (photoUrl && previewDiv && previewImg) {
      previewImg.src = photoUrl;
      previewDiv.style.display = "block";
    } else if (previewDiv) {
      previewDiv.style.display = "none";
    }
    openModal("edit-medication");
  }
}

async function updatePatient() {
  const id   = document.getElementById("ep-id").value;
  const name = document.getElementById("ep-name").value.trim();
  if (!name) { showToast("الاسم مطلوب","error"); return; }
  const needs = [...document.querySelectorAll("#ep-needs input:checked")].map(c=>c.value).join(", ");
  const data = {
    "Name":           name,
    "Case Number":    document.getElementById("ep-caseno").value.trim(),
    "Phone Number":   document.getElementById("ep-phone").value.trim(),
    "Gender":         document.getElementById("ep-gender").value,
    "Marital Status": document.getElementById("ep-marital").value,
    "city":           document.getElementById("ep-city").value,
    "Address":        document.getElementById("ep-address").value.trim(),
    "helping type":   needs,
    "final state":    document.getElementById("ep-status").value,
    "notes":          document.getElementById("ep-notes").value.trim(),
  };
  if (document.getElementById("ep-dob").value)
    data["Date of Birth"] = document.getElementById("ep-dob").value;
  // Remove empty strings only (keep 0 and false)
  Object.keys(data).forEach(k => { if(data[k] === "") delete data[k]; });
  console.log("Updating patient:", id, JSON.stringify(data));
  try {
    await bubbleUpdate("A - 01 Patients", id, data);
    // Update local state
    const idx = S.patients.findIndex(x => x._id === id);
    if (idx > -1) Object.assign(S.patients[idx], data);
    showToast("تم حفظ التعديلات ✅","success");
    closeModal("edit-patient");
    filterPatients();
    // If in detail view, refresh
    if (currentPatientId === id) viewPatient(id);
  } catch(e) { showToast("خطأ: "+e.message,"error"); }
}

async function updateMedication() {
  const id   = document.getElementById("emed-id").value;
  const name = document.getElementById("emed-name").value.trim();
  if (!name) { showToast("اسم الدواء مطلوب","error"); return; }
  const data = {
    "Medication Name": name,
    "Dosage":          document.getElementById("emed-dosage").value.trim(),
    "price":           parseFloat(document.getElementById("emed-price").value) || 0,
    "Sponsorsed":      document.getElementById("emed-avail").value === "true" ? "نعم" : "لا",
    "availability":    document.getElementById("emed-available").value === "true",
    "notes":           document.getElementById("emed-notes").value.trim(),
  };
  console.log("Updating medication:", id, JSON.stringify(data));
  try {
    await bubbleUpdate("A - 03 Medications And Sponsorships", id, data);
    const idx = S.medications.findIndex(x => x._id === id);
    if (idx > -1) Object.assign(S.medications[idx], data);
    showToast("تم حفظ التعديلات ✅","success");
    closeModal("edit-medication");
    S.medications = await bubbleGetAll("A - 03 Medications And Sponsorships");
    filterMedications();
    if (currentPatientId) renderDetailMedications();
  } catch(e) { showToast("خطأ: "+e.message,"error"); console.error(e); }
}

// ══════════════════════════════════════════════
//  PHARMACIST: Toggle availability
// ══════════════════════════════════════════════
async function toggleAvailability(id, currentVal) {
  const newVal = !(currentVal === true || currentVal === "true");
  try {
    await bubbleUpdate("A - 03 Medications And Sponsorships", id, {
      "availability":  newVal,
      "availability 2": newVal ? "yes" : "no"
    });
    // Update local state immediately for UI feedback
    const idx = S.medications.findIndex(x => x._id === id);
    if (idx > -1) {
      S.medications[idx]["availability"] = newVal;
      S.medications[idx]["availability 2"] = newVal ? "yes" : "no";
    }
    filterMedications();
    if (currentPatientId) renderDetailMedications();
    showToast(newVal ? "✅ متوفر" : "❌ غير متوفر","success");
  } catch(e) { showToast("خطأ: "+e.message,"error"); console.error(e); }
}

// ══════════════════════════════════════════════
//  PRINT FUNCTIONS
// ══════════════════════════════════════════════
function printPatientList() {
  const rows = filtered.patients.map((p,i) => `
    <tr>
      <td>${i+1}</td>
      <td>${pf(p,"Case Number")||"—"}</td>
      <td>${pf(p,"Name")||"—"}</td>
      <td>${pf(p,"Phone Number")||"—"}</td>
      <td>${pf(p,"city")||"—"}</td>
      <td>${pf(p,"helping type")||"—"}</td>
      <td>${pf(p,"final state")||"—"}</td>
      <td>${pf(p,"notes")||"—"}</td>
    </tr>`).join("");
  const win = window.open("","_blank");
  win.document.write(`<!DOCTYPE html><html dir="rtl"><head>
    <meta charset="UTF-8">
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700&display=swap" rel="stylesheet">
    <style>body{font-family:Cairo,sans-serif;padding:20px;}table{width:100%;border-collapse:collapse;font-size:11px;}
    th{background:#1a3a5c;color:#fff;padding:8px;text-align:right;}td{padding:7px;border-bottom:1px solid #e2e8f0;}
    h2{color:#1a3a5c;}@media print{button{display:none}}</style></head><body>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
      <div><h2>قائمة المرضى — منظمة بناة العراق</h2><p style="font-size:12px;color:#666;">تاريخ الطباعة: ${new Date().toLocaleDateString("ar-IQ")}</p></div>
      <button onclick="window.print()">🖨️ طباعة</button>
    </div>
    <table><thead><tr><th>#</th><th>رقم الحالة</th><th>اسم المريض</th><th>الهاتف</th><th>المدينة</th><th>نوع الاحتياج</th><th>الحالة</th><th>ملاحظات</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <script>window.print();<\/script></body></html>`);
  win.document.close();
}

function printMedicationsList() {
  const isg = document.getElementById("med-group-view").style.display !== "none";
  let body = "";
  if (!isg) {
    body = filtered.medications.map((m,i) => `<tr>
      <td>${i+1}</td><td>${pf(m,"Medication Name")||"—"}</td>
      <td>${pf(m,"Dosage")||"—"}</td><td>${pf(m,"price")||0} د.ع</td>
      <td>${getPatientName(resolvePatientId(pf(m,"Patient")))}</td>
      <td>${pf(m,"city")||"—"}</td>
      <td>${pf(m,"availability")===true?"✅ متوفر":"❌ غير متوفر"}</td>
      <td>${pf(m,"notes")||"—"}</td>
    </tr>`).join("");
    body = `<table><thead><tr><th>#</th><th>الدواء</th><th>الكمية</th><th>السعر</th><th>المريض</th><th>المدينة</th><th>التوفر</th><th>ملاحظات</th></tr></thead><tbody>${body}</tbody></table>`;
  } else {
    // Grouped
    const groups = {};
    filtered.medications.forEach(m => {
      const pid = resolvePatientId(pf(m,"Patient"));
      if (!groups[pid]) groups[pid] = [];
      groups[pid].push(m);
    });
    body = Object.entries(groups).map(([pid,meds]) => `
      <div style="margin-bottom:16px;">
        <div style="background:#1a3a5c;color:#fff;padding:8px 12px;border-radius:6px;font-weight:700;margin-bottom:6px;">
          ${getPatientName(pid)} — ${getPatientProvince(pid)}
        </div>
        <table style="width:100%"><thead><tr><th>#</th><th>الدواء</th><th>الكمية</th><th>السعر</th><th>التوفر</th><th>ملاحظات</th></tr></thead>
        <tbody>${meds.map((m,i)=>`<tr><td>${i+1}</td><td>${pf(m,"Medication Name")||"—"}</td><td>${pf(m,"Dosage")||"—"}</td><td>${pf(m,"price")||0}</td><td>${pf(m,"availability")===true?"✅":"❌"}</td><td>${pf(m,"notes")||"—"}</td></tr>`).join("")}</tbody>
        </table>
      </div>`).join("");
  }
  const win = window.open("","_blank");
  win.document.write(`<!DOCTYPE html><html dir="rtl"><head>
    <meta charset="UTF-8">
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700&display=swap" rel="stylesheet">
    <style>body{font-family:Cairo,sans-serif;padding:20px;}table{width:100%;border-collapse:collapse;font-size:11px;}
    th{background:#1a3a5c;color:#fff;padding:8px;text-align:right;}td{padding:7px;border-bottom:1px solid #e2e8f0;}
    @media print{button{display:none}}</style></head><body>
    <div style="display:flex;justify-content:space-between;margin-bottom:16px;">
      <div><h2 style="color:#1a3a5c;">تقرير الأدوية — منظمة بناة العراق</h2>
      <p style="font-size:12px;color:#666;">${new Date().toLocaleDateString("ar-IQ")}</p></div>
      <button onclick="window.print()">🖨️ طباعة</button>
    </div>
    ${body}
    <script>window.print();<\/script></body></html>`);
  win.document.close();
}

function printPatientRx(patientId) {
  const p = S.patients.find(x => x._id === (patientId||currentPatientId));
  if (!p) return;
  const meds = S.medications.filter(m => resolvePatientId(pf(m,"Patient")) === p._id);
  const infoHtml = [
    ["اسم المريض", pf(p,"Name")],
    ["رقم الحالة", pf(p,"Case Number")],
    ["المدينة",    pf(p,"city")],
    ["الهاتف",     pf(p,"Phone Number")],
    ["تاريخ الميلاد", pf(p,"Date of Birth")?new Date(pf(p,"Date of Birth")).toLocaleDateString("ar-IQ"):"—"],
    ["الحالة",     pf(p,"final state")],
  ].map(([l,v])=>`<div><span style="font-weight:700;color:#1a3a5c;">${l}:</span> ${v||"—"}</div>`).join("");
  const medsHtml = meds.map((m,i)=>`<tr>
    <td>${i+1}</td>
    <td>${pf(m,"Medication Name")||"—"}</td>
    <td>${pf(m,"Dosage")||"—"}</td>
    <td>${pf(m,"price")||0} د.ع</td>
    <td>${pf(m,"availability")===true?"✅ متوفر":"❌ غير متوفر"}</td>
    <td>${pf(m,"notes")||"—"}</td>
  </tr>`).join("");
  const win = window.open("","_blank");
  win.document.write(`<!DOCTYPE html><html dir="rtl"><head>
    <meta charset="UTF-8">
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap" rel="stylesheet">
    <style>
      body{font-family:Cairo,sans-serif;padding:24px;max-width:800px;margin:auto;}
      .rx-header{text-align:center;border-bottom:3px solid #1a3a5c;padding-bottom:12px;margin-bottom:18px;}
      .rx-header h1{font-size:22px;font-weight:900;color:#1a3a5c;}
      .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px;margin-bottom:18px;background:#f8fafc;padding:12px;border-radius:8px;}
      table{width:100%;border-collapse:collapse;font-size:12px;}
      th{background:#1a3a5c;color:#fff;padding:9px;text-align:right;}
      td{padding:8px;border-bottom:1px solid #e2e8f0;}
      .footer{margin-top:30px;display:flex;justify-content:space-between;font-size:11px;color:#94a3b8;}
      @media print{button{display:none}}
    </style></head><body>
    <div class="rx-header">
      <h1>منظمة بناة العراق الطبي</h1>
      <p style="font-size:12px;color:#64748b;">وصفة طبية / قائمة أدوية</p>
    </div>
    <div class="info-grid">${infoHtml}</div>
    <table><thead><tr><th>#</th><th>اسم الدواء</th><th>الكمية الشهرية</th><th>السعر</th><th>حالة التوفر</th><th>ملاحظات</th></tr></thead>
    <tbody>${medsHtml}</tbody></table>
    <div class="footer">
      <span>تاريخ الطباعة: ${new Date().toLocaleDateString("ar-IQ")}</span>
      <span>منظمة بناة العراق © ${new Date().getFullYear()}</span>
    </div>
    <br><button onclick="window.print()" style="padding:8px 20px;background:#1a3a5c;color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:Cairo,sans-serif;font-weight:700;">🖨️ طباعة</button>
    <script>setTimeout(()=>window.print(),300);<\/script>
    </body></html>`);
  win.document.close();
}

// ══════════════════════════════════════════════
//  INIT — wait for DOM inside Bubble
// ══════════════════════════════════════════════
function safeInit() {
  if (document.getElementById("loadingOverlay") && document.getElementById("tbody-patients")) {
    // Read token from hidden input at runtime (after DOM is ready)
    var bt = document.getElementById('_bt');
    if (bt && bt.value && bt.value !== 'YOUR_BUBBLE_TOKEN') {
      window._BTOKEN = bt.value;
    }
    loadAll();
  } else {
    setTimeout(safeInit, 150);
  }
}
safeInit();
