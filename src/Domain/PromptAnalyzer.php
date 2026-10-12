<?php
declare(strict_types=1);

namespace PromptTrap\Domain;

use PromptTrap\Support\Text;

/**
 * تقييم اكتمال البرومبت بقواعد لغوية على المحتوى (لا يعتمد على عدد الكلمات).
 * هذا تقييم آلي تقريبي: قد يخطئ مع الصياغات غير المألوفة، ولذلك يُعرض للمتدرب كمؤشر لا كحكم.
 */
final class PromptAnalyzer
{
    public const DIMENSIONS = [
        'task' => ['label' => 'وضوح المهمة', 'weight' => 15,
            'gap' => 'لم تُحدَّد المهمة بدقة؛ يمكن للنموذج اختيار تفسير واحد من عدة تفسيرات.'],
        'source' => ['label' => 'تحديد المصدر', 'weight' => 15,
            'gap' => 'لم تُلزم النموذج بالاعتماد على المصدر وحده؛ يمكنه إضافة معلومات من عنده.'],
        'scope' => ['label' => 'نطاق المعلومات', 'weight' => 15,
            'gap' => 'لم تُحدَّد المعلومات المطلوبة ولا مدى الاكتمال؛ يمكنه الإجابة عن جزء وإسقاط تفاصيل.'],
        'format' => ['label' => 'تنسيق المخرجات', 'weight' => 10,
            'gap' => 'لم يُحدَّد شكل المخرجات؛ يمكنه اختيار شكل لا يناسب حاجتك.'],
        'unknown' => ['label' => 'التعامل مع المجهول', 'weight' => 15,
            'gap' => 'لم تحدد ماذا يفعل مع المعلومة الناقصة؛ يمكنه ملؤها بتخمين.'],
        'distinction' => ['label' => 'التمييز بين الحقيقة والمقترح والقرار', 'weight' => 15,
            'gap' => 'لم تطلب التمييز بين المؤكد والمقترح وغير المحسوم؛ يمكنه الخلط بينها.'],
        'verification' => ['label' => 'التحقق مقابل المصدر', 'weight' => 15,
            'gap' => 'لم تشترط مراجعة النتائج مقابل المصدر؛ تمر الأخطاء دون فحص.'],
    ];

    public const CATEGORIES = [
        'decisions' => 'قرار|قرارات|اتفاق|اتفاقات|ما تم الاتفاق|ما تقرر|ما تم اعتماده',
        'tasks' => 'مهمة|مهام|مطلوب|اجراءات|إجراءات|تكليفات|التزامات|اعمال المتابعة|بنود العمل',
        'owners' => 'مسؤول|مسؤولين|مسؤولية|مسؤوليات|المكلف|المكلفين|من سيقوم|اصحاب المهام',
        'deadlines' => 'موعد|مواعيد|تاريخ|تواريخ|الموعد النهائي|مهلة|مهل|جدول زمني|متى',
        'proposals' => 'مقترح|مقترحات|اقتراح|اقتراحات|افكار',
        'open' => 'غير محسوم|غير المحسومة|معلق|معلقة|نقاط مفتوحة|لم تحسم|لم يحسم|نقاط عالقة|اسئلة مفتوحة',
    ];

    /** @return array<string,mixed> */
    public function analyze(string $prompt): array
    {
        $p = Text::norm($prompt);
        $requested = [];
        foreach (self::CATEGORIES as $cat => $alts) {
            if (Text::has($p, $alts)) {
                $requested[] = $cat;
            }
        }

        $levels = [
            'task' => $this->task($p, $requested),
            'source' => $this->source($p),
            'scope' => $this->scope($p, $requested),
            'format' => $this->format($p),
            'unknown' => $this->unknown($p),
            'distinction' => $this->distinction($p),
            'verification' => $this->verification($p),
        ];

        $score = 0.0;
        $dims = [];
        $gaps = [];
        $min = 1.0;
        foreach (self::DIMENSIONS as $key => $meta) {
            [$level, $found] = $levels[$key];
            $score += $meta['weight'] * $level;
            $min = min($min, $level);
            $status = $level >= 0.75 ? 'ok' : ($level >= 0.35 ? 'partial' : 'missing');
            if ($level < 0.75) {
                $gaps[] = $key;
            }
            $dims[$key] = [
                'label' => $meta['label'],
                'weight' => $meta['weight'],
                'level' => round($level, 2),
                'status' => $status,
                'detail' => $status === 'ok' ? 'محدَّد: ' . $found : ($found !== '' ? 'محدَّد جزئياً: ' . $found . ' — ' . $meta['gap'] : $meta['gap']),
            ];
        }
        $score = (int) round($score);

        return [
            'score' => $score,
            'dimensions' => $dims,
            'gaps' => $gaps,
            'requested' => $requested,
            'format' => $this->formatKind($p),
            'mode' => ($score >= 85 && $min >= 0.75) ? 'precise' : 'trap',
            'min_level' => round($min, 2),
        ];
    }

    /** @return array{0:float,1:string} */
    private function task(string $p, array $requested): array
    {
        $verb = Text::has($p, 'استخرج|لخص|حلل|اكتب|اعرض|حدد|اذكر|رتب|صنف|اسرد|عدد|سجل|قدم|اعطني|اريد|جمع|فرز|ولد|اعد');
        $objects = count(array_diff($requested, ['owners', 'deadlines'])) + count(array_intersect($requested, ['owners', 'deadlines']));
        $s = ($verb ? 0.35 : 0.0) + ($objects >= 2 ? 0.65 : ($objects === 1 ? 0.4 : 0.0));
        $found = [];
        if ($verb) {
            $found[] = 'فعل الطلب';
        }
        if ($objects) {
            $found[] = 'نوع المعلومات المطلوبة (' . $objects . ')';
        }
        return [min(1.0, $s), implode('، ', $found)];
    }

    /** @return array{0:float,1:string} */
    private function source(string $p): array
    {
        $ref = Text::has($p, 'من المصدر|من النص|المحضر|محضر|النص المرفق|المصدر|الوارد في|المذكور في|بناء علي النص|استنادا الي|بالاعتماد علي|وفق النص');
        $only = Text::has($p, 'وحده|وحدها|حصرا|فحسب|دون سواه|دون غيره');
        $excl = $only || preg_match('/(?:من|علي|الي|في|ب)\s*(?:ال)?(?:مصدر|نص|محضر)\S*\s+فقط|فقط\s+(?:من|علي|ب)\s*(?:ال)?(?:مصدر|نص|محضر)/u', $p)
            || Text::has($p, 'لا تضف|لا تخترع|لا تستخدم اي معلومات|لا تستخدم معلومات|من خارج|دون اضافه|لا تفترض|لا تعتمد علي اي معلومات|لا تضيف');
        $s = ($ref ? 0.5 : 0.0) + ($excl ? 0.5 : 0.0);
        $found = array_filter([$ref ? 'الإشارة إلى المصدر' : null, $excl ? 'الحصر في المصدر/منع الإضافة' : null]);
        return [$s, implode('، ', $found)];
    }

    /** @return array{0:float,1:string} */
    private function scope(string $p, array $requested): array
    {
        $n = count($requested);
        $base = $n >= 3 ? 0.7 : ($n === 2 ? 0.5 : ($n === 1 ? 0.3 : 0.0));
        $complete = Text::has($p, 'جميع|كل |كافة|لا تحذف|لا تهمل|دون حذف|حافظ علي|التفاصيل|الشروط|الاستثناءات|شامل|كامل|بالكامل');
        $s = min(1.0, $base + ($complete ? 0.3 : 0.0));
        $found = array_filter([$n ? 'فئات المعلومات المطلوبة (' . $n . ')' : null, $complete ? 'اشتراط الاكتمال/حفظ التفاصيل' : null]);
        return [$s, implode('، ', $found)];
    }

    /** @return array{0:float,1:string} */
    private function format(string $p): array
    {
        if ($this->formatKind($p) !== 'none') {
            return [1.0, 'نوع الشكل (' . $this->formatKind($p) . ')'];
        }
        if (Text::has($p, 'منظم|مرتب|واضح|مختصر|موجز|بسيط')) {
            return [0.25, 'وصف عام للشكل دون تحديده'];
        }
        return [0.0, ''];
    }

    private function formatKind(string $p): string
    {
        if (preg_match('/json/u', $p)) {
            return 'json';
        }
        if (preg_match('/جدول(?!\s+زمني)|اعمده|عمود|csv/u', $p)) {
            return 'table';
        }
        if (Text::has($p, 'قايمه|نقاط|ترقيم|مرقمه|bullet|بنود')) {
            return 'list';
        }
        if (Text::has($p, 'فقره|فقرات|نثر|سرد')) {
            return 'prose';
        }
        return 'none';
    }

    /** @return array{0:float,1:string} */
    private function unknown(string $p): array
    {
        $cond = preg_match('/(?:اذا|في حال|عند|حين|لو)\s.{0,40}?(?:غير|مجهول|ناقص|لم يذكر|لم تذكر|لم يحدد|مفقود|ما ذكر|غاب|غابت|لم يرد|لم ترد)/u', $p)
            || preg_match('/(?:اي|كل)\s+(?:معلومه|مسوول|موعد|اسم|تاريخ|بند)\S*(?:\s+او\s+\S+)?\s+(?:لم يرد|لم ترد|لم يذكر|لم تذكر|لم يحدد|غير مذكور|غير موجود|غير محدد|مفقود)/u', $p)
            || preg_match('/(?:المعلومات?|المعلومه|الاسم|الموعد|المسوول)\s+(?:المجهول|الناقص|غير المذكور|غير المحدد|المفقود)/u', $p);
        $label = Text::has($p, 'غير محدد|غير معروف|غير مذكور|مجهول|ناقص|لم يحدد');
        $action = (bool) preg_match('/(?<![ء-ي])(?:ف|و)?(?:اكتب|اذكر|ضع|اشر|سجل|علم|وضح|بين|قل|صرح|اعلن)/u', $p);
        $noGuess = Text::has($p, 'لا تخمن|لا تفترض|لا تخترع|لا تتوقع|لا تضف');
        $s = 0.0;
        $found = [];
        if ($cond) {
            $s += 0.5;
            $found[] = 'حالة المعلومة الناقصة';
            if ($action) {
                $s += 0.5;
                $found[] = 'ما يُكتب عندها';
            }
        } elseif ($label) {
            $s += 0.3;
            $found[] = 'ذُكر «غير محدد» دون قاعدة واضحة';
        }
        if ($noGuess) {
            $s += 0.35;
            $found[] = 'منع التخمين';
        }
        return [min(1.0, $s), implode('، ', $found)];
    }

    /** @return array{0:float,1:string} */
    private function distinction(string $p): array
    {
        $verb = Text::has($p, 'ميز|فرق|افصل|صنف|قسم|فصل');
        $noun = Text::has($p, 'مقترح|قرار|مؤكد|محسوم|افتراض|حقيق|نهائي|معتمد');
        $noConflate = Text::has($p, 'لا تحول|لا تخلط|لا تعتبر|لا تعامل|لا تجعل') && Text::has($p, 'مقترح|اقتراح');
        $weakNoun = Text::has($p, 'مؤكد|محسوم|نهائي|معتمد|رسمي');
        $s = 0.0;
        $found = [];
        if ($verb && $noun) {
            $s += 0.8;
            $found[] = 'طلب التمييز بين الأنواع';
        }
        if ($noConflate) {
            $s += 0.4;
            $found[] = 'منع تحويل المقترح إلى قرار';
        }
        if ($s === 0.0 && $weakNoun) {
            $s = 0.35;
            $found[] = 'إشارة عابرة إلى «المؤكد» دون قاعدة للتمييز';
        }
        return [min(1.0, $s), implode('، ', $found)];
    }

    /** @return array{0:float,1:string} */
    private function verification(string $p): array
    {
        $verb = Text::has($p, 'راجع|تحقق|دقق|قارن|طابق|تاكد|فحص|اختبر');
        $ref = preg_match('/(?:مقابل|مع|من|في|الي|علي|بالرجوع الي|ب)\s*(?:ال)?(?:مصدر|نص|محضر)/u', $p);
        if ($verb && $ref) {
            return [1.0, 'مراجعة النتائج مقابل المصدر'];
        }
        if ($verb) {
            return [0.4, 'طلب مراجعة دون ربطها بالمصدر'];
        }
        if (Text::has($p, 'كن دقيق|بدقة|دقيق|بعناية')) {
            return [0.1, 'عبارة «دقيق» وحدها لا تحدد أي فحص'];
        }
        return [0.0, ''];
    }
}
