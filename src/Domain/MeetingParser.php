<?php
declare(strict_types=1);

namespace PromptTrap\Domain;

use PromptTrap\Support\Text;

/**
 * يستخرج «الحقيقة المرجعية» من محضر الاجتماع بقواعد لغوية قابلة للتفسير (ليس نموذجاً لغوياً).
 * كل بند يحمل اقتباساً حرفياً من المصدر في evidence، وهو ما يعتمد عليه كشف الأخطاء.
 * حدود معروفة: يعمل جيداً مع جمل عربية صريحة بصيغة «المتحدث: جملة»، وقد يخطئ مع الصياغات الملتوية.
 */
final class MeetingParser
{
    private const HEADERS = ['الحضور', 'المشاركون', 'المشاركين', 'التاريخ', 'العنوان', 'الموضوع', 'المكان', 'الجلسة'];

    private const DAYS = 'الأحد|الاحد|الإثنين|الاثنين|الثلاثاء|الأربعاء|الاربعاء|الخميس|الجمعة|السبت';
    private const MONTHS = 'يناير|فبراير|مارس|أبريل|ابريل|مايو|يونيو|يوليو|أغسطس|اغسطس|سبتمبر|أكتوبر|اكتوبر|نوفمبر|ديسمبر|كانون الثاني|شباط|آذار|نيسان|أيار|حزيران|تموز|آب|أيلول|تشرين الأول|تشرين الثاني|كانون الأول';

    /** @return array{title:?string,date:?string,participants:string[],items:array<int,array<string,mixed>>} */
    public function parse(string $source): array
    {
        $participants = [];
        $title = $date = null;
        $utterances = [];
        $speaker = null;

        foreach (preg_split('/\R/u', trim($source)) ?: [] as $line) {
            $line = trim($line);
            if ($line === '') {
                continue;
            }
            if (preg_match('/^([^:：]{1,30})[:：]\s*(.*)$/u', $line, $m) && substr_count(trim($m[1]), ' ') <= 2) {
                $label = trim($m[1]);
                $rest = trim($m[2]);
                $nl = Text::norm($label);
                $isHeader = false;
                foreach (self::HEADERS as $h) {
                    if ($nl === Text::norm($h)) {
                        $isHeader = true;
                        if (in_array($h, ['الحضور', 'المشاركون', 'المشاركين'], true)) {
                            foreach (preg_split('/\s*[،,;؛]\s*|\s+و(?=\s)\s*/u', $rest) ?: [] as $p) {
                                $p = trim($p);
                                if ($p !== '') {
                                    $participants[] = $p;
                                }
                            }
                        } elseif ($h === 'التاريخ') {
                            $date = $rest;
                        } elseif ($h === 'العنوان' || $h === 'الموضوع') {
                            $title = $rest;
                        }
                    }
                }
                if ($isHeader) {
                    continue;
                }
                $speaker = $label;
                $participants[] = $label;
                $line = $rest;
            }
            foreach (Text::sentences($line) as $s) {
                $utterances[] = [$speaker, $s];
            }
        }

        $participants = array_values(array_unique($participants));
        $items = [];
        $lastPending = null; // مؤشر آخر مقترح معلّق

        foreach ($utterances as [$spk, $sentence]) {
            $n = Text::normalize($sentence);
            $norm = $n['norm'];

            // تعديل الموعد السابق: «هذا الموعد تقريبي»
            if (preg_match('/^(?:ولكن |لكن )?(?:هذا )?(?:الموعد|التاريخ)\b/u', $norm)
                && Text::has($norm, 'تقريبي|مبدئي|غير نهائي|غير مؤكد|قابل للتغيير')
                && $items) {
                $items[array_key_last($items)]['due_status'] = $items[array_key_last($items)]['due'] ? 'tentative' : 'none';
                $items[array_key_last($items)]['evidence'][] = Text::clean($sentence);
                continue;
            }

            $isOpen = Text::has($norm, 'لم يحسم|لم نحسم|لم تحسم|غير محسوم|لم يتم تحديد|لم يتم الاتفاق|لم نتفق|لم يحدد|لم يتحدد|لم تحدد|نؤجل البت|يؤجل البت|نحتاج الي معرفة|نحتاج الي تحديد|نحتاج الي التاكد|لا نعرف|ما زال مفتوح|سنناقش لاحقا|بحاجة الي قرار|بانتظار')
                && !Text::has($norm, 'تقرر|قررنا');
            $isReject = Text::has($norm, 'رفضنا|تم رفض|تم رفضه|مرفوض|لم نوافق|لا نوافق علي|لم يتم قبول|رفض الاقتراح|رفضت');
            $approveCue = Text::has($norm, 'تمت الموافقه|وافق الجميع|اتفق الجميع|اتفقنا|تم الاتفاق|نوافق جميعا|وافقنا|لا اعتراض|تمت الموافقة');
            $refWord = Text::has($norm, 'ذلك|هذا|الاقتراح|المقترح|ما سبق|الفكره');
            $isApprovalRef = $approveCue && !$isOpen && ($refWord || mb_strlen($norm) < 28) && !preg_match('/علي (?:ان|تاجيل|اعتماد|اختيار)/u', $norm);
            $isProposal = Text::has($norm, 'اقترح|اقتراح|ماذا لو|ما رايكم|يمكننا ان|هل نستطيع|افضل ان|اري ان|اظن ان|ممكن ان|فكره');
            $isDecision = !$isOpen && Text::has($norm, 'تقرر|قررنا|قرر |تم الاتفاق علي|اتفقنا علي|تمت الموافقه علي|وافقنا علي|تم اعتماد|اعتمدنا|تم اختيار|اخترنا|القرار');

            $owner = $this->owner($sentence, $norm, $spk, $participants);
            $taskCue = $this->taskCue($norm, $participants);

            if ($isOpen) {
                $items[] = $this->item('open', $sentence, $spk, null, $n);
                continue;
            }
            if ($isReject && $lastPending !== null) {
                $items[$lastPending]['status'] = 'rejected';
                $items[$lastPending]['evidence'][] = Text::clean($sentence);
                $lastPending = null;
                continue;
            }
            if ($isApprovalRef && $lastPending !== null) {
                $it = &$items[$lastPending];
                $it['status'] = 'approved';
                $it['kind'] = ($it['owner'] !== null || $it['task_cue']) ? 'task' : 'decision';
                $it['evidence'][] = Text::clean($sentence);
                unset($it);
                $lastPending = null;
                continue;
            }
            if ($isProposal && !$isDecision) {
                $it = $this->item('proposal', $sentence, $spk, $owner, $n);
                $it['status'] = 'pending';
                $it['task_cue'] = $taskCue;
                $items[] = $it;
                $lastPending = array_key_last($items);
                continue;
            }
            if ($isDecision && $taskCue) {
                $items[] = $this->item('task', $sentence, $spk, $owner, $n);
                continue;
            }
            if ($isDecision) {
                $items[] = $this->item('decision', $sentence, $spk, null, $n);
                continue;
            }
            if ($taskCue) {
                $items[] = $this->item('task', $sentence, $spk, $owner, $n);
                continue;
            }
            if (count(preg_split('/\s+/u', $norm, -1, PREG_SPLIT_NO_EMPTY)) >= 4) {
                $items[] = $this->item('discussion', $sentence, $spk, null, $n);
            }
        }

        foreach ($items as $i => &$it) {
            $it['id'] = $i + 1;
        }
        unset($it);

        return ['title' => $title, 'date' => $date, 'participants' => $participants, 'items' => $items];
    }

    /** @return array<string,mixed> */
    private function item(string $kind, string $sentence, ?string $speaker, ?string $owner, array $n): array
    {
        $norm = $n['norm'];
        $hedge = Text::has($norm, 'ربما|قد |اظن|لعل|اتوقع|غالبا|تقريبا|مبدئيا|ان امكن|نحاول|احاول|ساحاول|سنحاول|نامل|لكن هذا الموعد');
        [$due, $dueStatus] = $this->deadline($n, $hedge);
        [$core, $condition] = $this->condition($n, $sentence);

        return [
            'id' => 0,
            'kind' => $kind,
            'text' => Text::clean($sentence),
            'core' => Text::clean($core),
            'condition' => $condition === null ? null : Text::clean($condition),
            'speaker' => $speaker,
            'owner' => $owner,
            'due' => $due,
            'due_status' => $dueStatus,
            'hedged' => $hedge && in_array($kind, ['task'], true),
            'status' => $kind === 'proposal' ? 'pending' : null,
            'task_cue' => false,
            'evidence' => [Text::clean($sentence)],
        ];
    }

    private function taskCue(string $norm, array $participants): bool
    {
        if (preg_match('/(?<![ء-ي])(?:يتولي|تتولي|ستتولي|سيتولي|سنتولي|تكليف|كلف|تكلف|يكلف|اسند|تسند|مسوول(?:ه|ين)?|مسووليه)(?![ء-ي])/u', $norm)) {
            return true;
        }
        if (preg_match('/(?<![ء-ي])سيتم(?![ء-ي])/u', $norm)) {
            return true;
        }
        if (preg_match('/(?<![ء-ي])علي\s+\S+\s+ان\s/u', $norm)) {
            return true;
        }
        $skip = ['سيكون', 'ستكون', 'سنكون', 'سنوات', 'سنتين', 'سياره', 'سيارات', 'سيناريو', 'سينما', 'ستوديو', 'سيرفر', 'سيستم', 'ستايل', 'ستيف', 'ساعه', 'ساعات', 'ساعتين', 'ساعتان', 'سابق', 'سابقا', 'ساحه', 'ساكن', 'سايق', 'سالف', 'سياسه', 'سياسات', 'ستين', 'سنتر'];
        foreach ($participants as $p) {
            $skip[] = Text::norm(explode(' ', $p)[0]);
        }
        preg_match_all('/(?<![ء-ي])(?:سا|سي|ست|سن)[ء-ي]{2,}(?![ء-ي])/u', $norm, $all);
        foreach ($all[0] as $tok) {
            if (!in_array($tok, $skip, true) && !str_starts_with($tok, 'سنا') ) {
                return true;
            }
        }
        // «سنناقش/سنا...» مستبعدة عمداً (نقاط مفتوحة لا مهام)
        return false;
    }

    private function owner(string $sentence, string $norm, ?string $speaker, array $participants): ?string
    {
        // ضمير المتكلم: سأ... / أنا سـ...
        $skip = [];
        foreach ($participants as $p) {
            $skip[] = Text::norm(explode(' ', $p)[0]);
        }
        $skip = array_merge($skip, ['ساعه', 'ساعات', 'ساعتين', 'سابق', 'سابقا', 'ساحه', 'ساكن', 'سايق']);
        if (preg_match_all('/(?<![ء-ي])سا[ء-ي]{2,}(?![ء-ي])/u', $norm, $all)) {
            foreach ($all[0] as $tok) {
                if (!in_array($tok, $skip, true)) {
                    return $speaker;
                }
            }
        }
        // أسماء مذكورة (غير المتحدث) بترتيب ظهورها
        $found = [];
        foreach ($participants as $p) {
            if ($p === $speaker) {
                continue;
            }
            $first = preg_quote(Text::norm(explode(' ', $p)[0]), '/');
            if (preg_match('/(?<![ء-ي])(?:و|ل|ب|ك|ف)?' . $first . '(?![ء-ي])/u', $norm, $m, PREG_OFFSET_CAPTURE)) {
                $found[$m[0][1]] = $p;
            }
        }
        if ($found) {
            ksort($found);
            return reset($found);
        }
        return null;
    }

    /** @return array{0:?string,1:string} */
    private function deadline(array $n, bool $hedge): array
    {
        $days = Text::norm(self::DAYS);
        $months = Text::norm(self::MONTHS);
        $core = '(?:' . $days . ')|نهايه\s+(?:الاسبوع|الشهر|الربع|السنه)|الاسبوع\s+(?:القادم|المقبل)|الشهر\s+(?:القادم|المقبل)|\d{1,4}[\/\-]\d{1,2}(?:[\/\-]\d{1,4})?|\d{1,2}\s+(?:' . $months . ')(?:\s+\d{4})?|(?:' . $months . ')\s+(?:القادم|المقبل)|بعد\s+\d+\s+(?:ايام|يوم|اسابيع|اسبوع|اشهر|شهر)|بعد\s+(?:يومين|اسبوعين|شهرين)|غدا|بعد غد|الاسبوع القادم';
        $rx = '/(?<![ء-ي])(?:(?:قبل|بحلول|حتي|خلال|مع|في)\s+|ب)?(?:يوم\s+)?(?:' . $core . ')(?:\s+(?:القادم|المقبل))?/u';
        $hit = Text::find($n, $rx);
        if ($hit === null) {
            return [null, 'none'];
        }
        $tentative = $hedge || Text::has($n['norm'], 'تقريبي|مبدئي|غير نهائي|غير مؤكد');
        return [Text::clean($hit['text']), $tentative ? 'tentative' : 'confirmed'];
    }

    /** @return array{0:string,1:?string} */
    private function condition(array $n, string $sentence): array
    {
        $rx = '/(?<![ء-ي])(?:بشرط|ما لم|الا اذا|شريطه|علي ان يتم|بعد موافقه|بعد اعتماد|بحيث|اذا)(?![ء-ي])/u';
        $hit = Text::find($n, $rx);
        if ($hit === null || $hit['start'] < 8) {
            return [$sentence, null];
        }
        $core = Text::slice($n, 0, $hit['start']);
        $cond = Text::slice($n, $hit['start']);
        return [$core, $cond];
    }
}
