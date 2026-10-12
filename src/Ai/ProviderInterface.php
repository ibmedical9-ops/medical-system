<?php
declare(strict_types=1);

namespace PromptTrap\Ai;

interface ProviderInterface
{
    /** اسم المزود كما يظهر للمستخدم */
    public function name(): string;

    /** هل هو وضع المحاكاة المحلي (لا يُرسل أي بيانات خارج الخادم)؟ */
    public function isSimulation(): bool;

    /** نص يُعرض للمتدرب يوضح طبيعة المزود وخصوصية البيانات */
    public function notice(): string;

    /** يُرجع نص الإكمال. يرمي ProviderException عند الفشل. */
    public function complete(string $system, string $user): string;
}
