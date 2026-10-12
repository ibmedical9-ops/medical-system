<?php
declare(strict_types=1);

namespace PromptTrap;

/** إعدادات التطبيق من متغيرات البيئة أو ملف .env (خارج مجلد public). */
final class Config
{
    private static array $values = [];
    private static bool $loaded = false;

    public static function root(): string
    {
        return dirname(__DIR__);
    }

    public static function load(?string $envFile = null): void
    {
        $envFile ??= self::root() . '/.env';
        if (is_file($envFile)) {
            foreach (file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
                $line = trim($line);
                if ($line === '' || $line[0] === '#' || !str_contains($line, '=')) {
                    continue;
                }
                [$k, $v] = explode('=', $line, 2);
                self::$values[trim($k)] = trim(trim($v), "\"'");
            }
        }
        self::$loaded = true;
    }

    public static function set(string $key, string $value): void
    {
        self::$values[$key] = $value;
    }

    public static function get(string $key, string $default = ''): string
    {
        if (!self::$loaded) {
            self::load();
        }
        $env = getenv($key);
        if ($env !== false && $env !== '') {
            return $env;
        }
        return self::$values[$key] ?? $default;
    }

    public static function reset(): void
    {
        self::$values = [];
        self::$loaded = true;
    }
}
