"""Coleta de dados de fundos listados na B3 (FII, Fiagro, FI-Infra, ETF).

Fontes (todas da B3 ou da CVM; nada é estimado):
- COTAHIST (B3, séries históricas): fechamento, volume e nº de negócios diários de cada ticker.
- Fundos listados (B3, sistemaswebb3-listados): lista de fundos por tipo, ficha (ticker <-> CNPJ) e eventos
  corporativos (proventos em dinheiro dos últimos ~12 meses, desdobramentos e grupamentos — histórico completo).
- Fundos.NET (B3/CVM): "Aviso aos Cotistas - Estruturado / Rendimentos e Amortizações" (XML enviado pelo
  administrador) — histórico de proventos de FII e Fiagro anterior à janela dos eventos corporativos.
- CVM: informe mensal de FII e de Fiagro (PL, valor patrimonial da cota, cotistas, segmento).

Downloads ficam em data/raw/listados (cache). Os dois históricos que só se constroem com o tempo — avisos do
Fundos.NET já lidos (imutáveis: cada XML é baixado uma vez) e eventos da B3 acumulados entre execuções — ficam também
em data/historico/ (versionado no repositório), para que o GitHub Actions não precise recoletá-los.
"""
import base64
import csv
import hashlib
import io
import json
import re
import threading
import time
import urllib.error
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta

import config
from util import log, only_digits

UA = {"User-Agent": "Mozilla/5.0 (relatorio-fundos)"}
DIR = config.RAW_DIR / "listados"
HIST = config.ROOT / "data" / "historico"
B3_SEARCH = "https://sistemaswebb3-listados.b3.com.br/fundsListedProxy/Search/"
COTAHIST_URL = "https://bvmf.bmfbovespa.com.br/InstDados/SerHist/{nome}"
FNET_LIST = ("https://fnet.bmfbovespa.com.br/fnet/publico/pesquisarGerenciadorDocumentosDados?d=1&s={s}&l=100"
             "&o%5B0%5D%5BdataEntrega%5D=asc&idCategoriaDocumento=14&idTipoDocumento=41&idEspecieDocumento=0"
             "&dataInicial={ini}&dataFinal={fim}")
FNET_DOC = "https://fnet.bmfbovespa.com.br/fnet/publico/downloadDocumento?id={id}"
CVM_FII_URL = "https://dados.cvm.gov.br/dados/FII/DOC/INF_MENSAL/DADOS/inf_mensal_fii_{y}.zip"
CVM_FIAGRO_URL = "https://dados.cvm.gov.br/dados/FIAGRO/DOC/INF_MENSAL/DADOS/inf_mensal_fiagro_{ym}.zip"


def _b64(o):
    return base64.b64encode(json.dumps(o, separators=(",", ":"), ensure_ascii=False).encode()).decode()


def _get(url, timeout=60, tries=3, headers=None):
    err = None
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers={**UA, **(headers or {})})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise
            err = e
        except Exception as e:  # noqa: BLE001 — rede instável: tenta de novo
            err = e
        time.sleep(0.5 * (k + 1))
    raise err


def _get_json(url, **kw):
    raw = _get(url, **kw)
    return json.loads(raw.decode("utf-8")) if raw.strip() else None


def num_br(s):
    """'1.234,56' -> 1234.56 ; vazio -> None."""
    s = (s or "").strip()
    if not s:
        return None
    return float(s.replace(".", "").replace(",", "."))


def date_br(s):
    """'31/10/2025' -> '2025-10-31'."""
    s = (s or "").strip()
    if not re.fullmatch(r"\d{2}/\d{2}/\d{4}", s):
        return None
    return f"{s[6:]}-{s[3:5]}-{s[:2]}"


# ---------------------------------------------------------------- históricos acumulados (data/historico + cache)
def _load_store(name, empty, merge):
    """Une a cópia versionada (data/historico) e a de trabalho (data/raw/listados); ambas só crescem."""
    out = None
    for p in (HIST / name, DIR / name):
        if p.exists():
            d = json.loads(p.read_text(encoding="utf-8"))
            out = d if out is None else merge(out, d)
    return out if out is not None else empty


def _save_store(name, data):
    raw = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    for p in (HIST / name, DIR / name):
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(".tmp")
        tmp.write_text(raw, encoding="utf-8")
        tmp.replace(p)


def _merge_events(a, b):
    for ac, v in b["fundos"].items():
        cur = a["fundos"].setdefault(ac, {"cash": [], "stock": []})
        seen = {(c["isin"], c["data_com"], c["tipo"], c["valor"]) for c in cur["cash"]}
        cur["cash"] += [c for c in v["cash"] if (c["isin"], c["data_com"], c["tipo"], c["valor"]) not in seen]
        if len(v.get("stock") or []) > len(cur.get("stock") or []):
            cur["stock"] = v["stock"]
    for ac, c in b["coletas"].items():
        cur = a["coletas"].setdefault(ac, dict(c))
        cur["primeira"] = min(cur["primeira"], c["primeira"])
        cur["ultima"] = max(cur.get("ultima") or c["ultima"], c.get("ultima") or cur["ultima"])
    return a


def _merge_fnet(a, b):
    a["docs"].update({k: v for k, v in b["docs"].items() if k not in a["docs"]})
    for m, v in b["meses"].items():
        cur = a["meses"].get(m)
        if not cur or (v.get("completo") and not cur.get("completo")) or (v.get("lido_em", "") > cur.get("lido_em", "") and v.get("completo") == cur.get("completo")):
            a["meses"][m] = v
    return a


# ---------------------------------------------------------------- universo (lista + ficha B3)
def universe(tipos, offline=False, max_age_days=25):
    """[{tipo_b3, id, acronym, ticker, cnpj, nome, nome_pregao, ...}] para os tipos pedidos (cache ~mensal)."""
    cache = DIR / "universo_b3.json"
    old = json.loads(cache.read_text(encoding="utf-8")) if cache.exists() else {"gerado": None, "fundos": {}}
    fresh = old["gerado"] and (date.today() - date.fromisoformat(old["gerado"])).days <= max_age_days
    if offline or (fresh and set(old.get("tipos", [])) >= set(tipos)):
        return list(old["fundos"].values())
    DIR.mkdir(parents=True, exist_ok=True)
    listed = []
    for t in tipos:
        page = 1
        while True:
            d = _get_json(B3_SEARCH + "GetListFunds/" + _b64({"language": "pt-br", "typeFund": t, "pageNumber": page, "pageSize": 120}))
            res = (d or {}).get("results") or []
            listed += [dict(r, tipo_b3=t) for r in res]
            if page >= ((d or {}).get("page") or {}).get("totalPages", 0):
                break
            page += 1
    log(f"  listados: {len(listed)} fundos na lista da B3 ({', '.join(tipos)})")
    fundos = dict(old["fundos"])
    lock = threading.Lock()

    def detail(r):
        key = f"{r['tipo_b3']}|{r['acronym']}"
        prev = old["fundos"].get(key)
        if prev and prev.get("cnpj") and fresh:
            return
        # ETF/FII: a ficha é localizada pelo id do Fundos.NET; FI-Infra e outros: pelo código (acronym).
        bodies = [{"language": "pt-br", "idFNET": str(r["id"]), "idCEM": "", "typeFund": r["tipo_b3"]},
                  {"language": "pt-br", "idFNET": str(r["id"]), "idCEM": r["acronym"], "typeFund": r["tipo_b3"]}]
        det = None
        for b in bodies:
            try:
                det = _get_json(B3_SEARCH + "GetDetailFund/" + _b64(b), timeout=30)
            except Exception:  # noqa: BLE001
                det = None
            if det and det.get("cnpj"):
                break
        rec = {"tipo_b3": r["tipo_b3"], "id": r["id"], "acronym": r["acronym"], "nome": (r.get("fundName") or "").strip(),
               "nome_pregao": (r.get("tradingName") or "").strip()}
        if det:
            rec.update({"cnpj": only_digits(det.get("cnpj")) or None, "ticker": (det.get("tradingCode") or "").strip() or None,
                        "outros_tickers": (det.get("tradingCodeOthers") or "").strip() or None,
                        "classificacao": det.get("classification"), "cotas_b3": num_br(det.get("quotaCount")),
                        "administrador": ((det.get("shareHolder") or {}).get("shareHolderName") or "").strip() or None})
        with lock:
            fundos[key] = rec

    with ThreadPoolExecutor(6) as ex:
        list(ex.map(detail, listed))
    keep = {f"{r['tipo_b3']}|{r['acronym']}" for r in listed}
    fundos = {k: v for k, v in fundos.items() if k in keep}
    cache.write_text(json.dumps({"gerado": date.today().isoformat(), "tipos": tipos, "fundos": fundos}, ensure_ascii=False), encoding="utf-8")
    return list(fundos.values())


# ---------------------------------------------------------------- eventos corporativos (B3)
def events(acronyms, offline=False):
    """{acronym: {"cash": [...], "stock": [...]}} — eventos corporativos da B3, acumulados entre execuções.

    A B3 publica os proventos em dinheiro dos últimos ~12 meses; cada coleta é somada ao histórico já guardado
    (chave: ISIN + data-com + tipo + valor), de modo que o histórico cresce com o tempo.
    """
    store = _load_store("eventos_b3.json", {"coletas": {}, "fundos": {}}, _merge_events)
    if offline:
        return store["fundos"], store["coletas"]
    lock = threading.Lock()
    falhas = []

    def one(ac):
        try:
            d = _get_json(B3_SEARCH + "GetEventsCorporateActions/" + _b64({"language": "pt-br", "idCEM": ac}), timeout=30)
        except Exception as e:  # noqa: BLE001
            falhas.append(ac)
            return
        if not d:
            return
        cash = [{"isin": x.get("isinCode"), "data_com": date_br(x.get("lastDatePrior")), "pagamento": date_br(x.get("paymentDate")),
                 "valor": num_br(x.get("rate")), "tipo": (x.get("label") or "").strip().upper(), "ref": x.get("relatedTo"),
                 "aprovado": date_br(x.get("approvedOn"))} for x in d.get("cashDividends") or []]
        stock = [{"isin": x.get("isinCode"), "data_com": date_br(x.get("lastDatePrior")), "fator": num_br(x.get("factor")),
                  "tipo": (x.get("label") or "").strip().upper(), "aprovado": date_br(x.get("approvedOn"))} for x in d.get("stockDividends") or []]
        with lock:
            cur = store["fundos"].setdefault(ac, {"cash": [], "stock": []})
            seen = {(c["isin"], c["data_com"], c["tipo"], c["valor"]) for c in cur["cash"]}
            cur["cash"] += [c for c in cash if c["data_com"] and c["valor"] and (c["isin"], c["data_com"], c["tipo"], c["valor"]) not in seen]
            cur["stock"] = stock or cur["stock"]
            # Primeira coleta: a partir dela (menos ~12 meses) o histórico de proventos da B3 é completo.
            col = store["coletas"].setdefault(ac, {"primeira": date.today().isoformat()})
            col["ultima"] = date.today().isoformat()

    with ThreadPoolExecutor(6) as ex:
        list(ex.map(one, acronyms))
    if falhas:
        log(f"  aviso: eventos corporativos indisponíveis para {len(falhas)} fundo(s) nesta execução (usado o histórico guardado)")
    _save_store("eventos_b3.json", store)
    return store["fundos"], store["coletas"]


# ---------------------------------------------------------------- COTAHIST (B3)
COTAHIST_BDI = {b"12", b"13", b"14"}  # 12 = FII; 13 = Fiagro (até out/2025); 14 = demais cotas de fundos (ETF, FI-Infra, Fiagro…)


def _parse_cotahist(zpath, tickers):
    """{ticker: {iso: [fechamento, volume_R$, negócios, isin]}} — mercado à vista (TPMERC 010)."""
    out = {}
    with zipfile.ZipFile(zpath) as zf, zf.open(zf.namelist()[0]) as fh:
        for line in fh:
            if line[:2] != b"01" or line[10:12] not in COTAHIST_BDI or line[24:27] != b"010":
                continue
            t = line[12:24].strip().decode("latin-1")
            if t not in tickers:
                continue
            d = line[2:10].decode()
            fat = int(line[210:217]) or 1
            out.setdefault(t, {})[f"{d[:4]}-{d[4:6]}-{d[6:]}"] = [
                int(line[108:121]) / 100 / fat, int(line[170:188]) / 100, int(line[147:152]), line[230:242].decode("latin-1").strip()]
    return out


def prices(tickers, start: date, today: date, offline=False):
    """Fechamentos diários (COTAHIST) de `tickers` desde `start`.

    Anos fechados: arquivo anual (baixado uma vez). Ano corrente: arquivos mensais (os 2 mais recentes são
    rebaixados a cada execução) e diários para o mês corrente.
    """
    tickers = set(tickers)
    key = hashlib.sha1((",".join(sorted(tickers)) + "|" + ",".join(sorted(b.decode() for b in COTAHIST_BDI))).encode()).hexdigest()[:10]
    src = DIR / "cotahist"
    src.mkdir(parents=True, exist_ok=True)
    out = {}

    def load(nome, force=False):
        z = src / nome
        if not offline and (force or not z.exists()):
            try:
                data = _get(COTAHIST_URL.format(nome=nome), timeout=300)
                tmp = z.with_suffix(".tmp")
                tmp.write_bytes(data)
                tmp.replace(z)
            except urllib.error.HTTPError:
                pass  # ainda não publicado
            except Exception as e:  # noqa: BLE001
                log(f"  aviso: falha ao baixar {nome}: {e}")
        cache = config.CACHE_DIR / f"cotahist_{nome[:-4]}_{key}.json"
        if not z.exists():
            # Arquivo bruto ausente (ex.: removido pela sincronização de pasta): usa a extração em cache, se houver.
            if not cache.exists():
                if not nome.startswith("COTAHIST_D"):  # diários: normal faltar (feriado, ainda não publicado)
                    log(f"  AVISO: {nome} indisponível (sem arquivo e sem cache) — cotações desse período ficam N/D")
                return False
            log(f"  aviso: {nome} ausente em data/raw; usando a extração em cache")
            part = json.loads(cache.read_text(encoding="utf-8"))
        elif cache.exists() and cache.stat().st_mtime >= z.stat().st_mtime:
            part = json.loads(cache.read_text(encoding="utf-8"))
        else:
            log(f"  listados: lendo {nome}…")
            for old in config.CACHE_DIR.glob(f"cotahist_{nome[:-4]}_*.json"):
                old.unlink()
            part = _parse_cotahist(z, tickers)
            config.CACHE_DIR.mkdir(parents=True, exist_ok=True)
            cache.write_text(json.dumps(part, separators=(",", ":")), encoding="utf-8")
        for t, rows in part.items():
            out.setdefault(t, {}).update(rows)
        return True

    for y in range(start.year, today.year):
        load(f"COTAHIST_A{y}.ZIP")
    for m in range(1, today.month):
        load(f"COTAHIST_M{m:02d}{today.year}.ZIP", force=m >= today.month - 2)
    d = date(today.year, today.month, 1)
    while d < today:  # mês corrente: arquivos diários
        if d.weekday() < 5:
            load(f"COTAHIST_D{d:%d%m%Y}.ZIP", force=(today - d).days <= 3)
        d += timedelta(days=1)
    return out


# ---------------------------------------------------------------- Fundos.NET (avisos estruturados de rendimentos)
def _parse_fnet_xml(raw):
    """Proventos de um 'Aviso aos Cotistas - Estruturado'. [{isin, ticker, tipo, data_com, valor, pagamento, isento}]"""
    s = raw.decode("utf-8", "replace")
    if not s.lstrip().startswith("<"):
        try:
            s = base64.b64decode(raw).decode("utf-8", "replace")
        except Exception:  # noqa: BLE001
            return []
    out = []
    for prov in re.findall(r"<Provento>(.*?)</Provento>", s, re.S):
        isin = (re.search(r"<CodISIN>(.*?)</CodISIN>", prov) or [None, ""])[1].strip()
        tick = (re.search(r"<CodNegociacao>(.*?)</CodNegociacao>", prov) or [None, ""])[1].strip()
        for tag, tipo in (("Rendimento", "RENDIMENTO"), ("Amortizacao", "AMORTIZACAO")):
            for blk in re.findall(rf"<{tag}>(.*?)</{tag}>", prov, re.S):
                g = lambda k: ((re.search(rf"<{k}>(.*?)</{k}>", blk, re.S) or [None, ""])[1] or "").strip()  # noqa: E731
                try:
                    v = float(g("ValorProvento").replace(",", ".")) if g("ValorProvento") else None
                except ValueError:
                    v = None
                dc = g("DataBase")[:10]
                if v and re.fullmatch(r"\d{4}-\d{2}-\d{2}", dc):
                    out.append({"isin": isin, "ticker": tick, "tipo": tipo, "data_com": dc, "valor": v,
                                "pagamento": g("DataPagamento")[:10] or None,
                                "isento": {"SIM": True, "NAO": False, "NÃO": False}.get(g("RendimentoIsentoIR").upper())})
    return out


def fnet(meses_entrega, budget_s, threads, offline=False):
    """Avisos estruturados de rendimentos do Fundos.NET entregues nos meses pedidos ('AAAA-MM').

    Retorna (docs, meses_completos): docs = {id: {"entrega", "versao", "pregao", "proventos": [...]}}.
    Um mês só conta como completo quando todos os seus documentos foram lidos. `budget_s` limita o tempo de
    download por execução (os demais meses continuam na próxima execução).
    """
    st = _load_store("fnet_rendimentos.json", {"docs": {}, "meses": {}}, _merge_fnet)
    if offline:
        return st["docs"], {m for m, v in st["meses"].items() if v.get("completo")}
    t0 = time.time()
    hoje = date.today()
    lock = threading.Lock()

    def save():
        with lock:
            _save_store("fnet_rendimentos.json", st)

    # Mais recentes primeiro: o histórico antigo é completado aos poucos.
    for ym in sorted(meses_entrega, reverse=True):
        info = st["meses"].get(ym, {})
        y, m = int(ym[:4]), int(ym[5:])
        fim_mes = date(y + m // 12, m % 12 + 1, 1) - timedelta(days=1)
        recente = (hoje - fim_mes).days < 45  # meses recentes: relista (documentos novos ou reapresentados)
        if info.get("completo") and not recente:
            continue
        if time.time() - t0 > budget_s:
            break
        ini, fim = f"01/{m:02d}/{y}", f"{fim_mes:%d/%m/%Y}"
        rows, s = [], 0
        try:
            while True:
                d = _get_json(FNET_LIST.format(s=s, ini=ini, fim=fim), timeout=90, tries=6, headers={"X-Requested-With": "XMLHttpRequest"})
                rows += d["data"]
                s += 100
                if s >= d["recordsTotal"]:
                    break
        except Exception as e:  # noqa: BLE001
            log(f"  aviso: Fundos.NET indisponível ({ym}): {e}")
            break
        # Apenas fundos negociados em bolsa (com nome de pregão) e documentos ativos.
        rows = [r for r in rows if (r.get("nomePregao") or "").strip() and r.get("situacaoDocumento") == "A"]
        todo = [r for r in rows if str(r["id"]) not in st["docs"]]
        falhas = []

        def one(r):
            if time.time() - t0 > budget_s:
                falhas.append(r["id"])
                return
            try:
                raw = _get(FNET_DOC.format(id=r["id"]), timeout=4, tries=6)
            except Exception:  # noqa: BLE001
                falhas.append(r["id"])
                return
            with lock:
                st["docs"][str(r["id"])] = {"entrega": date_br((r.get("dataEntrega") or "")[:10]), "versao": r.get("versao"),
                                            "pregao": r["nomePregao"].strip(), "proventos": _parse_fnet_xml(raw)}

        with ThreadPoolExecutor(threads) as ex:
            list(ex.map(one, todo))
        st["meses"][ym] = {"docs": len(rows), "completo": not falhas, "lido_em": hoje.isoformat()}
        save()
        log(f"  Fundos.NET {ym}: {len(rows)} avisos ({len(todo) - len(falhas)} novos lidos"
            + (f", {len(falhas)} pendentes" if falhas else "") + ")")
    return st["docs"], {m for m, v in st["meses"].items() if v.get("completo")}


# ---------------------------------------------------------------- CVM: informe mensal de FII e Fiagro
def _dl(url, dest, force):
    if dest.exists() and not force:
        return True
    try:
        data = _get(url, timeout=180)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
    except Exception:  # noqa: BLE001
        pass
    return dest.exists()


def cvm_mensal(db: date, offline=False):
    """{cnpj: {mes, pl, vp_cota, cotas, cotistas, segmento, mandato, gestao, publico, dy_mes_cvm}} — último mês ≤ data-base.

    FII: arquivo anual com todos os meses; Fiagro: arquivos mensais.
    """
    out = {}
    cvm_dir = DIR / "cvm"
    for y in sorted({db.year - 1, db.year}):
        z = cvm_dir / f"inf_mensal_fii_{y}.zip"
        if not (_dl(CVM_FII_URL.format(y=y), z, force=not offline and y == db.year) if not offline else z.exists()):
            continue
        with zipfile.ZipFile(z) as zf:
            geral = next(n for n in zf.namelist() if "geral" in n)
            comp = next(n for n in zf.namelist() if "complemento" in n)
            g = {}
            for r in csv.DictReader(io.TextIOWrapper(zf.open(geral), encoding="latin-1"), delimiter=";"):
                g[(only_digits(r["CNPJ_Fundo_Classe"]), r["Data_Referencia"][:7])] = r
            for r in csv.DictReader(io.TextIOWrapper(zf.open(comp), encoding="latin-1"), delimiter=";"):
                c, mes = only_digits(r["CNPJ_Fundo_Classe"]), r["Data_Referencia"][:7]
                if mes > db.isoformat()[:7]:
                    continue
                cur = out.get(c)
                if cur and (cur["mes"] > mes or (cur["mes"] == mes and cur["_v"] >= int(r["Versao"] or 0))):
                    continue
                gg = g.get((c, mes), {})
                f = lambda k: float(r[k]) if r.get(k) not in (None, "") else None  # noqa: E731
                out[c] = {"mes": mes, "_v": int(r["Versao"] or 0), "pl": f("Patrimonio_Liquido"), "vp_cota": f("Valor_Patrimonial_Cotas"),
                          "cotas": f("Cotas_Emitidas"), "cotistas": int(float(r["Total_Numero_Cotistas"])) if r.get("Total_Numero_Cotistas") else None,
                          "segmento": gg.get("Segmento_Atuacao") or None, "mandato": gg.get("Mandato") or None,
                          "gestao": gg.get("Tipo_Gestao") or None, "publico": gg.get("Publico_Alvo") or None, "inicio": gg.get("Data_Funcionamento") or None,
                          "administrador": gg.get("Nome_Administrador") or None, "fonte": "CVM — Informe mensal FII"}
    m = date(db.year, db.month, 1)
    for _ in range(4):  # Fiagro: últimos meses até a data-base
        ym = f"{m:%Y%m}"
        z = cvm_dir / f"inf_mensal_fiagro_{ym}.zip"
        ok = (_dl(CVM_FIAGRO_URL.format(ym=ym), z, force=not offline and (db - m).days < 70) if not offline else z.exists())
        if ok:
            with zipfile.ZipFile(z) as zf:
                n = next(x for x in zf.namelist() if "subclasse" not in x)
                for r in csv.DictReader(io.TextIOWrapper(zf.open(n), encoding="latin-1"), delimiter=";"):
                    c, mes = only_digits(r["CNPJ_Classe"]), r["Data_Referencia"][:7]
                    if c in out and out[c]["mes"] >= mes:
                        continue
                    f = lambda k: float(r[k]) if r.get(k) not in (None, "") else None  # noqa: E731
                    out[c] = {"mes": mes, "_v": int(r["Versao"] or 0), "pl": f("Patrimonio_Liquido"), "vp_cota": f("Valor_Patrimonial_Cotas"),
                              "cotas": f("Cotas_Emitidas"), "cotistas": int(float(r["Numero_Cotistas"])) if r.get("Numero_Cotistas") else None,
                              "segmento": None, "publico": r.get("Publico_Alvo") or None,
                              "administrador": r.get("Nome_Administrador") or None, "gestor": r.get("Nome_Gestor") or None,
                              "fonte": "CVM — Informe mensal Fiagro"}
        m = date(m.year - (m.month == 1), (m.month - 2) % 12 + 1, 1)
    for v in out.values():
        v.pop("_v", None)
    return out
