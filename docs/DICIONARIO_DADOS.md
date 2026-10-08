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
| qc[] | Itens de qualidade do fundo. |

Percentuais são frações decimais (0,0123 = 1,23%). Valores monetários em R$.

## Saída — `output/base_fundos_AAAAMMDD.xlsx`
Abas: Fontes, Fundos (cadastro + CVM + todos os indicadores), Rentab_Mensal, Cotas_Diarias, Carteiras (carteira consolidada completa de cada fundo), Qualidade.
