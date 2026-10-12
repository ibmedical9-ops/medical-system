<?php
declare(strict_types=1);

namespace PromptTrap\Domain;

/** يبني برومبتاً محسّناً يغلق الثغرات المكتشفة، ويربط كل إضافة بالأخطاء التي كانت ستمنعها. */
final class ImprovedPromptBuilder
{
    public const CLAUSES = [
        'task' => 'استخرج القرارات المؤكدة والمهام (مع المسؤول عن كل مهمة وموعدها) والمقترحات غير المعتمدة والنقاط غير المحسومة من محضر الاجتماع.',
        'source' => 'اعتمد على نص المحضر فقط، ولا تضف أي معلومة أو اسم أو تاريخ من خارجه.',
        'scope' => 'اشمل جميع البنود دون حذف، وحافظ على الشروط والتفاصيل المهمة المرتبطة بكل بند.',
        'format' => 'اعرض النتيجة في جدول بأعمدة: النوع | البند | المسؤول | الموعد | الحالة.',
        'unknown' => 'إذا كانت أي معلومة (مسؤول أو موعد) غير مذكورة أو غير مؤكدة في المحضر فاكتب «غير محدد» أو «تقريبي» ولا تخمّنها.',
        'distinction' => 'ميّز بين القرارات المؤكدة والمقترحات غير المعتمدة والنقاط غير المحسومة، ولا تحوّل أي مقترح أو نقطة مفتوحة إلى قرار.',
        'verification' => 'قبل تقديم الإجابة راجع كل بند مقابل نص المحضر واحذف أي بند أو معلومة لا يسندها المصدر.',
    ];

    /**
     * @param array<int,array<string,mixed>> $errors سجلات الأخطاء (اختياري)
     * @return array{prompt:string,additions:array<int,array<string,mixed>>}
     */
    public function build(string $prompt, array $analysis, array $errors = []): array
    {
        $preventing = [];
        foreach ($errors as $e) {
            $preventing[$e['cause_dim']][] = $e['label'];
        }
        $dims = array_values(array_unique(array_merge(array_keys($preventing), $analysis['gaps'])));
        $order = array_keys(self::CLAUSES);
        usort($dims, fn($a, $b) => array_search($a, $order) <=> array_search($b, $order));

        $additions = [];
        $text = trim($prompt);
        if ($text !== '' && !preg_match('/[.!؟?]$/u', $text)) {
            $text .= '.';
        }
        foreach ($dims as $d) {
            if (!isset(self::CLAUSES[$d])) {
                continue;
            }
            $level = $analysis['dimensions'][$d]['level'] ?? 0;
            if ($level >= 0.75 && empty($preventing[$d])) {
                continue;
            }
            $text .= ' ' . self::CLAUSES[$d];
            $additions[] = [
                'dimension' => $d,
                'label' => PromptAnalyzer::DIMENSIONS[$d]['label'],
                'clause' => self::CLAUSES[$d],
                'prevents' => array_values(array_unique($preventing[$d] ?? [])),
            ];
        }
        return ['prompt' => trim($text), 'additions' => $additions];
    }
}
