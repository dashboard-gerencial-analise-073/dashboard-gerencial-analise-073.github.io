"""Configuração central do pipeline.

Tudo que pode mudar sem alterar a lógica (caminhos, janelas, parâmetros
estatísticos) fica aqui. Para incluir uma nova janela de rentabilidade basta
acrescentar um item em RETURN_WINDOWS; o dashboard lê a lista do dataset.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INPUT_XLSX = ROOT / "data" / "input" / "cadastro_fundos.xlsx"
RAW_DIR = ROOT / "data" / "raw"
CVM_DIR = RAW_DIR / "cvm"
BENCH_DIR = RAW_DIR / "benchmarks"
CACHE_DIR = ROOT / "data" / "cache"
DASHBOARD_DIR = ROOT / "dashboard"
DATASET_JS = DASHBOARD_DIR / "data" / "dataset.js"
OUTPUT_DIR = ROOT / "output"

CVM_INF_DIARIO_URL = "https://dados.cvm.gov.br/dados/FI/DOC/INF_DIARIO/DADOS/inf_diario_fi_{ym}.zip"
CVM_CDA_URL = "https://dados.cvm.gov.br/dados/FI/DOC/CDA/DADOS/cda_fi_{ym}.zip"
CVM_REGISTRO_URL = "https://dados.cvm.gov.br/dados/FI/CAD/DADOS/registro_fundo_classe.zip"
CVM_CAD_FI_URL = "https://dados.cvm.gov.br/dados/FI/CAD/DADOS/cad_fi.csv"
# Alternativa oficial quando a API (api.bcb.gov.br) está fora: módulo web do próprio SGS/BCB.
BCB_SGS_WEB_URL = ("https://www3.bcb.gov.br/sgspub/consultarvalores/consultarValoresSeries.do?method=consultarValores"
                   "&optSelecionaSerie={code}&dataInicio={ini}&dataFim={fim}&selTipoArqDownload=1"
                   "&hdOidSeriesSelecionadas={code}&hdPaginar=false&bilServico=%5BSGSFW2301%5D")
BCB_SGS_URL = "https://api.bcb.gov.br/dados/serie/bcdata.sgs.{code}/dados?formato=json&dataInicial={ini}&dataFinal={fim}"
YAHOO_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?period1={p1}&period2={p2}&interval=1d"

# Data-base padrão do relatório:
#   "fechamento" = último dia útil do mês anterior (relatório mensal)
#   "ultima"     = data mais recente em que todos os fundos têm cota
# Pode ser sobrescrita na linha de comando: python pipeline/build.py --data-base 2026-08-31
DATA_BASE_PADRAO = "fechamento"

# Arquivos mensais da CVM são republicados com retificações. Os N meses mais
# recentes são baixados novamente a cada execução; os demais ficam em cache.
CVM_REFRESH_MONTHS = 3

# Janelas de rentabilidade. type: mtd | prev_month | ytd | months (n meses corridos).
RETURN_WINDOWS = [
    {"id": "mtd", "label": "Mês", "long": "Mês atual (até a data-base)", "type": "mtd"},
    {"id": "m1", "label": "Mês ant.", "long": "Mês anterior", "type": "prev_month"},
    {"id": "ytd", "label": "Ano", "long": "Ano até a data-base (YTD)", "type": "ytd"},
    {"id": "12m", "label": "12M", "long": "Últimos 12 meses", "type": "months", "n": 12},
    {"id": "24m", "label": "24M", "long": "Últimos 24 meses", "type": "months", "n": 24},
    {"id": "36m", "label": "36M", "long": "Últimos 36 meses", "type": "months", "n": 36},
    {"id": "48m", "label": "48M", "long": "Últimos 48 meses", "type": "months", "n": 48},
]
# Janelas em que se calculam indicadores de risco (precisam existir em RETURN_WINDOWS).
RISK_WINDOWS = ["12m", "24m", "36m", "48m"]
# Anualização só a partir de 12 meses (anualizar períodos curtos distorce).
ANNUALIZE_MIN_MONTHS = 12

BUSINESS_DAYS_YEAR = 252
# Cobertura mínima de retornos diários na janela para calcular risco.
MIN_RISK_COVERAGE = 0.90
# Cota ausente exatamente na data de início: aceita a última cota até N pregões antes.
MAX_QUOTE_LOOKBACK_DAYS = 5
# Retorno diário acima destes limites é sinalizado como suspeito no controle de qualidade.
SUSPICIOUS_DAILY_RETURN = {"Renda Variável": 0.15, "default": 0.08}

# Carteiras (CDA): quantos meses para trás procurar a última carteira aberta de cada fundo.
CDA_LOOKBACK_MONTHS = 6
# Posições exibidas por fundo no dashboard (a lista completa vai para a planilha consolidada).
CDA_TOP_N = 40

# Fundos de mercado (apenas na página Comparação). Recorte na data-base.
MERCADO = {
    "ativo": True,
    "pl_min": 10e6,          # PL mínimo (R$)
    "cotistas_min": 100,     # número mínimo de cotistas
    "shards": 128,           # nº de arquivos-lote (carregados sob demanda)
    "descricao": "classes abertas, não exclusivas, em funcionamento normal, PL ≥ R$ 10 mi e ≥ 100 cotistas na data-base",
}

# Meses de histórico além da maior janela (margem para datas de início).
HISTORY_MARGIN_MONTHS = 2

CATEGORY_ORDER = [
    "Renda Fixa Ativa", "Crédito Privado", "Renda Fixa Ativa Infra",
    "Debêntures Incentivadas", "Multimercado", "Renda Variável",
]

SOURCES = [
    {"nome": "CVM — Dados Abertos: Informe Diário de Fundos", "uso": "Cotas, PL, cotistas, captações e resgates diários",
     "url": "https://dados.cvm.gov.br/dataset/fi-doc-inf_diario"},
    {"nome": "CVM — Cadastro de Fundos e Classes (RCVM 175) e cadastro legado", "uso": "Denominação, administrador, gestor, início, situação, classificação ANBIMA",
     "url": "https://dados.cvm.gov.br/dataset/fi-cad"},
    {"nome": "CVM — Dados Abertos: Composição e Diversificação das Aplicações (CDA)", "uso": "Carteiras mensais dos fundos (posições abertas e em sigilo)",
     "url": "https://dados.cvm.gov.br/dataset/fi-doc-cda"},
    {"nome": "Banco Central do Brasil — SGS série 12 (CDI)", "uso": "Taxa DI diária (benchmark e taxa livre de risco)",
     "url": "https://www3.bcb.gov.br/sgspub/"},
    {"nome": "Yahoo Finance (^BVSP) — fonte secundária", "uso": "Ibovespa (série oficial do BCB descontinuada em 2019)",
     "url": "https://finance.yahoo.com/quote/%5EBVSP/"},
    {"nome": "Itaú Asset Management — material comercial (prateleira de fundos)", "uso": "Categoria, estratégia, taxas, cotização, alvos, público",
     "url": "https://www.itauassetmanagement.com.br"},
]
