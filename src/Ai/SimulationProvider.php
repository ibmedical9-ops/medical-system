<?php
declare(strict_types=1);

namespace PromptTrap\Ai;

/** وضع المحاكاة المحلي: لا يستدعي أي نموذج لغوي ولا يرسل بيانات إلى أي جهة. */
final class SimulationProvider implements ProviderInterface
{
    public function name(): string
    {
        return 'simulation';
    }

    public function isSimulation(): bool
    {
        return true;
    }

    public function notice(): string
    {
        return 'وضع محاكاة محلي: المخرجات تولّدها قواعد لغوية مبرمجة مسبقاً وليست نموذجاً لغوياً حقيقياً. لا تُرسل أي بيانات إلى خدمة خارجية.';
    }

    public function complete(string $system, string $user): string
    {
        throw new ProviderException('وضع المحاكاة لا يستدعي نموذجاً لغوياً.');
    }
}
