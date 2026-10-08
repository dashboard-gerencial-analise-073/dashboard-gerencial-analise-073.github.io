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

## Versão online (GitHub Pages — sem custo)

O repositório no GitHub atualiza e publica o site sozinho, pelo workflow
`.github/workflows/atualizar-site.yml`:

- **Quando:** toda terça-feira às 07:00 (Brasília) e sempre que você pedir (GitHub → aba **Actions** →
  *Atualizar e publicar relatório* → **Run workflow**; dá para informar outra data-base ali).
- **O quê:** roda o mesmo `pipeline/build.py` (data-base = fechamento do mês anterior), publica o dashboard e
  disponibiliza no rodapé os downloads da planilha completa e do relatório em arquivo único.
- **Se os dados da data-base ainda não saíram** (começo do mês), o site anterior é mantido e a execução
  registra um aviso; na semana seguinte ele tenta de novo.
- **Para mudar fundos/cadastro online:** edite `data/input/cadastro_fundos.xlsx` e envie ao GitHub
  (pelo site: abrir o arquivo no repositório → ícone de lápis/“Upload files”; ou `git commit` + `git push`).
  Depois rode o workflow manualmente para publicar na hora.
- **Custos:** nenhum. Repositório público → GitHub Actions e Pages gratuitos e sem limite de minutos.
  Os dados brutos (~600 MB) ficam no cache do Actions, não no repositório.
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
│   ├── raw/                         # downloads oficiais (CVM, benchmarks) — cache
│   └── cache/                       # extrações filtradas por mês
├── pipeline/
│   ├── build.py        # orquestração (Dados → Tratamento → Dashboard)
│   ├── config.py       # janelas, parâmetros, fontes
│   ├── cadastro.py     # leitura/validação da planilha
│   ├── cvm.py          # informe diário + cadastros CVM
│   ├── benchmarks.py   # CDI (BCB), Ibovespa
│   ├── carteira.py     # carteiras (CDA/CVM), look-through e conciliação
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
