# Dicionário de dados

## Entrada — `data/input/cadastro_fundos.xlsx`

### Aba `Gestoras`
| Coluna | Descrição |
|---|---|
| gestora_id | Chave (ex.: `itau-asset`). |
| nome, cnpj_gestor, site, observacoes | Identificação da gestora. |

### Aba `Benchmarks`
| Coluna | Descrição |
|---|---|
| benchmark_id | Chave usada na aba Fundos (ex.: `CDI`, `IBOV`). |
| nome | Nome exibido. |
| fonte | `bcb_sgs`, `yahoo` ou `nd` (sem série). |
| codigo_serie | Código na fonte (SGS: `12`; Yahoo: `^BVSP`). |
| tipo_serie | `taxa_diaria_pct` (taxa % ao dia, vira índice acumulado) ou `nivel` (índice de mercado). |
| observacoes | Exibido no dashboard quando o índice não tem série. |

### Aba `Fundos` (dados estáticos/qualitativos)
Descrição de cada coluna na aba `Dicionario` da própria planilha. Flags usam 1/0.
Campos numéricos: `cotizacao_aplicacao_d`, `cotizacao_resgate_d`, `liquidacao_resgate_d` (D+),
`taxa_adm_pct` (% a.a.), `taxa_perf_pct` (% do excedente; vazio = não há), `risco_lamina` (1–5).

Colunas adicionadas com a importação do Mapa de Fundos (aba `Fundos`): `status_captacao` (ABERTO, ABERTO | Calendário,
ABERTO | Investfone, FECHADO, INIBIDO, ENCERRADO), `origem_distribuicao` (Itaú Asset, FoF, Conta e Ordem, Kinea) e
`secao_mapa` (seção do mapa). Nos fundos importados, `familia` = estratégia do mapa, `estrutura` = origem e
`liquidacao_resgate_d` = prazo do mapa (dias); gestor e público vêm do cadastro da CVM e o benchmark do indicador de
desempenho informado à CVM (`SEM` = sem índice com série pública).

## Saída — `dashboard/data/dataset.js`

`window.FUNDS_DATASET = { meta, gestoras, benchmarks, eixo, bench_series, fundos, qualidade }`

| Campo | Conteúdo |
|---|---|
| meta | data_base, gerado_em, arquivos CVM, janelas (`janelas`, `janelas_risco`), fontes, categorias. |
| benchmarks[] | id, nome, fonte, disponivel, mercado (bool), ultima_data, observacoes. |
| eixo[] | Dias úteis (ISO) — eixo comum de todas as séries. |
| bench_series | `{CDI: índice acumulado, IBOV: nível}` alinhados ao eixo (null = sem dado). |
| fundos[] | Um objeto por fundo (abaixo). |
| qualidade[] | `{nivel, fundo_id, codigo, mensagem}`. |

### Objeto do fundo
| Campo | Conteúdo |
|---|---|
| id, nome, cnpj, gestora_id, categoria, familia, estrutura, benchmark_id | Cadastro. |
| alvo_tipo, alvo, cot_apl, cot_resg, liq_resg, prazo_tipo, taxa_adm, taxa_perf, taxa_perf_indice | Cadastro (material da gestora). |
| qualificado, previdencia, isento_ir, risco_lamina, descricao, fonte_cadastro | Cadastro. |
| cvm | denominacao, situacao, administrador, gestor, classificacao_anbima, publico_alvo, tributacao_lp, fonte. |
| inicio, primeira_cota, ultima_cota | Datas (ISO). |
| ret[janela] | `f` fundo, `b` benchmark, `x` excesso, `pb` % bench, `fa`/`ba`/`xa` anualizados, `n_du`, `start`, `end`, `nd`/`nd_b` motivos de N/D. |
| risk[janela] | `vol`, `sharpe`, `mdd`, `mdd_pico`, `mdd_vale`, `pct_dias_pos`, `pct_meses_pos`, `pct_meses_acima_bench`, `beta`, `te`, `ir`, `corr`, `cobertura`, `nd`. |
| flow | pl, cotistas, data, pl_12m_atras, cotistas_12m_atras, captacao_liquida_12m, pl_medio_12m. |
| mensal | `{"AAAA-MM": [ret_fundo, ret_bench]}`. |
| anual | `{"AAAA": [ret_fundo, ret_bench]}` (ano corrente = YTD). |
| pl_mensal | `{"AAAA-MM": [PL, cotistas]}` no último dia útil do mês. |
| serie | `{i0, q[]}` — cotas diárias a partir da posição `i0` do eixo. |
| carteira | `{ultima, completa}` — cada uma: data, pl, conciliacao, n_direta, n_consolidada, sigilo_pct, ajuste_pct, grupos[] e grupos_direta[] (`{grupo, valor, pct}`), top[] e top_direta[] (`{grupo, aplic, tipo, ativo, codigo, emissor, venc, valor, pct}`), fundos_sem_carteira[], fundos_nao_conciliados[]. `completa` só existe quando a última carteira tem > 5% em sigilo. |
| status, origem, secao | Status de captação, origem e seção do Mapa de Fundos. |
| carteira_lote | Lote de `dashboard/data/carteiras/NNN.js` com a carteira (carregada sob demanda; embutida no HTML único). |
| qc[] | Itens de qualidade do fundo. |

Percentuais são frações decimais (0,0123 = 1,23%). Valores monetários em R$.

## Saída — `dashboard/data/listados/` (fundos listados na B3)

`indice.js` → `window.__LST_INDEX({meta, fundos})`: uma linha por fundo, na ordem de `meta.campos`
(id, ticker, nome, tipo, segmento, preco, dy12, prov12, meses_pag12, var12, rt12, rt36a, pvp, liq3m, pl, vol12, lote, cnpj,
gestor, cobertura, sem_proventos, cv12, rt24a, tipo_b3, n_prov). `meta`: data_base, n, por_tipo, fnet_cobertura,
b3_cobertura, fnet_avisos.

`s/NNN.js` → `window.__LST_SHARD(NNN, {id: fundo})`. Objeto do fundo listado (id `l:TICKER`):

| Campo | Conteúdo |
|---|---|
| ticker, tipo (FII/Fiagro/FI-Infra/ETF), tipo_b3, subtipo, segmento, isin, cnpj, cvm | Cadastro (B3 + CVM). |
| ret[janela] | Retorno total (mesmo formato dos fundos) + `cdi` (CDI no período) e `x_cdi` (diferença). |
| ret_preco[janela] | Só variação da cota. |
| risk[janela] | Risco do retorno total. |
| renda | cobertura (data-com a partir da qual os proventos são completos), preco, preco_data, dy12, prov12, prov24, meses_pag12/24, prov_med12, prov_min12, prov_max12, cv12, tend6, amort12, dy_12m…dy_48m, ultimo{data_com, pagamento, valor, tipo, fonte}, isento_ir, pvp, vp, vp_data, vp_fonte. |
| liq | vol_3m, vol_12m (R$/dia), pregoes_3m, pregoes_12m (fração de pregões com negócio). |
| meses | `{"AAAA-MM": [proventos R$/cota, DY, variação da cota, retorno total, amortização]}` (null = fora da cobertura). |
| anos | `{"AAAA": [proventos, DY do ano, variação, retorno total, nº de meses]}`. |
| proventos | `[[data_com, pagamento, valor base atual, R/A, fonte B/F]]`. |
| serie / serie_preco | `{i0, q[]}` — índice de retorno total / preço ajustado, alinhados ao eixo. |

Históricos acumulados (versionados): `data/historico/eventos_b3.json` (eventos corporativos coletados, com a data da primeira
coleta de cada fundo) e `data/historico/fnet_rendimentos.json` (avisos do Fundos.NET lidos, por id do documento).

## Saída — `output/base_fundos_AAAAMMDD.xlsx`
Abas: Fontes, Fundos (cadastro + CVM + todos os indicadores), Rentab_Mensal, Cotas_Diarias, Carteiras (carteira consolidada completa de cada fundo), Listados_Renda (resumo de renda dos fundos listados), Listados_Proventos (todos os proventos usados, com fonte e documento), Qualidade.
