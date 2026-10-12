<?php
declare(strict_types=1);

namespace PromptTrap\Ai;

use PromptTrap\Config;

/** يختار المزود من الإعدادات فقط؛ لا يحتاج التطبيق إلى تعديل عند التبديل. */
final class ProviderFactory
{
    public static function make(?callable $http = null): ProviderInterface
    {
        $type = strtolower(Config::get('AI_PROVIDER', 'simulation'));
        $key = Config::get('AI_API_KEY');
        $model = Config::get('AI_MODEL');
        $timeout = (int) Config::get('AI_TIMEOUT', '30');

        // دون إعداد كامل نعود إلى المحاكاة بدل الفشل
        return match ($type) {
            'openai_compatible', 'openai' => ($model !== '')
                ? new OpenAICompatibleProvider($key, $model, Config::get('AI_BASE_URL', 'https://api.openai.com/v1'), $timeout, $http)
                : new SimulationProvider(),
            'anthropic' => ($key !== '' && $model !== '')
                ? new AnthropicProvider($key, $model, $timeout, $http)
                : new SimulationProvider(),
            default => new SimulationProvider(),
        };
    }
}
