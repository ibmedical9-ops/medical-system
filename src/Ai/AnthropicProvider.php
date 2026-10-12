<?php
declare(strict_types=1);

namespace PromptTrap\Ai;

final class AnthropicProvider extends HttpProvider
{
    public function name(): string
    {
        return 'anthropic';
    }

    public function complete(string $system, string $user): string
    {
        $data = $this->post('https://api.anthropic.com/v1/messages', [
            'Content-Type: application/json',
            'x-api-key: ' . $this->apiKey,
            'anthropic-version: 2023-06-01',
        ], [
            'model' => $this->model,
            'max_tokens' => 2048,
            'system' => $system,
            'messages' => [['role' => 'user', 'content' => $user]],
        ]);
        $text = '';
        foreach ($data['content'] ?? [] as $block) {
            if (($block['type'] ?? '') === 'text') {
                $text .= $block['text'];
            }
        }
        if (trim($text) === '') {
            throw new ProviderException('استجابة المزود فارغة.');
        }
        return $text;
    }
}
