"""Séries de benchmarks. Cada fonte devolve {iso_date: valor} e é gravada em cache.

- bcb_sgs / taxa_diaria_pct: valor = taxa do dia em % (ex.: CDI 0,050788 % a.d.)
- yahoo / nivel: valor = nível de fechamento do índice
"""
import json
import re
import time
import urllib.request
from datetime import date, datetime, timezone

import config
from util import log


def _get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def _bcb(code, start: date, end: date):
    data = _get_json(config.BCB_SGS_URL.format(code=code, ini=start.strftime("%d/%m/%Y"), fim=end.strftime("%d/%m/%Y")))
    out = {}
    for r in data:
        d, m, y = r["data"].split("/")
        out[f"{y}-{m}-{d}"] = float(r["valor"])
    return out


def _bcb_web(code, start: date, end: date):
    """Mesma série SGS via módulo web do BCB (www3.bcb.gov.br), usado se a API estiver indisponível.

    A página lista pares data / valor (formato numérico europeu). Consultas longas são feitas por ano.
    """
    out = {}
    y = start.year
    while y <= end.year:
        ini = max(start, date(y, 1, 1))
        fim = min(end, date(y, 12, 31))
        url = config.BCB_SGS_WEB_URL.format(code=code, ini=ini.strftime("%d/%m/%Y"), fim=fim.strftime("%d/%m/%Y"))
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=90) as r:
            html = r.read().decode("latin-1")
        cells = [re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", c)).strip() for c in re.findall(r"<td[^>]*>(.*?)</td>", html, re.S)]
        cells = [c for c in cells if c]
        for a, b in zip(cells, cells[1:]):
            if re.fullmatch(r"\d{2}/\d{2}/\d{4}", a) and re.fullmatch(r"-?[\d.]*\d,\d+", b):
                d, m, yy = a.split("/")
                out[f"{yy}-{m}-{d}"] = float(b.replace(".", "").replace(",", "."))
        y += 1
    if not out:
        raise ValueError("SGS web: nenhuma observação encontrada na página")
    return out


def _yahoo(symbol, start: date, end: date):
    p1 = int(datetime(start.year, start.month, start.day, tzinfo=timezone.utc).timestamp())
    p2 = int(time.time()) + 86400
    data = _get_json(config.YAHOO_URL.format(symbol=symbol.replace("^", "%5E"), p1=p1, p2=p2))
    res = data["chart"]["result"][0]
    tz_off = res["meta"].get("gmtoffset", -10800)
    out = {}
    for ts, px in zip(res["timestamp"], res["indicators"]["quote"][0]["close"]):
        if px is None:
            continue
        d = datetime.fromtimestamp(ts + tz_off, tz=timezone.utc).date()
        out[d.isoformat()] = float(px)
    # Remove o pregão corrente, que pode ser um preço intradiário e não um fechamento.
    today = datetime.now(timezone.utc).date().isoformat()
    out.pop(today, None)
    return out


def load(benchmarks, start: date, end: date, offline=False):
    """benchmarks: linhas da aba Benchmarks. Retorna {id: {"serie": {...}, "meta": {...}}}."""
    config.BENCH_DIR.mkdir(parents=True, exist_ok=True)
    result = {}
    for b in benchmarks:
        bid, fonte = b["benchmark_id"], (b.get("fonte") or "nd").strip()
        meta = {"id": bid, "nome": b["nome"], "fonte": fonte, "tipo_serie": b.get("tipo_serie"),
                "observacoes": b.get("observacoes") or "", "disponivel": False}
        cache = config.BENCH_DIR / f"{bid}.json"
        serie = None
        if fonte in ("bcb_sgs", "yahoo"):
            if not offline:
                code = str(b["codigo_serie"]).strip()
                tentativas = [("api", _bcb), ("sgs_web", _bcb_web)] if fonte == "bcb_sgs" else [("yahoo", _yahoo)]
                erros = []
                for nome, fn in tentativas:
                    try:
                        serie = fn(code, start, end)
                        meta["fonte_efetiva"] = nome
                        break
                    except Exception as e:  # noqa: BLE001
                        erros.append(f"{nome}: {e}")
                        log(f"  aviso: {bid} indisponível via {nome} ({e})" + ("; tentando alternativa…" if nome != tentativas[-1][0] else ""))
                if serie is not None:
                    # Conferência com o cache: valores sobrepostos devem coincidir (fontes oficiais equivalentes).
                    if cache.exists():
                        old_s = json.loads(cache.read_text(encoding="utf-8"))
                        diff = [d for d in old_s if d in serie and abs(old_s[d] - serie[d]) > 1e-9 * max(1, abs(old_s[d]))]
                        if diff:
                            meta["divergencias_cache"] = len(diff)
                            log(f"  aviso: {bid}: {len(diff)} valores diferem do cache anterior (ex.: {diff[0]}); usando a nova coleta")
                    cache.write_text(json.dumps(serie), encoding="utf-8")
                    log(f"Benchmark {bid}: {len(serie)} observações ({fonte}/{meta['fonte_efetiva']}, até {max(serie)})")
                else:
                    log(f"  AVISO: falha ao obter {bid}; usando cache se existir")
                    meta["falha_atualizacao"] = " | ".join(erros)[:300]
            if serie is None and cache.exists():
                serie = json.loads(cache.read_text(encoding="utf-8"))
        if serie:
            meta["disponivel"] = True
            meta["ultima_data"] = max(serie)
            meta["primeira_data"] = min(serie)
        result[bid] = {"serie": serie or {}, "meta": meta}
    return result
