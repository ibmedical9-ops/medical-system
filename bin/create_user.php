<?php
declare(strict_types=1);

// الاستخدام: php bin/create_user.php <username> <password> "<الاسم>" [trainer|trainee]
require __DIR__ . '/../src/bootstrap.php';

use PromptTrap\Database;
use PromptTrap\Service\Auth;

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('CLI only');
}
if ($argc < 4) {
    fwrite(STDERR, "الاستخدام: php bin/create_user.php <username> <password> \"<الاسم>\" [trainer|trainee]\n");
    exit(1);
}
$pdo = Database::connect();
try {
    $id = Auth::createUser($pdo, $argv[1], $argv[2], $argv[3], $argv[4] ?? 'trainer');
    echo "تم إنشاء المستخدم #$id\n";
} catch (\Throwable $e) {
    fwrite(STDERR, "تعذر إنشاء المستخدم: " . $e->getMessage() . "\n");
    exit(1);
}
