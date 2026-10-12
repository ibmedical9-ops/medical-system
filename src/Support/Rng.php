<?php
declare(strict_types=1);

namespace PromptTrap\Support;

/** مولّد عشوائي حتمي (mulberry32) لإعادة إنتاج نفس المحاكاة بنفس البذرة. */
final class Rng
{
    private int $s;

    public function __construct(int $seed)
    {
        $this->s = $seed & 0xFFFFFFFF;
    }

    public function float(): float
    {
        $this->s = ($this->s + 0x6D2B79F5) & 0xFFFFFFFF;
        $t = $this->s;
        $t = (($t ^ ($t >> 15)) * ($t | 1)) & 0xFFFFFFFF;
        $t ^= ($t + ((($t ^ ($t >> 7)) * ($t | 61)) & 0xFFFFFFFF)) & 0xFFFFFFFF;
        return ((($t ^ ($t >> 14)) & 0xFFFFFFFF)) / 4294967296;
    }

    public function chance(float $p): bool
    {
        return $p > 0 && $this->float() < $p;
    }

    /** @template T @param T[] $arr @return T */
    public function pick(array $arr)
    {
        return $arr[(int) floor($this->float() * count($arr))];
    }

    public function shuffle(array $arr): array
    {
        $arr = array_values($arr);
        for ($i = count($arr) - 1; $i > 0; $i--) {
            $j = (int) floor($this->float() * ($i + 1));
            [$arr[$i], $arr[$j]] = [$arr[$j], $arr[$i]];
        }
        return $arr;
    }
}
