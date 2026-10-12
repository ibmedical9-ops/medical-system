<?php
declare(strict_types=1);
header("Content-Security-Policy: default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
?>
<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Prompt Trap Lab — مختبر فخاخ البرومبتات</title>
  <link rel="icon" href="data:,">
  <link rel="stylesheet" href="assets/app.css">
</head>
<body>
<header class="top">
  <div class="brand">
    <span class="logo" aria-hidden="true">&lt;/&gt;</span>
    <div>
      <h1>Prompt Trap Lab</h1>
      <p>مختبر فخاخ البرومبتات</p>
    </div>
  </div>
  <div class="user">
    <span id="userChip" class="chip"></span>
    <button id="loginBtn" class="btn ghost small" type="button">دخول المدرب</button>
    <button id="logoutBtn" class="btn ghost small" type="button" hidden>خروج</button>
  </div>
</header>

<div id="providerNotice" class="banner" role="note"></div>
<div id="toast" class="toast" role="status" aria-live="polite" hidden></div>

<main class="container">
  <section id="setup" class="card">
    <h2>١. تجربة جديدة</h2>
    <p class="muted">اختر السيناريو وضع محضر الاجتماع. سيحاول النموذج التدريبي استغلال أي نقص في تعليماتك، ثم تكشف أخطاءه بنفسك.</p>
    <div class="row">
      <label class="field"><span>السيناريو التدريبي</span>
        <select id="scenarioSel"></select>
      </label>
      <label class="field"><span>المصدر</span>
        <select id="sampleSel"></select>
      </label>
    </div>
    <label class="field"><span>نص المصدر (محضر الاجتماع) <small id="srcCount" class="muted"></small></span>
      <textarea id="sourceTxt" rows="9" placeholder="الصق محضر الاجتماع هنا. الصيغة المفضلة: «اسم المتحدث: كلامه» في كل سطر."></textarea>
    </label>
    <p class="hint">يُعامل النص كبيانات للتحليل فقط، وأي تعليمات مكتوبة داخله لا تغيّر سلوك النظام.</p>
    <button id="startBtn" class="btn primary" type="button">بدء تجربة جديدة</button>
  </section>

  <section id="workspace" hidden>
    <div class="grid2">
      <article class="card">
        <h2>المصدر</h2>
        <pre id="sourceView" class="source" tabindex="0"></pre>
      </article>
      <article class="card">
        <h2>٢. اكتب تعليماتك</h2>
        <label class="field"><span>البرومبت <small class="muted">(من عندك، دون قوالب جاهزة)</small></span>
          <textarea id="promptTxt" rows="9" maxlength="4000" placeholder="اكتب هنا ما تريد من النموذج أن يفعله بالمحضر…"></textarea>
        </label>
        <div class="actions">
          <button id="runBtn" class="btn primary" type="button">تنفيذ التعليمات</button>
          <span id="runState" class="muted"></span>
        </div>
      </article>
    </div>

    <article id="resultCard" class="card" hidden>
      <div class="card-head">
        <h2>٣. نتيجة النموذج <small id="attemptTag" class="muted"></small></h2>
        <span id="simBadge" class="badge"></span>
      </div>
      <div id="output" class="output"></div>
      <div id="outputNote" class="hint" hidden></div>

      <fieldset class="verdict" id="verdictBox">
        <legend>هل ترى هذه النتيجة صحيحة؟ (قرارك قبل الكشف)</legend>
        <label><input type="radio" name="verdict" value="correct"> صحيحة</label>
        <label><input type="radio" name="verdict" value="wrong"> فيها أخطاء</label>
        <label><input type="radio" name="verdict" value="unsure"> لست متأكداً</label>
      </fieldset>

      <div class="actions wrap">
        <button id="retryBtn" class="btn" type="button">محاولة أخرى</button>
        <button id="revealBtn" class="btn danger" type="button">كشف الأخطاء</button>
        <button id="evalBtn" class="btn" type="button">تقييم البرومبت</button>
        <button id="improveBtn" class="btn" type="button">تحسين البرومبت</button>
      </div>
    </article>

    <article id="evalPanel" class="card" hidden></article>
    <article id="improvePanel" class="card" hidden></article>
    <article id="revealPanel" class="card" hidden></article>

    <article id="historyCard" class="card" hidden>
      <h2>سجل المحاولات</h2>
      <div id="compare" class="compare" hidden></div>
      <ol id="attemptList" class="attempts"></ol>
    </article>
  </section>

  <section id="pastCard" class="card" hidden>
    <h2>تجارب سابقة</h2>
    <ul id="pastList" class="past"></ul>
  </section>

  <section id="trainerCard" class="card" hidden>
    <h2>لوحة المدرب</h2>
    <p class="muted">عرض مفاتيح الإجابة لأي محاولة (متاح للمدرب فقط).</p>
    <div id="trainerList" class="past"></div>
    <div id="trainerKey"></div>
  </section>
</main>

<dialog id="loginDlg">
  <form method="dialog" id="loginForm">
    <h3>دخول المدرب</h3>
    <label class="field"><span>اسم المستخدم</span><input id="lgUser" autocomplete="username"></label>
    <label class="field"><span>كلمة المرور</span><input id="lgPass" type="password" autocomplete="current-password"></label>
    <p id="lgErr" class="err-text" hidden></p>
    <div class="actions">
      <button id="lgOk" class="btn primary" type="button">دخول</button>
      <button class="btn ghost" value="cancel">إلغاء</button>
    </div>
  </form>
</dialog>

<footer class="foot">
  <p>التقييم الآلي تقريبي ولا يضمن جودة النتيجة مع نموذج حقيقي. المحاكاة المحلية ليست نموذجاً لغوياً.</p>
</footer>
<script src="assets/app.js"></script>
</body>
</html>
