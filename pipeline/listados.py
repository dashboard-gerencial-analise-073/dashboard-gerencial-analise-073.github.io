"""Fundos listados na B3 (FII, Fiagro, FI-Infra, ETF): página Renda e busca da página Comparação.

Metodologia (docs/METODOLOGIA.md, seção 9):
- Preço = fechamento oficial da B3 (COTAHIST), ajustado por desdobramentos/grupamentos (eventos da B3).
- Retorno total = variação do preço + proventos reinvestidos na data ex (1º pregão após a data-com):
  RT_j = RT_k × (P_j + D) / P_k, entre pregões consecutivos k < j com negócio, D = proventos com data-com em [k, j).
- Proventos (R$/cota, data-com): eventos corporativos da B3 (janela de ~12 meses, acumulada entre execuções) e,
  antes dela, avisos estruturados do Fundos.NET (FII e Fiagro). Fora da cobertura comprovada = N/D (nunca zero).
- DY de um período = proventos com data-com no período ÷ preço de fechamento no início do período.
  DY 12M (sobre o preço atual) = proventos dos últimos 12 meses ÷ preço na data-base.
- Preço numa data = último fechamento em até MAX_QUOTE_LOOKBACK_DAYS pregões antes (fundos pouco negociados).
- Risco (volatilidade, drawdown, Sharpe vs CDI) só com pregões consecutivos negociados; cobertura mínima de 90%.

Saída (carregada sob demanda):
  dashboard/data/listados/indice.js   -> ranking e busca (resumo de todos os fundos)
  dashboard/data/listados/s/NNN.js    -> lotes com séries, proventos e tabelas mês a mês
"""
import json
import math
import re
from collections import defaultdict
from datetime import date

import b3
import config
import mercado
import metrics as mt
from util import add_months, format_cnpj, iso, log, month_end

TIPO_LABEL = {"FII": "FII", "FIAGRO": "Fiagro", "FIAGRO-FII": "Fiagro", "FI-INFRA": "FI-Infra", "ETF": "ETF",
              "ETF-RF": "ETF", "ETF-FII": "ETF", "ETF-INT-RF": "ETF", "ETF-MOEDA": "ETF", "ETF-CRIPTO": "ETF"}
SUBTIPO = {"ETF": "ETF de renda variável", "ETF-RF": "ETF de renda fixa", "ETF-FII": "ETF de FII", "ETF-INT-RF": "ETF de renda fixa internacional",
           "ETF-MOEDA": "ETF de moeda", "ETF-CRIPTO": "ETF de criptoativos", "FIAGRO-FII": "Fiagro imobiliário"}
FNET_TIPOS = {"FII", "FIAGRO", "FIAGRO-FII"}  # tipos com avisos estruturados de rendimentos no Fundos.NET
ND_PROV = "Histórico de proventos ainda não coberto pelas fontes oficiais neste período"


NOME_RUIDO = [
    r"FUNDOS? DE INVESTIMENTOS? NAS CADEIAS PRODUTIVAS (DO |DA )?AGRO\w*( [A-ZÀ-Ú]+)?",
    r"(EM COTAS DE )?FUNDOS? INCENTIVADOS? DE INVESTIMENTO EM INFRA\w*",
    r"F\. DE IN\. EM C\. DE F\. INCENTIVADOS INFRA",
    r"FUNDOS? DE INVESTIMENTOS? EM COTAS DE FUNDOS? DE INVESTIMENTOS?",
    r"FUNDOS? DE INVESTIMENTOS? IMOBILI[AÁ]RIOS?", r"FUNDOS? DE INVESTIMENTOS?",
    r"CLASSES? [A-Z] DE COTAS (DO|DA|DE)", r"CLASSES?( ÚNICA| UNICA)?( DE COTAS| DE ÍNDICE| DE INDICE)?( DO| DE| DA)?",
    r"FUNDOS? DE [IÍ]NDICE", r"DE [IÍ]NDICE", r"EM COTAS DE( FUNDOS?)?", r"EM INFRA\w*", r"FIC DE FIF",
    r"RESPONSABILI\w*( L\w*)?", r"RESP\.?( L\w*)?", r"RL",
    r"FII", r"FIAGRO", r"FI-?INFRA", r"FIIF", r"FIC", r"CIC", r"FIF", r"FI", r"FINANCEIRO", r"IE",
    r"IMOBILI[AÁ]RIO", r"RENDA FIXA", r"RF", r"CR[EÉ]D(ITO)?\.? PRIV(ADO)?",
]
# Cada termo só casa como palavra inteira; espaços aceitam qualquer espaçamento.
NOME_RUIDO_RE = [re.compile(r"(?<!\w)" + p.replace(" ", r"\s+") + r"(?![\w.])") for p in NOME_RUIDO]
CONECT = {"DE", "DA", "DO", "EM", "E", "–", "-", "S.A.", "S/A"}


def nome_listado(den, fallback):
    """Nome curto e legível a partir da denominação (remove termos jurídicos e de tipo de fundo)."""
    s = " " + " ".join((den or "").upper().split()) + " "
    for p in NOME_RUIDO_RE:
        s = p.sub(" ", s)
    toks = [t for t in s.replace(" - ", " – ").split() if t]
    out = []
    for t in toks:  # remove conectores repetidos e travessões soltos
        if t in ("–", "-") and (not out or out[-1] in ("–", "-")):
            continue
        out.append(t)
    while out and out[-1] in CONECT:
        out.pop()
    while out and out[0] in CONECT:
        out.pop(0)
    txt = " ".join(out).title()
    for a, b in ((" De ", " de "), (" Da ", " da "), (" Do ", " do "), (" Em ", " em "), (" E ", " e "), (" Das ", " das "), (" Dos ", " dos ")):
        txt = txt.replace(a, b)
    return txt or fallback


def ym(d):
    return d[:7] if isinstance(d, str) else f"{d.year}-{d.month:02d}"


def ym_add(k, n):
    y, m = int(k[:4]), int(k[5:7]) - 1 + n
    return f"{y + m // 12}-{m % 12 + 1:02d}"


def split_multiplier(ev):
    """Quantidade de cotas após o evento ÷ antes (eventos de quantidade da B3)."""
    f = ev.get("fator")
    if not f:
        return None
    if ev["tipo"] in ("DESDOBRAMENTO", "BONIFICACAO"):
        return 1 + f / 100          # fator em % (900 = cada cota vira 10)
    if ev["tipo"] == "GRUPAMENTO":
        return f                    # fator = cotas novas por cota antiga (0,1 = 10 viram 1)
    return None                     # outros (cisão, resgate de recibos): sem regra -> conferido pelo preço


def b3_window_start(primeira_coleta):
    """Primeira data-com coberta pelos eventos da B3: 365 dias antes da primeira coleta (janela de 12 meses)."""
    return date.fromordinal(date.fromisoformat(primeira_coleta).toordinal() - 365).isoformat()


def fnet_coverage(meses_completos, ate):
    """Mês (AAAA-MM) a partir do qual os proventos do Fundos.NET estão completos até `ate` (exclusive).

    Um mês de data-com m exige os meses de entrega m-1, m e m+1 lidos por completo.
    """
    m = ym_add(ate, -1)
    start = None
    while all(ym_add(m, k) in meses_completos for k in (-1, 0, 1)):
        start = m
        m = ym_add(m, -1)
    return start


def _carry(series, n):
    """Último valor em até n posições antes (preço de referência de fundos pouco negociados)."""
    out, last, age = [], None, 0
    for v in series:
        if v is not None:
            last, age = v, 0
        else:
            age += 1
        out.append(last if (last is not None and age <= n) else None)
    return out


def build(axis, i_base, cdi_idx, cvm_months, rnd, clean, offline=False, qc_global=None):
    cfg = config.LISTADOS
    out_dir = config.DASHBOARD_DIR / "data" / "listados"
    if not cfg.get("ativo"):
        for old in out_dir.rglob("*.js"):
            old.unlink()
        return None, None
    today = date.today()
    db = axis.dates[i_base]
    db_iso = iso(db)
    axis_iso = [iso(d) for d in axis.dates]
    pos = {d: i for i, d in enumerate(axis_iso)}
    n = len(axis_iso)
    hist0 = axis_iso[0]

    # ------------------------------------------------ coleta
    tipos = list(cfg["tipos"])
    uni = [u for u in b3.universe(tipos, offline=offline) if u.get("ticker") and u["tipo_b3"] in tipos]
    ev, coletas = b3.events([u["acronym"] for u in uni], offline=offline)
    px = b3.prices({u["ticker"] for u in uni}, axis.dates[0], today, offline=offline)
    # Fundos.NET: meses de entrega desde o início do histórico até o fim da janela da B3 (mais recentes primeiro).
    b3_first = min((c["primeira"] for c in coletas.values()), default=today.isoformat())
    b3_start_global = ym(b3_window_start(b3_first))
    meses = []
    k = ym_add(ym(hist0), -1)
    while k <= ym_add(b3_start_global, 1):
        meses.append(k)
        k = ym_add(k, 1)
    fdocs, fcomp = b3.fnet(meses, cfg["fnet_orcamento_min"] * 60, cfg["fnet_threads"], offline=offline)
    cvm_m = b3.cvm_mensal(db, offline=offline)
    register = mercado.read_register_all()
    # Cota patrimonial (VP) de ETF/FI-Infra: informe diário da CVM no mês da data-base.
    want_daily = {u["cnpj"] for u in uni if u.get("cnpj") and u["cnpj"] not in cvm_m}
    z = config.CVM_DIR / f"inf_diario_fi_{db_iso[:4]}{db_iso[5:7]}.zip"
    daily = mercado._parse_month(z, want_daily, {}) if z.exists() and want_daily else {}

    # Proventos do Fundos.NET por ISIN/ticker: documento mais recente vence para a mesma (data-com, tipo).
    fnet_by = defaultdict(dict)
    for did, d in sorted(fdocs.items(), key=lambda kv: (kv[1].get("entrega") or "", kv[1].get("versao") or 0, int(kv[0]))):
        agg = defaultdict(float)
        meta = {}
        for p in d["proventos"]:
            key = (p["isin"] or p["ticker"], p["data_com"], p["tipo"])
            agg[key] += p["valor"]
            meta[key] = p
        for key, v in agg.items():
            p = meta[key]
            rec = {"data_com": p["data_com"], "valor": v, "tipo": p["tipo"], "pagamento": p["pagamento"], "fonte": "Fundos.NET",
                   "doc": did, "isento": p.get("isento")}
            for ident in {p["isin"], p["ticker"]} - {None, ""}:
                fnet_by[ident][(p["data_com"], p["tipo"])] = rec
    fnet_cov = fnet_coverage(fcomp, b3_start_global)
    log(f"  listados: {len(uni)} fundos com ticker; Fundos.NET: {len(fdocs)} avisos lidos"
        + (f", proventos completos desde {fnet_cov}" if fnet_cov else ", histórico ainda incompleto"))

    i12 = axis.last_on_or_before(add_months(db, -12))
    i3 = axis.last_on_or_before(add_months(db, -3))
    shards, index = {}, []
    resumo, prov_rows = [], []  # planilha consolidada (abas Listados_Renda e Listados_Proventos)
    shard_n = cfg["shards"]
    windows = config.RETURN_WINDOWS
    lb = config.MAX_QUOTE_LOOKBACK_DAYS
    stats = defaultdict(int)

    for u in sorted(uni, key=lambda x: x["ticker"]):
        t = u["ticker"]
        rows = {d: r for d, r in px.get(t, {}).items() if d in pos}
        if not rows:
            stats["sem_negocio"] += 1
            continue
        last_trade = max(rows)
        if pos[last_trade] < i_base - 21 or last_trade > db_iso:
            # Sem negócio no último mês até a data-base: preço defasado, fora do ranking.
            if last_trade <= db_iso:
                stats["sem_negocio_recente"] += 1
                continue
        isin = rows[max(d for d in rows if d <= db_iso)][3] if any(d <= db_iso for d in rows) else None
        if not isin:
            continue
        qc = []
        raw = [None] * n
        vol = [0.0] * n
        for d, r in rows.items():
            if d <= db_iso:
                raw[pos[d]] = r[0]
                vol[pos[d]] = r[1]
        traded = [i for i in range(n) if raw[i] is not None]
        if not traded:
            continue

        # Eventos de quantidade (cota principal): multiplicador aplicado do 1º pregão após a data-com.
        fe = ev.get(u["acronym"], {"cash": [], "stock": []})
        splits = []
        for s in fe["stock"]:
            if s["isin"] != isin or not s["data_com"] or s["data_com"] < hist0 or s["data_com"] >= db_iso:
                continue
            mlt = split_multiplier(s)
            splits.append((s["data_com"], mlt, s["tipo"]))
        # Preço ajustado (base atual de cotas): divide pelo produto dos eventos posteriores.
        adj = [None] * n
        cum = 1.0
        events_at = {}
        for dc, mlt, tp in sorted(splits, reverse=True):
            ex_i = next((i for i in traded if axis_iso[i] > dc), None)
            if ex_i is None:
                continue
            events_at[ex_i] = (mlt, tp, dc)
        cut = None
        for i in reversed(traded):
            adj[i] = raw[i] / cum
            if i in events_at:
                mlt = events_at[i][0]
                k_prev = max((j for j in traded if j < i), default=None)
                if k_prev is not None:
                    obs = raw[k_prev] / raw[i]   # salto de preço observado no evento
                    if mlt is None or abs(obs / mlt - 1) > 0.30:
                        # Evento sem regra conhecida ou salto incompatível com o fator: série só após o evento.
                        cut = i
                        qc.append({"nivel": "alerta", "codigo": "EVENTO_COTAS",
                                   "mensagem": f"{events_at[i][1].title()} com data-com {events_at[i][2]}: variação de preço incompatível com o fator informado pela B3; série considerada a partir de {axis_iso[i]}."})
                        break
                    cum *= mlt
        if cut is not None:
            for i in range(cut):
                adj[i] = None
            traded = [i for i in traded if i >= cut]
        # Saltos sem evento (> 50% em um pregão): série só depois deles (dado suspeito, não corrigível).
        jumps = [(b_, adj[b_] / adj[a] - 1) for a, b_ in zip(traded, traded[1:]) if b_ not in events_at and abs(adj[b_] / adj[a] - 1) > 0.5]
        if jumps:
            b_, var = jumps[-1]
            for i in range(b_):
                adj[i] = None
            qc.append({"nivel": "alerta", "codigo": "SALTO_PRECO", "mensagem": f"Variação de {var:+.0%} em {axis_iso[b_]} sem evento de cotas informado pela B3: série considerada a partir dessa data."})
        traded = [i for i in traded if adj[i] is not None]
        if not traded:
            continue
        def adj_factor(dc):
            f = 1.0
            for i, (mlt, _, _) in events_at.items():
                if mlt and axis_iso[i] > dc and (cut is None or i >= cut):
                    f *= mlt
            return f

        # ------------------------------------------------ proventos
        tipo = u["tipo_b3"]
        # Janela da B3: proventos com data-com a partir de 365 dias antes da primeira coleta deste fundo.
        b3_from = b3_window_start((coletas.get(u["acronym"]) or {}).get("primeira", today.isoformat()))
        provs = {}
        for c in fe["cash"]:
            if c["isin"] == isin and c["data_com"] and c["data_com"] >= b3_from and c["data_com"] <= db_iso:
                key = (c["data_com"], "AMORTIZACAO" if c["tipo"].startswith("AMORT") else "RENDIMENTO")
                cur = provs.get(key)
                provs[key] = {"data_com": c["data_com"], "valor": (cur["valor"] if cur else 0) + c["valor"], "tipo": key[1],
                              "pagamento": c["pagamento"], "fonte": "B3"}
        cov = b3_from
        if tipo in FNET_TIPOS and fnet_cov:
            fn = {**fnet_by.get(t, {}), **fnet_by.get(isin, {})}
            for (dc, tp), r in fn.items():
                if dc < b3_from and ym(dc) >= fnet_cov and dc <= db_iso:
                    provs[(dc, tp)] = r
            # Conferência na sobreposição (quando houver avisos do Fundos.NET lidos dentro da janela da B3).
            over = [(k, r) for k, r in fn.items() if k[0] >= b3_from and k[0] <= db_iso and ym(k[0]) <= ym_add(b3_start_global, 1)]
            dif = [k for k, r in over if k in provs and abs(provs[k]["valor"] - r["valor"]) > 1e-6]
            if dif:
                qc.append({"nivel": "info", "codigo": "PROVENTO_DIVERGENTE", "mensagem": f"{len(dif)} provento(s) com valor diferente entre a B3 e o aviso do Fundos.NET (ex.: data-com {dif[0][0]}); usado o valor da B3."})
            cov = min(b3_from, fnet_cov + "-01")
        # cov = data a partir da qual todos os proventos (data-com) são conhecidos.
        events_list = sorted(provs.values(), key=lambda r: r["data_com"])
        for r in events_list:
            r["valor_adj"] = r["valor"] / adj_factor(r["data_com"])

        # ------------------------------------------------ retorno total (proventos reinvestidos)
        tr = [None] * n
        start_tr = next((i for i in traded if axis_iso[i] >= cov), None)
        if start_tr is not None:
            tr[start_tr] = adj[start_tr]
            k_prev = start_tr
            ei = 0
            evs = [(r["data_com"], r["valor_adj"]) for r in events_list]
            while ei < len(evs) and evs[ei][0] < axis_iso[start_tr]:
                ei += 1
            for i in traded:
                if i <= start_tr:
                    continue
                dsum = 0.0
                while ei < len(evs) and evs[ei][0] < axis_iso[i]:
                    if evs[ei][0] >= axis_iso[k_prev]:
                        dsum += evs[ei][1]
                    ei += 1
                tr[i] = tr[k_prev] * (adj[i] + dsum) / adj[k_prev]
                k_prev = i
        # ETF sem nenhum provento registrado pela B3: a série principal é a variação da cota (preço), declarada como tal.
        # Distribuições anteriores à janela da B3, se existirem, não estão incluídas (aviso no fundo).
        base_preco = tipo.startswith("ETF") and not events_list
        if base_preco:
            tr = list(adj)
            qc.append({"nivel": "info", "codigo": "ETF_BASE_PRECO", "mensagem": f"Sem proventos registrados pela B3 desde {cov[8:]}/{cov[5:7]}/{cov[:4]}: rentabilidade = variação da cota (preço de fechamento). Distribuições anteriores, se houver, não estão incluídas."})
        adj_c, tr_c = _carry(adj, lb), _carry(tr, lb)
        ret, _ = mt.fund_metrics(axis, i_base, tr_c, None, cdi_idx, windows, [], False)
        _, risk = mt.fund_metrics(axis, i_base, tr, None, cdi_idx, windows, config.RISK_WINDOWS, False)
        retp, _ = mt.fund_metrics(axis, i_base, adj_c, None, cdi_idx, windows, [], False)
        for wid, r in ret.items():  # referência: CDI no mesmo período (não é benchmark do fundo)
            w = next(w for w in windows if w["id"] == wid)
            i0, i1 = mt.window_indices(axis, i_base, w)
            rc, _ = mt.period_return(cdi_idx, i0, i1, 0)
            r["cdi"] = rc
            if r.get("f") is not None and rc is not None:
                r["x_cdi"] = r["f"] - rc
            if r.get("nd") == mt.ND_HIST and retp.get(wid, {}).get("f") is not None:
                r["nd"] = ND_PROV
        fi_tr = mt.first_index(tr_c)
        fi_px = mt.first_index(adj_c)
        m_tr = mt.monthly_table(axis, tr_c, fi_tr, i_base) if fi_tr is not None else {}
        m_px = mt.monthly_table(axis, adj_c, fi_px, i_base) if fi_px is not None else {}
        y_tr = mt.yearly_table(axis, tr_c, fi_tr, i_base) if fi_tr is not None else {}
        y_px = mt.yearly_table(axis, adj_c, fi_px, i_base) if fi_px is not None else {}

        # ------------------------------------------------ renda mês a mês e anual
        def price_at_month_end(k):
            y, m = int(k[:4]), int(k[5:7])
            i = axis.last_on_or_before(month_end(y, m))
            return adj_c[i] if i is not None else None

        prov_m = defaultdict(float)
        amort_m = defaultdict(float)
        npag_m = defaultdict(int)
        for r in events_list:
            k = ym(r["data_com"])
            if r["tipo"] == "AMORTIZACAO":
                amort_m[k] += r["valor_adj"]
            else:
                prov_m[k] += r["valor_adj"]
                npag_m[k] += 1
        months_all = []
        k = ym(axis_iso[fi_px]) if fi_px is not None else ym(db_iso)
        while k <= ym(db_iso):
            months_all.append(k)
            k = ym_add(k, 1)
        meses = {}
        for k in months_all:
            covered = k + "-01" >= cov
            p0 = price_at_month_end(ym_add(k, -1))
            pv = prov_m.get(k, 0.0) if covered else None
            am = amort_m.get(k, 0.0) if covered else None
            dy = (pv / p0) if (pv is not None and p0) else None
            meses[k] = [rnd(pv, 6), rnd(dy, 6), rnd(m_px.get(k), 6), rnd(m_tr.get(k), 6), rnd(am, 6) if am else (0 if covered else None)]
        anos = {}
        for y in sorted({k[:4] for k in months_all}):
            ks = [k for k in months_all if k[:4] == y]
            covered = all(k + "-01" >= cov for k in ks)
            p0 = price_at_month_end(f"{int(y) - 1}-12") if f"{int(y) - 1}-12" >= ym(axis_iso[fi_px] if fi_px is not None else db_iso) else None
            pv = sum(prov_m.get(k, 0.0) for k in ks) if covered else None
            anos[y] = [rnd(pv, 6), rnd(pv / p0, 6) if (pv is not None and p0) else None, rnd(y_px.get(y), 6), rnd(y_tr.get(y), 6), len(ks)]

        # ------------------------------------------------ indicadores de renda
        p_db = adj_c[i_base]
        k_db = ym(db_iso)
        last12 = [ym_add(k_db, -j) for j in range(11, -1, -1)]
        last24 = [ym_add(k_db, -j) for j in range(23, -1, -1)]
        cov12 = last12[0] + "-01" >= cov
        cov24 = last24[0] + "-01" >= cov
        pv12 = [prov_m.get(k, 0.0) for k in last12] if cov12 else None
        renda = {"cobertura": cov, "preco": rnd(p_db, 6), "preco_data": axis_iso[max(i for i in traded if i <= i_base)]}
        if pv12 is not None:
            s12 = sum(pv12)
            renda.update({"prov12": rnd(s12, 6), "dy12": rnd(s12 / p_db, 6) if p_db else None, "meses_pag12": sum(1 for v in pv12 if v > 0),
                          "prov_med12": rnd(s12 / 12, 6), "prov_min12": rnd(min(pv12), 6), "prov_max12": rnd(max(pv12), 6),
                          "amort12": rnd(sum(amort_m.get(k, 0.0) for k in last12), 6)})
            mean = s12 / 12
            if mean > 0:
                sd = math.sqrt(sum((v - mean) ** 2 for v in pv12) / 11)
                renda["cv12"] = rnd(sd / mean, 6)
                a, b_ = sum(pv12[6:]) / 6, sum(pv12[:6]) / 6
                renda["tend6"] = rnd(a / b_ - 1, 6) if b_ > 0 else None
        if cov24:
            pv24 = [prov_m.get(k, 0.0) for k in last24]
            renda["prov24"] = rnd(sum(pv24), 6)
            renda["meses_pag24"] = sum(1 for v in pv24 if v > 0)
        for w in windows:  # DY do período (sobre o preço no início)
            if w["type"] != "months":
                continue
            i0, _ = mt.window_indices(axis, i_base, w)
            ks = [ym_add(k_db, -j) for j in range(w["n"] - 1, -1, -1)]
            if ks[0] + "-01" >= cov and i0 is not None and adj_c[i0]:
                renda["dy_" + w["id"]] = rnd(sum(prov_m.get(k, 0.0) for k in ks) / adj_c[i0], 6)
        if events_list:
            le = events_list[-1]
            renda["ultimo"] = {"data_com": le["data_com"], "pagamento": le.get("pagamento"), "valor": rnd(le["valor_adj"], 6), "tipo": le["tipo"], "fonte": le["fonte"]}
            isentos = [r.get("isento") for r in events_list if r.get("isento") is not None]
            if isentos:
                renda["isento_ir"] = all(isentos)
        # Liquidez
        liq = {}
        for nome, i0 in (("3m", i3), ("12m", i12)):
            if i0 is not None and fi_px is not None and fi_px <= i0:
                dias = i_base - i0
                liq["vol_" + nome] = rnd(sum(vol[i0 + 1:i_base + 1]) / dias, 6)
                liq["pregoes_" + nome] = rnd(sum(1 for i in range(i0 + 1, i_base + 1) if raw[i] is not None) / dias, 4)
        # Patrimônio e VP (CVM)
        c = u.get("cnpj")
        cm = cvm_m.get(c) if c else None
        reg = register.get(c) if c else None
        vp = vp_data = pl = cotistas = None
        fonte_vp = None
        if cm:
            vp, vp_data, pl, cotistas, fonte_vp = cm.get("vp_cota"), cm.get("mes"), cm.get("pl"), cm.get("cotistas"), cm.get("fonte")
        elif c in daily and daily[c]:
            last = [r for r in daily[c] if r[0] <= db_iso][-1:]
            if last:
                vp_data, vp, pl, cotistas = last[0][0], last[0][1], last[0][2], last[0][4]
                fonte_vp = "CVM — Informe diário"
        # VP na base atual de cotas: divide pelos eventos de cotas com data ex posterior à data do VP.
        if vp and p_db:
            vp_ref = vp_data if len(vp_data or "") == 10 else iso(month_end(int(vp_data[:4]), int(vp_data[5:7])))
            vp_adj = vp / adj_factor(vp_ref)
            pvp = p_db / vp_adj if vp_adj > 0 else None
            if pvp is None or not 0.1 <= pvp <= 10:
                # Cota patrimonial incompatível com o preço (base de cotas ou unidade diferente): não exibe.
                qc.append({"nivel": "alerta", "codigo": "PVP_INCOERENTE", "mensagem": f"Valor patrimonial da cota informado à CVM (R$ {vp:,.4f}, {vp_data}) incompatível com o preço de mercado; P/VP não exibido."})
            else:
                renda.update({"pvp": rnd(pvp, 6), "vp": rnd(vp_adj, 6), "vp_data": vp_data, "vp_fonte": fonte_vp})
                if not 0.3 <= pvp <= 3:
                    qc.append({"nivel": "info", "codigo": "PVP_ATIPICO", "mensagem": f"P/VP de {pvp:.2f} (VP {vp_data}, {fonte_vp}) — fora da faixa usual; conferir."})
        if not events_list and cov12:
            renda["sem_proventos"] = True
        if not cov12 and not base_preco:
            qc.append({"nivel": "info", "codigo": "PROVENTOS_PARCIAIS", "mensagem": f"Proventos disponíveis para data-com a partir de {cov[8:]}/{cov[5:7]}/{cov[:4]} "
                       + ("(janela de eventos corporativos da B3; o histórico cresce a cada atualização)." if tipo not in FNET_TIPOS else "(avisos do Fundos.NET ainda em coleta).")
                       + " Retorno total e DY de períodos anteriores aparecem como N/D."})
        segmento = (cm or {}).get("segmento") or SUBTIPO.get(tipo)
        nome = u["nome_pregao"]
        den = (reg or {}).get("denominacao") or u["nome"]
        fid = "l:" + t
        f = {
            "id": fid, "listado": True, "ticker": t, "tipo": TIPO_LABEL[tipo], "tipo_b3": tipo, "subtipo": SUBTIPO.get(tipo),
            "nome": f"{t} · {nome_listado(den, nome)}", "nome_pregao": nome, "cnpj": format_cnpj(c) if c else None,
            "gestora_id": None, "categoria": TIPO_LABEL[tipo] + (f" · {segmento}" if segmento and segmento != SUBTIPO.get(tipo) else (f" · {SUBTIPO[tipo]}" if tipo in SUBTIPO else "")),
            "segmento": segmento, "benchmark_id": None, "isin": isin,
            "cvm": {"denominacao": den, "administrador": (reg or {}).get("administrador") or (cm or {}).get("administrador") or u.get("administrador"),
                    "gestor": (reg or {}).get("gestor") or (cm or {}).get("gestor"), "classificacao_anbima": (reg or {}).get("anbima") or segmento,
                    "publico_alvo": (reg or {}).get("publico") or (cm or {}).get("publico"), "mandato": (cm or {}).get("mandato"),
                    "gestao": (cm or {}).get("gestao"), "fonte": "B3 / CVM"},
            # Início: data de funcionamento do informe mensal de FII (o cadastro RCVM 175 traz a data de adaptação da classe).
            "inicio": (cm or {}).get("inicio"), "base_ret": "preco" if base_preco else "total", "primeira_cota": axis_iso[fi_tr] if fi_tr is not None else None, "ultima_cota": renda["preco_data"],
            "ret": ret, "ret_preco": retp, "risk": risk,
            "flow": {"pl": pl, "cotistas": cotistas, "data": vp_data},
            "liq": liq, "renda": renda,
            "mensal": {k: [m_tr[k], None] for k in m_tr},
            "meses": meses, "anos": anos,
            "proventos": [[r["data_com"], r.get("pagamento"), rnd(r["valor_adj"], 8), r["tipo"][0], r["fonte"][0]] for r in events_list],
            "serie": {"i0": fi_tr, "q": [rnd(v, 8) for v in tr_c[fi_tr:]]} if fi_tr is not None else {"i0": None, "q": []},
            "serie_preco": {"i0": fi_px, "q": [rnd(v, 8) for v in adj_c[fi_px:]]},
            "qc": qc,
        }
        sh = len(index) % shard_n
        shards.setdefault(sh, {})[fid] = clean(f)
        g = lambda d, k: (d or {}).get(k)  # noqa: E731
        index.append([fid, t, f["nome"], f["tipo"], segmento or "", rnd(p_db, 6), g(renda, "dy12"), g(renda, "prov12"), g(renda, "meses_pag12"),
                      rnd(g(retp.get("12m"), "f"), 6), rnd(g(ret.get("12m"), "f"), 6), rnd(g(ret.get("36m"), "fa"), 6), g(renda, "pvp"),
                      g(liq, "vol_3m"), rnd(pl, 6), rnd(g(risk.get("12m"), "vol"), 6), sh, f["cnpj"] or "", ((f["cvm"] or {}).get("gestor") or (f["cvm"] or {}).get("administrador") or "")[:60],
                      cov, 1 if renda.get("sem_proventos") else 0, g(renda, "cv12"), rnd(g(ret.get("24m"), "fa"), 6), tipo, len(events_list)])
        stats[TIPO_LABEL[tipo]] += 1
        r12, rp12 = ret.get("12m", {}), retp.get("12m", {})
        resumo.append([t, f["nome"], f["tipo"], segmento, f["cnpj"], isin, renda.get("preco"), renda["preco_data"], renda.get("dy12"),
                       renda.get("prov12"), renda.get("meses_pag12"), renda.get("cv12"), renda.get("amort12"), rp12.get("f"), r12.get("f"),
                       r12.get("cdi"), (ret.get("24m") or {}).get("fa"), (ret.get("36m") or {}).get("fa"), (risk.get("12m") or {}).get("vol"),
                       renda.get("pvp"), renda.get("vp_data"), liq.get("vol_3m"), liq.get("vol_12m"), pl, cotistas, cov,
                       "; ".join(q["mensagem"] for q in qc if q["nivel"] != "info")])
        prov_rows += [[t, r["data_com"], r.get("pagamento"), r["valor"], r["valor_adj"], r["tipo"].title(), r["fonte"], r.get("doc")] for r in events_list]

    for old in out_dir.rglob("*.js"):
        old.unlink()
    (out_dir / "s").mkdir(parents=True, exist_ok=True)
    for sh, funds in shards.items():
        (out_dir / "s" / f"{sh:03d}.js").write_text(
            f"window.__LST_SHARD({sh},{json.dumps(funds, ensure_ascii=False, separators=(',', ':'))});\n", encoding="utf-8")
    campos = ["id", "ticker", "nome", "tipo", "segmento", "preco", "dy12", "prov12", "meses_pag12", "var12", "rt12", "rt36a", "pvp",
              "liq3m", "pl", "vol12", "lote", "cnpj", "gestor", "cobertura", "sem_proventos", "cv12", "rt24a", "tipo_b3", "n_prov"]
    meta = {"data_base": db_iso, "n": len(index), "campos": campos, "por_tipo": {k: v for k, v in stats.items() if k in TIPO_LABEL.values()},
            "fnet_cobertura": fnet_cov, "b3_cobertura": b3_start_global, "fnet_avisos": len(fdocs),
            "excluidos_sem_negocio": stats["sem_negocio"] + stats["sem_negocio_recente"]}
    (out_dir / "indice.js").write_text(
        f"window.__LST_INDEX({json.dumps({'meta': meta, 'fundos': index}, ensure_ascii=False, separators=(',', ':'))});\n", encoding="utf-8")
    total = sum(p.stat().st_size for p in out_dir.rglob("*.js"))
    log(f"  listados: {len(index)} fundos publicados ({', '.join(f'{k} {v}' for k, v in meta['por_tipo'].items())}) em {len(shards)} lotes ({total / 1e6:.1f} MB)")
    if qc_global is not None and not fnet_cov:
        qc_global.add("info", None, "FNET_INCOMPLETO", "Histórico de proventos do Fundos.NET ainda em coleta: retorno total de FII/Fiagro limitado à janela da B3 nesta versão.")
    return meta, {"resumo": resumo, "proventos": prov_rows}
