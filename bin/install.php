<?php
declare(strict_types=1);

// الاستخدام: php bin/install.php
require __DIR__ . '/../src/bootstrap.php';

use PromptTrap\Config;
use PromptTrap\Database;

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('CLI only');
}
$pdo = Database::connect();
Database::install($pdo);
echo "تم تثبيت قاعدة البيانات (" . Database::driver($pdo) . ") وإضافة السيناريو والمصادر التجريبية.\n";
