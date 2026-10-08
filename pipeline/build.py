"""Pipeline completo: Dados -> Tratamento -> Dashboard.

Uso:
    python pipeline/build.py            # baixa/atualiza dados e gera tudo
    python pipeline/build.py --offline  # usa apenas o que já está em data/raw
    python pipeline/build.py --data-base 2026-08-31   # fixa a data-base (ex.: fechamento de mês)
"""
import argparse
import json
import sys
from collections import defaultdict
from datetime import date, datetime

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))

import benchmarks as bm  # noqa: E402
import cadastro  # noqa: E402
import carteira  # noqa: E402
import config  # noqa: E402
import cvm  # noqa: E402
import export_xlsx  # noqa: E402
import mercado  # noqa: E402
import metrics as mt  # noqa: E402
import quality  # noqa: E402
from util import add_months, format_cnpj, iso, last_business_day_on_or_before, log, only_digits  # noqa: E402

MARKET_SERIES = {"nivel"}  # tipo_serie de índices de mercado (beta/TE fazem sentido)


def rnd(x, n=8):
    if x is None:
        return None
    if isinstance(x, float):
        return float(f"{x:.{n}g}")
    return x


def clean(o):
    if isinstance(o, dict):
        return {k: clean(v) for k, v in o.items() if v is not None}
    if isinstance(o, list):
        return [clean(v) for v in o]
    return rnd(o)


def merge_subclasses(rows, sub_rows, jump_limit):
    """Quando a CVM passa a reportar a classe apenas por subclasse, continua a série da classe.

    Regra (determinística): após a última data com registro da classe, usa a cota da subclasse com
    maior número de cotistas; PL, cotistas e fluxos = soma das subclasses. Só é aplicada se a primeira
    cota da subclasse for contínua com a última cota da classe (variação <= limite de retorno suspeito).
    Retorna (linhas, nota ou None).
    """
    if not sub_rows:
        return rows, None
    last_cls = max(rows) if rows else None
    later = {d: r for d, r in sub_rows.items() if last_cls is None or d > last_cls}
    if not later:
        return rows, None
    # sub_rows guarda uma linha por data e subclasse (chave data|subclasse)
    by_date = {}
    for k, r in later.items():
        by_date.setdefault(k.split("|")[0], []).append(r)
    last_d = max(by_date)
    chosen = max(by_date[last_d], key=lambda r: r["cot"])["sub"]
    merged = dict(rows)
    for d, rs in sorted(by_date.items()):
        ch = [r for r in rs if r["sub"] == chosen]
        if not ch or ch[0]["q"] <= 0:
            continue
        merged[d] = {"q": ch[0]["q"], "pl": sum(r["pl"] for r in rs), "cap": sum(r["cap"] for r in rs),
                     "res": sum(r["res"] for r in rs), "cot": sum(r["cot"] for r in rs), "fonte": "subclasse"}
    new = sorted(d for d in merged if d not in rows)
    if last_cls and new:
        prev = [d for d in rows if rows[d]["q"] > 0]
        if prev:
            a = rows[max(prev)]["q"]
            if abs(merged[new[0]]["q"] / a - 1) > jump_limit:
                return rows, (f"A partir de {new[0]} a CVM reporta apenas por subclasse, mas a cota da subclasse {chosen} "
                              f"não é contínua com a da classe; série interrompida (sem emenda).")
    return merged, (f"A partir de {new[0]} a CVM passou a reportar este fundo por subclasse. Série de cotas continuada pela "
                    f"subclasse {chosen} (maior número de cotistas, cota contínua com a da classe); PL, cotistas e fluxos = soma das subclasses.")


def cdi_index(axis_dates, cdi_rates):
    """Índice acumulado do CDI. Cota do dia t incorpora a taxa DI do dia útil anterior (t-1)."""
    out = [1.0]
    for i in range(1, len(axis_dates)):
        r = cdi_rates.get(iso(axis_dates[i - 1]))
        out.append(None if (r is None or out[-1] is None) else out[-1] * (1 + r / 100))
    return out


def level_series(axis_dates, levels):
    return [levels.get(iso(d)) for d in axis_dates]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true")
    ap.add_argument("--data-base", help="'fechamento' (padrão: último dia útil do mês anterior), 'ultima' (data mais recente "
                    "com cotas de todos os fundos) ou AAAA-MM-DD")
    ap.add_argument("--forcar", action="store_true", help="gera mesmo que a CVM ainda não tenha cotas de todos os fundos na data-base")
    args = ap.parse_args()

    today = date.today()
    max_months = max(w.get("n", 12) for w in config.RETURN_WINDOWS)
    hist_start = add_months(date(today.year, today.month, 1), -(max_months + config.HISTORY_MARGIN_MONTHS))

    log("1/6 Lendo planilha-base…")
    gestoras, bench_rows, fundos, errs = cadastro.load()
    for e in errs:
        log("  ERRO planilha: " + e)
    qc = quality.QC()
    quality.check_cadastro(qc, fundos, gestoras, bench_rows)

    log("2/6 Coletando dados da CVM…")
    months = cvm.download_all(hist_start, today, offline=args.offline)
    daily, daily_sub = cvm.read_daily(months, [f["cnpj"] for f in fundos])
    registers = cvm.read_registers([f["cnpj"] for f in fundos])

    log("   Carteiras (CDA/CVM)…")
    # CDA de um mês só é publicada no mês seguinte: consulta até o mês anterior ao atual.
    prev_month = add_months(date(today.year, today.month, 1), -1)
    cda_months = list(cvm.month_range(add_months(prev_month, -(config.CDA_LOOKBACK_MONTHS - 1)), prev_month))
    carteiras, carteiras_full, cda_qc = carteira.build(fundos, cda_months, offline=args.offline, top_n=config.CDA_TOP_N)
    for nivel, fid, cod, msg in cda_qc:
        qc.add(nivel, fid, cod, msg)

    log("3/6 Coletando benchmarks…")
    benches = bm.load(bench_rows, hist_start, today, offline=args.offline)
    if not benches.get("CDI", {}).get("meta", {}).get("disponivel"):
        sys.exit("CDI indisponível — é necessário para o calendário e para o Sharpe.")

    # Continuação por subclasse (RCVM 175) quando a classe deixa de ser reportada.
    sub_notes = {}
    for f in fundos:
        c = only_digits(f["cnpj"])
        lim = config.SUSPICIOUS_DAILY_RETURN.get(f["categoria"], config.SUSPICIOUS_DAILY_RETURN["default"])
        merged, note = merge_subclasses({d: r for d, r in daily.get(c, {}).items() if r["q"] > 0}, daily_sub.get(c, {}), lim)
        daily[c] = {**{d: r for d, r in daily.get(c, {}).items() if r["q"] <= 0}, **merged}
        if note:
            sub_notes[f["id"]] = note

    # Calendário de dias úteis = datas do CDI (BCB) + datas posteriores em que a maioria dos fundos tem cota
    # (a taxa DI de um dia é publicada no dia útil seguinte).
    cdi_rates = benches["CDI"]["serie"]
    cdi_dates = sorted(d for d in cdi_rates if d >= hist_start.isoformat())
    n_active = sum(1 for rows in daily.values() if rows)
    qcount = defaultdict(int)
    for rows in daily.values():
        for d, r in rows.items():
            if r["q"] > 0 and d > cdi_dates[-1]:
                qcount[d] += 1
    after_cdi = sorted(d for d, n in qcount.items() if n >= 0.5 * n_active)
    # O índice do CDI em t usa a taxa de t-1: só o 1º dia útil após o último CDI é calculável.
    axis_dates = [date.fromisoformat(d) for d in cdi_dates + after_cdi[:1]]
    calendar_known = [date.fromisoformat(d) for d in cdi_dates + after_cdi]

    def coverage(d):
        """Fração dos fundos ativos (com cota nos 10 dias úteis anteriores) que têm cota em d."""
        i = calendar_known.index(d)
        recent = {iso(x) for x in calendar_known[max(0, i - 10):i]}
        act = [rows for rows in daily.values() if any(k in recent and rows[k]["q"] > 0 for k in rows)]
        ok = sum(1 for rows in act if iso(d) in rows and rows[iso(d)]["q"] > 0)
        return ok / len(act) if act else 0

    # Data-base. Padrão (config.DATA_BASE_PADRAO): fechamento do mês anterior.
    modo = args.data_base or config.DATA_BASE_PADRAO
    if modo == "ultima":
        # Data mais recente em que TODOS os fundos ativos têm cota (aceita >= 95% se não houver nos últimos 5 dias).
        cands = [d for d in axis_dates if d <= axis_dates[-1]]
        last = len(cands) - 1
        while last > 0 and coverage(cands[last]) < 0.5:
            last -= 1
        db = next((cands[i] for i in range(last, max(-1, last - 5), -1) if coverage(cands[i]) >= 0.999), None)
        if db is None:
            db = next(cands[i] for i in range(last, -1, -1) if coverage(cands[i]) >= 0.95)
    else:
        if modo == "fechamento":
            alvo = date.fromordinal(date(today.year, today.month, 1).toordinal() - 1)  # último dia do mês anterior
        else:
            try:
                alvo = date.fromisoformat(modo)
            except ValueError:
                sys.exit(f"--data-base inválida: {modo!r}. Use AAAA-MM-DD, 'fechamento' ou 'ultima'.")
        if alvo >= today:
            sys.exit(f"Data-base {alvo:%d/%m/%Y} ainda não ocorreu (hoje é {today:%d/%m/%Y}).")
        # Dia útil esperado (feriados nacionais) — nunca troca silenciosamente por uma data anterior.
        db = last_business_day_on_or_before(alvo)
        if db not in calendar_known:
            sys.exit(f"Ainda não há dados para a data-base {db:%d/%m/%Y}: a CVM e/ou o CDI vão até "
                     f"{calendar_known[-1]:%d/%m/%Y} (CDI até {date.fromisoformat(cdi_dates[-1]):%d/%m/%Y}). "
                     "O relatório NÃO foi gerado para não usar outra data. Tente novamente mais tarde.")
        if db not in axis_dates:
            sys.exit(f"O CDI do Banco Central ainda não cobre a data-base {db:%d/%m/%Y} (última taxa: "
                     f"{date.fromisoformat(cdi_dates[-1]):%d/%m/%Y}). O relatório NÃO foi gerado para não usar outra data. "
                     "Tente novamente mais tarde ou use --data-base ultima.")
        cov = coverage(db)
        if cov < 0.95 and not args.forcar:
            sys.exit(f"A CVM ainda não publicou as cotas de {db:%d/%m/%Y} para todos os fundos ({cov:.0%} dos fundos ativos). "
                     "O informe diário costuma completar em 1–2 dias úteis. Tente novamente mais tarde "
                     "(ou use --forcar para gerar mesmo assim, com N/D nos fundos faltantes).")
        log(f"  data-base solicitada: {modo} → {db:%d/%m/%Y} (cobertura de cotas: {cov:.0%})")
    axis_dates = [d for d in axis_dates if d <= db]
    axis = mt.Axis(axis_dates)
    i_base = len(axis_dates) - 1
    axis_iso = [iso(d) for d in axis_dates]
    axis_set = set(axis_iso)
    log(f"  data-base: {db}  ({len(axis_dates)} dias úteis no eixo desde {axis_dates[0]})")

    cdi_idx = cdi_index(axis_dates, cdi_rates)
    bench_series = {"CDI": cdi_idx}
    bench_meta = []
    for bid, b in benches.items():
        meta = dict(b["meta"])
        if bid != "CDI" and meta["disponivel"]:
            bench_series[bid] = level_series(axis_dates, b["serie"])
            lvl = bench_series[bid]
            if lvl[i_base] is None:
                qc.add("alerta", None, "BENCH_DEFASADO", f"{meta['nome']} sem valor na data-base {db} (último: {meta.get('ultima_data')}); retornos relativos ficam N/D.")
        meta["mercado"] = meta.get("tipo_serie") in MARKET_SERIES
        if meta.get("falha_atualizacao"):
            qc.add("alerta", None, "BENCH_NAO_ATUALIZADO",
                   f"{meta['nome']}: não foi possível atualizar a série nesta execução ({meta['falha_atualizacao']}). "
                   f"Usado o último dado em cache ({meta.get('ultima_data') or 'N/D'})"
                   + (" — a data-base fica limitada por ele. Rode a atualização novamente mais tarde." if bid == "CDI" else "."))
        if not meta["disponivel"]:
            qc.add("info", None, "BENCH_SEM_SERIE", f"{meta['nome']}: {meta.get('observacoes') or 'sem série disponível'} Comparações com este índice aparecem como N/D.")
        bench_meta.append(meta)
    bench_is_market = {m["id"]: m["mercado"] for m in bench_meta}

    log("4/6 Calculando indicadores…")
    out_funds = []
    for f in fundos:
        c = only_digits(f["cnpj"])
        rows = {d: r for d, r in daily.get(c, {}).items() if r["q"] > 0}
        reg = registers.get(c)
        if f["id"] in sub_notes:
            qc.add("info", f["id"], "SERIE_SUBCLASSE", sub_notes[f["id"]])
        quality.check_registro(qc, f, reg)
        quality.check_series(qc, f, daily.get(c, {}), daily_sub.get(c, {}) if not rows else {}, axis_set, iso(db), f["categoria"])
        q = [rows[d]["q"] if d in rows else None for d in axis_iso]
        bid = f["benchmark_id"]
        bser = bench_series.get(bid)
        ret, risk = mt.fund_metrics(axis, i_base, q, bser, cdi_idx, config.RETURN_WINDOWS, config.RISK_WINDOWS,
                                    bench_is_market.get(bid, False))
        fi = mt.first_index(q)
        monthly_f = mt.monthly_table(axis, q, fi, i_base)
        monthly_b = mt.monthly_table(axis, bser, max(fi, mt.first_index(bser) or 0), i_base) if (bser and fi is not None) else {}
        yearly_f = mt.yearly_table(axis, q, fi, i_base)
        yearly_b = mt.yearly_table(axis, bser, max(fi, mt.first_index(bser) or 0), i_base) if (bser and fi is not None) else {}
        # Consistência interna: YTD calculado diretamente == composição dos meses do ano.
        ytd = ret.get("ytd", {}).get("f")
        if ytd is not None:
            comp = 1.0
            for k, v in monthly_f.items():
                if k.startswith(str(db.year)):
                    comp *= 1 + v
            if abs((comp - 1) - ytd) > 1e-6:
                qc.add("erro", f["id"], "INCONSISTENCIA_CALCULO", f"YTD direto {ytd:.6%} difere da composição mensal {comp - 1:.6%}.")
        # PL mensal (último dia útil de cada mês) para gráfico de evolução.
        pl_m = {}
        for d in sorted(rows):
            if d <= iso(db):
                pl_m[d[:7]] = [rows[d]["pl"], rows[d]["cot"]]
        # Data de início: início de atividade no cadastro legado (anterior à adaptação RCVM 175) ou data de início da classe.
        inicio = None
        if reg:
            inicio = reg.get("legado_inicio_atividade") or reg.get("data_inicio") or reg.get("data_constituicao")
        flows = mt.flows(axis, i_base, rows)
        issues = qc.for_fund(f["id"])
        cart = carteiras.get(f["id"])
        if cart:
            for k in ("ultima", "completa"):
                if cart.get(k):
                    cart[k]["top_direta"] = cart[k]["top_direta"][:15]
        out_funds.append({
            "carteira": cart,
            "id": f["id"], "nome": f["nome"], "cnpj": format_cnpj(f["cnpj"]), "gestora_id": f["gestora_id"],
            "categoria": f["categoria"], "familia": f.get("familia"), "estrutura": f.get("estrutura"),
            "benchmark_id": bid, "alvo_tipo": f.get("alvo_tipo"), "alvo": f.get("alvo"),
            "cot_apl": f.get("cotizacao_aplicacao_d"), "cot_resg": f.get("cotizacao_resgate_d"),
            "liq_resg": f.get("liquidacao_resgate_d"), "prazo_tipo": f.get("prazo_tipo"),
            "taxa_adm": f.get("taxa_adm_pct"), "taxa_perf": f.get("taxa_perf_pct"), "taxa_perf_indice": f.get("taxa_perf_indice"),
            "qualificado": f["publico_qualificado"], "previdencia": f["versao_previdencia"], "isento_ir": f["isento_ir_pf"],
            "risco_lamina": f.get("risco_lamina"), "descricao": f.get("descricao"),
            "fonte_cadastro": f.get("fonte_cadastro"), "data_fonte_cadastro": f.get("data_fonte_cadastro"),
            "cvm": {k: (reg or {}).get(k) for k in ("denominacao", "situacao", "administrador", "gestor", "classificacao_anbima",
                                                     "classificacao_cvm", "publico_alvo", "tributacao_lp", "tipo_fundo", "fonte")},
            "inicio": inicio,
            "primeira_cota": min(rows) if rows else None, "ultima_cota": max(rows) if rows else None,
            "ret": ret, "risk": risk, "flow": flows,
            "mensal": {k: [monthly_f[k], monthly_b.get(k)] for k in monthly_f},
            "anual": {k: [yearly_f[k], yearly_b.get(k)] for k in yearly_f},
            "pl_mensal": pl_m,
            "serie": {"i0": fi, "q": q[fi:] if fi is not None else []},
            "qc": [{"nivel": i["nivel"], "codigo": i["codigo"], "mensagem": i["mensagem"]} for i in issues],
        })

    log("   Fundos de mercado (página Comparação)…")
    mkt_meta = mercado.build(axis, i_base, cdi_idx, bench_series, bench_is_market, months, fundos, rnd, clean)

    log("5/6 Montando dataset…")
    cats = [c for c in config.CATEGORY_ORDER if any(f["categoria"] == c for f in out_funds)]
    cats += sorted({f["categoria"] for f in out_funds} - set(cats))
    dataset = {
        "meta": {
            "gerado_em": datetime.now().isoformat(timespec="seconds"),
            "data_base": iso(db),
            "data_base_modo": modo if modo in ("fechamento", "ultima") else "data informada",
            "cdi_fonte": benches["CDI"]["meta"].get("fonte_efetiva") or "cache",
            "cdi_ultima_data": benches["CDI"]["meta"].get("ultima_data"),
            "cvm_arquivos": f"inf_diario_fi_{months[0]}…{months[-1]}",
            "janelas": config.RETURN_WINDOWS, "janelas_risco": config.RISK_WINDOWS,
            "dias_uteis_ano": config.BUSINESS_DAYS_YEAR, "fontes": config.SOURCES,
            "categorias": cats,
            "mercado": mkt_meta,
        },
        "gestoras": [{k: g.get(k) for k in ("gestora_id", "nome", "cnpj_gestor", "site")} for g in gestoras],
        "benchmarks": bench_meta,
        "eixo": axis_iso,
        "bench_series": {k: [rnd(v, 10) for v in s] for k, s in bench_series.items()},
        "fundos": out_funds,
        "qualidade": qc.items,
    }
    dataset = clean(dataset)
    config.DATASET_JS.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(dataset, ensure_ascii=False, separators=(",", ":"))
    config.DATASET_JS.write_text("/* Gerado por pipeline/build.py — não editar manualmente. */\nwindow.FUNDS_DATASET=" + payload + ";\n", encoding="utf-8")
    log(f"  {config.DATASET_JS} ({len(payload) / 1e6:.2f} MB)")
    # Configuração do site: versão local sem downloads (o GitHub Actions sobrescreve na publicação).
    site_js = "window.SITE_CONFIG = window.SITE_CONFIG || {downloads: false};\n"
    (config.DATASET_JS.parent / "site.js").write_text(site_js, encoding="utf-8")

    log("6/6 Exportando planilha consolidada e relatório em arquivo único…")
    config.OUTPUT_DIR.mkdir(exist_ok=True)
    xlsx = export_xlsx.export(dataset, config.OUTPUT_DIR / f"base_fundos_{db.strftime('%Y%m%d')}.xlsx", carteiras_full)
    log(f"  {xlsx}")
    import bundle  # noqa: E402
    html = bundle.build(config.OUTPUT_DIR / f"Relatorio_Fundos_{db.strftime('%Y%m%d')}.html")
    log(f"  {html}")

    lv = {"erro": 0, "alerta": 0, "info": 0}
    for i in qc.items:
        lv[i["nivel"]] += 1
    log(f"Qualidade: {lv['erro']} erro(s), {lv['alerta']} alerta(s), {lv['info']} informativo(s). Detalhes na aba 'Qualidade' da planilha e na seção Metodologia do dashboard.")


if __name__ == "__main__":
    main()
