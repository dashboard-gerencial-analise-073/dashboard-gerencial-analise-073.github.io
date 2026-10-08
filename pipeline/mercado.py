"""Universo de fundos de mercado para a página de Comparação.

Todos os fundos (não só os da planilha-base) que atendem ao recorte de config.MERCADO na data-base:
classe aberta, não exclusiva, em funcionamento normal, PL e nº de cotistas mínimos.

Mesma metodologia dos fundos da planilha (metrics.py): cotas oficiais do Informe Diário da CVM,
mesmo eixo de dias úteis, mesmo CDI/Ibovespa. Não há dados comerciais (taxas, liquidez, estratégia):
o dashboard mostra N/D.

Saída (carregada sob demanda pelo dashboard, funciona também abrindo o HTML localmente):
  dashboard/data/mercado/indice.js     -> busca (nome, gestor, classe, PL, retorno 12M)
  dashboard/data/mercado/s/NNN.js      -> lotes com série e indicadores de cada fundo
"""
import csv
import hashlib
import io
import json
import re
import shutil
import zipfile
from array import array
from datetime import date

import config
import metrics as mt
from util import add_months, format_cnpj, iso, log, only_digits

NAN = float("nan")


# ---------------------------------------------------------------- cadastro
def read_register_all():
    """{cnpj_classe: info} de todas as classes do cadastro RCVM 175, com gestor e administrador do fundo."""
    z = config.CVM_DIR / "registro_fundo_classe.zip"
    with zipfile.ZipFile(z) as zf:
        fundos = {r["ID_Registro_Fundo"]: r for r in csv.DictReader(
            io.TextIOWrapper(zf.open("registro_fundo.csv"), encoding="latin-1"), delimiter=";")}
        out = {}
        for r in csv.DictReader(io.TextIOWrapper(zf.open("registro_classe.csv"), encoding="latin-1"), delimiter=";"):
            f = fundos.get(r["ID_Registro_Fundo"], {})
            out[only_digits(r["CNPJ_Classe"])] = {
                "denominacao": r["Denominacao_Social"].strip(), "situacao": r["Situacao"],
                "condominio": r["Forma_Condominio"], "exclusivo": r["Exclusivo"],
                "classe": r["Classificacao"] or None, "anbima": r["Classificacao_Anbima"] or None,
                "indicador": r["Indicador_Desempenho"] or None, "publico": r["Publico_Alvo"] or None,
                "inicio": r["Data_Inicio"] or None, "tributacao": r["Tributacao_Longo_Prazo"] or None,
                "gestor": (f.get("Gestor") or "").strip() or None, "administrador": (f.get("Administrador") or "").strip() or None,
            }
    return out


def bench_from_indicator(ind):
    """Indicador de desempenho informado à CVM -> benchmark com série disponível (ou None)."""
    s = (ind or "").upper()
    if re.search(r"\bDI\b|CDI|SELIC", s):
        return "CDI"
    if "IBOV" in s:
        return "IBOV"
    return None


SUFIXOS = [
    r"\bDA CIC\b", r"\bDA CLASSE\b", r"\bDO FIF\b",
    r"FUNDO DE INVESTIMENTO FINANCEIRO", r"FUNDO DE INVESTIMENTO", r"CLASSE DE INVESTIMENTO EM COTAS",
    r"DA CLASSE DE INVESTIMENTO EM COTAS", r"CLASSE DE INVESTIMENTO", r"EM COTAS DE FUNDOS DE INVESTIMENTO",
    r"RESPONSABILIDADE LIMITADA", r"RESP\.? LIMITADA", r"RESP LTDA", r"\bRL\b", r"\bFIF\b", r"\bFIC\b", r"\bCIC\b",
    r"\bFI\b", r"\bDA\b$", r"\bDE\b$", r"\bEM\b$", r"[-–]\s*$",
]


CONECTORES = {"DA", "DE", "DO", "DAS", "DOS", "EM", "E"}
TIPOS = {"MULTIMERCADO", "RENDA", "AÇÕES", "ACOES", "CAMBIAL", "FIA", "FIM", "FIRF"}


def short_name(den):
    """Nome curto a partir da denominação CVM (remove termos jurídicos repetitivos)."""
    s = " " + den.upper() + " "
    for p in sorted(SUFIXOS + ['EM QUOTAS DE FUNDOS DE INVESTIMENTO', 'DE INVESTIMENTO', r'\bQUOTAS\b', r'\bFUNDOS\b'], key=len, reverse=True) + [r"\bFINANCEIRO\b", r"\bCLASSE\b", r"\bCOTAS\b"]:
        s = re.sub(p, " ", s)
    toks = s.replace("–", "-").split()
    out = []
    for i, t in enumerate(toks):
        nxt = toks[i + 1] if i + 1 < len(toks) else None
        if t in CONECTORES and (nxt is None or nxt in CONECTORES or nxt == "-" or nxt in TIPOS):
            continue
        if t == "-" and (not out or nxt is None):
            continue
        out.append(t)
    while out and (out[-1] in CONECTORES or out[-1] == "-"):
        out.pop()
    return " ".join(out) or den


def is_prev(info):
    """Fundo de previdência (FIE de PGBL/VGBL): classificação ANBIMA de previdência ou nome com PREV/PGBL/VGBL/FIE."""
    return "Previd" in (info.get("anbima") or "") or bool(re.search(r"PREV|PGBL|VGBL|\bFIE\b", (info.get("denominacao") or "").upper()))


# ---------------------------------------------------------------- informe diário
def _universe(db_iso, register, base_cnpjs):
    """Classes que atendem ao recorte na data-base (inclui as reportadas só por subclasse)."""
    cfg = config.MERCADO
    ym = db_iso[:4] + db_iso[5:7]
    z = config.CVM_DIR / f"inf_diario_fi_{ym}.zip"
    cls, subs = {}, {}
    target = db_iso.encode()
    with zipfile.ZipFile(z) as zf, zf.open(zf.namelist()[0]) as fh:
        header = fh.readline().decode("latin-1").strip().split(";")
        idx = {h: i for i, h in enumerate(header)}
        di, si = idx["DT_COMPTC"], idx.get("ID_SUBCLASSE")
        for line in fh:
            p = line.split(b";")
            if p[di] != target:
                continue
            row = line.decode("latin-1").rstrip().split(";")
            c = only_digits(row[idx.get("CNPJ_FUNDO_CLASSE", 1)])
            pl, cot = float(row[idx["VL_PATRIM_LIQ"]] or 0), int(float(row[idx["NR_COTST"]] or 0))
            if si is not None and row[si].strip():
                s = subs.setdefault(c, {"pl": 0.0, "cot": 0, "best": None, "best_cot": -1})
                s["pl"] += pl
                s["cot"] += cot
                if cot > s["best_cot"]:
                    s["best"], s["best_cot"] = row[si].strip(), cot
            else:
                cls[c] = (pl, cot)
    chosen_sub = {}
    uni = set()
    for c, info in register.items():
        prev = is_prev(info)
        if info["situacao"] != "Em Funcionamento Normal" or info["condominio"] == "Fechado":
            continue
        # Previdência (FIE): o cotista é a seguradora (1 a poucos cotistas, "exclusivo"); recorte só por PL.
        if info["exclusivo"] == "S" and not (prev and cfg.get("incluir_previdencia")):
            continue
        if c in cls:
            pl, cot = cls[c]
        elif c in subs:
            pl, cot = subs[c]["pl"], subs[c]["cot"]
            chosen_sub[c] = subs[c]["best"]
        else:
            continue
        if pl >= cfg["pl_min"] and (cot >= cfg["cotistas_min"] or (prev and cfg.get("incluir_previdencia"))):
            uni.add(c)
    return uni | {c for c in base_cnpjs if c in register}, chosen_sub


def _parse_month(zpath, wanted, chosen_sub):
    """{cnpj: [[data, cota, pl, captação−resgate, cotistas], ...]} — classe; subclasse escolhida se não houver classe."""
    fmt = {f"{c[:2]}.{c[2:5]}.{c[5:8]}/{c[8:12]}-{c[12:]}".encode(): c for c in wanted}
    fmt.update({c.encode(): c for c in wanted})
    cls, sub = {}, {}
    with zipfile.ZipFile(zpath) as zf, zf.open(zf.namelist()[0]) as fh:
        header = fh.readline().decode("latin-1").strip().split(";")
        idx = {h: i for i, h in enumerate(header)}
        ci = idx.get("CNPJ_FUNDO_CLASSE", idx.get("CNPJ_FUNDO"))
        si = idx.get("ID_SUBCLASSE")
        for line in fh:
            p = line.split(b";", ci + 2)
            c = fmt.get(p[ci]) if len(p) > ci else None
            if c is None:
                continue
            r = line.decode("latin-1").rstrip().split(";")
            q = float(r[idx["VL_QUOTA"]] or 0)
            rec = [r[idx["DT_COMPTC"]], q, float(r[idx["VL_PATRIM_LIQ"]] or 0),
                   float(r[idx["CAPTC_DIA"]] or 0) - float(r[idx["RESG_DIA"]] or 0), int(float(r[idx["NR_COTST"]] or 0))]
            sid = r[si].strip() if si is not None else ""
            if not sid:
                cls.setdefault(c, {})[rec[0]] = rec
            else:
                agg = sub.setdefault(c, {}).setdefault(rec[0], [rec[0], None, 0.0, 0.0, 0])
                agg[2] += rec[2]
                agg[3] += rec[3]
                agg[4] += rec[4]
                if sid == chosen_sub.get(c):
                    agg[1] = q
    out = {}
    for c in set(cls) | set(sub):
        days = dict(sub.get(c, {}))
        days = {d: v for d, v in days.items() if v[1]}  # só dias em que a subclasse escolhida tem cota
        days.update(cls.get(c, {}))  # a classe tem prioridade
        out[c] = [v for _, v in sorted(days.items()) if v[1] and v[1] > 0]
    return out


def _load_series(months, wanted, chosen_sub, axis_pos, n):
    """Arrays alinhados ao eixo (cota, PL, fluxo, cotistas) por CNPJ; cache por mês."""
    key = hashlib.sha1((",".join(sorted(wanted)) + "|" + json.dumps(chosen_sub, sort_keys=True)).encode()).hexdigest()[:10]
    config.CACHE_DIR.mkdir(parents=True, exist_ok=True)
    data = {c: [array("d", [NAN]) * n, array("d", [NAN]) * n, array("d", [0.0]) * n, array("d", [NAN]) * n] for c in wanted}
    for ym in months:
        z = config.CVM_DIR / f"inf_diario_fi_{ym}.zip"
        if not z.exists():
            continue
        cache = config.CACHE_DIR / f"mkt_{ym}_{key}.json"
        for old in config.CACHE_DIR.glob(f"mkt_{ym}_*.json"):
            if old != cache:
                old.unlink()
        if cache.exists() and cache.stat().st_mtime >= z.stat().st_mtime:
            part = json.loads(cache.read_text(encoding="utf-8"))
        else:
            log(f"  mercado: lendo {z.name}…")
            part = _parse_month(z, wanted, chosen_sub)
            cache.write_text(json.dumps(part, separators=(",", ":")), encoding="utf-8")
        for c, rows in part.items():
            q, pl, fl, cot = data[c]
            for d, qq, pp, ff, cc in rows:
                i = axis_pos.get(d)
                if i is not None:
                    q[i], pl[i], fl[i], cot[i] = qq, pp, ff, cc
    return data


def _continuous(q, cat_limit):
    """Remove o trecho anterior a um salto atípico de cota (troca classe→subclasse não contínua, eventos)."""
    last, cut = None, None
    for i, v in enumerate(q):
        if v != v:
            continue
        if last is not None and abs(v / last - 1) > cat_limit:
            cut = i
        last = v
    if cut is not None:
        for i in range(cut):
            q[i] = NAN
    return cut is not None


# ---------------------------------------------------------------- build
def build(axis, i_base, cdi_idx, bench_series, bench_is_market, months, base_fundos, rnd, clean):
    cfg = config.MERCADO
    out_dir = config.DASHBOARD_DIR / "data" / "mercado"
    if not cfg.get("ativo"):
        shutil.rmtree(out_dir, ignore_errors=True)
        return None
    db_iso = iso(axis.dates[i_base])
    register = read_register_all()
    base_cnpjs = {only_digits(f["cnpj"]) for f in base_fundos}
    uni, chosen_sub = _universe(db_iso, register, base_cnpjs)
    uni -= base_cnpjs  # fundos da planilha já estão no dataset principal (com dados comerciais)
    log(f"  mercado: {len(uni)} fundos no recorte ({sum(1 for c in uni if is_prev(register[c]))} de previdência)")
    axis_iso = [iso(d) for d in axis.dates]
    pos = {d: i for i, d in enumerate(axis_iso)}
    n = len(axis_iso)
    need = [m for m in months if m <= db_iso[:4] + db_iso[5:7]]
    data = _load_series(need, uni, {c: s for c, s in chosen_sub.items() if c in uni}, pos, n)

    windows, rwin = config.RETURN_WINDOWS, config.RISK_WINDOWS
    i12 = axis.last_on_or_before(add_months(axis.dates[i_base], -12))
    shard_n = cfg["shards"]
    shards = {}
    index = []
    for c in sorted(uni):
        info = register[c]
        qa, pla, fla, cota = data[c]
        q = [None if v != v else v for v in qa]
        if q[i_base] is None:
            continue  # sem cota na data-base (ex.: série interrompida)
        cat = "Renda Variável" if (info["classe"] or "").startswith("A") else "default"
        jumped = _continuous(qa, config.SUSPICIOUS_DAILY_RETURN.get(cat, config.SUSPICIOUS_DAILY_RETURN["default"]) * 2)
        q = [None if v != v else v for v in qa]
        bid = bench_from_indicator(info["indicador"])
        bser = bench_series.get(bid) if bid else None
        ret, risk = mt.fund_metrics(axis, i_base, q, bser, cdi_idx, windows, rwin, bench_is_market.get(bid, False))
        fi = mt.first_index(q)
        mf = mt.monthly_table(axis, q, fi, i_base)
        mb = mt.monthly_table(axis, bser, max(fi, mt.first_index(bser) or 0), i_base) if bser else {}
        flow = {"pl": pla[i_base], "cotistas": int(cota[i_base]) if cota[i_base] == cota[i_base] else None, "data": db_iso}
        if i12 is not None and fi is not None and fi <= i12:
            flow["pl_12m_atras"] = None if pla[i12] != pla[i12] else pla[i12]
            flow["cotistas_12m_atras"] = None if cota[i12] != cota[i12] else int(cota[i12])
            flow["captacao_liquida_12m"] = sum(fla[i12 + 1:i_base + 1])
            pls = [v for v in pla[i12 + 1:i_base + 1] if v == v]
            flow["pl_medio_12m"] = sum(pls) / len(pls) if pls else None
        fid = "m:" + c
        nome = short_name(info["denominacao"])
        qc = []
        if c in chosen_sub:
            qc.append({"nivel": "info", "codigo": "SERIE_SUBCLASSE", "mensagem": f"Série da subclasse {chosen_sub[c]} (maior nº de cotistas); PL e cotistas somam as subclasses."})
        if jumped:
            qc.append({"nivel": "alerta", "codigo": "SERIE_INTERROMPIDA", "mensagem": "Variação atípica de cota no histórico: série considerada só a partir dela."})
        f = {
            "id": fid, "mercado": True, "previdencia": is_prev(info), "nome": nome, "cnpj": format_cnpj(c), "gestora_id": None,
            "categoria": info["classe"] or "N/D", "familia": None, "estrutura": None, "benchmark_id": bid,
            "indicador_cvm": info["indicador"], "qualificado": (info["publico"] or "").startswith(("Qualificado", "Profissional")),
            "cvm": {"denominacao": info["denominacao"], "situacao": info["situacao"], "administrador": info["administrador"],
                    "gestor": info["gestor"], "classificacao_anbima": info["anbima"], "publico_alvo": info["publico"],
                    "tributacao_lp": info["tributacao"], "fonte": "CVM RCVM 175"},
            "inicio": info["inicio"], "primeira_cota": axis_iso[fi] if fi is not None else None, "ultima_cota": db_iso,
            "ret": ret, "risk": risk, "flow": flow,
            "mensal": {k: [mf[k], mb.get(k)] for k in mf},
            "serie": {"i0": fi, "q": [rnd(v, 8) for v in q[fi:]]},
            "qc": qc,
        }
        sh = int(c) % shard_n
        shards.setdefault(sh, {})[fid] = clean(f)
        r12 = ret.get("12m", {}).get("f")
        index.append([fid, nome, format_cnpj(c), (info["gestor"] or "")[:60], info["classe"] or "", info["anbima"] or "",
                      rnd(pla[i_base], 6), rnd(r12, 6) if r12 is not None else None, sh, 1 if is_prev(info) else 0])

    # Remove lotes antigos arquivo a arquivo (pastas sincronizadas, ex. OneDrive, podem travar rmtree).
    for old in out_dir.rglob("*.js"):
        old.unlink()
    (out_dir / "s").mkdir(parents=True, exist_ok=True)
    for sh, funds in shards.items():
        (out_dir / "s" / f"{sh:03d}.js").write_text(
            f"window.__MKT_SHARD({sh},{json.dumps(funds, ensure_ascii=False, separators=(',', ':'))});\n", encoding="utf-8")
    meta = {"data_base": db_iso, "n": len(index), "recorte": cfg["descricao"], "campos": ["id", "nome", "cnpj", "gestor", "classe", "anbima", "pl", "r12", "lote", "prev"],
            "n_prev": sum(1 for r in index if r[9])}
    (out_dir / "indice.js").write_text(
        f"window.__MKT_INDEX({json.dumps({'meta': meta, 'fundos': index}, ensure_ascii=False, separators=(',', ':'))});\n", encoding="utf-8")
    total = sum(p.stat().st_size for p in out_dir.rglob("*.js"))
    log(f"  mercado: {len(index)} fundos publicados em {len(shards)} lotes ({total / 1e6:.1f} MB)")
    return meta
