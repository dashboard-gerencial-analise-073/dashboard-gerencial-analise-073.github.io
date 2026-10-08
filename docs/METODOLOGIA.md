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

## 8. Tratamento de dados

- Nada é interpolado, estimado ou preenchido. Cota 0 reportada à CVM = ausente.
- Subclasses (RCVM 175): série da classe; se a CVM passar a reportar só por subclasse, continua pela
  subclasse com mais cotistas **apenas se a cota for contínua** (variação ≤ limite de retorno suspeito);
  PL/cotistas/fluxos = soma das subclasses. Sinalizado no fundo.
- Variação diária acima de 8% (15% para renda variável) é sinalizada para conferência (pode ser evento
  societário, amortização, erro de reporte) — não é removida automaticamente.

## 9. Controle de qualidade (automático)

Erros, alertas e informativos ficam na página *Metodologia e fontes* e na aba *Qualidade* da planilha:
CNPJ inválido/duplicado, id duplicado, gestora/benchmark inexistente, fundo não localizado na CVM,
situação diferente de "Em Funcionamento Normal", nome divergente, gestor divergente, sem informe diário,
cota defasada, cota zerada, série incompleta, variação atípica, PL negativo, datas fora do calendário,
taxa fora de faixa (erro de unidade), liquidação < cotização, taxa divergente entre fontes,
inconsistência de cálculo, benchmark sem série ou defasado, fundo sem carteira na CDA, carteira que não concilia
com o PL, carteira com sigilo relevante, look-through parcial.
