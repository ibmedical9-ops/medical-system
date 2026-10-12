<?php
declare(strict_types=1);

namespace PromptTrap;

use PDO;

/** اتصال PDO (MySQL/MariaDB أو SQLite) وتثبيت المخطط. */
final class Database
{
    public static function connect(): PDO
    {
        $driver = Config::get('DB_DRIVER', 'sqlite');
        $opts = [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ];
        if ($driver === 'mysql') {
            $dsn = sprintf(
                'mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4',
                Config::get('DB_HOST', '127.0.0.1'),
                Config::get('DB_PORT', '3306'),
                Config::get('DB_NAME', 'prompt_trap_lab')
            );
            return new PDO($dsn, Config::get('DB_USER', 'root'), Config::get('DB_PASS'), $opts);
        }
        $path = Config::get('DB_SQLITE_PATH', 'storage/prompt_trap_lab.sqlite');
        if ($path !== ':memory:' && $path[0] !== '/') {
            $path = Config::root() . '/' . $path;
        }
        $pdo = new PDO('sqlite:' . $path, null, null, $opts);
        $pdo->exec('PRAGMA foreign_keys = ON');
        return $pdo;
    }

    public static function driver(PDO $pdo): string
    {
        return $pdo->getAttribute(PDO::ATTR_DRIVER_NAME);
    }

    /** ينشئ الجداول ويضيف السيناريو والمصدر التجريبي إن لم يوجدا. */
    public static function install(PDO $pdo): void
    {
        $driver = self::driver($pdo);
        $file = Config::root() . '/database/' . ($driver === 'mysql' ? 'schema.mysql.sql' : 'schema.sqlite.sql');
        $sql = (string) file_get_contents($file);
        if ($driver === 'mysql') {
            // الملف يحتوي CREATE DATABASE/USE للاستخدام اليدوي؛ نتجاهلهما لأن الاتصال محدد القاعدة.
            $sql = preg_replace('/^\s*(CREATE DATABASE|USE)\b[^;]*;/mi', '', $sql);
        }
        foreach (array_filter(array_map('trim', explode(';', $sql))) as $stmt) {
            $pdo->exec($stmt);
        }
        self::seed($pdo);
    }

    public static function seed(PDO $pdo): void
    {
        $now = date('Y-m-d H:i:s');
        $has = $pdo->prepare('SELECT id FROM training_scenarios WHERE slug = ?');
        $has->execute(['meeting-analysis']);
        $sid = $has->fetchColumn();
        if (!$sid) {
            $pdo->prepare('INSERT INTO training_scenarios (slug, title, description, active) VALUES (?,?,?,1)')
                ->execute([
                    'meeting-analysis',
                    'تحليل محاضر الاجتماعات',
                    'استخرج القرارات والمهام والمسؤوليات والمواعيد من محضر اجتماع، وتعلّم كيف تمنع النموذج من استغلال النقص في تعليماتك.',
                ]);
            $sid = (int) $pdo->lastInsertId();
        }
        $samples = glob(Config::root() . '/database/samples/*.txt') ?: [];
        sort($samples);
        foreach ($samples as $file) {
            $content = trim((string) file_get_contents($file));
            $title = 'مصدر تجريبي: ' . (preg_match('/^العنوان:\s*(.+)$/mu', $content, $m) ? trim($m[1]) : basename($file));
            $chk = $pdo->prepare('SELECT id FROM source_documents WHERE is_sample = 1 AND title = ?');
            $chk->execute([$title]);
            if (!$chk->fetchColumn()) {
                $pdo->prepare('INSERT INTO source_documents (scenario_id, owner_user_id, title, content, is_sample, created_at) VALUES (?,NULL,?,?,1,?)')
                    ->execute([$sid, $title, $content, $now]);
            }
        }
    }
}
