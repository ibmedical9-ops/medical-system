<?php
declare(strict_types=1);

namespace PromptTrap\Http;

use PromptTrap\Ai\ProviderInterface;
use PromptTrap\Service\Auth;
use PromptTrap\Service\HttpException;
use PromptTrap\Service\TrainingService;

/** موجّه JSON بسيط: ‎api.php?action=...‎ — يعمل على أي استضافة دون إعادة كتابة المسارات. */
final class Api
{
    public function __construct(private Auth $auth, private TrainingService $svc, private ProviderInterface $provider)
    {
    }

    /**
     * @param array<string,mixed> $query
     * @param array<string,mixed> $body
     * @return array{0:int,1:array<string,mixed>}
     */
    public function handle(string $method, array $query, array $body, ?string $csrfHeader): array
    {
        try {
            $action = (string) ($query['action'] ?? '');
            $isPost = $method === 'POST';
            if ($isPost && !$this->auth->checkCsrf($csrfHeader)) {
                throw new HttpException('رمز الحماية غير صالح. أعد تحميل الصفحة.', 403);
            }
            $user = $this->auth->user();

            $int = static fn(string $k) => (int) ($body[$k] ?? $query[$k] ?? 0);

            $result = match (true) {
                $action === 'bootstrap' && !$isPost => [
                    'user' => ['name' => $user['display_name'], 'role' => $user['role']],
                    'csrf' => $this->auth->csrf(),
                    'provider' => ['name' => $this->provider->name(), 'is_simulation' => $this->provider->isSimulation(), 'notice' => $this->provider->notice()],
                    'scenarios' => $this->svc->scenarios(),
                    'samples' => $this->svc->samples(),
                    'sessions' => $this->svc->listSessions($user),
                    'limits' => ['source_max' => TrainingService::MAX_SOURCE, 'source_min' => TrainingService::MIN_SOURCE, 'prompt_max' => TrainingService::MAX_PROMPT],
                ],
                $action === 'session' && !$isPost => $this->svc->getSession($user, $int('id')),
                $action === 'compare' && !$isPost => $this->svc->compare($user, $int('session_id')),
                $action === 'session_create' && $isPost => $this->svc->createSession(
                    $user, $int('scenario_id'), $int('sample_id') ?: null,
                    isset($body['source_text']) ? (string) $body['source_text'] : null,
                    isset($body['title']) ? (string) $body['title'] : null
                ),
                $action === 'attempt_create' && $isPost => $this->svc->runAttempt($user, $int('session_id'), (string) ($body['prompt'] ?? '')),
                $action === 'evaluate' && $isPost => $this->svc->evaluate($user, $int('attempt_id')),
                $action === 'improve' && $isPost => $this->svc->improve($user, $int('attempt_id')),
                $action === 'reveal' && $isPost => $this->svc->reveal($user, $int('attempt_id'), isset($body['verdict']) ? (string) $body['verdict'] : null),
                $action === 'login' && $isPost => $this->login((string) ($body['username'] ?? ''), (string) ($body['password'] ?? '')),
                $action === 'logout' && $isPost => $this->logout(),
                $action === 'trainer_attempts' && !$isPost => ['attempts' => $this->svc->trainerSessions($user)],
                $action === 'trainer_key' && !$isPost => $this->svc->trainerKey($user, $int('attempt_id')),
                default => throw new HttpException('إجراء غير معروف.', 404),
            };
            return [200, $result];
        } catch (HttpException $e) {
            return [$e->status, ['error' => $e->getMessage()]];
        } catch (\Throwable $e) {
            // لا نسجل أي بيانات إدخال أو مفاتيح؛ فقط نوع الخطأ والموضع
            error_log('PromptTrap: ' . get_class($e) . ' at ' . basename($e->getFile()) . ':' . $e->getLine());
            return [500, ['error' => 'حدث خطأ داخلي.']];
        }
    }

    /** @return array<string,mixed> */
    private function login(string $username, string $password): array
    {
        $u = $this->auth->login(trim($username), $password);
        if ($u === null) {
            throw new HttpException('بيانات الدخول غير صحيحة.', 401);
        }
        return ['user' => ['name' => $u['display_name'], 'role' => $u['role']], 'csrf' => $this->auth->csrf()];
    }

    /** @return array<string,mixed> */
    private function logout(): array
    {
        $this->auth->logout();
        return ['ok' => true];
    }
}
