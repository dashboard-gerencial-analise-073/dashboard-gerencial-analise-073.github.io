import calendar
import re
import sys
import unicodedata
from datetime import date


try:
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:  # noqa: BLE001
    pass


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def only_digits(s):
    return re.sub(r"\D", "", str(s or ""))


def format_cnpj(s):
    d = only_digits(s).zfill(14)
    return f"{d[:2]}.{d[2:5]}.{d[5:8]}/{d[8:12]}-{d[12:]}"


def cnpj_is_valid(s):
    d = only_digits(s)
    if len(d) != 14 or d == d[0] * 14:
        return False
    def dv(base, weights):
        r = sum(int(x) * w for x, w in zip(base, weights)) % 11
        return "0" if r < 2 else str(11 - r)
    w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    w2 = [6] + w1
    return dv(d[:12], w1) == d[12] and dv(d[:13], w2) == d[13]


def normalize_text(s):
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9 ]", " ", s.lower())


def add_months(d: date, n: int) -> date:
    m = d.month - 1 + n
    y = d.year + m // 12
    m = m % 12 + 1
    return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


def month_end(y, m):
    return date(y, m, calendar.monthrange(y, m)[1])


def iso(d):
    return d.isoformat() if d else None


def easter(y):
    """Domingo de Páscoa (algoritmo gregoriano anônimo)."""
    a, b, c = y % 19, y // 100, y % 100
    d, e = b // 4, b % 4
    g = (8 * b + 13) // 25
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l_ = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 19 * l_) // 433
    month = (h + l_ - 7 * m + 90) // 25
    return date(y, month, (h + l_ - 7 * m + 33 * month + 19) % 32)


def national_holidays(y):
    """Feriados nacionais (calendário de dias úteis do mercado financeiro / ANBIMA)."""
    e = easter(y).toordinal()
    fixed = [(1, 1), (4, 21), (5, 1), (9, 7), (10, 12), (11, 2), (11, 15), (12, 25)] + ([(11, 20)] if y >= 2024 else [])
    mobile = [e - 48, e - 47, e - 2, e + 60]  # Carnaval (seg/ter), Sexta-feira Santa, Corpus Christi
    return {date(y, m, d) for m, d in fixed} | {date.fromordinal(x) for x in mobile}


def is_business_day(d):
    return d.weekday() < 5 and d not in national_holidays(d.year)


def last_business_day_on_or_before(d):
    while not is_business_day(d):
        d = date.fromordinal(d.toordinal() - 1)
    return d
