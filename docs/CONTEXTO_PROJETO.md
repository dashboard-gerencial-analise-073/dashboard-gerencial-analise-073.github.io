# Contexto do projeto — Relatório de Fundos (para continuar em outro chat)

## O que é
Dashboard de análise e comparação de fundos de investimento (começou com a prateleira da Itaú Asset, 61 fundos).
Pipeline Python gera os dados → dashboard HTML/JS estático. Uso interno e para clientes.

- **Pasta local:** `C:\Users\vinim\OneDrive\Área de Trabalho\Códigos\Relatorio_Fundos`
- **Site público:** https://dashboard-gerencial-analise-073.github.io/
- **Repositório (público):** https://github.com/dashboard-gerencial-analise-073/dashboard-gerencial-analise-073.github.io
  (organização GitHub `dashboard-gerencial-analise-073`; conta pessoal do usuário: `viniciusmarquesserpeloni-commits`;
  commits usam e-mail noreply `282683608+viniciusmarquesserpeloni-commits@users.noreply.github.com`)
- Ambiente: Windows 11, Python 3.13 (stdlib + openpyxl), git; sem Node. Git Credential Manager já autenticado (push funciona).

## Estrutura
```
data/input/cadastro_fundos.xlsx   PLANILHA-BASE (única edição manual): abas Gestoras, Benchmarks, Fundos, Dicionario
pipeline/  build.py (orquestra) · config.py (parâmetros) · cadastro.py · cvm.py (informe diário/cadastros)
           benchmarks.py (CDI BCB + fallback SGS web; Ibovespa Yahoo) · metrics.py · quality.py · carteira.py (CDA)
           mercado.py (universo de mercado p/ Comparação) · export_xlsx.py · bundle.py (HTML único) · util.py (feriados)
dashboard/ index.html · assets/css/styles.css · assets/js/{core,charts,app}.js
           views/{overview,funds,detail,portfolio,compare,analysis,methodology}.js · vendor/echarts.min.js
           data/dataset.js (gerado) · data/site.js (gerado) · data/mercado/{indice.js, s/NNN.js} (gerado)
output/    base_fundos_AAAAMMDD.xlsx · Relatorio_Fundos_AAAAMMDD.html (arquivo único)
docs/      METODOLOGIA.md · DICIONARIO_DADOS.md · este arquivo
.github/workflows/atualizar-site.yml   atualização + publicação no GitHub Pages
atualizar.bat                          roda o pipeline local e abre o dashboard
```
Gitignored: data/raw, data/cache, output/, dataset.js, site.js, data/mercado/.

## Fontes de dados
- **CVM Dados Abertos:** informe diário (cota, PL, cotistas, fluxos), cadastro RCVM 175 + legado, CDA (carteiras).
- **BCB SGS 12 (CDI):** API `api.bcb.gov.br`; se cair, fallback `www3.bcb.gov.br/sgspub` (validado: 0 divergências).
- **Ibovespa:** Yahoo (^BVSP) — série do BCB descontinuada. IMA-B, IMA-B5, IFIX, SMLL, IPCA+Yield IMA-B: sem série → N/D (sem proxy).
- **Material comercial Itaú** (fotos): categoria, estratégia, taxas, cotização, alvos, público → planilha-base.

## Regras e decisões principais
- **Data-base padrão = fechamento do mês anterior** (último dia útil; calendário com feriados nacionais).
  Se CVM/CDI não cobrem a data → pipeline PARA com mensagem (não troca de data). `--data-base ultima|AAAA-MM-DD`, `--offline`, `--forcar`.
- Nada é interpolado/estimado; ausência = N/D com motivo (tooltip). Retornos por composição de cotas; anualização 252 du (≥12M).
- Risco: vol √252, Sharpe vs CDI, drawdown, beta/TE/IR só vs Ibovespa; cobertura mínima 90%.
- Subclasses RCVM 175: série continua pela subclasse com mais cotistas se contínua. Cota zero da CVM = ausente.
- **Carteira (CDA):** última divulgada + "completa mais recente" se sigilo > 5%; visão consolidada (look-through até 4 níveis)
  e direta; "Ajuste de conciliação" explícito quando carteira reportada não fecha com PL (offshore/derivativos em valor bruto).
- **Fundos de mercado (só na página Comparação):** ~7.164 fundos (2.990 + 4.204 previdência). Recorte em `config.MERCADO`:
  aberto, em funcionamento, PL ≥ R$10 mi; não exclusivo e ≥100 cotistas, EXCETO previdência (FIE: cotista = seguradora).
  Mesma metodologia; sem dados comerciais (N/D). Selos MERCADO/PREV, filtro "Só previdência". Não entram no HTML único.
- Página Fundos/Visão geral/Análise = só planilha-base. Comparação sem limite de fundos (8 cores + linha tracejada/pontilhada).
- Data-base atual publicada: 30/09/2026.

## Achados de qualidade conhecidos
- Artax: CNPJ da foto estava errado → corrigido para 42.698.615/0001-83.
- Dual Advanced: na CVM chama "Itaú Dual Private Markets" (provável mudança de nome) — sinalizado.
- CDI Mais: cotas zeradas/ausentes ago/2025–fev/2026 → janelas longas N/D.
- Dunamis: CVM reporta por subclasse desde 04/09/2026 → regra de subclasse aplicada.
- FIDC Soneto: não reporta no informe diário nem CDA → N/D.
- Diferenciado: descrição impressa errada (igual à do Inflation Equity) → N/D.

## Publicação (GitHub Actions, custo zero)
- Gatilhos: terça 07:00 BRT, push em pipeline/dashboard/data/input/workflows, e manual (Actions → Run workflow, aceita data-base).
- Monta site = dashboard + downloads (xlsx e HTML único) + site.js {downloads:true}. Se dados da data-base não saíram, mantém site anterior.
- Cache do Actions guarda data/raw e data/cache (~600 MB + mercado).

## Como fazer
- Atualizar local: `atualizar.bat` (ou `python pipeline/build.py`). Publicar: `git add -A && git commit && git push`.
- Novo fundo: linha na aba Fundos da planilha (id, gestora_id, nome, cnpj, categoria, benchmark_id obrigatórios) → push.
- Nova gestora: aba Gestoras + fundos com o gestora_id. Nova janela: `RETURN_WINDOWS` em config.py. Novo indicador:
  metrics.py + registro `M` em core.js (+ COLS/FILTERS em funds.js).
- Testes usados: recálculo independente a partir dos zips da CVM/CDI (bateram até 8ª casa); abrir todas as abas dos 61 fundos.

## Cuidados
- Ao editar JS via scripts Python com heredoc, `\b`/`\s` viraram caracteres de controle algumas vezes → preferir Edit/Write
  ou arquivos de patch; checar `python -m py_compile pipeline/*.py`.
- Nunca pedir/usar senhas; o usuário faz os logins (GitHub etc.) por conta própria.

## Ideias pendentes / próximos passos sugeridos
- Benchmarks ANBIMA (IMA-B etc.) via ANBIMA Data; FIDCs via informe mensal; ETFs/fundos listados (B3).
- Histórico > 48 meses; classificação de risco da lâmina; controle de acesso se deixar de ser público.
