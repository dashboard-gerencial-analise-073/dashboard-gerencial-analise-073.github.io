# Metodologia

A mesma metodologia aparece, resumida, na página *Metodologia e fontes* do dashboard.
Implementação de referência: `pipeline/metrics.py`.

## 1. Fontes e hierarquia

| Dado | Fonte primária | Observação |
|---|---|---|
| Cota, PL, cotistas, captações, resgates (diários) | CVM — Informe Diário (`inf_diario_fi_AAAAMM.zip`) | Fonte oficial obrigatória para todos os fundos regulados. |
| Denominação, situação, administrador, gestor, início, classificação ANBIMA | CVM — `registro_fundo_classe.zip` (RCVM 175) e `cad_fi.csv` (legado) | Início = início de atividade do cadastro legado; se ausente, data de início da classe. |
| CDI | BCB — SGS série 12 | Taxa DI diária (% a.d.). API `api.bcb.gov.br`; se indisponível, módulo web do SGS (`www3.bcb.gov.br/sgspub`), mesma série, com conferência contra a coleta anterior. |
| Ibovespa | Yahoo Finance (^BVSP) — secundária | A série do BCB (SGS 7) foi descontinuada em 2019. |
| Categoria, estratégia, taxas, prazos, público, alvos | Material comercial da gestora | Sem data de referência no documento. |
| Carteiras (posições, sigilo, PL da carteira) | CVM — CDA (`cda_fi_AAAAMM.zip`) | Mensal; divulgação de posições pode ser postergada (sigilo). |
| Preço de FII, Fiagro, FI-Infra, ETF (diário) | B3 — COTAHIST (séries históricas) | Fechamento, volume e nº de negócios por ticker. |
| Ticker × CNPJ, proventos (12 meses), desdobramentos/grupamentos | B3 — Fundos listados (eventos corporativos) | Proventos acumulados entre execuções. |
| Proventos de FII/Fiagro antes da janela da B3 | B3 — Fundos.NET (aviso aos cotistas estruturado) | XML enviado pelo administrador. |
| PL, valor patrimonial da cota, cotistas, segmento de FII/Fiagro | CVM — Informe mensal FII / Fiagro | Último mês ≤ data-base. |
| IMA-B, IMA-B 5, IFIX, SMLL, IPCA+Yield IMA-B | — | Sem série pública estruturada: comparações N/D. ETFs **não** são usados como proxy. |

Validação cruzada automática: CNPJ (dígito verificador + existência na CVM), nome comercial ×
denominação CVM, gestor na CVM, taxa de administração do material × cadastro legado da CVM.

## 2. Calendário e data-base

- Dias úteis = datas da série do CDI (BCB), que exclui feriados nacionais.
- Data-base padrão = **último dia útil do mês anterior** (`DATA_BASE_PADRAO = "fechamento"`). O relatório só é
  gerado se o CDI cobrir a data e se ≥ 95% dos fundos ativos tiverem cota nela (senão o pipeline para e explica;
  `--forcar` ignora a exigência de cobertura).
- Alternativa `--data-base ultima`: data mais recente em que **todos** os fundos com envio regular (cota nos 10
  dias úteis anteriores) têm cota; se não houver nos últimos 5 dias úteis, aceita-se cobertura ≥ 95%.
- Com data-base no fechamento, a janela "Mês" corresponde ao mês fechado e "Mês ant." ao mês anterior a ele.
- Fundo sem cota na data-base → métricas N/D (não se usa data anterior para ele).

## 3. Rentabilidade

- `R = Cota_fim / Cota_início − 1` (composição).
- Janelas: mês atual (fim do mês anterior → data-base), mês anterior (mês calendário completo),
  ano (31/12 anterior → data-base), 12/24/36/48 meses (data-base − N meses → data-base).
- Início da janela = último dia útil ≤ data-alvo. Sem cota exatamente nessa data: aceita-se a última cota
  em até 5 dias úteis antes. O fundo precisa existir na data de início; senão N/D.
- Anualização (≥ 12M): `(1 + R)^(252/du) − 1`, `du` = dias úteis do período.
- Rentabilidade mensal: fim de mês a fim de mês; mês corrente até a data-base (marcado com *).
  Mês de início do fundo (parcial) = N/D.
- Consistência interna verificada a cada execução: YTD direto = composição dos meses do ano.

## 4. Benchmark

- CDI: `Índice(t) = Índice(t−1) × (1 + DI(t−1)/100)` — a cota de t incorpora a taxa do dia útil anterior.
- Ibovespa: nível de fechamento.
- Excesso = `R_fundo − R_bench` (p.p.). % do benchmark = `R_fundo / R_bench` (só índices de juros, `R_bench > 0`).
- Excesso anualizado = diferença das taxas anualizadas.

## 5. Risco (janelas 12/24/36/48M)

- Retornos diários `r_t = Cota_t / Cota_{t−1} − 1`, apenas pares consecutivos com dado.
- Cobertura mínima: 90% dos dias úteis da janela; senão N/D.
- Volatilidade = desvio-padrão amostral × √252.
- Sharpe = (R a.a. fundo − R a.a. CDI) / volatilidade (mesma janela).
- Máximo drawdown = mín(Cota_t / máx_{s≤t} Cota_s − 1) dentro da janela; datas do pico e do vale guardadas.
- Beta = cov(r_f, r_b)/var(r_b); tracking error = dp(r_f − r_b) × √252; IR = (R a.a. f − R a.a. b)/TE.
  Apenas para benchmark de mercado com série diária (Ibovespa).
- % meses positivos e % meses acima do benchmark: meses calendário completos dentro da janela.

Não incluídos (justificativa): alfa de Jensen (redundante com excesso de retorno para fundos CDI e
instável com pouco histórico); VaR (sem fonte pública; estimativa própria não comparável);
correlação é calculada sob demanda na página de comparação.

## 6. Fluxos

- PL e cotistas na data-base; PL e cotistas 12 meses antes.
- Captação líquida 12M = Σ(captação − resgate) no período (exige histórico desde o início da janela).
- PL médio 12M = média dos PL diários.

## 7. Carteiras (CDA/CVM) — `pipeline/carteira.py`

- Fonte: `cda_fi_AAAAMM.zip` (blocos BLC_1 a BLC_8 = títulos públicos, cotas de fundos, swaps, ações/derivativos,
  depósitos, crédito privado, exterior e demais; `CONFID` = posições em sigilo agregadas; `PL`). Arquivos `cda_fie_*`
  (outro regime) são ignorados. Consulta `CDA_LOOKBACK_MONTHS` meses (padrão 6).
- Última carteira aberta = mês mais recente com posições do fundo. Se mais de 5% do PL estiver em sigilo,
  guarda-se também a carteira completa mais recente (sigilo < 1%).
- Look-through: cota de fundo investido → carteira do investido na mesma data × (valor da cota ÷ PL do investido),
  até 4 níveis, com proteção contra ciclos. Sem carteira na mesma data → permanece como cota.
- Conciliação: (Σ posições + sigilo) ÷ PL. Se um investido não concilia (±2%), suas posições entram como reportadas
  e a diferença vira a linha "Ajuste de conciliação" (o total do fundo continua 100%). Causa típica: exterior e
  derivativos informados em valor bruto (sinal não disponível na CDA).
- Sinal negativo para passivos (valores a pagar, opções lançadas, futuros vendidos, obrigações, swap a pagar).
  Derivativos: valor de mercado/ajuste reportado, não nocional.
- Posições idênticas (tipo, ativo, código, vencimento) vindas de fundos diferentes são somadas.
- Dashboard: 40 maiores posições + composição por classe; planilha: carteira consolidada completa (aba Carteiras).

## 8. Fundos de mercado (Comparação) — `pipeline/mercado.py`

- Universo na data-base (`config.MERCADO`): classes do cadastro RCVM 175 em funcionamento normal, condomínio aberto,
  não exclusivas, com PL ≥ R$ 10 mi e ≥ 100 cotistas no Informe Diário. Classes reportadas só por subclasse entram
  pela soma das subclasses (PL/cotistas) e pela cota da subclasse com mais cotistas.
- Fundos da planilha-base são excluídos do universo (já estão no dataset principal, com dados comerciais).
- Métricas: as mesmas funções de `metrics.py`, no mesmo eixo de dias úteis. Benchmark pelo indicador de desempenho
  da CVM (DI/Selic → CDI; Ibovespa → IBOV; demais → N/D).
- Salto diário de cota acima de 2× o limite de retorno suspeito: a série passa a valer só a partir do salto.
- Saída: `dashboard/data/mercado/indice.js` (busca) e `s/NNN.js` (lotes carregados sob demanda).

## 9. Fundos listados na B3 (páginas Renda e Comparação) — `pipeline/listados.py`, `pipeline/b3.py`

- **Universo**: lista "Fundos listados" da B3 (tipos em `config.LISTADOS["tipos"]`: FII, Fiagro, FI-Infra e ETFs), com ticker e
  CNPJ pela ficha de cada fundo na B3. Entram os que tiveram negócio no último mês até a data-base.
- **Preço**: fechamento oficial do COTAHIST (B3), mercado à vista (TPMERC 010), dividido pelo fator de cotação. Anos fechados
  pelo arquivo anual; ano corrente pelos arquivos mensais e diários.
- **Eventos de cotas** (eventos corporativos da B3, histórico completo): desdobramento e bonificação, com fator em %
  (cotas × (1 + fator/100)), e grupamento, com fator = cotas novas por cota antiga. O preço anterior ao evento é dividido pelo
  multiplicador. Cada evento é conferido com o salto de preço observado (tolerância de 30%). Se não bater, ou se houver
  variação acima de 50% em um pregão sem evento, a série passa a valer só depois dele (alertas `EVENTO_COTAS` e `SALTO_PRECO`).
- **Proventos** (R$ por cota, data-com; rendimentos e amortizações):
  1. eventos corporativos da B3: proventos com data-com nos 365 dias anteriores à coleta. A cada execução a coleta é somada
     ao histórico (`data/historico/eventos_b3.json`), então a cobertura cresce com o tempo;
  2. antes dessa janela, só para FII e Fiagro: avisos aos cotistas estruturados ("Rendimentos e Amortizações") do Fundos.NET,
     enviados pelos administradores (`data/historico/fnet_rendimentos.json`). Se houver mais de um aviso para a mesma data-com,
     vale o mais recente (reapresentação). Um mês de data-com só é considerado coberto quando os avisos entregues no mês
     anterior, no próprio mês e no seguinte foram todos lidos. A coleta tem limite de tempo por execução
     (`fnet_orcamento_min`) e é completada ao longo das execuções.
  - Fora da cobertura comprovada, proventos, DY e retorno total ficam **N/D**: nunca se presume "sem provento".
  - Valores na base atual de cotas = valor original ÷ eventos de cotas posteriores à data-com.
  - Fontes não oficiais (ex.: Yahoo) foram testadas e descartadas: faltavam pagamentos e o histórico era incompleto.
- **Preço de referência numa data**: último fechamento em até 5 pregões antes, para fundos pouco negociados. O risco usa só
  pregões consecutivos com negócio.
- **Retorno total** (proventos reinvestidos na data ex = 1º pregão após a data-com), entre pregões consecutivos k < j:
  `RT_j = RT_k × (P_j + D) / P_k`, com D = proventos com data-com em [data_k, data_j). A série começa no 1º pregão em que todos os
  proventos seguintes são conhecidos. Janelas, anualização e risco (vol., drawdown, Sharpe vs CDI) são calculados com as
  funções de `metrics.py`. **Variação da cota** = só o preço ajustado.
- **DY**: `DY(período) = Σ proventos com data-com no período ÷ fechamento no início do período`. No mês, usa o fechamento do mês
  anterior; no ano, o do ano anterior; nas janelas N meses, o preço no início da janela. **DY 12M sobre o preço atual** =
  proventos dos últimos 12 meses ÷ preço na data-base.
- **Regularidade**: meses com pagamento (12M e 24M). Coeficiente de variação dos proventos mensais em 12M (meses sem provento
  contam como zero). Tendência = média dos últimos 6 meses ÷ média dos 6 anteriores − 1.
- **P/VP** = preço na data-base ÷ valor patrimonial da cota da CVM: informe mensal de FII e de Fiagro (último mês ≤ data-base);
  para FI-Infra e ETFs, informe diário. O VP é ajustado por eventos de cotas posteriores à sua data. Com P/VP fora de 0,1–10,
  o VP é considerado incompatível (base ou unidade diferente) e o P/VP não é exibido (`PVP_INCOERENTE`).
- **Liquidez**: volume financeiro médio diário (3 e 12 meses) = volume total ÷ pregões do período, e % de pregões com negócio.
- **Referência**: não há benchmark com série pública para esses fundos (IFIX, IMA-B etc.). Exibe-se o CDI no mesmo período,
  sem tratá-lo como benchmark. Valores brutos de IR, corretagem e emolumentos.
- **Simulador de carteira de renda** (página Renda): para cada fundo, cotas inteiras = ⌊valor alocado ÷ preço na data-base⌋
  (a sobra fica fora). Renda do mês = cotas × rendimentos por cota com data-com no mês (base atual de cotas), com as mesmas
  cotas nos 12 meses anteriores e sem reinvestir. Amortizações aparecem à parte. Média, mínimo e máximo usam só os meses com
  histórico oficial (quantos meses, quando forem menos de 12). Total da carteira só quando todos os fundos têm o dado do mês.
  Referência: valor investido × CDI do mês (bruto). Mostra renda passada, não projeção.
- **Simulação de renda** (página Renda): compra pelo fechamento no início do período, com cotas fracionárias e sem custos;
  proventos recebidos em dinheiro (data-com até a data-base) e cotas avaliadas pelo fechamento na data-base. É só uma
  ilustração com dados passados.
- **Saída**: `dashboard/data/listados/indice.js` (ranking e busca) e `s/NNN.js` (séries, proventos e tabelas mês a mês e ano a
  ano), carregados sob demanda. Também vão para as abas `Listados_Renda` e `Listados_Proventos` da planilha consolidada. Não
  são embutidos no HTML único.

## 10. Tratamento de dados

- Nada é interpolado, estimado ou preenchido. Cota 0 reportada à CVM = ausente.
- Subclasses (RCVM 175): série da classe; se a CVM passar a reportar só por subclasse, continua pela
  subclasse com mais cotistas **apenas se a cota for contínua** (variação ≤ limite de retorno suspeito);
  PL/cotistas/fluxos = soma das subclasses. Sinalizado no fundo.
- Variação diária acima de 8% (15% para renda variável) é sinalizada para conferência (pode ser evento
  societário, amortização, erro de reporte) — não é removida automaticamente.

## 11. Controle de qualidade (automático)

Erros, alertas e informativos ficam na página *Metodologia e fontes* e na aba *Qualidade* da planilha:
CNPJ inválido/duplicado, id duplicado, gestora/benchmark inexistente, fundo não localizado na CVM,
situação diferente de "Em Funcionamento Normal", nome divergente, gestor divergente, sem informe diário,
cota defasada, cota zerada, série incompleta, variação atípica, PL negativo, datas fora do calendário,
taxa fora de faixa (erro de unidade), liquidação < cotização, taxa divergente entre fontes,
inconsistência de cálculo, benchmark sem série ou defasado, fundo sem carteira na CDA, carteira que não concilia
com o PL, carteira com sigilo relevante, look-through parcial.
