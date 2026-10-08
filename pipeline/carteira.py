"""Carteiras abertas — CVM, Composição e Diversificação das Aplicações (CDA).

- Fonte: dados.cvm.gov.br/dados/FI/DOC/CDA (mensal; blocos BLC_1..8 + CONFID + PL).
- "Última carteira aberta" de um fundo = mês mais recente em que ele divulgou posições.
- Posições em sigilo (divulgação postergada permitida pela CVM) só existem agregadas no arquivo
  CONFID: aparecem como uma linha "Posições em sigilo", sem detalhamento.
- Visão consolidada (look-through): cotas de fundos são substituídas pela carteira do fundo investido
  na MESMA data, proporcionalmente (peso = valor da posição / PL do fundo investido), até MAX_DEPTH
  níveis. Fundo investido sem carteira na mesma data permanece como "Cotas de fundos".
- Passivos (valores a pagar, posições lançadas/vendidas, obrigações) entram com sinal negativo.
  Derivativos são reportados pelo valor de mercado/ajuste, não pelo nocional (exposição não é medida).
"""
import hashlib
import json
import re
import zipfile
from collections import defaultdict

import config
from util import log, only_digits

MAX_DEPTH = 4

NEGATIVE = {
    "Valores a pagar", "Opções - Posições lançadas", "Mercado Futuro - Posições vendidas",
    "Obrigações por ações e outros TVM recebidos em empréstimo", "Outras operações passivas e exigibilidades",
    "Obrigações por compra a termo a pagar", "Obrigações por venda a termo a entregar", "DIFERENCIAL DE SWAP A PAGAR",
}
GROUPS = [
    ("Títulos públicos", {"Títulos Públicos"}),
    ("Operações compromissadas", {"Operações Compromissadas"}),
    ("Crédito privado", {"Debêntures", "Debêntures conversíveis", "Debêntures simples", "Títulos de Crédito Privado",
                         "Títulos ligados ao agronegócio", "Outros valores mobiliários registrados na CVM objeto de oferta pública",
                         "Outros valores mobiliários ofertados privadamente"}),
    ("Títulos bancários", {"Depósitos a prazo e outros títulos de IF"}),
    ("Ações e BDRs", {"Ações", "Brazilian Depository Receipt - BDR", "Ações e outros TVM cedidos em empréstimo",
                      "Certificado ou recibo de depósito de valores mobiliários",
                      "Obrigações por ações e outros TVM recebidos em empréstimo"}),
    ("Cotas de fundos", {"Cotas de Fundos", "Cotas de fundos de investimento - Instrução Nº 409", "Cotas de fundos de renda variável"}),
    ("Exterior", {"Investimento no Exterior"}),
    ("Derivativos", {"Opções - Posições lançadas", "Opções - Posições titulares", "Mercado Futuro - Posições vendidas",
                     "Mercado Futuro - Posições compradas", "DIFERENCIAL DE SWAP A PAGAR", "DIFERENCIAL DE SWAP A RECEBER",
                     "Compras a termo a receber", "Vendas a termo a receber", "Obrigações por compra a termo a pagar",
                     "Obrigações por venda a termo a entregar"}),
]
GROUP_OF = {a: g for g, s in GROUPS for a in s}
ADJ = "Ajuste de conciliação"
GROUP_ORDER = [g for g, _ in GROUPS] + ["Caixa, valores a receber/pagar e outros", "Posições em sigilo", ADJ]
FUND_APLIC = GROUPS[5][1]


def group_of(tp_aplic):
    return GROUP_OF.get(tp_aplic, "Caixa, valores a receber/pagar e outros")


def download(months, offline=False):
    from cvm import _download  # mesmo downloader do informe diário
    d = config.RAW_DIR / "cvm_cda"
    for i, ym in enumerate(months):
        if not offline:
            _download(config.CVM_CDA_URL.format(ym=ym), d / f"cda_fi_{ym}.zip", force=i >= len(months) - config.CVM_REFRESH_MONTHS)
    return [ym for ym in months if (d / f"cda_fi_{ym}.zip").exists()]


def _fmt(c):
    return f"{c[:2]}.{c[2:5]}.{c[5:8]}/{c[8:12]}-{c[12:]}"


def _iter_csv(zf, name, keys=None):
    """Itera linhas (dict) de um CSV do zip; se keys, filtra pela 2ª coluna antes de decodificar."""
    with zf.open(name) as fh:
        header = fh.readline().decode("latin-1").strip().split(";")
        for line in fh:
            if keys is not None:
                p = line.split(b";", 2)
                if len(p) < 2 or p[1] not in keys:
                    continue
            row = line.decode("latin-1").rstrip("\r\n").split(";")
            yield dict(zip(header, row))


def _num(s):
    try:
        return float(s) if s not in ("", None) else 0.0
    except ValueError:
        return 0.0


def _label(blk, r):
    g = lambda k: (r.get(k) or "").strip()  # noqa: E731
    venc = g("DT_VENC")
    vtxt = f" {venc[8:10]}/{venc[5:7]}/{venc[:4]}" if len(venc) >= 10 else ""
    if blk == "1":
        return (g("TP_TITPUB") or g("TP_ATIVO") or "Título público") + vtxt, g("CD_ISIN") or g("CD_SELIC"), "Tesouro Nacional"
    if blk == "2":
        return g("NM_FUNDO_CLASSE_SUBCLASSE_COTA") or "Cotas de fundo", g("CNPJ_FUNDO_CLASSE_COTA"), g("NM_FUNDO_CLASSE_SUBCLASSE_COTA")
    if blk == "3":
        return g("DS_SWAP") or "Swap", g("CD_SWAP"), ""
    if blk == "4":
        code = g("CD_ATIVO")
        return (f"{code} — {g('DS_ATIVO')}" if code and g("DS_ATIVO") and g("DS_ATIVO") != code else code or g("DS_ATIVO") or g("TP_ATIVO")), g("CD_ISIN") or code, ""
    if blk == "5":
        idx = g("DS_INDEXADOR_POSFX")
        return f"{g('TP_ATIVO') or 'Título bancário'} {g('EMISSOR')}{vtxt}".strip() + (f" ({idx})" if idx else ""), "", g("EMISSOR")
    if blk == "6":
        return f"{g('TP_ATIVO') or g('TP_APLIC')} {g('EMISSOR')}{vtxt}".strip(), g("TITULO_CETIP"), g("EMISSOR")
    if blk == "7":
        ds = g("DS_ATIVO_EXTERIOR")
        em = g("EMISSOR")
        # Fundos offshore vêm como "3ITARTF - IT ARTAX FIXED INCOM - KYG497693526 - ITAU - 196743141,71" (código interno,
        # nome, ISIN, administrador, quantidade). Rotula por nome + ISIN para somar as linhas do mesmo veículo.
        if g("TP_ATIVO") == "Fundos Offshore" or not ds or re.match(r"^\w+_[-\d.]+_", ds):
            parts = [x.strip() for x in em.split(" - ") if x.strip()]
            isin = next((x for x in parts if re.fullmatch(r"[A-Z]{2}[A-Z0-9]{9}\d", x)), "")
            name = next((x for x in parts[1:] if x != isin and not re.fullmatch(r"[\d.,-]+", x)), parts[0] if parts else "")
            if parts and re.fullmatch(r"\w*\d\w*", parts[0]) and len(parts) > 1:
                name = parts[1]
            return (f"{name} ({isin})" if isin else name) or ds or "Fundo offshore", isin, name
        return ds or g("CD_ATIVO_BV_MERC") or em or "Ativo no exterior", g("CD_ATIVO_BV_MERC"), em
    if blk == "8":
        ds = g("DS_ATIVO").strip(" -")
        ap = g("TP_APLIC")
        if ap in NEGATIVE or ap.startswith("Outras"):
            return f"{ap}: {ds}" if ds else ap, "", g("EMISSOR")
        return ds or g("TP_ATIVO") or ap, "", g("EMISSOR")
    return g("TP_APLIC"), "", ""


def _parse_month(zpath, roots):
    """Lê um mês: grafo fundo->fundo investido, fecho a partir de `roots` e posições do fecho."""
    with zipfile.ZipFile(zpath) as zf:
        names = [n for n in zf.namelist() if n.startswith("cda_fi_")]  # exclui cda_fie_* (outro regime)
        blc = {n.split("_")[3]: n for n in names if "_BLC_" in n}
        confid = next((n for n in names if "_CONFID_" in n), None)
        pln = next((n for n in names if "_PL_" in n), None)
        # 1) grafo de cotas de fundos (bloco 2) para todo o mercado
        edges = defaultdict(set)
        if "2" in blc:
            for r in _iter_csv(zf, blc["2"]):
                a, b = only_digits(r["CNPJ_FUNDO_CLASSE"]), only_digits(r.get("CNPJ_FUNDO_CLASSE_COTA"))
                if a and b and a != b:
                    edges[a].add(b)
        closure, frontier = set(roots), set(roots)
        for _ in range(MAX_DEPTH):
            frontier = {b for a in frontier for b in edges.get(a, ())} - closure
            closure |= frontier
        keys = {_fmt(c).encode() for c in closure}
        # 2) posições, sigilo e PL do fecho
        pos = defaultdict(list)
        for k, n in sorted(blc.items()):
            for r in _iter_csv(zf, n, keys):
                c = only_digits(r["CNPJ_FUNDO_CLASSE"])
                ap = (r.get("TP_APLIC") or "").strip()
                v = _num(r.get("VL_MERC_POS_FINAL"))
                lab, code, emissor = _label(k, r)
                pos[c].append({"dt": r["DT_COMPTC"], "blc": k, "aplic": ap, "tipo": (r.get("TP_ATIVO") or "").strip(),
                               "ativo": lab.strip(), "codigo": code, "emissor": (emissor or "").strip(),
                               # cotas de fundos offshore não têm vencimento (o campo traz datas de lotes)
                               "venc": None if (r.get("TP_ATIVO") or "").strip() == "Fundos Offshore" else ((r.get("DT_VENC") or "")[:10] or None),
                               "valor": -abs(v) if ap in NEGATIVE else v,
                               "cota_cnpj": only_digits(r.get("CNPJ_FUNDO_CLASSE_COTA")) if k == "2" else None,
                               "ligado": (r.get("EMISSOR_LIGADO") or "").strip() == "S"})
        conf = defaultdict(float)
        if confid:
            for r in _iter_csv(zf, confid, keys):
                ap = (r.get("TP_APLIC") or "").strip()
                v = _num(r.get("VL_MERC_POS_FINAL"))
                conf[only_digits(r["CNPJ_FUNDO_CLASSE"])] += -abs(v) if ap in NEGATIVE else v
        pl = {}
        if pln:
            for r in _iter_csv(zf, pln, keys):
                pl[only_digits(r["CNPJ_FUNDO_CLASSE"])] = (r["DT_COMPTC"], _num(r["VL_PATRIM_LIQ"]))
    return {"pos": pos, "confid": dict(conf), "pl": pl}


def load_month(ym, roots):
    z = config.RAW_DIR / "cvm_cda" / f"cda_fi_{ym}.zip"
    key = hashlib.sha1(",".join(sorted(roots)).encode()).hexdigest()[:10]
    cache = config.CACHE_DIR / f"cda_{ym}_{key}.json"
    if cache.exists() and cache.stat().st_mtime >= z.stat().st_mtime:
        return json.loads(cache.read_text(encoding="utf-8"))
    log(f"  CDA {ym}: lendo carteiras…")
    d = _parse_month(z, roots)
    cache.write_text(json.dumps(d), encoding="utf-8")
    return d


RECON_TOL = 0.02  # tolerância de conciliação (posições − passivos vs PL) para abrir um fundo investido


def _recon(month, cnpj):
    """(soma das posições + sigilo) / PL do fundo no mês, ou None."""
    pl = month["pl"].get(cnpj, (None, 0))[1]
    pos = month["pos"].get(cnpj)
    if not pl or not pos:
        return None
    return (sum(p["valor"] for p in pos) + (month["confid"].get(cnpj) or 0)) / pl


def _adjust_line(name, valor):
    return {"aplic": ADJ, "ativo": f"Diferença entre o PL e a soma da carteira reportada — {name}", "valor": valor,
            "tipo": "", "codigo": "", "emissor": "", "venc": None, "blc": "AJUSTE"}


def _lookthrough(cnpj, month, scale, depth, path, out, unresolved, unreconciled=None):
    """Acumula em `out` as posições finais de `cnpj` multiplicadas por `scale`.

    Fundos investidos com carteira na mesma data são abertos proporcionalmente. Se a carteira do
    fundo investido não fechar com o PL dele (|soma/PL − 1| > RECON_TOL), as posições entram como
    reportadas e a diferença vira uma linha explícita de "Ajuste de conciliação" — o total segue
    igual ao valor da cota investida, e a anomalia fica visível.
    """
    for p in month["pos"].get(cnpj, []):
        sub = p.get("cota_cnpj")
        sub_pl = month["pl"].get(sub, (None, 0))[1] if sub else 0
        r = _recon(month, sub) if sub else None
        if sub and depth < MAX_DEPTH and sub not in path and r is not None and sub_pl > 0:
            _lookthrough(sub, month, scale * p["valor"] / sub_pl, depth + 1, path | {sub}, out, unresolved, unreconciled)
            if abs(r - 1) > RECON_TOL:
                out.append(_adjust_line(p["ativo"], scale * p["valor"] * (1 - r)))
                if unreconciled is not None:
                    unreconciled[p["ativo"]] = r
            continue
        if sub and p["aplic"] in FUND_APLIC and depth < MAX_DEPTH:
            unresolved.add(p["ativo"])
        out.append(dict(p, valor=p["valor"] * scale))
    c = month["confid"].get(cnpj)
    if c:
        out.append({"aplic": "Posições em sigilo", "ativo": "Posições em sigilo (divulgação postergada)", "valor": c * scale,
                    "tipo": "", "codigo": "", "emissor": "", "venc": None, "blc": "CONFID"})


def _aggregate(rows, pl):
    """Agrupa posições idênticas (mesmo ativo/código/emissor/vencimento) e calcula % do PL."""
    agg = {}
    for r in rows:
        k = (r["aplic"], r["ativo"], r.get("codigo") or "", r.get("venc") or "")
        if k in agg:
            agg[k]["valor"] += r["valor"]
        else:
            agg[k] = {"grupo": r["aplic"] if r["aplic"] in ("Posições em sigilo", ADJ) else group_of(r["aplic"]),
                      "aplic": r["aplic"], "tipo": r.get("tipo") or "", "ativo": r["ativo"], "codigo": r.get("codigo") or "",
                      "emissor": r.get("emissor") or "", "venc": r.get("venc"), "valor": r["valor"]}
    out = sorted(agg.values(), key=lambda x: -abs(x["valor"]))
    for x in out:
        x["pct"] = x["valor"] / pl if pl else None
    return out


def _summary(c, m, top_n):
    dt, pl = m["pl"].get(c, (m["pos"][c][0]["dt"], None))
    direct, lt, unresolved, unreconciled = [], [], set(), {}
    _lookthrough(c, m, 1.0, MAX_DEPTH, {c}, direct, set())  # depth = MAX: sem abrir fundos investidos
    _lookthrough(c, m, 1.0, 0, {c}, lt, unresolved, unreconciled)
    dir_agg, lt_agg = _aggregate(direct, pl), _aggregate(lt, pl)
    total = sum(x["valor"] for x in dir_agg)

    def gl(rows):
        g = defaultdict(float)
        for x in rows:
            g[x["grupo"]] += x["valor"]
        return [{"grupo": k, "valor": v, "pct": v / pl if pl else None}
                for k, v in sorted(g.items(), key=lambda kv: GROUP_ORDER.index(kv[0]) if kv[0] in GROUP_ORDER else 99)]
    grupos = gl(lt_agg)
    sig = sum(x["valor"] for x in lt_agg if x["grupo"] == "Posições em sigilo")
    return {
        "data": dt, "pl": pl, "conciliacao": total / pl - 1 if pl else None,
        "n_direta": len(dir_agg), "n_consolidada": len(lt_agg),
        "sigilo_pct": sig / pl if pl else None,
        "grupos": grupos, "grupos_direta": gl(dir_agg),
        "top": lt_agg[:top_n], "top_direta": dir_agg[:top_n],
        "fundos_sem_carteira": sorted(unresolved)[:20],
        "fundos_nao_conciliados": [{"fundo": k, "soma_pl": v} for k, v in sorted(unreconciled.items())][:20],
        "ajuste_pct": sum(x["valor"] for x in lt_agg if x["grupo"] == ADJ) / pl if pl else None,
        "_full": lt_agg,
    }


def build(fundos, months, offline=False, top_n=40):
    """Retorna ({fund_id: {"ultima": carteira, "completa": carteira|None}}, linhas_para_excel, itens_de_qualidade).

    "ultima"   = carteira mais recente divulgada (pode ter parcela em sigilo).
    "completa" = se a última tiver > 5% do PL em sigilo, a carteira mais recente com < 1% em sigilo.
    """
    months = download(months, offline)
    roots = {only_digits(f["cnpj"]) for f in fundos}
    loaded = {}

    def month(ym):
        if ym not in loaded:
            loaded[ym] = load_month(ym, roots)
        return loaded[ym]

    result, full, qc = {}, [], []
    for f in fundos:
        c = only_digits(f["cnpj"])
        ultima = completa = None
        for ym in reversed(months):
            m = month(ym)
            if not m["pos"].get(c):
                continue
            s = _summary(c, m, top_n)
            if ultima is None:
                ultima = s
                if (s["sigilo_pct"] or 0) <= 0.05:
                    break
            elif (s["sigilo_pct"] or 0) < 0.01:
                completa = s
                break
        if not ultima:
            qc.append(("alerta", f["id"], "SEM_CARTEIRA_CDA", f"Nenhuma carteira divulgada na CDA/CVM nos meses consultados ({months[0]}–{months[-1]})."))
            continue
        for s in (ultima, completa):
            if s and s["conciliacao"] is not None and abs(s["conciliacao"]) > 0.02:
                qc.append(("alerta", f["id"], "CARTEIRA_NAO_CONCILIA",
                           f"Carteira de {s['data']}: soma das posições (ativos − passivos) difere {s['conciliacao']:+.1%} do PL informado na CDA. "
                           "Percentuais são exibidos sobre o PL informado."))
        if (ultima["sigilo_pct"] or 0) > 0.05:
            qc.append(("info", f["id"], "CARTEIRA_SIGILO",
                       f"Carteira de {ultima['data']}: {ultima['sigilo_pct']:.0%} do PL em posições com divulgação postergada (sigilo permitido pela CVM)"
                       + (f"; exibida também a carteira completa mais recente ({completa['data']})." if completa else
                          "; não há carteira completa nos meses consultados.")))
        if ultima["fundos_sem_carteira"]:
            qc.append(("info", f["id"], "CARTEIRA_LOOKTHROUGH_PARCIAL",
                       f"Carteira consolidada de {ultima['data']}: {len(ultima['fundos_sem_carteira'])} fundo(s) investido(s) sem carteira "
                       "divulgada na mesma data (ex.: gestoras externas, ETFs, FIDCs) permanecem como cotas de fundos."))
        if ultima["fundos_nao_conciliados"]:
            qc.append(("info", f["id"], "CARTEIRA_INVESTIDA_NAO_CONCILIA",
                       f"Carteira consolidada de {ultima['data']}: fundo(s) investido(s) cuja carteira reportada à CVM não fecha com o PL "
                       f"(diferença exibida como 'Ajuste de conciliação'; em geral posições no exterior/derivativos reportadas em valor bruto): " + "; ".join(f"{x['fundo']} (soma = {x['soma_pl']:.0%} do PL)" for x in ultima["fundos_nao_conciliados"][:3]) + "."))
        for s in (ultima, completa):
            if s:
                for x in s.pop("_full"):
                    full.append([f["nome"], s["data"], x["grupo"], x["aplic"], x["tipo"], x["ativo"], x["codigo"], x["emissor"], x["venc"], x["valor"], x["pct"]])
        result[f["id"]] = {"ultima": ultima, "completa": completa}
    return result, full, qc
