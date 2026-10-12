<?php
declare(strict_types=1);

namespace PromptTrap\Domain;

/** يحوّل صفوف الإخراج إلى نص ووحدات عرض (جدول/قائمة/JSON/فقرات). */
final class OutputRenderer
{
    private const CAT_LABEL = ['decision' => 'قرار', 'task' => 'مهمة', 'proposal' => 'مقترح', 'open' => 'نقطة مفتوحة', 'discussion' => 'نقطة نقاش'];
    private const PROSE_TITLE = ['decision' => 'القرارات', 'task' => 'المهام', 'proposal' => 'المقترحات', 'open' => 'النقاط المفتوحة', 'discussion' => 'النقاش'];

    /**
     * @param array<int,array<string,mixed>> $rows
     * @param array{owner:bool,due:bool} $cols
     * @return array{headers:string[],units:array<int,array<string,mixed>>,text:string,key_to_unit:array<int,string>}
     */
    public function render(array $rows, string $style, array $cols): array
    {
        if ($style === 'prose') {
            return $this->prose($rows);
        }
        $headers = ['النوع', 'البند'];
        if ($cols['owner']) {
            $headers[] = 'المسؤول';
        }
        if ($cols['due']) {
            $headers[] = 'الموعد';
        }
        $headers[] = 'الحالة';

        $units = [];
        $map = [];
        foreach ($rows as $i => $r) {
            $id = 'u' . ($i + 1);
            $cells = [self::CAT_LABEL[$r['cat']] ?? $r['cat'], $r['text']];
            if ($cols['owner']) {
                $cells[] = $r['owner'] ?? ($r['cat'] === 'task' ? 'غير محدد' : '—');
            }
            if ($cols['due']) {
                $cells[] = $this->due($r);
            }
            $cells[] = $r['status'];
            $units[] = ['id' => $id, 'cat' => $r['cat'], 'cells' => $cells];
            $map[$r['key']] = $id;
        }

        if (!$units) {
            return ['headers' => $headers, 'units' => [], 'text' => 'لا توجد بنود مطابقة في المصدر.', 'key_to_unit' => []];
        }

        if ($style === 'json') {
            $objs = array_map(fn($u) => array_combine($headers, $u['cells']), $units);
            $text = json_encode($objs, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
        } elseif ($style === 'table') {
            $esc = static fn(string $c) => str_replace(['|', "\n"], ['\\|', ' '], $c);
            $lines = ['| ' . implode(' | ', $headers) . ' |', '|' . str_repeat(' --- |', count($headers))];
            foreach ($units as $u) {
                $lines[] = '| ' . implode(' | ', array_map($esc, $u['cells'])) . ' |';
            }
            $text = implode("\n", $lines);
        } else {
            $lines = [];
            foreach ($units as $u) {
                $c = $u['cells'];
                $lines[] = '- ' . $c[0] . ': ' . $c[1] . ' — ' . implode(' — ', array_map(
                    fn($h, $v) => $h . ': ' . $v,
                    array_slice($headers, 2),
                    array_slice($c, 2)
                ));
            }
            $text = implode("\n", $lines);
        }
        return ['headers' => $headers, 'units' => $units, 'text' => $text, 'key_to_unit' => $map];
    }

    /** نثر متصل: لا تظهر فيه خانة الحالة، ويُدمج المسؤول والموعد داخل الجملة. */
    private function prose(array $rows): array
    {
        $groups = [];
        foreach ($rows as $r) {
            $groups[$r['cat']][] = $r;
        }
        $units = [];
        $map = [];
        $paras = [];
        $n = 0;
        foreach (['decision', 'task', 'proposal', 'open', 'discussion'] as $cat) {
            if (empty($groups[$cat])) {
                continue;
            }
            $id = 'u' . (++$n);
            $parts = [];
            foreach ($groups[$cat] as $r) {
                $s = $r['text'];
                if ($r['owner'] !== null) {
                    $s .= ' (المسؤول: ' . $r['owner'] . ')';
                }
                if ($r['due'] !== null) {
                    $s .= ' — الموعد: ' . $r['due'];
                }
                $parts[] = $s;
                $map[$r['key']] = $id;
            }
            $para = self::PROSE_TITLE[$cat] . ': ' . implode('؛ ', $parts) . '.';
            $paras[] = $para;
            $units[] = ['id' => $id, 'cat' => $cat, 'cells' => [$para]];
        }
        return ['headers' => [], 'units' => $units, 'text' => $paras ? implode("\n\n", $paras) : 'لا توجد بنود مطابقة في المصدر.', 'key_to_unit' => $map];
    }

    private function due(array $r): string
    {
        if ($r['due'] === null) {
            return $r['cat'] === 'task' ? 'غير محدد' : '—';
        }
        return $r['due_status'] === 'tentative' ? $r['due'] . ' (تقريبي — غير مؤكد)' : $r['due'];
    }
}
