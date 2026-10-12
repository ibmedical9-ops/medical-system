<?php
declare(strict_types=1);

namespace PromptTrap\Service;

use PDO;

/** هوية المستخدم عبر جلسة PHP: متدرب ضيف تلقائي، ومدرب بكلمة مرور مشفرة. */
final class Auth
{
    /** @param array<string,mixed> $session مرجع إلى $_SESSION (أو مصفوفة في الاختبارات) */
    public function __construct(private PDO $pdo, private array &$session)
    {
    }

    /** @return array{id:int,username:string,display_name:string,role:string} */
    public function user(): array
    {
        if (!empty($this->session['uid'])) {
            $st = $this->pdo->prepare('SELECT id, username, display_name, role FROM users WHERE id = ?');
            $st->execute([(int) $this->session['uid']]);
            if ($row = $st->fetch()) {
                return ['id' => (int) $row['id'], 'username' => $row['username'], 'display_name' => $row['display_name'], 'role' => $row['role']];
            }
        }
        return $this->createGuest();
    }

    private function createGuest(): array
    {
        $name = 'guest_' . bin2hex(random_bytes(5));
        $this->pdo->prepare('INSERT INTO users (username, display_name, role, password_hash, created_at) VALUES (?,?,?,NULL,?)')
            ->execute([$name, 'متدرب', 'trainee', date('Y-m-d H:i:s')]);
        $id = (int) $this->pdo->lastInsertId();
        $this->session['uid'] = $id;
        return ['id' => $id, 'username' => $name, 'display_name' => 'متدرب', 'role' => 'trainee'];
    }

    /** @return array<string,mixed>|null */
    public function login(string $username, string $password): ?array
    {
        if (($this->session['login_lock_until'] ?? 0) > time()) {
            throw new HttpException('محاولات كثيرة. حاول بعد دقيقة.', 429);
        }
        $st = $this->pdo->prepare('SELECT id, username, display_name, role, password_hash FROM users WHERE username = ? AND password_hash IS NOT NULL');
        $st->execute([$username]);
        $row = $st->fetch();
        // نتحقق دائماً من التجزئة لتقليل الفارق الزمني بين وجود الحساب وعدمه
        $hash = $row['password_hash'] ?? '$2y$10$usesomesillystringforsalt$' . str_repeat('x', 31);
        $ok = password_verify($password, $hash) && $row;
        if (!$ok) {
            $this->session['login_fail'] = ($this->session['login_fail'] ?? 0) + 1;
            if ($this->session['login_fail'] >= 5) {
                $this->session['login_lock_until'] = time() + 60;
                $this->session['login_fail'] = 0;
            }
            return null;
        }
        $this->session['login_fail'] = 0;
        if (PHP_SAPI !== 'cli' && session_status() === PHP_SESSION_ACTIVE) {
            session_regenerate_id(true);
        }
        $this->session['uid'] = (int) $row['id'];
        $this->session['csrf'] = bin2hex(random_bytes(16));
        return $this->user();
    }

    public function logout(): void
    {
        $this->session = [];
    }

    public function csrf(): string
    {
        return $this->session['csrf'] ??= bin2hex(random_bytes(16));
    }

    public function checkCsrf(?string $token): bool
    {
        return is_string($token) && $token !== '' && hash_equals($this->csrf(), $token);
    }

    public static function createUser(PDO $pdo, string $username, string $password, string $displayName, string $role = 'trainer'): int
    {
        if (!in_array($role, ['trainee', 'trainer'], true)) {
            throw new \InvalidArgumentException('دور غير صالح.');
        }
        if (strlen($password) < 8) {
            throw new \InvalidArgumentException('كلمة المرور يجب ألا تقل عن 8 أحرف.');
        }
        $pdo->prepare('INSERT INTO users (username, display_name, role, password_hash, created_at) VALUES (?,?,?,?,?)')
            ->execute([$username, $displayName, $role, password_hash($password, PASSWORD_DEFAULT), date('Y-m-d H:i:s')]);
        return (int) $pdo->lastInsertId();
    }
}
