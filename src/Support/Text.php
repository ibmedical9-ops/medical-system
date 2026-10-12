<?php
declare(strict_types=1);

namespace PromptTrap\Support;

/**
 * أدوات النص العربي: توحيد الحروف مع الحفاظ على تقابل المواضع بين النص الأصلي والمطبَّع،
 * حتى نستطيع اقتباس النص الأصلي حرفياً بعد المطابقة على النص المطبَّع.
 */
final class Text
{
    private const MAP = [
        'أ' => 'ا', 'إ' => 'ا', 'آ' => 'ا', 'ٱ' => 'ا',
        'ى' => 'ي', 'ئ' => 'ي', 'ة' => 'ه', 'ؤ' => 'و',
        '٠' => '0', '١' => '1', '٢' => '2', '٣' => '3', '٤' => '4',
        '٥' => '5', '٦' => '6', '٧' => '7', '٨' => '8', '٩' => '9',
        '،' => ',', '؛' => ';', '؟' => '?',
    ];

    /** @return array{norm:string, map:int[], chars:string[]} */
    public static function normalize(string $s): array
    {
        $chars = preg_split('//u', $s, -1, PREG_SPLIT_NO_EMPTY) ?: [];
        $norm = '';
        $map = [];
        foreach ($chars as $i => $c) {
            // تشكيل، تطويل، محارف عرض صفري
            if (preg_match('/^[\x{064B}-\x{065F}\x{0670}\x{0640}\x{200B}-\x{200F}\x{202A}-\x{202E}]$/u', $c)) {
                continue;
            }
            $norm .= self::MAP[$c] ?? mb_strtolower($c);
            $map[] = $i;
        }
        return ['norm' => $norm, 'map' => $map, 'chars' => $chars];
    }

    public static function norm(string $s): string
    {
        return self::normalize($s)['norm'];
    }

    /** يبني تعبيراً نمطياً من بدائل مفصولة بـ | بعد تطبيعها. */
    public static function rx(string $alternatives, string $wrapL = '', string $wrapR = ''): string
    {
        $alts = array_map(
            static fn(string $a) => preg_quote(self::norm($a), '/'),
            explode('|', $alternatives)
        );
        // preg_quote يهرّب المسافة؟ لا؛ لكنه يهرّب '-' و '/' فقط ضمن ما نحتاج.
        return '/' . $wrapL . '(?:' . implode('|', $alts) . ')' . $wrapR . '/u';
    }

    public static function has(string $normText, string $alternatives): bool
    {
        return preg_match(self::rx($alternatives), $normText) === 1;
    }

    /**
     * يطابق تعبيراً على النص المطبَّع ويعيد المقطع الأصلي المقابل.
     * @param array{norm:string,map:int[],chars:string[]} $n
     * @return array{text:string,start:int,end:int}|null  start/end بمواضع محارف النص الأصلي
     */
    public static function find(array $n, string $regex, int $group = 0): ?array
    {
        if (!preg_match($regex, $n['norm'], $m, PREG_OFFSET_CAPTURE) || $m[$group][1] < 0) {
            return null;
        }
        [$str, $byteOff] = $m[$group];
        $cs = mb_strlen(substr($n['norm'], 0, $byteOff), 'UTF-8');
        $cl = mb_strlen($str, 'UTF-8');
        if ($cl === 0) {
            return null;
        }
        $origStart = $n['map'][$cs];
        $origEnd = $n['map'][$cs + $cl - 1];
        return [
            'text' => implode('', array_slice($n['chars'], $origStart, $origEnd - $origStart + 1)),
            'start' => $origStart,
            'end' => $origEnd + 1,
        ];
    }

    /** يقتطع من النص الأصلي بمواضع المحارف. */
    public static function slice(array $n, int $start, ?int $end = null): string
    {
        $end ??= count($n['chars']);
        return implode('', array_slice($n['chars'], $start, max(0, $end - $start)));
    }

    /** @return string[] */
    public static function sentences(string $text): array
    {
        $parts = preg_split('/(?<=[.!?؟…])\s+|\R+/u', trim($text), -1, PREG_SPLIT_NO_EMPTY) ?: [];
        return array_values(array_filter(array_map('trim', $parts), static fn($p) => $p !== ''));
    }

    public static function clean(string $s): string
    {
        return trim(preg_replace('/[\s.!?؟،,;؛…]+$/u', '', trim($s)));
    }

    public static function contains(string $haystack, string $needle): bool
    {
        return $needle !== '' && str_contains(self::norm($haystack), self::norm($needle));
    }
}
