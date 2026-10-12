<?php
declare(strict_types=1);

namespace PromptTrap\Ai;

/** قاعدة مشتركة للمزودات عبر HTTP. النقل قابل للاستبدال لتسهيل الاختبار. */
abstract class HttpProvider implements ProviderInterface
{
    /** @var callable(string,array<int,string>,string,int):array{0:int,1:string} */
    protected $http;

    public function __construct(
        protected string $apiKey,
        protected string $model,
        protected int $timeout = 30,
        ?callable $http = null
    ) {
        $this->http = $http ?? [self::class, 'curl'];
    }

    public function isSimulation(): bool
    {
        return false;
    }

    public function notice(): string
    {
        return 'المزود الحالي: ' . $this->name() . ' — يُرسل نص مخرجات المحضر المخطَّط (مقتطفات من المصدر) إلى هذه الخدمة الخارجية لصياغته. لا تُدخل بيانات حساسة دون موافقة.';
    }

    /** @return array{0:int,1:string} */
    public static function curl(string $url, array $headers, string $body, int $timeout): array
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_CONNECTTIMEOUT => 10,
        ]);
        $res = curl_exec($ch);
        if ($res === false) {
            // لا نضع عنوان الطلب أو الترويسات في الرسالة حتى لا يتسرب المفتاح
            throw new ProviderException('تعذر الاتصال بمزود الذكاء الاصطناعي.');
        }
        $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        return [$code, (string) $res];
    }

    protected function post(string $url, array $headers, array $payload): array
    {
        [$code, $body] = ($this->http)($url, $headers, json_encode($payload, JSON_UNESCAPED_UNICODE), $this->timeout);
        $data = json_decode($body, true);
        if ($code < 200 || $code >= 300 || !is_array($data)) {
            throw new ProviderException('رفض المزود الطلب (HTTP ' . $code . ').');
        }
        return $data;
    }
}
