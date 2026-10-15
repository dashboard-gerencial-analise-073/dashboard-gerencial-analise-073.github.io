/* Página "Metodologia e fontes": fórmulas, tratamento de dados, fontes e relatório de qualidade. */
(function () {
  "use strict";
  const App = window.App;
  if (!App.ds) return;
  const esc = App.esc, fmt = App.fmt;
  App.views = App.views || {};

  function render(root) {
    const m = App.meta;
    const qc = App.ds.qualidade;
    const cnt = { erro: 0, alerta: 0, info: 0 };
    qc.forEach((q) => cnt[q.nivel]++);
    const bn = App.ds.benchmarks;
    root.innerHTML = `
      <div class="page-head"><div><h2>Metodologia e fontes</h2><p>Como cada número é obtido, calculado e validado.</p></div></div>
      <div class="grid g-main">
        <div class="card"><div class="card-b prose">
          <h3 style="margin-top:4px">Datas de referência</h3>
          <ul>
            <li><b>Data-base do relatório: ${fmt.date(m.data_base)}</b> — ${m.data_base_modo === "fechamento" ? "fechamento do mês anterior (último dia útil do mês)" : m.data_base_modo === "ultima" ? "data mais recente em que todos os fundos com envio regular à CVM têm cota publicada" : "data informada na geração do relatório"}. Todas as rentabilidades, riscos e PL são calculados até esta data, sem mistura de datas entre fundos. O relatório só é gerado quando a CVM e o CDI já cobrem a data.</li>
            <li>Fundo sem cota na data-base: métricas até a data-base ficam N/D (não se usa uma data anterior).</li>
            <li>Arquivos CVM utilizados: <code>${esc(m.cvm_arquivos)}</code>. Última taxa CDI: ${fmt.date(m.cdi_ultima_data)}${m.cdi_fonte === "sgs_web" ? " (obtida pelo módulo web do SGS/BCB — API indisponível na coleta)" : ""}. Dataset gerado em ${esc(m.gerado_em.replace("T", " "))}.</li>
            <li>Dados cadastrais qualitativos (categoria, estratégia, taxas, prazos, público) vêm do material da gestora e não possuem data de referência informada no documento.</li>
          </ul>

          <h3>Rentabilidade</h3>
          <p>Calculada exclusivamente a partir das cotas oficiais do Informe Diário da CVM, por composição (nunca por soma de retornos):</p>
          <span class="formula">Retorno(período) = Cota(fim) / Cota(início) − 1</span>
          <ul>
            ${App.windows.map((w) => `<li><b>${esc(w.label)}</b> — ${esc(w.long)}${App.windowBounds[w.id] ? `: de ${fmt.date(App.windowBounds[w.id].start)} a ${fmt.date(App.windowBounds[w.id].end)}` : ""}.</li>`).join("")}
          </ul>
          <p>A data de início de cada janela é o último dia útil igual ou anterior à data-base menos N meses (ou ao fim do mês/ano anterior). Se não houver cota exatamente nessa data, aceita-se a última cota em até 5 dias úteis antes; caso contrário, N/D. O fundo precisa ter cota na data de início (sem “retorno desde o início” disfarçado de 12M).</p>
          <h4>Anualização (somente janelas ≥ 12 meses)</h4>
          <span class="formula">Retorno a.a. = (1 + Retorno)^(252 / du) − 1     du = dias úteis no período</span>
          <h4>Benchmark e excesso de retorno</h4>
          <ul>
            <li><b>CDI</b>: índice acumulado a partir da taxa DI diária (BCB/SGS 12). A cota do dia t incorpora a taxa DI do dia útil anterior: <code>Índice(t) = Índice(t−1) × (1 + DI(t−1)/100)</code>.</li>
            <li><b>Ibovespa</b>: nível de fechamento diário; retorno = nível final / nível inicial − 1.</li>
            <li><b>Excesso (p.p.)</b> = retorno do fundo − retorno do benchmark, no mesmo período. <b>% do benchmark</b> = retorno do fundo / retorno do benchmark (apenas índices de juros como o CDI e quando o retorno do índice é positivo).</li>
            <li>Cada fundo é comparado com o benchmark informado pela gestora; fundos da mesma categoria não são presumidos com o mesmo índice.</li>
          </ul>

          <h3>Risco</h3>
          <p>Base: retornos diários <code>r(t) = Cota(t)/Cota(t−1) − 1</code> dentro da janela. Exige cobertura de ao menos 90% dos dias úteis; caso contrário, N/D. Pares com dia faltante não são interpolados — são descartados.</p>
          <span class="formula">Volatilidade a.a. = desvio-padrão amostral(r) × √252
Sharpe = (Retorno a.a. do fundo − Retorno a.a. do CDI) / Volatilidade a.a.
Máximo drawdown = mínimo de [ Cota(t) / máx(Cota(s), s ≤ t) − 1 ] na janela
Beta = cov(r_fundo, r_índice) / var(r_índice)
Tracking error = desvio-padrão(r_fundo − r_índice) × √252
Information ratio = (Retorno a.a. fundo − Retorno a.a. índice) / Tracking error</span>
          <ul>
            <li>Beta, tracking error e information ratio só são calculados contra índices de mercado com série diária (Ibovespa). Contra o CDI esses indicadores não têm interpretação útil (o tracking error se confunde com a volatilidade).</li>
            <li>% de meses positivos / acima do benchmark: considera apenas meses calendário completos dentro da janela.</li>
            <li>Sharpe de fundos com volatilidade muito baixa (ex.: fundos DI) tende a valores altos e é sensível a pequenas variações — interprete com cautela.</li>
            <li>Correlação (página Comparação): Pearson dos retornos diários em datas comuns, mínimo de 60 observações.</li>
          </ul>
          <h4>Indicadores avaliados e não incluídos</h4>
          <ul>
            <li><b>Alfa de Jensen</b>: redundante com o excesso de retorno para fundos referenciados ao CDI e pouco robusto com poucos anos de histórico.</li>
            <li><b>VaR</b>: não há fonte pública estruturada por fundo; estimativa própria não seria comparável à da gestora.</li>
            <li><b>Classificação de risco da lâmina</b>: campo previsto na planilha-base (<code>risco_lamina</code>); exibido como N/D até ser preenchido a partir das lâminas.</li>
          </ul>

          <h3>Liquidez, PL e fluxos</h3>
          <ul>
            <li>Prazos no formato do material: aplicação / cotização do resgate / crédito do resgate, em dias úteis salvo indicação (fundos de debêntures incentivadas CDI Mix e IMA-B5 Mix: cotização em dias corridos, crédito D+1 útil).</li>
            <li>PL, cotistas, captações e resgates: Informe Diário da CVM na data-base. Captação líquida 12M = Σ(captações − resgates) nos últimos 12 meses; PL médio = média dos PL diários no período.</li>
          </ul>

          <h3>Carteiras</h3>
          <ul>
            <li><b>Fonte</b>: CVM — Composição e Diversificação das Aplicações (CDA), mensal. Consulta os últimos meses publicados e usa, por fundo, a <b>última carteira divulgada</b>.</li>
            <li><b>Sigilo</b>: a CVM permite adiar a divulgação de posições (em geral por até 90 dias). Essas posições só existem agregadas e aparecem como “Posições em sigilo”. Se a última carteira tiver mais de 5% do PL em sigilo, também é oferecida a <b>carteira completa mais recente</b> (sigilo &lt; 1%).</li>
            <li><b>Consolidada (look-through)</b>: cotas de fundos investidos são substituídas pela carteira desses fundos na mesma data, proporcionalmente (valor da cota ÷ PL do fundo investido), até 4 níveis. Fundos sem carteira na mesma data (gestoras externas, ETFs, FIDCs) permanecem como cotas.</li>
            <li><b>Ajuste de conciliação</b>: quando a carteira reportada por um fundo investido não fecha com o PL dele (comum em posições no exterior e derivativos informados em valor bruto), as posições são mostradas como reportadas e a diferença aparece numa linha explícita — o total continua igual a 100% do PL.</li>
            <li>Passivos (valores a pagar, posições vendidas/lançadas, obrigações) têm sinal negativo. Derivativos aparecem pelo valor de mercado/ajuste informado, não pelo nocional.</li>
            <li>Percentuais sobre o PL informado na própria CDA. A soma da carteira direta de cada fundo é conferida contra esse PL (tolerância de 2%).</li>
          </ul>

          <h3>Fundos de mercado (página Comparação)</h3>
          <ul>
            <li>Além da planilha-base, a busca da Comparação inclui ${m.mercado ? `<b>${fmt.int(m.mercado.n)} fundos de mercado</b> (${esc(m.mercado.recorte)})` : "fundos de mercado (base não gerada nesta versão)"}. As páginas Visão geral, Fundos e Análise continuam restritas à planilha-base.</li>
            <li>Mesma metodologia: cotas oficiais do Informe Diário da CVM, mesmo calendário, CDI e Ibovespa, mesmas janelas e indicadores. Classes reportadas só por subclasse usam a subclasse com mais cotistas.</li>
            <li>Previdência (FIEs que recebem PGBL/VGBL): o cotista é a seguradora, por isso não se exige número mínimo de cotistas nem a condição de não exclusivo — o recorte é só por PL. Identificação pela classificação ANBIMA (“Previdência…”) ou pelo nome (PREV, PGBL, VGBL, FIE). Pode incluir fundos de planos específicos de empresas. A rentabilidade é a da cota, antes das taxas do plano cobradas pela seguradora.</li>
            <li>Benchmark inferido do indicador de desempenho informado à CVM (DI/Selic → CDI; Ibovespa → Ibovespa); outros índices aparecem como N/D.</li>
            <li>Sem dados comerciais da gestora (taxas, prazos de cotização/liquidação, objetivo, estratégia): N/D. Variação diária atípica de cota (eventos, troca de classe) interrompe a série a partir dela.</li>
          </ul>

          <h3>Fundos listados na B3 (páginas Renda e Comparação)</h3>
          <ul>
            <li>${m.listados ? `<b>${fmt.int(m.listados.n)} fundos</b> negociados na B3 no último mês até a data-base (${Object.entries(m.listados.por_tipo || {}).map(([k, v]) => `${esc(k)} ${v}`).join(", ")})` : "Fundos listados (base não gerada nesta versão)"}: FII, Fiagro, FI-Infra e ETFs. Ticker e CNPJ pela lista de fundos listados da B3.</li>
            <li><b>Preço</b>: fechamento oficial (COTAHIST, B3), mercado à vista, ajustado por desdobramentos e grupamentos informados pela B3. Cada evento é conferido com o salto de preço observado; se não bater (ou se houver salto acima de 50% sem evento), a série passa a valer só depois dele. Em fundos pouco negociados, o preço numa data é o último fechamento em até 5 pregões antes.</li>
            <li><b>Proventos</b> (R$ por cota, pela data-com): eventos corporativos da B3 (janela dos últimos 12 meses, acumulada a cada atualização) e, para FII e Fiagro, avisos aos cotistas estruturados do Fundos.NET (enviados pelos administradores) para o período anterior. Rendimentos e amortizações são separados. Um mês só entra no cálculo se o histórico oficial cobrir todo o mês; antes disso, DY e retorno total ficam N/D — nunca se presume “sem provento”.</li>
            <li><b>Retorno total</b> (proventos reinvestidos na data ex, 1º pregão após a data-com), entre pregões consecutivos com negócio:
              <span class="formula">RT(j) = RT(k) × (Preço(j) + Proventos com data-com em [k, j)) / Preço(k)</span>
              As janelas, a anualização e o risco (volatilidade, drawdown, Sharpe vs CDI) seguem as mesmas regras dos demais fundos. <b>Variação da cota</b> = só o preço, sem proventos.</li>
            <li><b>DY</b>: <code>DY(período) = proventos com data-com no período ÷ preço de fechamento no início do período</code> (mês: fechamento do mês anterior; ano: fechamento do ano anterior). <b>DY 12M sobre o preço atual</b> = proventos dos últimos 12 meses ÷ preço na data-base.</li>
            <li><b>Regularidade</b>: meses com pagamento e coeficiente de variação dos proventos mensais (desvio-padrão ÷ média, 12 meses; meses sem provento contam como zero). <b>Tendência</b>: média dos últimos 6 meses ÷ média dos 6 anteriores − 1.</li>
            <li><b>P/VP</b> = preço ÷ valor patrimonial da cota informado à CVM (informe mensal de FII/Fiagro; informe diário para FI-Infra e ETFs), ajustado a eventos de cotas posteriores. VP incompatível com o preço (P/VP fora de 0,1–10) não é exibido. <b>Liquidez</b> = volume financeiro médio diário na B3.</li>
            <li><b>Simulador de carteira de renda</b> (página Renda): cotas inteiras = valor alocado ÷ preço na data-base (arredondado para baixo); renda do mês = cotas × rendimentos por cota com data-com no mês, mantendo as mesmas cotas nos 12 meses anteriores, sem reinvestir. Amortizações à parte. Total da carteira só quando todos os fundos têm o dado do mês. É renda passada, não projeção.</li>
            <li>Fundos listados não têm benchmark com série pública (IFIX, IMA-B etc. não estão disponíveis): a referência exibida é o CDI no mesmo período. Valores brutos de IR, corretagem e emolumentos.</li>
          </ul>

          <h3>Carteiras simuladas (página Carteiras)</h3>
          <ul>
            <li>Pesos informados (normalizados para 100%), compra no fechamento do início do período e cotas mantidas até a data-base, sem rebalancear, sem custos e sem impostos: <span class="formula">V(t) = Σ peso × Cota(t) / Cota(início)        Retorno = V(data-base) − 1</span></li>
            <li>Fundo sem cota no início do período deixa a carteira N/D naquele período (o peso não é redistribuído). Volatilidade e queda máxima sobre o valor diário da carteira em 12 meses.</li>
            <li>As carteiras ficam salvas no próprio navegador; o link e o arquivo exportado guardam só fundos e pesos — os números são sempre recalculados com a data-base mais recente.</li>
          </ul>

          <h3>Tratamento de dados</h3>
          <ul>
            <li><b>Calendário</b>: dias úteis definidos pelas datas da série do CDI (BCB), o que exclui feriados nacionais. Cotas em datas fora do calendário são ignoradas e registradas.</li>
            <li><b>Dados faltantes</b>: nunca são interpolados ou estimados. Cota igual a zero reportada à CVM é tratada como ausente.</li>
            <li><b>Subclasses (RCVM 175)</b>: usa-se a série da classe. Se a CVM passar a reportar apenas por subclasse, a série continua pela subclasse com mais cotistas somente se a cota for contínua; PL e cotistas somam as subclasses. O caso é sinalizado no fundo.</li>
            <li><b>Histórico insuficiente</b>: janela sem cota na data de início → N/D (“Histórico insuficiente para o período”).</li>
            <li><b>Rentabilidades</b>: líquidas de taxas de administração e performance, brutas de impostos (padrão da cota divulgada).</li>
          </ul>
        </div></div>

        <div style="display:grid;gap:16px;align-content:start">
          <div class="card"><div class="card-h"><h3>Fontes de dados</h3></div><div class="card-b">
            <ul class="qc-list">${m.fontes.map((s) => `<li style="grid-template-columns:1fr"><span><a href="${esc(s.url)}" target="_blank" rel="noopener"><b>${esc(s.nome)}</b></a><br><span class="muted">${esc(s.uso)}</span></span></li>`).join("")}</ul>
            <p class="small muted" style="margin-top:10px">Hierarquia: dados quantitativos sempre da CVM/BCB (fonte primária oficial). O material da gestora é usado para atributos qualitativos e comerciais. Fontes de terceiros apenas onde não há série oficial aberta (Ibovespa).</p>
          </div></div>
          <div class="card"><div class="card-h"><h3>Benchmarks</h3></div><div class="card-b" style="overflow-x:auto">
            <table class="compact"><thead><tr><th>Índice</th><th>Série</th><th>Última obs.</th></tr></thead><tbody>
            ${bn.map((b) => `<tr><td>${esc(b.nome)}</td><td>${b.disponivel ? esc(b.fonte) : App.ND(b.observacoes)}</td><td>${b.disponivel ? fmt.date(b.ultima_data) : "—"}</td></tr>`).join("")}
            </tbody></table>
            <p class="small muted" style="margin-top:8px">${bn.filter((b) => !b.disponivel).map((b) => `<b>${esc(b.nome)}</b>: ${esc(b.observacoes)}`).join("<br>")}</p>
          </div></div>
        </div>
      </div>

      <div class="card" style="margin-top:16px">
        <div class="card-h"><h3>Controle de qualidade dos dados</h3><span class="sub">${cnt.erro} erro(s) · ${cnt.alerta} alerta(s) · ${cnt.info} informativo(s)</span></div>
        <div class="card-b">
          <div class="seg" id="qc-f" role="group" aria-label="Filtrar nível"><button type="button" data-v="" aria-pressed="true">Todos</button><button type="button" data-v="erro">Erros</button><button type="button" data-v="alerta">Alertas</button><button type="button" data-v="info">Informativos</button></div>
          <p class="small muted">Verificações automáticas a cada atualização: dígito verificador e duplicidade de CNPJ, existência e situação na CVM, conferência do nome comercial com a denominação CVM, cotas inválidas, séries incompletas, variações diárias atípicas, PL negativo, taxas fora de faixa (unidade), consistência da liquidez, divergência de taxas entre fontes, consistência interna dos cálculos (YTD direto = composição dos meses) e defasagem de benchmarks.</p>
          <ul class="qc-list" id="qc-list"></ul>
        </div>
      </div>`;
    const draw = (lvl) => {
      root.querySelector("#qc-list").innerHTML = qc.filter((q) => !lvl || q.nivel === lvl).map((q) => {
        const f = q.fundo_id ? App.byId[q.fundo_id] : null;
        return `<li><span class="lvl ${q.nivel}">${q.nivel}</span><span>${f ? `<a href="#/fundo/${f.id}"><b>${esc(f.nome)}</b></a> — ` : ""}${esc(q.mensagem)} <span class="muted small">[${esc(q.codigo)}]</span></span></li>`;
      }).join("") || '<li style="grid-template-columns:1fr"><span class="muted">Nenhum item.</span></li>';
    };
    root.querySelector("#qc-f").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      root.querySelectorAll("#qc-f button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      draw(b.dataset.v);
    });
    draw("");
  }

  App.views.methodology = { render };
})();
