"""Coleta e leitura dos dados abertos da CVM (informe diário + cadastros)."""
import csv
import hashlib
import io
import json
import urllib.error
import urllib.request
import zipfile
from datetime import date

import config
from util import log, only_digits


def _download(url, dest, force=False):
    if dest.exists() and dest.stat().st_size > 0 and not force:
        return True
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (relatorio-fundos)"})
        with urllib.request.urlopen(req, timeout=180) as r:
            data = r.read()
        tmp = dest.with_suffix(dest.suffix + ".tmp")
        tmp.write_bytes(data)
        tmp.replace(dest)
        return True
    except urllib.error.HTTPError as e:
        if e.code == 404:
            log(f"  (ainda não publicado pela CVM: {url.rsplit('/', 1)[-1]})")
        else:
            log(f"  aviso: falha ao baixar {url}: {e}")
        return dest.exists()
    except Exception as e:  # noqa: BLE001 — offline ou erro de rede
        log(f"  aviso: falha ao baixar {url}: {e}")
        return dest.exists()


def month_range(start: date, end: date):
    y, m = start.year, start.month
    while (y, m) <= (end.year, end.month):
        yield f"{y}{m:02d}"
        m += 1
        if m == 13:
            y, m = y + 1, 1


def download_all(start: date, end: date, offline=False):
    months = list(month_range(start, end))
    refresh = set(months[-config.CVM_REFRESH_MONTHS:])
    if not offline:
        log(f"CVM: verificando {len(months)} arquivos mensais do informe diário…")
        for ym in months:
            _download(config.CVM_INF_DIARIO_URL.format(ym=ym), config.CVM_DIR / f"inf_diario_fi_{ym}.zip", force=ym in refresh)
        _download(config.CVM_REGISTRO_URL, config.CVM_DIR / "registro_fundo_classe.zip", force=True)
        _download(config.CVM_CAD_FI_URL, config.CVM_DIR / "cad_fi.csv", force=True)
    return months


def read_daily(months, cnpjs):
    """Retorna {cnpj_digits: {iso_date: row}} filtrando apenas os CNPJs de interesse.

    Linhas de subclasse (RCVM 175, coluna ID_SUBCLASSE) são guardadas à parte:
    a série da classe (subclasse vazia) é a preferida.
    """
    wanted = {only_digits(c) for c in cnpjs}
    key = hashlib.sha1(",".join(sorted(wanted)).encode()).hexdigest()[:10]
    config.CACHE_DIR.mkdir(parents=True, exist_ok=True)
    out = {c: {} for c in wanted}
    sub = {c: {} for c in wanted}
    for ym in months:
        z = config.CVM_DIR / f"inf_diario_fi_{ym}.zip"
        if not z.exists():
            log(f"  aviso: arquivo CVM ausente {z.name}")
            continue
        cache = config.CACHE_DIR / f"cvm_{ym}_{key}.json"
        if cache.exists() and cache.stat().st_mtime >= z.stat().st_mtime:
            part = json.loads(cache.read_text(encoding="utf-8"))
        else:
            part = _parse_month(z, wanted)
            cache.write_text(json.dumps(part), encoding="utf-8")
        for c, rows in part["classe"].items():
            out[c].update(rows)
        for c, rows in part["sub"].items():
            sub[c].update(rows)
    return out, sub


def _parse_month(zpath, wanted):
    """Leitura rápida: filtra pelo CNPJ (2ª coluna) antes de decodificar a linha."""
    res = {"classe": {}, "sub": {}}
    fmt = {f"{c[:2]}.{c[2:5]}.{c[5:8]}/{c[8:12]}-{c[12:]}".encode(): c for c in wanted}
    fmt.update({c.encode(): c for c in wanted})
    with zipfile.ZipFile(zpath) as zf:
        with zf.open(zf.namelist()[0]) as fh:
            header = fh.readline().decode("latin-1").strip().split(";")
            idx = {h: i for i, h in enumerate(header)}
            ci = idx.get("CNPJ_FUNDO_CLASSE", idx.get("CNPJ_FUNDO"))
            si = idx.get("ID_SUBCLASSE")
            for line in fh:
                parts = line.split(b";", ci + 2)
                c = fmt.get(parts[ci]) if len(parts) > ci else None
                if c is None:
                    continue
                row = line.decode("latin-1").rstrip().split(";")
                rec = {
                    "q": float(row[idx["VL_QUOTA"]] or 0),
                    "pl": float(row[idx["VL_PATRIM_LIQ"]] or 0),
                    "cap": float(row[idx["CAPTC_DIA"]] or 0),
                    "res": float(row[idx["RESG_DIA"]] or 0),
                    "cot": int(float(row[idx["NR_COTST"]] or 0)),
                }
                d = row[idx["DT_COMPTC"]]
                if si is not None and row[si].strip():
                    res["sub"].setdefault(c, {})[d + "|" + row[si].strip()] = dict(rec, sub=row[si].strip())
                else:
                    res["classe"].setdefault(c, {})[d] = rec
    return res


def read_registers(cnpjs):
    """Cadastro RCVM 175 (classe + fundo) com fallback para o cadastro legado."""
    wanted = {only_digits(c) for c in cnpjs}
    info = {}
    z = config.CVM_DIR / "registro_fundo_classe.zip"
    fundos = {}
    classes = {}
    if z.exists():
        with zipfile.ZipFile(z) as zf:
            with zf.open("registro_fundo.csv") as fh:
                for r in csv.DictReader(io.TextIOWrapper(fh, encoding="latin-1"), delimiter=";"):
                    fundos[r["ID_Registro_Fundo"]] = r
            with zf.open("registro_classe.csv") as fh:
                for r in csv.DictReader(io.TextIOWrapper(fh, encoding="latin-1"), delimiter=";"):
                    classes.setdefault(only_digits(r["CNPJ_Classe"]), []).append(r)
        fundo_by_cnpj = {only_digits(f["CNPJ_Fundo"]): f for f in fundos.values()}
        for c in wanted:
            cls = classes.get(c)
            f = None
            if cls:
                cl = sorted(cls, key=lambda r: r["Situacao"] != "Em Funcionamento Normal")[0]
                f = fundos.get(cl["ID_Registro_Fundo"])
            else:
                f = fundo_by_cnpj.get(c)
                cands = [r for rs in classes.values() for r in rs if f and r["ID_Registro_Fundo"] == f["ID_Registro_Fundo"]]
                cl = cands[0] if len(cands) == 1 else None
            if not cl and not f:
                continue
            info[c] = {
                "fonte": "CVM RCVM 175",
                "denominacao": (cl or f)["Denominacao_Social"].strip(),
                "denominacao_fundo": f["Denominacao_Social"].strip() if f else None,
                "situacao": (cl or f)["Situacao"],
                "data_inicio": (cl or {}).get("Data_Inicio") or None,
                "data_constituicao": (f or cl).get("Data_Constituicao") or None,
                "classificacao_cvm": (cl or {}).get("Classificacao") or None,
                "classificacao_anbima": (cl or {}).get("Classificacao_Anbima") or None,
                "publico_alvo": (cl or {}).get("Publico_Alvo") or None,
                "tributacao_lp": (cl or {}).get("Tributacao_Longo_Prazo") or None,
                "tipo_fundo": f.get("Tipo_Fundo") if f else None,
                "tipo_classe": (cl or {}).get("Tipo_Classe"),
                "administrador": f.get("Administrador") if f else None,
                "cnpj_administrador": f.get("CNPJ_Administrador") if f else None,
                "gestor": f.get("Gestor") if f else None,
                "cnpj_gestor": f.get("CPF_CNPJ_Gestor") if f else None,
            }
    # Cadastro legado: data de início de atividade (anterior à adaptação) e taxas declaradas.
    legacy = config.CVM_DIR / "cad_fi.csv"
    if legacy.exists():
        with open(legacy, encoding="latin-1", newline="") as fh:
            for r in csv.DictReader(fh, delimiter=";"):
                c = only_digits(r["CNPJ_FUNDO"])
                if c not in wanted:
                    continue
                cur = info.setdefault(c, {"fonte": "CVM cadastro legado", "denominacao": r["DENOM_SOCIAL"].strip(),
                                          "situacao": r["SIT"], "administrador": r["ADMIN"] or None,
                                          "gestor": r["GESTOR"] or None, "classificacao_anbima": r["CLASSE_ANBIMA"] or None,
                                          "data_inicio": None})
                if r.get("SIT") == "CANCELADA" and cur.get("fonte") != "CVM cadastro legado":
                    continue
                cur["legado_inicio_atividade"] = r["DT_INI_ATIV"] or None
                cur["legado_taxa_adm"] = float(r["TAXA_ADM"].replace(",", ".")) if r["TAXA_ADM"] else None
                cur["legado_taxa_perf"] = float(r["TAXA_PERFM"].replace(",", ".")) if r["TAXA_PERFM"] else None
                if not cur.get("classificacao_anbima") and r["CLASSE_ANBIMA"]:
                    cur["classificacao_anbima"] = r["CLASSE_ANBIMA"]
    return info
