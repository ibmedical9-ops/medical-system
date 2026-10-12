<?php
declare(strict_types=1);

namespace PromptTrap\Domain;

use PromptTrap\Support\Rng;
use PromptTrap\Support\Text;

/**
 * محرك محاكاة الأخطاء.
 * يبني أولاً إجابة أمينة من الحقيقة المرجعية، ثم يطبّق «فخاخاً» لا يُسمح بها إلا إذا كانت
 * ثغرة محددة في البرومبت تبررها ويوجد في المصدر مادة لها. كل فخ يترك سجلاً قابلاً للتحقق.
 */
final class ErrorSimulator
{
    public const TYPES = [
        'assumption' => ['label' => 'خطأ الافتراض', 'severity' => 'high'],
        'ambiguity' => ['label' => 'خطأ الغموض', 'severity' => 'medium'],
        'omission' => ['label' => 'خطأ الحذف', 'severity' => 'medium'],
        'confusion' => ['label' => 'خطأ الالتباس', 'severity' => 'high'],
        'attribution' => ['label' => 'خطأ الإسناد', 'severity' => 'high'],
        'time' => ['label' => 'خطأ الزمن', 'severity' => 'high'],
        'format' => ['label' => 'خطأ التنسيق', 'severity' => 'low'],
        'scope' => ['label' => 'خطأ النطاق', 'severity' => 'medium'],
    ];

    /** أي أبعاد في البرومبت تفتح أي فخ */
    private const TRAP_DIMS = [
        'ambiguity' => ['task'],
        'scope' => ['scope', 'task'],
        'confusion' => ['distinction', 'verification'],
        'attribution' => ['unknown', 'source', 'verification'],
        'time' => ['unknown', 'verification'],
        'assumption' => ['source', 'unknown', 'verification'],
        'omission' => ['scope', 'verification'],
        'format' => ['format'],
    ];

    private const CAT_ORDER = ['decision' => 0, 'task' => 1, 'proposal' => 2, 'open' => 3, 'discussion' => 4];
    private const CAT_LABEL = ['decision' => 'قرار', 'task' => 'مهمة', 'proposal' => 'مقترح', 'open' => 'نقطة مفتوحة', 'discussion' => 'نقطة نقاش'];
    private const REQ_TO_CAT = ['decisions' => 'decision', 'tasks' => 'task', 'proposals' => 'proposal', 'open' => 'open'];

    private int $seq = 0;
    /** @var array<int,array<string,mixed>> */
    private array $errors = [];
    /** @var array<int,array<string,mixed>> */
    private array $omitted = [];
    /** @var array<int,array<string,mixed>> */
    private array $assumptions = [];
    /** @var array<int,bool> */
    private array $touched = [];

    /**
     * @param array<string,mixed> $truth  ناتج MeetingParser
     * @param array<string,mixed> $analysis ناتج PromptAnalyzer
     * @return array<string,mixed>
     */
    public function run(array $truth, array $analysis, string $source, int $seed): array
    {
        $this->seq = 0;
        $this->errors = $this->omitted = $this->assumptions = $this->touched = [];
        $rng = new Rng($seed);

        $vague = empty($analysis['requested']);
        $cats = $this->effectiveCats($analysis['requested']);
        $cols = $this->columns($analysis['requested']);
        $rows = $this->project($truth, $cats);
        $baseCount = count($rows);
        $baseKeys = array_column($rows, 'key');

        $style = $analysis['format'] === 'none' ? 'list' : $analysis['format'];
        $forceProse = false;

        if ($analysis['mode'] === 'trap') {
            $p = $this->probabilities($analysis['dimensions']);
            $force = $analysis['score'] < 50;
            $lowest = fn(array $dims) => min(array_map(fn($d) => $analysis['dimensions'][$d]['level'], $dims));
            $discussionMode = false;

            if ($vague && $rng->chance($p['ambiguity'])) {
                $discussionMode = $this->ambiguity($rows, $truth, $analysis, $rng);
            }
            if (!$discussionMode) {
                if (!$this->hasError('ambiguity') && $rng->chance($p['scope'])) {
                    $this->scope($rows, $cats, $rng, $baseCount);
                }
                if ($rng->chance($p['confusion'])) {
                    $n = $lowest(self::TRAP_DIMS['confusion']) < 0.25 && $rng->chance(0.6) ? 2 : 1;
                    for ($i = 0; $i < $n; $i++) {
                        $this->confusion($rows, $truth, $cats, $rng, $baseCount);
                    }
                }
                if ($rng->chance($p['attribution'])) {
                    $this->attribution($rows, $truth, $rng, $baseCount);
                }
                if ($rng->chance($p['time'])) {
                    $n = $lowest(self::TRAP_DIMS['time']) < 0.25 && $rng->chance(0.5) ? 2 : 1;
                    for ($i = 0; $i < $n; $i++) {
                        $this->time($rows, $source, $rng, $baseCount);
                    }
                }
                if ($rng->chance($p['assumption'])) {
                    $this->assumption($rows, $truth, $source, $cats, $rng, $baseCount, $lowest(self::TRAP_DIMS['assumption']) < 0.25);
                }
                if ($rng->chance($p['omission'])) {
                    $this->omission($rows, $rng, $baseCount);
                }
                // ضمان وجود خطأ واحد على الأقل للبرومبتات الغامضة جداً إن وُجدت مادة لذلك
                if ($force && !$this->errors) {
                    foreach (['confusion', 'time', 'assumption', 'attribution', 'omission', 'scope'] as $t) {
                        $before = count($this->errors);
                        match ($t) {
                            'confusion' => $this->confusion($rows, $truth, $cats, $rng, $baseCount),
                            'time' => $this->time($rows, $source, $rng, $baseCount),
                            'assumption' => $this->assumption($rows, $truth, $source, $cats, $rng, $baseCount, false),
                            'attribution' => $this->attribution($rows, $truth, $rng, $baseCount),
                            'omission' => $this->omission($rows, $rng, $baseCount),
                            'scope' => $this->scope($rows, $cats, $rng, $baseCount),
                        };
                        if (count($this->errors) > $before) {
                            break;
                        }
                    }
                }
            }
            if ($analysis['format'] === 'none' && $rng->chance($p['format']) && count($rows) >= 2) {
                $forceProse = true;
            }
        }

        usort($rows, fn($a, $b) => [self::CAT_ORDER[$a['cat']], $a['order']] <=> [self::CAT_ORDER[$b['cat']], $b['order']]);
        $style = $forceProse ? 'prose' : $style;
        $out = (new OutputRenderer())->render($rows, $style, $cols);
        if ($forceProse) {
            $this->addError('format', null, '*',
                'عُرضت النتيجة كفقرات متصلة دون جدول، وسقطت منها خانة الحالة (قرار/مقترح/غير محسوم).',
                ['البرومبت لم يحدد شكل المخرجات'],
                'جدول بأعمدة النوع والبند والمسؤول والموعد والحالة، يبقي الفروق بين المؤكد وغير المؤكد ظاهرة.',
                'لم يحدد البرومبت صيغة المخرجات، فاختار النموذج أسلوباً سردياً يخفي حالة كل بند ويخلط المسؤول والموعد داخل الجملة.',
                'format', false, 'prompt');
        }

        // ربط مفاتيح الصفوف بمعرّفات وحدات الإخراج
        foreach ($this->errors as &$e) {
            if ($e['row_key'] !== null && isset($out['key_to_unit'][$e['row_key']])) {
                $e['unit_id'] = $out['key_to_unit'][$e['row_key']];
            }
            unset($e['row_key']);
        }
        unset($e);

        $correct = (new OutputRenderer())->render($this->project($truth, ['decision', 'task', 'proposal', 'open']), 'table', ['owner' => true, 'due' => true]);
        $untouched = count(array_diff($baseKeys, array_keys($this->touched)));

        return [
            'style' => $style,
            'headers' => $out['headers'],
            'units' => $out['units'],
            'text' => $out['text'],
            'errors' => array_values($this->errors),
            'omitted' => $this->omitted,
            'assumptions' => $this->assumptions,
            'correct' => ['headers' => $correct['headers'], 'units' => $correct['units'], 'text' => $correct['text']],
            'stats' => [
                'mode' => $analysis['mode'],
                'rows_in_output' => count($out['units']),
                'rows_expected' => $baseCount,
                'rows_with_errors' => $baseCount - $untouched,
                'rows_correct' => $untouched,
                'error_count' => count($this->errors),
                'accuracy_percent' => $baseCount > 0 ? (int) round(100 * $untouched / $baseCount) : 100,
            ],
            'no_error_note' => $this->errors ? null : 'لم تتضمن النتيجة خطأً قابلاً للإثبات بالمقارنة مع المصدر.',
        ];
    }

    // ---------------------------------------------------------------- الإسقاط

    /** @return string[] */
    private function effectiveCats(array $requested): array
    {
        if (!$requested) {
            return ['decision', 'task'];
        }
        $cats = [];
        foreach ($requested as $r) {
            if (isset(self::REQ_TO_CAT[$r])) {
                $cats[] = self::REQ_TO_CAT[$r];
            }
        }
        if (array_intersect($requested, ['owners', 'deadlines'])) {
            $cats[] = 'task';
        }
        return array_values(array_unique($cats ?: ['decision', 'task']));
    }

    /** @return array{owner:bool,due:bool} */
    private function columns(array $requested): array
    {
        $tasks = in_array('tasks', $requested, true) || !$requested;
        return [
            'owner' => $tasks || in_array('owners', $requested, true),
            'due' => $tasks || in_array('deadlines', $requested, true),
        ];
    }

    /** @return array<int,array<string,mixed>> */
    public function project(array $truth, array $cats): array
    {
        $rows = [];
        foreach ($truth['items'] as $it) {
            if (!in_array($it['kind'], $cats, true)) {
                continue;
            }
            $rows[] = $this->rowFromItem($it, count($rows));
        }
        return $rows;
    }

    /** @return array<string,mixed> */
    private function rowFromItem(array $it, int $order): array
    {
        $status = match (true) {
            $it['kind'] === 'decision' => 'قرار مؤكد',
            $it['kind'] === 'task' && $it['hedged'] => 'التزام غير مؤكد',
            $it['kind'] === 'task' => 'مهمة مؤكدة',
            $it['kind'] === 'proposal' && $it['status'] === 'rejected' => 'مقترح مرفوض',
            $it['kind'] === 'proposal' => 'مقترح — لم يُعتمد',
            $it['kind'] === 'open' => 'غير محسوم',
            default => 'نقطة نقاش',
        };
        return [
            'key' => ++$this->seq,
            'order' => $order,
            'cat' => $it['kind'],
            'text' => $it['text'],
            'owner' => $it['owner'],
            'due' => $it['due'],
            'due_status' => $it['due_status'],
            'status' => $status,
            'item_id' => $it['id'],
            'item' => $it,
            'evidence' => $it['evidence'],
            'fabricated' => false,
            'owner_assumed' => false,
        ];
    }

    // ---------------------------------------------------------------- الفخاخ

    /** @return array<string,float> */
    private function probabilities(array $dims): array
    {
        $f = static fn(float $l) => $l < 0.5 ? 0.9 : ($l < 0.75 ? 0.4 : 0.0);
        $p = [];
        foreach (self::TRAP_DIMS as $trap => $ds) {
            $p[$trap] = max(array_map(fn($d) => $f($dims[$d]['level']), $ds));
        }
        return $p;
    }

    private function canTouch(int $baseCount): bool
    {
        return count($this->touched) < max(1, (int) floor(0.6 * $baseCount));
    }

    private function hasError(string $type): bool
    {
        foreach ($this->errors as $e) {
            if ($e['type'] === $type) {
                return true;
            }
        }
        return false;
    }

    private function touch(array $row): void
    {
        $this->touched[$row['key']] = true;
    }

    private function dueText(array $row): string
    {
        if ($row['due'] === null) {
            return $row['cat'] === 'task' ? 'غير محدد' : '—';
        }
        return $row['due_status'] === 'tentative' ? $row['due'] . ' (تقريبي — غير مؤكد)' : $row['due'];
    }

    private function addError(string $type, ?int $rowKey, ?string $unit, string $claim, array $evidence, string $correct, string $why, string $dim, bool $fabricated, string $evidenceFrom = 'source'): void
    {
        $this->errors[] = [
            'type' => $type,
            'label' => self::TYPES[$type]['label'],
            'severity' => self::TYPES[$type]['severity'],
            'row_key' => $rowKey,
            'unit_id' => $unit,
            'claim' => $claim,
            'source_evidence' => array_values($evidence),
            'evidence_from' => $evidenceFrom,
            'correct_value' => $correct,
            'explanation' => $why,
            'cause_dim' => $dim,
            'fabricated' => $fabricated,
        ];
    }

    /** @return bool true إذا استُبدل الإخراج بالكامل (ملخص نقاش) */
    private function ambiguity(array &$rows, array $truth, array $analysis, Rng $rng): bool
    {
        $byCat = [];
        foreach ($rows as $r) {
            $byCat[$r['cat']][] = $r;
        }
        $options = [];
        if (!empty($byCat['decision']) && !empty($byCat['task'])) {
            $options['decisions_only'] = [$byCat['task'], 'استخراج القرارات فقط'];
            $options['tasks_only'] = [$byCat['decision'], 'استخراج المهام فقط'];
        }
        $discussion = array_values(array_filter($truth['items'], fn($i) => $i['kind'] === 'discussion'));
        if ($discussion && $rows) {
            $options['discussion'] = [$rows, 'تلخيص مجريات النقاش'];
        }
        if (!$options) {
            return false;
        }
        $choice = $rng->pick(array_keys($options));
        [$dropped, $label] = $options[$choice];
        $phrase = $this->vaguePhrase($analysis);

        if ($choice === 'decisions_only') {
            $rows = array_values(array_filter($rows, fn($r) => $r['cat'] === 'decision'));
        } elseif ($choice === 'tasks_only') {
            $rows = array_values(array_filter($rows, fn($r) => $r['cat'] === 'task'));
        } else {
            $rows = [];
            foreach (array_slice($discussion, 0, 4) as $i => $d) {
                $rows[] = $this->rowFromItem($d, $i);
            }
        }
        $ev = [];
        foreach ($dropped as $d) {
            $ev[] = $d['evidence'][0];
            $this->omitted[] = ['reason' => 'ambiguity', 'category' => $d['cat'], 'text' => $d['text'], 'evidence' => $d['evidence']];
            $this->touch($d);
        }
        $this->addError('ambiguity', null, null,
            'فُسِّر الطلب على أنه «' . $label . '».',
            array_slice($ev, 0, 3),
            'الطلب «' . $phrase . '» يحتمل عدة معانٍ؛ المطلوب غالباً: القرارات والمهام (مع المسؤول والموعد) ومعها المقترحات والنقاط غير المحسومة.',
            'العبارة «' . $phrase . '» لا تحدد أي معلومات تُستخرج، فاختار النموذج تفسيراً واحداً دون سؤالك، وأسقط ' . count($dropped) . ' بنداً موجوداً في المصدر.',
            'task', false, 'prompt+source');
        return $choice === 'discussion';
    }

    private function vaguePhrase(array $analysis): string
    {
        return 'مخرجات الاجتماع';
    }

    private function scope(array &$rows, array $cats, Rng $rng, int $baseCount): void
    {
        $byCat = [];
        foreach ($rows as $r) {
            $byCat[$r['cat']][] = $r;
        }
        if (count($byCat) < 2) {
            return;
        }
        foreach ($rng->shuffle(array_keys($byCat)) as $cat) {
            $dropped = $byCat[$cat];
            if (count($this->touched) + count($dropped) > max(1, (int) floor(0.6 * $baseCount))) {
                continue;
            }
            $rows = array_values(array_filter($rows, fn($r) => $r['cat'] !== $cat));
            $ev = [];
            foreach ($dropped as $d) {
                $ev[] = $d['evidence'][0];
                $this->touch($d);
                $this->omitted[] = ['reason' => 'scope', 'category' => $cat, 'text' => $d['text'], 'evidence' => $d['evidence']];
            }
            $this->addError('scope', null, null,
                'غابت فئة «' . self::CAT_LABEL[$cat] . '» كلياً من المخرجات (' . count($dropped) . ' بنداً).',
                array_slice($ev, 0, 3),
                'تغطية فئة «' . self::CAT_LABEL[$cat] . '» أيضاً.',
                'لم يحدد البرومبت نطاق المعلومات المطلوبة ولا اشترط الاكتمال، فأجاب النموذج عن جزء من المهمة وأهمل الباقي.',
                'scope', false);
            return;
        }
    }

    private function confusion(array &$rows, array $truth, array $cats, Rng $rng, int $baseCount): void
    {
        $targetCat = in_array('decision', $cats, true) ? 'decision' : (in_array('task', $cats, true) ? 'task' : null);
        if ($targetCat === null) {
            return;
        }
        $done = array_map(fn($e) => $e['item_id'] ?? null, $this->errors);
        $cands = [];
        foreach ($truth['items'] as $it) {
            if (in_array($it['id'], $done, true)) {
                continue;
            }
            if ($it['kind'] === 'proposal' && $it['status'] === 'pending') {
                $cands[0][] = $it;
            } elseif ($it['kind'] === 'open') {
                $cands[1][] = $it;
            } elseif ($it['kind'] === 'proposal' && $it['status'] === 'rejected') {
                $cands[2][] = $it;
            } elseif ($it['kind'] === 'task' && $it['hedged']) {
                $cands[3][] = $it;
            }
        }
        ksort($cands);
        foreach ($cands as $group) {
            foreach ($rng->shuffle($group) as $it) {
                $existing = null;
                foreach ($rows as $i => $r) {
                    if ($r['item_id'] === $it['id']) {
                        $existing = $i;
                    }
                }
                if ($existing !== null && ($this->touched[$rows[$existing]['key']] ?? false)) {
                    continue;
                }
                if ($existing === null && !in_array($it['kind'], ['proposal', 'open'], true) && $it['kind'] !== 'task') {
                    continue;
                }
                if ($existing !== null) {
                    if (!$this->canTouch($baseCount)) {
                        return;
                    }
                    $row = &$rows[$existing];
                } else {
                    $rows[] = $this->rowFromItem($it, 10000 + $it['id']);
                    $row = &$rows[array_key_last($rows)];
                }
                $before = $row['status'];
                $row['cat'] = ($it['kind'] === 'task' || ($it['owner'] !== null && $targetCat === 'task')) ? 'task' : $targetCat;
                if ($it['kind'] === 'task') {
                    $row['cat'] = 'task';
                }
                $row['status'] = $row['cat'] === 'task' ? 'مهمة مؤكدة' : 'قرار مؤكد';
                $row['due_status'] = $row['due'] !== null ? 'confirmed' : $row['due_status'];
                $this->touch($row);
                $correct = match (true) {
                    $it['kind'] === 'proposal' && $it['status'] === 'rejected' => 'مقترح رُفض صراحة ولم يُعتمد.',
                    $it['kind'] === 'proposal' => 'مقترح لم تتم الموافقة عليه.',
                    $it['kind'] === 'open' => 'نقطة غير محسومة.',
                    default => 'التزام غير مؤكد (المتحدث تحفّظ في صياغته).',
                };
                $this->errors[] = [
                    'type' => 'confusion', 'label' => self::TYPES['confusion']['label'], 'severity' => 'high',
                    'row_key' => $row['key'], 'unit_id' => null, 'item_id' => $it['id'],
                    'claim' => $row['text'] . ' — ' . $row['status'],
                    'source_evidence' => $it['evidence'], 'evidence_from' => 'source',
                    'correct_value' => $correct . ' (الحالة في الإخراج: «' . $before . '» → «' . $row['status'] . '»)',
                    'explanation' => 'لم يطلب البرومبت التمييز بين المؤكد والمقترح وغير المحسوم، فعاملها النموذج كأنها بند نهائي.',
                    'cause_dim' => 'distinction', 'fabricated' => false,
                ];
                unset($row);
                return;
            }
        }
    }

    private function attribution(array &$rows, array $truth, Rng $rng, int $baseCount): void
    {
        $cands = [];
        foreach ($rows as $i => $r) {
            if ($r['cat'] === 'task' && $r['owner'] !== null && !isset($this->touched[$r['key']])) {
                $cands[] = $i;
            }
        }
        if (!$cands || !$this->canTouch($baseCount)) {
            return;
        }
        $i = $rng->pick($cands);
        $row = &$rows[$i];
        $others = array_values(array_filter($truth['participants'], fn($p) => $p !== $row['owner'] && !Text::contains($row['text'], explode(' ', $p)[0])));
        if (!$others) {
            unset($row);
            return;
        }
        $wrong = $rng->pick($others);
        $real = $row['owner'];
        $row['owner'] = $wrong;
        $this->touch($row);
        $this->errors[] = [
            'type' => 'attribution', 'label' => self::TYPES['attribution']['label'], 'severity' => 'high',
            'row_key' => $row['key'], 'unit_id' => null, 'item_id' => $row['item_id'],
            'claim' => 'المسؤول: ' . $wrong . ' — ' . $row['text'],
            'source_evidence' => $row['evidence'], 'evidence_from' => 'source',
            'correct_value' => 'المسؤول وفق المصدر: ' . $real,
            'explanation' => 'لم يشترط البرومبت الرجوع إلى المصدر لكل اسم ولا مراجعة الإسناد، فنُسبت المهمة إلى شخص غير مذكور فيها.',
            'cause_dim' => 'verification', 'fabricated' => false,
        ];
        unset($row);
    }

    private function time(array &$rows, string $source, Rng $rng, int $baseCount): void
    {
        $tentative = $none = [];
        foreach ($rows as $i => $r) {
            if (isset($this->touched[$r['key']])) {
                continue;
            }
            if ($r['due'] !== null && $r['due_status'] === 'tentative') {
                $tentative[] = $i;
            } elseif ($r['cat'] === 'task' && $r['due'] === null) {
                $none[] = $i;
            }
        }
        if (!$this->canTouch($baseCount)) {
            return;
        }
        if ($tentative) {
            $row = &$rows[$rng->pick($tentative)];
            $row['due_status'] = 'confirmed';
            $this->touch($row);
            $this->errors[] = [
                'type' => 'time', 'label' => self::TYPES['time']['label'], 'severity' => 'high',
                'row_key' => $row['key'], 'unit_id' => null, 'item_id' => $row['item_id'],
                'claim' => 'الموعد: ' . $row['due'] . ' (عُرض كموعد نهائي) — ' . $row['text'],
                'source_evidence' => $row['evidence'], 'evidence_from' => 'source',
                'correct_value' => 'الموعد «' . $row['due'] . '» تقريبي/غير مؤكد في المصدر.',
                'explanation' => 'لم يحدد البرومبت كيف تُعامَل المعلومات غير المؤكدة، فأسقط النموذج التحفظ الزمني وقدّم الموعد كأنه نهائي.',
                'cause_dim' => 'unknown', 'fabricated' => false,
            ];
            unset($row);
            return;
        }
        if ($none) {
            $phrases = array_values(array_filter(['نهاية الأسبوع القادم', 'الأحد القادم', 'خلال أسبوعين', '15 من الشهر القادم'], fn($p) => !Text::contains($source, $p)));
            if (!$phrases) {
                return;
            }
            $row = &$rows[$rng->pick($none)];
            $phrase = $rng->pick($phrases);
            $row['due'] = $phrase;
            $row['due_status'] = 'confirmed';
            $this->touch($row);
            $this->errors[] = [
                'type' => 'time', 'label' => self::TYPES['time']['label'], 'severity' => 'high',
                'row_key' => $row['key'], 'unit_id' => null, 'item_id' => $row['item_id'],
                'claim' => 'الموعد: ' . $phrase . ' — ' . $row['text'],
                'source_evidence' => $row['evidence'], 'evidence_from' => 'source',
                'correct_value' => 'لا يذكر المصدر موعداً لهذه المهمة (غير محدد).',
                'explanation' => 'لم يحدد البرومبت ما يُكتب عند غياب الموعد، فاخترع النموذج موعداً وعرضه كحقيقة. التاريخ «' . $phrase . '» مضاف من خارج المصدر.',
                'cause_dim' => 'unknown', 'fabricated' => true,
            ];
            $this->assumptions[] = ['kind' => 'fabricated_deadline', 'value' => $phrase, 'for' => $row['text']];
            unset($row);
        }
    }

    private function assumption(array &$rows, array $truth, string $source, array $cats, Rng $rng, int $baseCount, bool $extra): void
    {
        // (أ) مهمة بلا مسؤول: يُسند إلى المتحدث
        $unowned = [];
        foreach ($rows as $i => $r) {
            if ($r['cat'] === 'task' && $r['owner'] === null && !isset($this->touched[$r['key']]) && $r['item']['speaker']) {
                $unowned[] = $i;
            }
        }
        if ($unowned && $this->canTouch($baseCount)) {
            $row = &$rows[$rng->pick($unowned)];
            $row['owner'] = $row['item']['speaker'];
            $row['owner_assumed'] = true;
            $this->touch($row);
            $this->errors[] = [
                'type' => 'assumption', 'label' => self::TYPES['assumption']['label'], 'severity' => 'medium',
                'row_key' => $row['key'], 'unit_id' => null, 'item_id' => $row['item_id'],
                'claim' => 'المسؤول: ' . $row['owner'] . ' — ' . $row['text'],
                'source_evidence' => $row['evidence'], 'evidence_from' => 'source',
                'correct_value' => 'المسؤول غير محدد في المصدر؛ ' . $row['owner'] . ' هو المتحدث فقط وليس مكلَّفاً بالمهمة.',
                'explanation' => 'لم يقصر البرومبت الإجابة على ما ورد في المصدر ولا طلب كتابة «غير محدد»، فافترض النموذج أن المتحدث هو المنفّذ.',
                'cause_dim' => 'source', 'fabricated' => false,
            ];
            $this->assumptions[] = ['kind' => 'assumed_owner', 'value' => $row['owner'], 'for' => $row['text']];
            unset($row);
            if (!$extra) {
                return;
            }
        }
        // (ب) بند مضاف من خارج المصدر
        $templates = [
            ['decision', 'عقد اجتماع متابعة أسبوعي لمراجعة التقدم', null],
            ['task', 'إرسال محضر الاجتماع إلى جميع الحاضرين', $truth['participants'] ? $rng->pick($truth['participants']) : null],
        ];
        $templates = array_values(array_filter($templates, fn($t) => !Text::contains($source, $t[1]) && in_array($t[0], $cats, true)));
        if (!$templates) {
            $templates = array_values(array_filter([['decision', 'عقد اجتماع متابعة أسبوعي لمراجعة التقدم', null]], fn($t) => !Text::contains($source, $t[1])));
        }
        if (!$templates) {
            return;
        }
        [$cat, $text, $owner] = $rng->pick($templates);
        $rows[] = $row = [
            'key' => ++$this->seq, 'order' => 20000, 'cat' => $cat, 'text' => $text,
            'owner' => $owner, 'due' => null, 'due_status' => 'none',
            'status' => $cat === 'task' ? 'مهمة مؤكدة' : 'قرار مؤكد',
            'item_id' => null, 'item' => ['speaker' => null], 'evidence' => [], 'fabricated' => true, 'owner_assumed' => false,
        ];
        $this->errors[] = [
            'type' => 'assumption', 'label' => self::TYPES['assumption']['label'], 'severity' => 'high',
            'row_key' => $row['key'], 'unit_id' => null, 'item_id' => null,
            'claim' => $text . ($owner ? ' (المسؤول: ' . $owner . ')' : ''),
            'source_evidence' => [], 'evidence_from' => 'source',
            'correct_value' => 'لا يوجد هذا البند في المصدر إطلاقاً.',
            'explanation' => 'لم يقصر البرومبت الإجابة على المصدر ولم يشترط مراجعة كل بند، فأضاف النموذج بنداً مألوفاً في الاجتماعات يبدو منطقياً لكن لا سند له.',
            'cause_dim' => 'source', 'fabricated' => true,
        ];
        $this->assumptions[] = ['kind' => 'fabricated_item', 'value' => $text, 'for' => null];
    }

    private function omission(array &$rows, Rng $rng, int $baseCount): void
    {
        $cands = [];
        foreach ($rows as $i => $r) {
            if (!empty($r['item']['condition']) && !isset($this->touched[$r['key']])) {
                $cands[] = $i;
            }
        }
        if (!$cands || !$this->canTouch($baseCount)) {
            return;
        }
        $row = &$rows[$rng->pick($cands)];
        $full = $row['text'];
        $row['text'] = $row['item']['core'];
        $this->touch($row);
        $this->omitted[] = ['reason' => 'omission', 'category' => $row['cat'], 'text' => $row['item']['condition'], 'evidence' => $row['evidence']];
        $this->errors[] = [
            'type' => 'omission', 'label' => self::TYPES['omission']['label'], 'severity' => 'medium',
            'row_key' => $row['key'], 'unit_id' => null, 'item_id' => $row['item_id'],
            'claim' => $row['text'],
            'source_evidence' => $row['evidence'], 'evidence_from' => 'source',
            'correct_value' => $full . ' — المحذوف: «' . $row['item']['condition'] . '»',
            'explanation' => 'لم يشترط البرومبت الحفاظ على الشروط والتفاصيل، فاختصر النموذج البند وأسقط شرطاً جوهرياً فبدا التنفيذ غير مشروط.',
            'cause_dim' => 'scope', 'fabricated' => false,
        ];
        unset($row);
    }
}
