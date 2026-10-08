"""Controle de qualidade automatizado (Data Quality Check).

Cada verificação gera itens {nivel, fundo_id, codigo, mensagem}.
nivel: erro (dado não confiável/omitido) | alerta (conferir) | info (transparência).
"""
from collections import Counter

import config
from util import cnpj_is_valid, normalize_text

STOP = {"fundo", "de", "do", "da", "investimento", "fif", "fic", "multimercado", "acoes", "renda", "fixa",
        "credito", "privado", "responsabilidade", "limitada", "classe", "cotas", "rf", "itau", "ii", "cp"}


class QC:
    def __init__(self):
        self.items = []

    def add(self, nivel, fundo_id, codigo, msg):
        self.items.append({"nivel": nivel, "fundo_id": fundo_id, "codigo": codigo, "mensagem": msg})

    def for_fund(self, fid):
        return [i for i in self.items if i["fundo_id"] == fid]


def check_cadastro(qc, fundos, gestoras, benchmarks):
    gids = {g["gestora_id"] for g in gestoras}
    bids = {b["benchmark_id"] for b in benchmarks}
    for k, n in Counter(f["id"] for f in fundos).items():
        if n > 1:
            qc.add("erro", k, "ID_DUPLICADO", f"Identificador '{k}' repetido {n} vezes na planilha.")
    for k, n in Counter(f["cnpj"] for f in fundos).items():
        if n > 1:
            qc.add("erro", None, "CNPJ_DUPLICADO", f"CNPJ {k} aparece {n} vezes na planilha.")
    for f in fundos:
        if not cnpj_is_valid(f["cnpj"]):
            qc.add("erro", f["id"], "CNPJ_INVALIDO", f"CNPJ {f['cnpj']} com dígito verificador inválido.")
        if f["gestora_id"] not in gids:
            qc.add("erro", f["id"], "GESTORA_INEXISTENTE", f"gestora_id '{f['gestora_id']}' não cadastrada.")
        if f["benchmark_id"] not in bids:
            qc.add("erro", f["id"], "BENCH_INEXISTENTE", f"benchmark_id '{f['benchmark_id']}' não cadastrado.")
        for k, lo, hi in (("taxa_adm_pct", 0, 5), ("taxa_perf_pct", 0, 50)):
            v = f.get(k)
            if v is not None and not (lo <= v <= hi):
                qc.add("alerta", f["id"], "TAXA_FORA_FAIXA", f"{k} = {v} fora da faixa plausível [{lo}, {hi}] — verificar unidade (%).")
        a, b = f.get("cotizacao_resgate_d"), f.get("liquidacao_resgate_d")
        if a is not None and b is not None and b < a:
            qc.add("alerta", f["id"], "LIQUIDEZ_INCONSISTENTE", f"Liquidação (D+{b:g}) anterior à cotização (D+{a:g}).")
        if f.get("observacoes"):
            qc.add("info", f["id"], "OBS_CADASTRO", f["observacoes"])


def check_registro(qc, f, reg):
    if not reg:
        qc.add("alerta", f["id"], "CNPJ_NAO_ENCONTRADO_CVM", f"CNPJ {f['cnpj']} não localizado nos cadastros da CVM.")
        return
    sit = (reg.get("situacao") or "").upper()
    if sit and "NORMAL" not in sit:
        qc.add("alerta", f["id"], "SITUACAO_CVM", f"Situação na CVM: {reg.get('situacao')} — verificar se o fundo foi encerrado/incorporado.")
    # Conferência de nome: palavras significativas do nome comercial devem aparecer na denominação CVM.
    den = normalize_text((reg.get("denominacao") or "") + " " + (reg.get("denominacao_fundo") or ""))
    toks = [t for t in normalize_text(f["nome"]).split() if len(t) > 2 and t not in STOP]
    missing = [t for t in toks if t not in den.split()]
    if toks and len(missing) == len(toks):
        qc.add("alerta", f["id"], "NOME_DIVERGENTE", f"Nome comercial '{f['nome']}' não encontrado na denominação CVM "
               f"'{reg.get('denominacao')}' — conferir CNPJ.")
    elif missing:
        qc.add("info", f["id"], "NOME_PARCIAL", f"Termos {missing} do nome comercial ausentes na denominação CVM '{reg.get('denominacao')}'.")
    gestor = normalize_text(reg.get("gestor"))
    if gestor and "itau" not in gestor and f["gestora_id"] == "itau-asset":
        qc.add("alerta", f["id"], "GESTOR_DIVERGENTE", f"Gestor na CVM: {reg.get('gestor')}.")
    lt = reg.get("legado_taxa_adm")
    if lt is not None and f.get("taxa_adm_pct") is not None and abs(lt - f["taxa_adm_pct"]) > 0.005:
        qc.add("info", f["id"], "TAXA_ADM_DIVERGENTE",
               f"Taxa de adm. no material: {f['taxa_adm_pct']:.2f}% a.a.; cadastro legado CVM: {lt:.2f}% a.a. "
               "(cadastro legado pode estar desatualizado após a RCVM 175). Exibido o valor do material da gestora.")


def check_series(qc, f, rows, sub_rows, axis_dates, data_base, cat):
    if not rows and sub_rows:
        subs = sorted({str(r.get("sub")) for r in sub_rows.values()})
        qc.add("alerta", f["id"], "APENAS_SUBCLASSES", f"Informe diário apenas por subclasse ({', '.join(subs)}); série da classe indisponível.")
    if not rows:
        qc.add("alerta", f["id"], "SEM_INFORME_DIARIO", "Fundo sem registros no Informe Diário da CVM no período — rentabilidade e risco N/D.")
        return
    last = max(rows)
    if last < data_base:
        qc.add("alerta", f["id"], "COTA_DEFASADA", f"Última cota em {last}, anterior à data-base {data_base}: métricas até a data-base ficam N/D.")
    bad = sorted(d for d, r in rows.items() if r["q"] <= 0)
    if bad:
        qc.add("alerta", f["id"], "COTA_ZERADA", f"A CVM registra cota igual a zero em {len(bad)} dias úteis ({bad[0]} a {bad[-1]}), "
               "provável falha de reporte. Esses dias são tratados como ausentes (sem interpolação); janelas que dependem deles ficam N/D.")
    rows = {d: r for d, r in rows.items() if r["q"] > 0}
    if not rows:
        return
    negpl = [d for d, r in rows.items() if r["pl"] < 0]
    if negpl:
        qc.add("alerta", f["id"], "PL_NEGATIVO", f"{len(negpl)} registros com PL negativo (ex.: {negpl[0]}).")
    off = [d for d in rows if d not in axis_dates and d <= data_base]
    if off:
        qc.add("info", f["id"], "DATA_FORA_CALENDARIO", f"{len(off)} cotas em datas que não são dias úteis do calendário (ignoradas), ex.: {off[0]}.")
    lim = config.SUSPICIOUS_DAILY_RETURN.get(cat, config.SUSPICIOUS_DAILY_RETURN["default"])
    ds = sorted(d for d in rows if d in axis_dates)
    ax = sorted(axis_dates)
    nxt = {a: b for a, b in zip(ax, ax[1:])}
    jumps = []
    for a, b in zip(ds, ds[1:]):
        if nxt.get(a) != b:
            continue  # só dias úteis consecutivos; lacunas são reportadas em SERIE_INCOMPLETA
        qa, qb = rows[a]["q"], rows[b]["q"]
        if qa > 0 and abs(qb / qa - 1) > lim:
            jumps.append(f"{b} ({qb / qa - 1:+.1%})")
    if jumps:
        qc.add("alerta", f["id"], "RETORNO_DIARIO_SUSPEITO", f"Variação diária acima de {lim:.0%}: {', '.join(jumps[:5])}"
               + (" …" if len(jumps) > 5 else "") + ". Pode indicar evento (amortização, incorporação, desdobramento) — conferir.")
    first = ds[0] if ds else None
    if first:
        expected = [d for d in axis_dates if first <= d <= min(last, data_base)]
        miss = len(expected) - len([d for d in ds if d <= data_base])
        if expected and miss / len(expected) > 0.02:
            qc.add("alerta", f["id"], "SERIE_INCOMPLETA", f"{miss} dias úteis sem cota entre {first} e {min(last, data_base)}. "
                   "Janelas que começam dentro das lacunas ficam N/D.")
