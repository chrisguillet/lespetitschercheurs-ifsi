<?php
declare(strict_types=1);

namespace Lpc;

/** Dates : stockées en UTC (DATETIME), exposées en ISO 8601 comme les anciennes chaînes de toISOString(). */
final class Temps
{
    public static function maintenant(): string
    {
        return gmdate('Y-m-d H:i:s');
    }

    public static function depuis(int $secondes): string
    {
        return gmdate('Y-m-d H:i:s', time() + $secondes);
    }

    /** « 2026-11-21 08:30:00 » -> « 2026-11-21T08:30:00.000Z » ; vide si la valeur est absente. */
    public static function iso(?string $datetime): string
    {
        if ($datetime === null || $datetime === '') {
            return '';
        }
        $t = \DateTimeImmutable::createFromFormat('Y-m-d H:i:s', $datetime, new \DateTimeZone('UTC'));
        return $t === false ? '' : $t->format('Y-m-d\TH:i:s.000\Z');
    }

    public static function secondesDepuis(?string $datetime): ?int
    {
        if ($datetime === null || $datetime === '') {
            return null;
        }
        $t = \DateTimeImmutable::createFromFormat('Y-m-d H:i:s', $datetime, new \DateTimeZone('UTC'));
        return $t === false ? null : time() - $t->getTimestamp();
    }
}
