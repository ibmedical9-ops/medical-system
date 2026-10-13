const P=require('./engine.js'),fs=require('fs'),assert=require('assert');
const S=fs.readFileSync('../database/samples/meeting_01.txt','utf8').trim();
const PR='استخرج القرارات والمهام والمواعيد من النص في جدول';
let r;
// 1 المحضر ثم التعليمات بسطر فارغ
r=P.splitInput(S+'\n\n'+PR); assert.strictEqual(r.source,S); assert.strictEqual(r.prompt,PR);
// 2 التعليمات أولاً ثم المحضر
r=P.splitInput(PR+'\n\n'+S); assert.strictEqual(r.source,S); assert.strictEqual(r.prompt,PR);
// 3 بلا سطر فارغ: التعليمات في السطر الأخير/الأول
r=P.splitInput(S+'\n'+PR); assert.strictEqual(r.source,S); assert.strictEqual(r.prompt,PR);
r=P.splitInput(PR+'\n'+S); assert.strictEqual(r.source,S); assert.strictEqual(r.prompt,PR);
// 4 فاصل صريح
r=P.splitInput(PR+'\n---\n'+S); assert.strictEqual(r.source,S); assert.strictEqual(r.prompt,PR); assert.strictEqual(r.how,'delimiter');
// 5 تعليمات فقط
r=P.splitInput(PR); assert.strictEqual(r.source,''); assert.strictEqual(r.prompt,PR);
// 6 محضر فقط
r=P.splitInput(S); assert.strictEqual(r.source,S); assert.strictEqual(r.prompt,'');
// 7 تعليمات تحوي نقطتين لا تُعدّ محضراً
const P2='استخرج ما يلي: القرارات والمهام. ملاحظة: اكتب غير محدد للمجهول';
r=P.splitInput(S+'\n\n'+P2); assert.strictEqual(r.source,S); assert.strictEqual(r.prompt,P2);
// 8 محضر قصير بلا ترويسة
const M='ليلى: تقرر أن يتولى عمر إعداد التقرير.\nعمر: أقترح أن نضيف مراجعة خارجية.';
r=P.splitInput(M+'\n\nلخص القرارات'); assert.strictEqual(r.source,M); assert.strictEqual(r.prompt,'لخص القرارات');
// 9 فارغ
assert.strictEqual(P.splitInput('  \n ').how,'empty');
// 10 التحليل على الناتج يطابق التحليل المباشر
assert.strictEqual(P.analyze(P.splitInput(S+'\n\n'+PR).prompt).score,P.analyze(PR).score);
console.log('split ok');
