# Relatório de Fundos de Investimento

Dashboard interativo (HTML) para análise e comparação de fundos, com pipeline de dados
reprodutível a partir de fontes oficiais (CVM e Banco Central). Versão inicial: fundos da
prateleira Itaú Asset Management (61 fundos).

```
Dados (planilha + CVM + BCB)  →  Tratamento (pipeline Python)  →  Dashboard (HTML/JS estático)
```

## Como abrir o relatório

- **Uso local / interno:** abra `dashboard/index.html` no navegador (duplo clique). Não precisa de servidor.
- **Para enviar a clientes:** use `output/Relatorio_Fundos_AAAAMMDD.html` — arquivo único com dados,
  gráficos e estilos embutidos (funciona offline; a fonte Inter é carregada da internet quando disponível).
- **PDF:** botão *Imprimir / PDF* no topo do relatório.

## O que há em cada fundo

Clique no fundo na tabela (ou nos atalhos *Rentab. mensal* / *Carteira* abaixo do nome):

- **Resumo** — indicadores, evolução de R$ 100, drawdown, características, PL e fluxos.
- **Rentabilidade mensal** — gráfico dos últimos 24 meses e tabela mês a mês desde o início do histórico, com
  benchmark, % do benchmark ou excesso, total do ano e acumulado.
- **Carteira** — última carteira divulgada à CVM (CDA), com visão consolidada (abre os fundos investidos) ou direta,
  composição por classe e maiores posições. Mostra a parcela em sigilo e, quando relevante, a carteira completa
  mais recente.

A página *Comparação* também traz a rentabilidade mês a mês dos fundos selecionados (últimos 12 meses).

**Fundos de mercado na Comparação:** a busca da página *Comparação* encontra, além da prateleira, ~7 mil fundos
de mercado (recorte em `pipeline/config.py → MERCADO`: abertos, não exclusivos, PL ≥ R$ 10 mi, ≥ 100 cotistas;
fundos de previdência — PGBL/VGBL, cujo cotista é a seguradora — entram só pelo critério de PL). A opção
"Só previdência" filtra a busca.
Mesma metodologia, mas sem dados comerciais (taxas, liquidez, estratégia = N/D). As demais páginas continuam só
com a planilha-base. A base de mercado (~95 MB em `dashboard/data/mercado/`) funciona no site e no
`dashboard/index.html`; não é embutida no relatório em arquivo único. Para desligar: `MERCADO["ativo"] = False`.

**Fundos listados (ETFs, FII, Fiagro, FI-Infra):** a busca da *Comparação* também encontra ~580 fundos negociados na B3
(por ticker, nome ou CNPJ). Para eles, a rentabilidade é o **retorno total**: preço de fechamento + proventos reinvestidos.

**Prateleira (planilha-base):** ~625 fundos ativos distribuídos pelo Itaú (Itaú Asset, FoF, Conta e Ordem, Kinea), importados
do *Mapa de Fundos*; os encerrados ficam com `ativo = 0`. O status de captação aparece como tag — **FECHADO** (fechado para
novas aplicações), **INIBIDO**, **CALENDÁRIO** (aplicações só em datas definidas) e **INVESTFONE** — e há o filtro *Captação*
na página Fundos. Taxas, prazos de cotização e descrição dos fundos importados ficam N/D até serem preenchidos.

**Página *Carteiras*:** monte uma ou mais carteiras (qualquer fundo: prateleira, mercado ou listado), defina o % de
cada fundo e compare as carteiras com as mesmas métricas da *Comparação*: rentabilidade por prazo (Mês a 48M, acumulada ou
anualizada), quadro de risco (volatilidade, Sharpe, drawdown, % de meses positivos e acima do CDI), evolução de R$ 100,
drawdown, risco × retorno, correlação, mês a mês e contribuição de cada fundo. Compra no início do período com os pesos informados, sem rebalancear, custos ou impostos.
As carteiras ficam salvas no navegador; **Copiar link** e **Exportar/Importar** levam-nas para outro computador ou colega,
e **Relatório (PDF)** imprime a página. O link sempre mostra os dados da data-base mais recente.

**Página *Comparação*:** tabelas *Rentabilidade por prazo* e *mês a mês* com fundos nas linhas e prazos/meses nas colunas;
★ marca o maior valor de cada coluna. **Copiar link** guarda a seleção de fundos num endereço.

**Página *Renda*:** comparação de fundos listados que pagam rendimentos (FII, Fiagro, FI-Infra e ETFs que distribuem):
- ranking filtrável (tipo, segmento, liquidez, "pagou nos 12 meses") com DY 12M, proventos, variação da cota, retorno total,
  P/VP e liquidez;
- para os fundos marcados: resumo; **simulação de renda mensal** (R$ por fundo → renda mensal por fundo e da carteira nos
  últimos 12 meses, contra o CDI); **histórico de distribuição de proventos** (desde jul/2022 para FII/Fiagro); **histórico da
  cota** (preço, volatilidade móvel de 3 meses, queda desde o pico); **rentabilidade mês a mês** em formato de lâmina
  (ano × mês: retorno total, variação da cota ou DY).

Fontes: preço da B3 (COTAHIST); proventos dos eventos corporativos da B3 (12 meses, acumulados a cada atualização) e,
antes disso, dos avisos aos cotistas do Fundos.NET (FII/Fiagro); PL, VP e cotistas da CVM. Período sem histórico oficial de
proventos = N/D. **Limitação atual:** para FI-Infra e ETFs só existe a janela de 12 meses da B3 (desde 08/10/2025); o histórico
cresce a cada mês. ETFs que nunca registraram provento na B3 (ex.: BOVA11, IVVB11) usam a variação da cota, com histórico
completo e aviso na tela. Para desligar: `LISTADOS["ativo"] = False` em `pipeline/config.py`.

## Versão online (GitHub Pages — sem custo)

O repositório no GitHub atualiza e publica o site sozinho, pelo workflow
`.github/workflows/atualizar-site.yml`:

- **Quando:** toda terça-feira às 07:00 (Brasília), automaticamente sempre que código ou a planilha-base forem
  enviados ao GitHub, e sempre que você pedir (GitHub → aba **Actions** →
  *Atualizar e publicar relatório* → **Run workflow**; dá para informar outra data-base ali).
- **O quê:** roda o mesmo `pipeline/build.py` (data-base = fechamento do mês anterior), publica o dashboard e
  disponibiliza no rodapé os downloads da planilha completa e do relatório em arquivo único.
- **Se os dados da data-base ainda não saíram** (começo do mês), o site anterior é mantido e a execução
  registra um aviso; na semana seguinte ele tenta de novo.
- **Para mudar fundos/cadastro online:** edite `data/input/cadastro_fundos.xlsx` e envie ao GitHub
  (pelo site: abrir o arquivo no repositório → ícone de lápis/“Upload files”; ou `git commit` + `git push`).
  A publicação começa sozinha ao enviar.
- **Custos:** nenhum. Repositório público → GitHub Actions e Pages gratuitos e sem limite de minutos.
  Os dados brutos (~1 GB) ficam no cache do Actions, não no repositório. Os históricos de proventos que só se constroem
  com o tempo ficam versionados em `data/historico/` (envie-os junto com o `git push`).
- **Atenção:** o repositório e o site são públicos (inclui a planilha-base).

## Como atualizar os dados (local)

```bat
atualizar.bat
```
ou
```bash
python pipeline/build.py
```

O pipeline:
1. lê a planilha-base `data/input/cadastro_fundos.xlsx`;
2. baixa os informes diários e as carteiras (CDA) da CVM que faltam (os 3 meses mais recentes são sempre rebaixados, pois a CVM republica retificações) e os cadastros de fundos;
3. baixa o CDI (BCB/SGS 12) e o Ibovespa;
4. calcula rentabilidades, risco e fluxos;
5. roda o controle de qualidade;
6. gera `dashboard/data/dataset.js`, `output/base_fundos_AAAAMMDD.xlsx` e `output/Relatorio_Fundos_AAAAMMDD.html`.

Opções:

| Comando | Uso |
|---|---|
| `python pipeline/build.py` | **Padrão: data-base = fechamento do mês anterior** (último dia útil). |
| `python pipeline/build.py --data-base ultima` | Data mais recente em que todos os fundos têm cota (relatório intramês). |
| `python pipeline/build.py --data-base 2026-08-31` | Data-base específica (ex.: refazer um fechamento antigo). |
| `python pipeline/build.py --offline` | Recalcula apenas com os arquivos já baixados (sem internet). |
| `python pipeline/build.py --forcar` | Gera mesmo que a CVM ainda não tenha cotas de todos os fundos na data-base (faltantes ficam N/D). |

O padrão pode ser trocado em `pipeline/config.py → DATA_BASE_PADRAO` (`"fechamento"` ou `"ultima"`).

**Quando rodar no mês:** a CVM costuma completar o informe diário do último dia útil em 1–2 dias úteis e o
CDI é publicado no dia útil seguinte. Se a data de fechamento ainda não estiver coberta, o pipeline **não gera**
o relatório e explica o motivo — rode de novo no dia seguinte. A carteira (CDA) de um mês só sai no mês
seguinte; o relatório usa a mais recente publicada.

**CDI:** coletado da API do BCB; se ela estiver fora do ar, o pipeline usa automaticamente o módulo web do
próprio SGS/BCB (mesma série) e confere os valores com a coleta anterior.

**Fundos listados:** a primeira execução baixa as cotações da B3 (~400 MB) e começa a ler os avisos de rendimentos do
Fundos.NET (~400 por mês de histórico, servidor lento). Cada execução gasta no máximo `LISTADOS["fnet_orcamento_min"]`
minutos nisso (padrão 20) e continua de onde parou na próxima; até completar, o retorno total de FII/Fiagro fica limitado à
janela da B3 (N/D antes dela).

Requisitos: Python 3.10+ e `pip install -r requirements.txt` (apenas `openpyxl`). A primeira execução
baixa ~550 MB da CVM e leva alguns minutos; as seguintes usam cache (`data/cache`).

## Como adicionar um fundo

1. Abra `data/input/cadastro_fundos.xlsx`, aba **Fundos**.
2. Inclua uma linha. Obrigatórios: `id` (único, sem espaços), `gestora_id`, `nome`, `cnpj`, `categoria`, `benchmark_id`.
   Os demais campos (taxas, prazos, descrição…) são opcionais — vazios aparecem como **N/D**.
3. Rode `atualizar.bat`. Cotas, PL, cotistas, início, administrador e classificação ANBIMA vêm automaticamente da CVM pelo CNPJ.
4. Confira a seção *Metodologia e fontes → Controle de qualidade* (ou a aba *Qualidade* da planilha gerada):
   CNPJ inválido, fundo não localizado na CVM ou nome divergente são sinalizados.

Para ocultar um fundo sem apagá-lo, use `ativo = 0`.

## Como adicionar uma nova gestora

1. Aba **Gestoras**: nova linha com `gestora_id` (ex.: `xp-asset`), nome, CNPJ e site.
2. Aba **Fundos**: cadastre os fundos com esse `gestora_id`. Categorias novas são aceitas livremente
   (a ordem de exibição preferida fica em `pipeline/config.py → CATEGORY_ORDER`).
3. Se a gestora tiver fonte de material própria, registre-a em `config.py → SOURCES` (aparece no rodapé).
4. Rode `atualizar.bat`. O filtro *Gestora* e o cabeçalho passam a exibir múltiplas gestoras automaticamente.

## Como adicionar um benchmark

Aba **Benchmarks**: `benchmark_id`, nome, `fonte` (`bcb_sgs` com `tipo_serie=taxa_diaria_pct`, ou
`yahoo` com `tipo_serie=nivel`) e `codigo_serie`. Use `fonte = nd` quando não houver série pública —
o dashboard mostra as métricas relativas como N/D em vez de usar um substituto.
Para uma fonte nova (ex.: ANBIMA Data para IMA-B), implemente uma função em `pipeline/benchmarks.py`
que devolva `{data_iso: valor}`.

## Como recalcular / criar indicadores

- **Nova janela de rentabilidade:** acrescente um item em `RETURN_WINDOWS` (`pipeline/config.py`), ex.
  `{"id": "60m", "label": "60M", "long": "Últimos 60 meses", "type": "months", "n": 60}`. O pipeline passa
  a baixar o histórico necessário e o dashboard cria a coluna automaticamente. Para risco nessa janela,
  inclua o id em `RISK_WINDOWS`.
- **Novo indicador:** calcule-o em `pipeline/metrics.py` (`fund_metrics` ou `flows`), e registre-o no
  dashboard em `dashboard/assets/js/core.js` (lista `M`). A partir daí ele pode ser usado em colunas
  (`views/funds.js → COLS`), filtros (`FILTERS`) e comparação.
- **Parâmetros** (252 dias úteis, cobertura mínima de 90%, limites de variação suspeita): `pipeline/config.py`.

## Estrutura

```
Relatorio_Fundos/
├── atualizar.bat                 # roda o pipeline completo (local)
├── .github/workflows/            # atualização semanal + publicação no GitHub Pages
├── requirements.txt
├── data/
│   ├── input/cadastro_fundos.xlsx   # PLANILHA-BASE (única fonte editada manualmente)
│   ├── historico/                   # proventos acumulados (eventos B3 + avisos Fundos.NET) — versionado
│   ├── raw/                         # downloads oficiais (CVM, benchmarks) — cache
│   └── cache/                       # extrações filtradas por mês
├── pipeline/
│   ├── build.py        # orquestração (Dados → Tratamento → Dashboard)
│   ├── config.py       # janelas, parâmetros, fontes
│   ├── cadastro.py     # leitura/validação da planilha
│   ├── cvm.py          # informe diário + cadastros CVM
│   ├── benchmarks.py   # CDI (BCB), Ibovespa
│   ├── carteira.py     # carteiras (CDA/CVM), look-through e conciliação
│   ├── mercado.py      # universo de fundos de mercado (só para a Comparação)
│   ├── b3.py           # coleta B3 (COTAHIST, fundos listados, eventos) e Fundos.NET; informe mensal FII/Fiagro
│   ├── listados.py     # fundos listados: retorno total, proventos, DY, P/VP (páginas Renda e Comparação)
│   ├── metrics.py      # rentabilidade, risco, fluxos
│   ├── quality.py      # controle de qualidade
│   ├── export_xlsx.py  # planilha consolidada
│   └── bundle.py       # HTML único para distribuição
├── dashboard/
│   ├── index.html
│   ├── data/dataset.js           # gerado — não editar
│   └── assets/ (css, js/views, vendor/echarts)
├── output/                       # relatório em arquivo único + planilha consolidada
└── docs/ (METODOLOGIA.md, DICIONARIO_DADOS.md)
```

## Princípios de dados

- Nenhum número é digitado no dashboard: tudo vem do dataset gerado.
- Dados quantitativos só de fonte primária (CVM/BCB); nada é interpolado, estimado ou substituído por proxy.
- Ausência de dado = **N/D** com o motivo no tooltip.
- Uma única data-base para todos os fundos.
- Detalhes: [docs/METODOLOGIA.md](docs/METODOLOGIA.md) e [docs/DICIONARIO_DADOS.md](docs/DICIONARIO_DADOS.md).
