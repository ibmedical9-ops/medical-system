<?php
declare(strict_types=1);

namespace PromptTrap\Ai;

/** أي خدمة تدعم /chat/completions بصيغة OpenAI (OpenAI، Ollama، vLLM، OpenRouter...). */
final class OpenAICompatibleProvider extends HttpProvider
{
    public function __construct(string $apiKey, string $model, private string $baseUrl, int $timeout = 30, ?callable $http = null)
    {
        parent::__construct($apiKey, $model, $timeout, $http);
    }

    public function name(): string
    {
        return 'openai_compatible (' . (parse_url($this->baseUrl, PHP_URL_HOST) ?: 'custom') . ')';
    }

    public function complete(string $system, string $user): string
    {
        $headers = ['Content-Type: application/json'];
        if ($this->apiKey !== '') {
            $headers[] = 'Authorization: Bearer ' . $this->apiKey;
        }
        $data = $this->post(rtrim($this->baseUrl, '/') . '/chat/completions', $headers, [
            'model' => $this->model,
            'temperature' => 0,
            'messages' => [
                ['role' => 'system', 'content' => $system],
                ['role' => 'user', 'content' => $user],
            ],
        ]);
        $text = $data['choices'][0]['message']['content'] ?? null;
        if (!is_string($text) || trim($text) === '') {
            throw new ProviderException('استجابة المزود فارغة.');
        }
        return $text;
    }
}
