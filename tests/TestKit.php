<?php
declare(strict_types=1);

namespace PromptTrap\Tests;

use PDO;
use PromptTrap\Config;
use PromptTrap\Database;

/** إطار اختبار مصغر بلا اعتماديات (يعمل بـ php tests/run.php). */
final class T
{
    public static int $pass = 0;
    public static int $fail = 0;
    /** @var string[] */
    public static array $failures = [];
    public static string $current = '';

    public static function test(string $name, callable $fn): void
    {
        self::$current = $name;
        try {
            $fn();
            echo "  ✔ $name\n";
        } catch (\Throwable $e) {
            self::$fail++;
            self::$failures[] = "$name: " . $e->getMessage();
            echo "  ✘ $name\n      " . $e->getMessage() . "\n";
        }
    }

    public static function ok(bool $cond, string $msg = 'assertion failed'): void
    {
        if (!$cond) {
            throw new \RuntimeException($msg);
        }
        self::$pass++;
    }

    public static function same(mixed $expected, mixed $actual, string $msg = ''): void
    {
        self::ok($expected === $actual, ($msg ? $msg . ' — ' : '') . 'المتوقع ' . json_encode($expected, JSON_UNESCAPED_UNICODE) . ' لكن الفعلي ' . json_encode($actual, JSON_UNESCAPED_UNICODE));
    }

    public static function newDb(): PDO
    {
        Config::reset();
        Config::set('DB_DRIVER', 'sqlite');
        Config::set('DB_SQLITE_PATH', ':memory:');
        $pdo = Database::connect();
        Database::install($pdo);
        return $pdo;
    }
}
