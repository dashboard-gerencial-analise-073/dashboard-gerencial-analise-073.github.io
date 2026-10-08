"""Cálculo de rentabilidade, risco e fluxos. Metodologia completa em docs/METODOLOGIA.md.

Convenções
- Eixo de datas = dias úteis (calendário das datas da série do CDI/BCB).
- Séries alinhadas ao eixo: lista com o valor na data ou None.
- Rentabilidade de período sempre por composição: V_fim / V_ini - 1.
- Nenhum valor é interpolado ou estimado; faltando dado, o resultado é None
  acompanhado de um motivo ("reason").
"""
import math
from datetime import date

import config
from util import add_months, month_end, iso

ND_HIST = "Histórico insuficiente para o período"
ND_NOQUOTE = "Cota não disponível na data"
ND_BENCH = "Benchmark sem série histórica pública"
ND_COVER = "Cobertura de dados diária insuficiente (<90%)"


class Axis:
    def __init__(self, dates):
        self.dates = dates
        self.pos = {d: i for i, d in enumerate(dates)}

    def last_on_or_before(self, d):
        """Índice do último dia útil <= d (busca binária)."""
        lo, hi, ans = 0, len(self.dates) - 1, None
        while lo <= hi:
            mid = (lo + hi) // 2
            if self.dates[mid] <= d:
                ans, lo = mid, mid + 1
            else:
                hi = mid - 1
        return ans


def window_indices(axis: Axis, i_base: int, w):
    """(i_ini, i_fim) no eixo para a janela w, terminando na data-base."""
    db = axis.dates[i_base]
    t = w["type"]
    if t == "mtd":
        prev = date(db.year, db.month, 1)
        return axis.last_on_or_before(date.fromordinal(prev.toordinal() - 1)), i_base
    if t == "prev_month":
        first = date(db.year, db.month, 1)
        end_prev = date.fromordinal(first.toordinal() - 1)
        start_prev = date.fromordinal(date(end_prev.year, end_prev.month, 1).toordinal() - 1)
        return axis.last_on_or_before(start_prev), axis.last_on_or_before(end_prev)
    if t == "ytd":
        return axis.last_on_or_before(date(db.year - 1, 12, 31)), i_base
    if t == "months":
        return axis.last_on_or_before(add_months(db, -w["n"])), i_base
    raise ValueError(t)


def value_at(series, i, lookback=0):
    """Valor em i; opcionalmente aceita o último valor até `lookback` posições antes."""
    if i is None:
        return None, None
    for k in range(i, max(-1, i - lookback - 1), -1):
        if series[k] is not None:
            return series[k], k
    return None, None


def period_return(series, i0, i1, first_idx):
    """Retorno composto entre i0 e i1. first_idx = primeira posição com dado da série."""
    if i0 is None or i1 is None or first_idx is None:
        return None, ND_HIST
    if first_idx > i0:
        return None, ND_HIST
    v0, _ = value_at(series, i0, config.MAX_QUOTE_LOOKBACK_DAYS)
    v1 = series[i1]
    if v0 is None or v1 is None or v0 <= 0:
        return None, ND_NOQUOTE
    return v1 / v0 - 1, None


def annualize(r, n_days):
    if r is None or not n_days:
        return None
    return (1 + r) ** (config.BUSINESS_DAYS_YEAR / n_days) - 1


def daily_returns(series, i0, i1):
    """Retornos diários r_t = V_t/V_{t-1}-1 para pares consecutivos com dado. Retorna (lista_por_índice, cobertura)."""
    out = {}
    expected = i1 - i0
    for k in range(i0 + 1, i1 + 1):
        a, b = series[k - 1], series[k]
        if a is not None and b is not None and a > 0:
            out[k] = b / a - 1
    return out, (len(out) / expected if expected > 0 else 0)


def stdev(xs):
    n = len(xs)
    if n < 2:
        return None
    m = sum(xs) / n
    return math.sqrt(sum((x - m) ** 2 for x in xs) / (n - 1))


def max_drawdown(series, i0, i1):
    peak, mdd, trough_i, peak_i, best_peak_i = None, 0.0, None, None, None
    for k in range(i0, i1 + 1):
        v = series[k]
        if v is None:
            continue
        if peak is None or v > peak:
            peak, peak_i = v, k
        dd = v / peak - 1
        if dd < mdd:
            mdd, trough_i, best_peak_i = dd, k, peak_i
    return mdd, best_peak_i, trough_i


def monthly_table(axis: Axis, series, first_idx, i_base):
    """{'AAAA-MM': retorno} por mês calendário, fim-de-mês a fim-de-mês. Mês corrente = parcial (até data-base)."""
    out = {}
    if first_idx is None:
        return out
    d0 = axis.dates[first_idx]
    y, m = d0.year, d0.month
    db = axis.dates[i_base]
    while (y, m) <= (db.year, db.month):
        prev_end = date.fromordinal(date(y, m, 1).toordinal() - 1)
        i0 = axis.last_on_or_before(prev_end)
        i1 = axis.last_on_or_before(month_end(y, m)) if (y, m) != (db.year, db.month) else i_base
        r, _ = period_return(series, i0, i1, first_idx)
        if r is not None:
            out[f"{y}-{m:02d}"] = r
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


def yearly_table(axis: Axis, series, first_idx, i_base):
    out = {}
    if first_idx is None:
        return out
    for y in range(axis.dates[first_idx].year, axis.dates[i_base].year + 1):
        i0 = axis.last_on_or_before(date(y - 1, 12, 31))
        i1 = axis.last_on_or_before(date(y, 12, 31)) if y != axis.dates[i_base].year else i_base
        r, _ = period_return(series, i0, i1, first_idx)
        if r is not None:
            out[str(y)] = r
    return out


def first_index(series):
    for i, v in enumerate(series):
        if v is not None:
            return i
    return None


def business_days(axis: Axis, i0, i1):
    return i1 - i0 if i0 is not None and i1 is not None else None


def fund_metrics(axis, i_base, q, bench, cdi, windows, risk_windows, bench_is_market):
    """Calcula todas as janelas para um fundo.

    q: cotas alinhadas; bench: série de índice (nível) do benchmark ou None;
    cdi: índice acumulado do CDI (taxa livre de risco).
    """
    fi = first_index(q)
    bi = first_index(bench) if bench else None
    ci = first_index(cdi)
    ret, risk = {}, {}
    for w in windows:
        i0, i1 = window_indices(axis, i_base, w)
        rf, why = period_return(q, i0, i1, fi)
        rb, whyb = (period_return(bench, i0, i1, bi) if bench else (None, ND_BENCH))
        rec = {"f": rf, "b": rb, "start": iso(axis.dates[i0]) if i0 is not None else None,
               "end": iso(axis.dates[i1]) if i1 is not None else None}
        if why:
            rec["nd"] = why
        if rb is None:
            rec["nd_b"] = whyb
        if rf is not None and rb is not None:
            rec["x"] = rf - rb                       # excesso aritmético (p.p.)
            if not bench_is_market and rb > 0:
                rec["pb"] = rf / rb                  # % do benchmark (apenas índices de juros)
        if w["type"] == "months" and w["n"] >= config.ANNUALIZE_MIN_MONTHS:
            n = business_days(axis, i0, i1)
            rec["n_du"] = n
            rec["fa"] = annualize(rf, n)
            rec["ba"] = annualize(rb, n)
            if rec["fa"] is not None and rec["ba"] is not None:
                rec["xa"] = rec["fa"] - rec["ba"]
        ret[w["id"]] = rec

    wmap = {w["id"]: w for w in windows}
    for wid in risk_windows:
        w = wmap[wid]
        i0, i1 = window_indices(axis, i_base, w)
        rec = {"start": iso(axis.dates[i0]) if i0 is not None else None, "end": iso(axis.dates[i1])}
        if fi is None or i0 is None or fi > i0:
            rec["nd"] = ND_HIST
            risk[wid] = rec
            continue
        dr, cov = daily_returns(q, i0, i1)
        rec["cobertura"] = cov
        if cov < config.MIN_RISK_COVERAGE:
            rec["nd"] = ND_COVER
            risk[wid] = rec
            continue
        sd = stdev(list(dr.values()))
        vol = sd * math.sqrt(config.BUSINESS_DAYS_YEAR) if sd is not None else None
        n = business_days(axis, i0, i1)
        rf, _ = period_return(q, i0, i1, fi)
        rc, _ = period_return(cdi, i0, i1, ci)
        fa, ca = annualize(rf, n), annualize(rc, n)
        rec["vol"] = vol
        rec["sharpe"] = (fa - ca) / vol if (vol and fa is not None and ca is not None) else None
        mdd, pk, tr = max_drawdown(q, i0, i1)
        rec["mdd"] = mdd
        rec["mdd_pico"] = iso(axis.dates[pk]) if pk is not None else None
        rec["mdd_vale"] = iso(axis.dates[tr]) if tr is not None else None
        rets = list(dr.values())
        rec["pct_dias_pos"] = sum(1 for x in rets if x > 0) / len(rets) if rets else None
        # Meses positivos e acima do benchmark (meses calendário completos dentro da janela).
        mf = monthly_table(axis, q, i0, i1)
        mb = monthly_table(axis, bench, max(i0, bi), i1) if bench and bi is not None else {}
        start_key = f"{axis.dates[i0].year}-{axis.dates[i0].month:02d}"
        end_d = axis.dates[i1]
        end_key = f"{end_d.year}-{end_d.month:02d}"
        # Apenas meses completos: exclui o mês de início e o mês corrente (parcial).
        months = [k for k in mf if start_key < k < end_key]
        if months:
            rec["meses"] = len(months)
            rec["pct_meses_pos"] = sum(1 for k in months if mf[k] > 0) / len(months)
            common = [k for k in months if k in mb]
            if common and len(common) == len(months):
                rec["pct_meses_acima_bench"] = sum(1 for k in common if mf[k] > mb[k]) / len(common)
        # Beta, tracking error e information ratio: somente contra índice de mercado (ex.: Ibovespa).
        if bench_is_market and bench and bi is not None and bi <= i0:
            db, _ = daily_returns(bench, i0, i1)
            pairs = [(dr[k], db[k]) for k in dr if k in db]
            if len(pairs) >= config.MIN_RISK_COVERAGE * (i1 - i0):
                xs = [p[1] for p in pairs]
                ys = [p[0] for p in pairs]
                mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
                cov_xy = sum((b - mx) * (f - my) for f, b in pairs) / (len(pairs) - 1)
                var_x = sum((x - mx) ** 2 for x in xs) / (len(xs) - 1)
                rec["beta"] = cov_xy / var_x if var_x else None
                te_sd = stdev([a - b for a, b in pairs])
                rec["te"] = te_sd * math.sqrt(config.BUSINESS_DAYS_YEAR) if te_sd else None
                rb, _ = period_return(bench, i0, i1, bi)
                ba = annualize(rb, n)
                rec["ir"] = (fa - ba) / rec["te"] if rec.get("te") and fa is not None and ba is not None else None
                rec["corr"] = cov_xy / (stdev(xs) * stdev(ys)) if stdev(xs) and stdev(ys) else None
        risk[wid] = rec
    return ret, risk


def flows(axis, i_base, rows_by_date, months=12):
    """PL, cotistas e captação líquida a partir das linhas brutas do informe diário."""
    db = axis.dates[i_base]
    i0 = axis.last_on_or_before(add_months(db, -months))
    base = rows_by_date.get(iso(db))
    out = {"pl": base["pl"] if base else None, "cotistas": base["cot"] if base else None,
           "data": iso(db) if base else None}
    if i0 is None:
        return out
    d0 = axis.dates[i0]
    past = rows_by_date.get(iso(d0))
    if past:
        out["pl_12m_atras"] = past["pl"]
        out["cotistas_12m_atras"] = past["cot"]
    window = [r for d, r in rows_by_date.items() if iso(d0) < d <= iso(db)]
    first = min(rows_by_date) if rows_by_date else None
    if first and first <= iso(d0) and window:
        out["captacao_liquida_12m"] = sum(r["cap"] - r["res"] for r in window)
        out["pl_medio_12m"] = sum(r["pl"] for r in window) / len(window)
    return out
