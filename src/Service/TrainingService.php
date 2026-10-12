<?php
declare(strict_types=1);

namespace PromptTrap\Service;

use PDO;
use PromptTrap\Ai\ProviderInterface;
use PromptTrap\Domain\ErrorSimulator;
use PromptTrap\Domain\ImprovedPromptBuilder;
use PromptTrap\Domain\MeetingParser;
use PromptTrap\Domain\PromptAnalyzer;

/**
 * منطق دورة التدريب. القاعدة العامة للأمان: لا تُقرأ جداول prompt_analyses وerror_records وanswer_keys
 * إلا في الدوال evaluate/reveal/improve/compare/trainerKey بعد التحقق من الملكية والمرحلة.
 */
final class TrainingService
{
    public const MAX_SOURCE = 20000;
    public const MIN_SOURCE = 40;
    public const MAX_PROMPT = 4000;
    public const MAX_ATTEMPTS = 50;

    private PromptAnalyzer $analyzer;
    private MeetingParser $parser;
    private ErrorSimulator $simulator;

    public function __construct(private PDO $pdo, private ProviderInterface $provider)
    {
        $this->analyzer = new PromptAnalyzer();
        $this->parser = new MeetingParser();
        $this->simulator = new ErrorSimulator();
    }

    // ------------------------------------------------------------ بيانات عامة

    /** @return array<int,array<string,mixed>> */
    public function scenarios(): array
    {
        return $this->pdo->query('SELECT id, slug, title, description FROM training_scenarios WHERE active = 1 ORDER BY id')->fetchAll();
    }

    /** @return array<int,array<string,mixed>> */
    public function samples(): array
    {
        return $this->pdo->query('SELECT id, scenario_id, title, content FROM source_documents WHERE is_sample = 1 ORDER BY id')->fetchAll();
    }

    // ------------------------------------------------------------ الجلسات

    /** @return array<string,mixed> */
    public function createSession(array $user, int $scenarioId, ?int $sampleId, ?string $sourceText, ?string $title): array
    {
        $st = $this->pdo->prepare('SELECT id FROM training_scenarios WHERE id = ? AND active = 1');
        $st->execute([$scenarioId]);
        if (!$st->fetchColumn()) {
            throw new HttpException('السيناريو غير موجود.', 404);
        }
        $now = date('Y-m-d H:i:s');
        if ($sampleId) {
            $st = $this->pdo->prepare('SELECT id FROM source_documents WHERE id = ? AND is_sample = 1');
            $st->execute([$sampleId]);
            $sourceId = $st->fetchColumn();
            if (!$sourceId) {
                throw new HttpException('المصدر التجريبي غير موجود.', 404);
            }
        } else {
            $text = trim((string) $sourceText);
            $len = mb_strlen($text);
            if ($len < self::MIN_SOURCE || $len > self::MAX_SOURCE) {
                throw new HttpException('نص المصدر يجب أن يكون بين ' . self::MIN_SOURCE . ' و' . self::MAX_SOURCE . ' حرفاً.', 422);
            }
            $title = trim((string) $title);
            $title = $title !== '' ? mb_substr($title, 0, 150) : 'مصدر مخصص';
            $this->pdo->prepare('INSERT INTO source_documents (scenario_id, owner_user_id, title, content, is_sample, created_at) VALUES (?,?,?,?,0,?)')
                ->execute([$scenarioId, $user['id'], $title, $text, $now]);
            $sourceId = (int) $this->pdo->lastInsertId();
        }
        $this->pdo->prepare('INSERT INTO training_sessions (user_id, scenario_id, source_id, created_at) VALUES (?,?,?,?)')
            ->execute([$user['id'], $scenarioId, $sourceId, $now]);
        return $this->getSession($user, (int) $this->pdo->lastInsertId());
    }

    /** @return array<string,mixed> */
    public function getSession(array $user, int $sessionId): array
    {
        $s = $this->ownedSession($user, $sessionId);
        $att = $this->pdo->prepare(
            'SELECT a.id, a.attempt_no, a.prompt_text, a.created_at, a.evaluated_at, a.revealed_at, a.trainee_verdict,
                    o.style, o.output_text, o.headers_json, o.units_json, o.provider, o.is_simulation, o.provider_note
             FROM prompt_attempts a LEFT JOIN generated_outputs o ON o.attempt_id = a.id
             WHERE a.session_id = ? ORDER BY a.attempt_no'
        );
        $att->execute([$sessionId]);
        $attempts = [];
        foreach ($att->fetchAll() as $r) {
            $v = $this->attemptView($r);
            // الدرجة وعدد الأخطاء لا يظهران إلا بعد طلب التقييم/الكشف
            if ($r['evaluated_at'] !== null) {
                $q = $this->pdo->prepare('SELECT score FROM prompt_analyses WHERE attempt_id = ?');
                $q->execute([$r['id']]);
                $v['score'] = (int) $q->fetchColumn();
            }
            if ($r['revealed_at'] !== null) {
                $q = $this->pdo->prepare('SELECT COUNT(*) FROM error_records WHERE attempt_id = ?');
                $q->execute([$r['id']]);
                $v['error_count'] = (int) $q->fetchColumn();
            }
            $attempts[] = $v;
        }
        return [
            'id' => (int) $s['id'],
            'created_at' => $s['created_at'],
            'scenario_id' => (int) $s['scenario_id'],
            'source' => ['id' => (int) $s['source_id'], 'title' => $s['source_title'], 'content' => $s['source_content']],
            'attempts' => $attempts,
        ];
    }

    /** @return array<int,array<string,mixed>> */
    public function listSessions(array $user): array
    {
        $st = $this->pdo->prepare(
            'SELECT s.id, s.created_at, d.title AS source_title,
                    (SELECT COUNT(*) FROM prompt_attempts a WHERE a.session_id = s.id) AS attempts
             FROM training_sessions s JOIN source_documents d ON d.id = s.source_id
             WHERE s.user_id = ? ORDER BY s.id DESC LIMIT 50'
        );
        $st->execute([$user['id']]);
        return array_map(fn($r) => ['id' => (int) $r['id'], 'created_at' => $r['created_at'], 'title' => $r['source_title'], 'attempts' => (int) $r['attempts']], $st->fetchAll());
    }

    // ------------------------------------------------------------ المحاولة

    /** @return array<string,mixed> لا يتضمن أي بيانات سرية (لا درجة ولا أخطاء) */
    public function runAttempt(array $user, int $sessionId, string $prompt): array
    {
        $s = $this->ownedSession($user, $sessionId, true);
        $prompt = trim($prompt);
        $len = mb_strlen($prompt);
        if ($len < 2 || $len > self::MAX_PROMPT) {
            throw new HttpException('البرومبت يجب أن يكون بين 2 و' . self::MAX_PROMPT . ' حرف.', 422);
        }
        $cnt = $this->pdo->prepare('SELECT COALESCE(MAX(attempt_no),0) FROM prompt_attempts WHERE session_id = ?');
        $cnt->execute([$sessionId]);
        $no = (int) $cnt->fetchColumn() + 1;
        if ($no > self::MAX_ATTEMPTS) {
            throw new HttpException('بلغت الحد الأقصى للمحاولات في هذه التجربة.', 429);
        }

        $source = (string) $s['source_content'];
        $analysis = $this->analyzer->analyze($prompt);
        $truth = $this->parser->parse($source);
        $seed = crc32($source . '|' . $prompt . '|' . $no) & 0x7FFFFFFF;
        $plan = $this->simulator->run($truth, $analysis, $source, $seed);
        $composed = (new OutputComposer($this->provider))->compose($prompt, $plan);
        $improved = (new ImprovedPromptBuilder())->build($prompt, $analysis, $plan['errors']);
        $now = date('Y-m-d H:i:s');

        $this->pdo->beginTransaction();
        try {
            $this->pdo->prepare('INSERT INTO prompt_attempts (session_id, attempt_no, prompt_text, created_at) VALUES (?,?,?,?)')
                ->execute([$sessionId, $no, $prompt, $now]);
            $aid = (int) $this->pdo->lastInsertId();
            $this->pdo->prepare('INSERT INTO prompt_analyses (attempt_id, score, mode, dimensions_json, gaps_json, requested_json) VALUES (?,?,?,?,?,?)')
                ->execute([$aid, $analysis['score'], $analysis['mode'], self::j($analysis['dimensions']), self::j($analysis['gaps']), self::j($analysis['requested'])]);
            $this->pdo->prepare('INSERT INTO generated_outputs (attempt_id, provider, is_simulation, style, output_text, headers_json, units_json, provider_note) VALUES (?,?,?,?,?,?,?,?)')
                ->execute([$aid, $composed['provider'], $this->provider->isSimulation() ? 1 : 0, $plan['style'], $composed['text'], self::j($plan['headers']), self::j($plan['units']), $composed['note']]);
            $ins = $this->pdo->prepare('INSERT INTO error_records (attempt_id, ordinal, error_type, label, severity, unit_id, claim, source_evidence_json, correct_value, explanation, cause_dim, fabricated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
            foreach ($plan['errors'] as $i => $e) {
                $ins->execute([$aid, $i + 1, $e['type'], $e['label'], $e['severity'], $e['unit_id'], $e['claim'], self::j($e['source_evidence']), $e['correct_value'], $e['explanation'], $e['cause_dim'], $e['fabricated'] ? 1 : 0]);
            }
            $this->pdo->prepare('INSERT INTO answer_keys (attempt_id, source_snapshot, prompt_snapshot, output_snapshot, omitted_json, assumptions_json, correct_answer_text, correct_units_json, improved_prompt, no_error_note, stats_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
                ->execute([$aid, $source, $prompt, $composed['text'], self::j($plan['omitted']), self::j($plan['assumptions']), $plan['correct']['text'], self::j(['headers' => $plan['correct']['headers'], 'units' => $plan['correct']['units']]), self::j($improved), $plan['no_error_note'], self::j($plan['stats'])]);
            $this->pdo->commit();
        } catch (\Throwable $e) {
            $this->pdo->rollBack();
            throw $e;
        }

        return $this->attemptView([
            'id' => $aid, 'attempt_no' => $no, 'prompt_text' => $prompt, 'created_at' => $now,
            'evaluated_at' => null, 'revealed_at' => null, 'trainee_verdict' => null,
            'style' => $plan['style'], 'output_text' => $composed['text'],
            'headers_json' => self::j($plan['headers']), 'units_json' => self::j($plan['units']),
            'provider' => $composed['provider'], 'is_simulation' => $this->provider->isSimulation() ? 1 : 0,
            'provider_note' => $composed['note'],
        ]);
    }

    // ------------------------------------------------------------ التقييم والكشف

    /** @return array<string,mixed> */
    public function evaluate(array $user, int $attemptId): array
    {
        $a = $this->ownedAttempt($user, $attemptId);
        $this->pdo->prepare('UPDATE prompt_attempts SET evaluated_at = COALESCE(evaluated_at, ?) WHERE id = ?')
            ->execute([date('Y-m-d H:i:s'), $attemptId]);
        return $this->analysisView($attemptId, $a);
    }

    /** @return array<string,mixed> */
    public function improve(array $user, int $attemptId): array
    {
        $a = $this->ownedAttempt($user, $attemptId);
        $analysis = $this->analyzer->analyze($a['prompt_text']);
        // قبل الكشف: بناءً على ثغرات البرومبت فقط، دون الإشارة إلى الأخطاء الفعلية
        $revealed = $a['revealed_at'] !== null || $user['role'] === 'trainer';
        $errors = [];
        if ($revealed) {
            $errors = $this->errorsFor($attemptId);
        }
        $r = (new ImprovedPromptBuilder())->build($a['prompt_text'], $analysis, $errors);
        if (!$revealed) {
            foreach ($r['additions'] as &$add) {
                $add['prevents'] = [];
            }
            unset($add);
        }
        return $r + ['note' => 'هذا اقتراح لإغلاق الثغرات المكتشفة آلياً؛ عدّله بما يناسب مقصدك ثم أعد المحاولة.'];
    }

    /** @return array<string,mixed> */
    public function reveal(array $user, int $attemptId, ?string $verdict = null): array
    {
        $a = $this->ownedAttempt($user, $attemptId);
        if ($verdict !== null && !in_array($verdict, ['correct', 'wrong', 'unsure'], true)) {
            throw new HttpException('قيمة الحكم غير صالحة.', 422);
        }
        $this->markRevealed($attemptId, $verdict);
        return $this->keyView($attemptId, $verdict ?? $a['trainee_verdict']);
    }

    /** للمدرب: عرض المفتاح دون تعديل حالة المتدرب. */
    public function trainerKey(array $user, int $attemptId): array
    {
        if ($user['role'] !== 'trainer') {
            throw new HttpException('غير مصرح.', 403);
        }
        $this->ownedAttempt($user, $attemptId);
        return $this->keyView($attemptId, null);
    }

    /** @return array<int,array<string,mixed>> */
    public function trainerSessions(array $user): array
    {
        if ($user['role'] !== 'trainer') {
            throw new HttpException('غير مصرح.', 403);
        }
        $rows = $this->pdo->query(
            'SELECT a.id AS attempt_id, a.attempt_no, a.created_at, a.revealed_at, s.id AS session_id, u.display_name, u.username, d.title
             FROM prompt_attempts a JOIN training_sessions s ON s.id = a.session_id
             JOIN users u ON u.id = s.user_id JOIN source_documents d ON d.id = s.source_id
             ORDER BY a.id DESC LIMIT 100'
        )->fetchAll();
        return $rows;
    }

    /** @return array<string,mixed> */
    public function compare(array $user, int $sessionId): array
    {
        $this->ownedSession($user, $sessionId);
        $st = $this->pdo->prepare(
            'SELECT a.id, a.attempt_no, a.evaluated_at, a.revealed_at FROM prompt_attempts a WHERE a.session_id = ? ORDER BY a.attempt_no DESC LIMIT 2'
        );
        $st->execute([$sessionId]);
        $rows = array_reverse($st->fetchAll());
        if (count($rows) < 2) {
            return ['available' => false, 'message' => 'تحتاج إلى محاولتين على الأقل للمقارنة.'];
        }
        $side = [];
        foreach ($rows as $r) {
            $entry = ['attempt_no' => (int) $r['attempt_no'], 'score' => null, 'dimensions' => null, 'errors' => null];
            if ($r['evaluated_at'] !== null) {
                $an = $this->pdo->prepare('SELECT score, dimensions_json FROM prompt_analyses WHERE attempt_id = ?');
                $an->execute([$r['id']]);
                $x = $an->fetch();
                $dims = json_decode($x['dimensions_json'], true);
                $entry['score'] = (int) $x['score'];
                $entry['dimensions'] = array_map(fn($d) => ['label' => $d['label'], 'level' => $d['level']], $dims);
            }
            if ($r['revealed_at'] !== null) {
                $entry['errors'] = array_map(fn($e) => $e['label'], $this->errorsFor((int) $r['id']));
            }
            $side[] = $entry;
        }
        [$old, $new] = $side;
        $delta = null;
        $changes = [];
        if ($old['score'] !== null && $new['score'] !== null) {
            $delta = $new['score'] - $old['score'];
            foreach ($new['dimensions'] as $k => $d) {
                $diff = round($d['level'] - $old['dimensions'][$k]['level'], 2);
                if ($diff != 0) {
                    $changes[] = ['dimension' => $d['label'], 'change' => $diff];
                }
            }
        }
        $errDelta = ($old['errors'] !== null && $new['errors'] !== null) ? count($new['errors']) - count($old['errors']) : null;
        return [
            'available' => true, 'previous' => $old, 'latest' => $new,
            'score_delta' => $delta, 'dimension_changes' => $changes, 'error_delta' => $errDelta,
            'message' => ($delta === null || $errDelta === null)
                ? 'اطلب «تقييم البرومبت» و«كشف الأخطاء» للمحاولتين لتظهر المقارنة كاملة.'
                : 'تمت المقارنة بين المحاولتين.',
        ];
    }

    // ------------------------------------------------------------ داخلي

    private function markRevealed(int $attemptId, ?string $verdict): void
    {
        $now = date('Y-m-d H:i:s');
        $this->pdo->prepare('UPDATE prompt_attempts SET revealed_at = COALESCE(revealed_at, ?), evaluated_at = COALESCE(evaluated_at, ?), trainee_verdict = COALESCE(?, trainee_verdict) WHERE id = ?')
            ->execute([$now, $now, $verdict, $attemptId]);
    }

    /** @return array<string,mixed> */
    private function analysisView(int $attemptId, array $attempt): array
    {
        $st = $this->pdo->prepare('SELECT score, mode, dimensions_json, gaps_json FROM prompt_analyses WHERE attempt_id = ?');
        $st->execute([$attemptId]);
        $r = $st->fetch();
        $dims = json_decode($r['dimensions_json'], true);
        return [
            'attempt_id' => $attemptId,
            'score' => (int) $r['score'],
            'mode' => $r['mode'],
            'mode_label' => $r['mode'] === 'precise' ? 'التنفيذ الدقيق' : 'محاكاة استغلال الثغرات',
            'dimensions' => $dims,
            'gaps' => array_map(fn($k) => ['key' => $k, 'label' => $dims[$k]['label'], 'detail' => $dims[$k]['detail']], json_decode($r['gaps_json'], true)),
            'disclaimer' => 'تقييم آلي تقريبي يعتمد على قواعد لغوية؛ قد يخطئ مع الصياغات غير المألوفة، ولا يضمن جودة النتيجة مع نموذج حقيقي.',
        ];
    }

    /** @return array<int,array<string,mixed>> */
    private function errorsFor(int $attemptId): array
    {
        $st = $this->pdo->prepare('SELECT * FROM error_records WHERE attempt_id = ? ORDER BY ordinal');
        $st->execute([$attemptId]);
        return array_map(fn($e) => [
            'ordinal' => (int) $e['ordinal'], 'type' => $e['error_type'], 'label' => $e['label'], 'severity' => $e['severity'],
            'unit_id' => $e['unit_id'], 'claim' => $e['claim'],
            'source_evidence' => json_decode($e['source_evidence_json'], true),
            'correct_value' => $e['correct_value'], 'explanation' => $e['explanation'],
            'cause_dim' => $e['cause_dim'], 'fabricated' => (bool) $e['fabricated'],
        ], $st->fetchAll());
    }

    /** @return array<string,mixed> */
    private function keyView(int $attemptId, ?string $verdict): array
    {
        $errors = $this->errorsFor($attemptId);
        $k = $this->pdo->prepare('SELECT * FROM answer_keys WHERE attempt_id = ?');
        $k->execute([$attemptId]);
        $key = $k->fetch();
        $a = $this->pdo->prepare('SELECT prompt_text, trainee_verdict FROM prompt_attempts WHERE id = ?');
        $a->execute([$attemptId]);
        $att = $a->fetch();
        $verdict ??= $att['trainee_verdict'];
        $had = count($errors) > 0;
        $judgement = null;
        if ($verdict && $verdict !== 'unsure') {
            $judgement = ($verdict === 'wrong') === $had;
        }
        return [
            'attempt_id' => $attemptId,
            'errors' => $errors,
            'no_error_note' => $key['no_error_note'],
            'stats' => json_decode($key['stats_json'], true),
            'analysis' => $this->analysisView($attemptId, []),
            'key' => [
                'source' => $key['source_snapshot'],
                'prompt' => $key['prompt_snapshot'],
                'output' => $key['output_snapshot'],
                'omitted' => json_decode($key['omitted_json'], true),
                'assumptions' => json_decode($key['assumptions_json'], true),
                'correct' => json_decode($key['correct_units_json'], true) + ['text' => $key['correct_answer_text']],
                'improved' => json_decode($key['improved_prompt'], true),
            ],
            'verdict' => ['value' => $verdict, 'had_errors' => $had, 'judged_correctly' => $judgement],
            'disclaimer' => 'الأخطاء المعروضة هي ما خطط له المحرك وفق ثغرات البرومبت، والمقارنة تعتمد على تحليل لغوي للمصدر وقد لا تغطي كل الصياغات.',
        ];
    }

    /** @param array<string,mixed> $r @return array<string,mixed> */
    private function attemptView(array $r): array
    {
        return [
            'id' => (int) $r['id'],
            'attempt_no' => (int) $r['attempt_no'],
            'prompt' => $r['prompt_text'],
            'created_at' => $r['created_at'],
            'evaluated' => $r['evaluated_at'] !== null,
            'revealed' => $r['revealed_at'] !== null,
            'verdict' => $r['trainee_verdict'],
            'output' => $r['output_text'] === null ? null : [
                'style' => $r['style'],
                'text' => $r['output_text'],
                'headers' => json_decode($r['headers_json'], true),
                'units' => json_decode($r['units_json'], true),
                'provider' => $r['provider'],
                'is_simulation' => (bool) $r['is_simulation'],
                'note' => $r['provider_note'],
            ],
        ];
    }

    /** @return array<string,mixed> */
    private function ownedSession(array $user, int $sessionId, bool $needSource = true): array
    {
        $st = $this->pdo->prepare(
            'SELECT s.*, d.title AS source_title, d.content AS source_content FROM training_sessions s
             JOIN source_documents d ON d.id = s.source_id WHERE s.id = ?'
        );
        $st->execute([$sessionId]);
        $s = $st->fetch();
        if (!$s || ((int) $s['user_id'] !== $user['id'] && $user['role'] !== 'trainer')) {
            throw new HttpException('التجربة غير موجودة.', 404);
        }
        return $s;
    }

    /** @return array<string,mixed> */
    private function ownedAttempt(array $user, int $attemptId): array
    {
        $st = $this->pdo->prepare('SELECT a.*, s.user_id FROM prompt_attempts a JOIN training_sessions s ON s.id = a.session_id WHERE a.id = ?');
        $st->execute([$attemptId]);
        $a = $st->fetch();
        if (!$a || ((int) $a['user_id'] !== $user['id'] && $user['role'] !== 'trainer')) {
            throw new HttpException('المحاولة غير موجودة.', 404);
        }
        return $a;
    }

    private static function j(mixed $v): string
    {
        return json_encode($v, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    }
}
