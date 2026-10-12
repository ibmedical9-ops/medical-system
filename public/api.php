<?php
declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';

use PromptTrap\Ai\ProviderFactory;
use PromptTrap\Config;
use PromptTrap\Database;
use PromptTrap\Http\Api;
use PromptTrap\Service\Auth;
use PromptTrap\Service\TrainingService;

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

$secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');
session_set_cookie_params(['httponly' => true, 'samesite' => 'Lax', 'secure' => $secure, 'path' => '/']);
session_name('ptl_sid');
session_start();

try {
    $pdo = Database::connect();
    $provider = ProviderFactory::make();
    $auth = new Auth($pdo, $_SESSION);
    $api = new Api($auth, new TrainingService($pdo, $provider), $provider);

    $body = [];
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $raw = file_get_contents('php://input', false, null, 0, 200000);
        $body = json_decode($raw ?: '[]', true);
        if (!is_array($body)) {
            http_response_code(400);
            echo json_encode(['error' => 'جسم الطلب غير صالح.'], JSON_UNESCAPED_UNICODE);
            exit;
        }
    }
    [$status, $payload] = $api->handle(
        $_SERVER['REQUEST_METHOD'] ?? 'GET',
        $_GET,
        $body,
        $_SERVER['HTTP_X_CSRF_TOKEN'] ?? null
    );
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
} catch (\Throwable $e) {
    error_log('PromptTrap bootstrap: ' . get_class($e));
    http_response_code(500);
    echo json_encode(['error' => 'تعذر الاتصال بقاعدة البيانات. تأكد من الإعدادات وشغّل bin/install.php.'], JSON_UNESCAPED_UNICODE);
}
