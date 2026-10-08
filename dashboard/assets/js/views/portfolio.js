/* Aba "Carteira" do detalhe do fundo — última carteira aberta (CDA/CVM). */
(function () {
  "use strict";
  const App = window.App;
  if (!App.ds) return;
  const esc = App.esc, fmt = App.fmt;
  const SPECIAL = ["Posições em sigilo", "Ajuste de conciliação"];
  const st = { which: "ultima", view: "consolidada", group: null };

  function monthsBetween(a, b) {
    const [ya, ma] = a.split("-").map(Number), [yb, mb] = b.split("-").map(Number);
    return (yb - ya) * 12 + (mb - ma);
  }

  App.renderCarteira = function (el, f) {
    const c = f.carteira;
    if (!c || !c.ultima) {
      el.innerHTML = `<div class="card empty" style="margin-top:16px"><h3>Carteira não disponível</h3>
        <p>${App.ND()} Este fundo não divulgou carteira na CDA da CVM nos meses consultados.${/FIDC/i.test(f.nome) ? " FIDCs reportam em informe próprio, fora da CDA." : ""}</p></div>`;
      return;
    }
    if (st.which === "completa" && !c.completa) st.which = "ultima";
    st.group = null;
    draw(el, f);
  };

  function draw(el, f) {
    const c = f.carteira;
    const cart = c[st.which];
    const cons = st.view === "consolidada";
    const grupos = cons ? cart.grupos : cart.grupos_direta;
    const top = (cons ? cart.top : cart.top_direta) || [];
    const lag = monthsBetween(cart.data.slice(0, 7), App.meta.data_base.slice(0, 7));
    const sig = cart.sigilo_pct || 0;
    const maxAbs = Math.max(...grupos.map((g) => Math.abs(g.pct || 0)), 0.0001);

    el.innerHTML = `
      <div class="card" style="margin-top:16px">
        <div class="card-h"><h3>Carteira em ${fmt.date(cart.data)}</h3>
          <div class="toolbar no-print">
            ${c.completa ? `<div class="seg" id="pf-which" role="group" aria-label="Data da carteira">
              <button type="button" data-v="ultima" aria-pressed="${st.which === "ultima"}">Última divulgada · ${fmt.date(c.ultima.data)}</button>
              <button type="button" data-v="completa" aria-pressed="${st.which === "completa"}">Completa mais recente · ${fmt.date(c.completa.data)}</button></div>` : ""}
            <div class="seg" id="pf-view" role="group" aria-label="Visão da carteira">
              <button type="button" data-v="consolidada" aria-pressed="${cons}" title="Abre as cotas de fundos investidos até os ativos finais, proporcionalmente">Consolidada</button>
              <button type="button" data-v="direta" aria-pressed="${!cons}" title="Posições como o próprio fundo reporta (inclui cotas de outros fundos)">Direta</button></div>
          </div></div>
        <div class="card-b">
          <div class="grid g-4" style="gap:10px">
            <div class="kpi" style="padding:0"><div class="label">PL na data da carteira</div><div class="value num" style="font-size:20px">${fmt.money(cart.pl) || "N/D"}</div></div>
            <div class="kpi" style="padding:0"><div class="label">Posições ${cons ? "(consolidadas)" : "(diretas)"}</div><div class="value num" style="font-size:20px">${fmt.int(cons ? cart.n_consolidada : cart.n_direta)}</div></div>
            <div class="kpi" style="padding:0"><div class="label">Em sigilo</div><div class="value num" style="font-size:20px">${fmt.pct(sig, 1, false)}</div><div class="hint">do PL, divulgação postergada</div></div>
            <div class="kpi" style="padding:0"><div class="label">Defasagem vs. data-base</div><div class="value num" style="font-size:20px">${lag} ${lag === 1 ? "mês" : "meses"}</div><div class="hint">data-base ${fmt.date(App.meta.data_base)}</div></div>
          </div>
          ${sig > 0.05 ? `<div class="warn-note" style="margin:14px 0 0">${fmt.pct(sig, 0, false)} do PL desta carteira está em <b>sigilo</b>: a CVM permite que o gestor adie a divulgação de posições por até 90 dias (regra geral). Essas posições aparecem apenas agregadas.${c.completa && st.which === "ultima" ? ` Para ver a composição completa, use <a href="#" data-go="completa">a carteira completa mais recente (${fmt.date(c.completa.data)})</a>.` : ""}</div>` : ""}
        </div>
      </div>

      <div class="grid g-main" style="margin-top:16px">
        <div class="card">
          <div class="card-h"><h3>Maiores posições</h3><span class="sub">${st.group ? `Filtro: ${esc(st.group)} · <a href="#" data-clear-group>limpar</a>` : `% do PL · ${top.length} maiores`}</span></div>
          <div class="table-wrap" style="max-height:620px"><table class="data" id="pf-top"></table></div>
          <div class="card-note">Lista das ${top.length} maiores posições em valor absoluto. A carteira completa (${fmt.int(cons ? cart.n_consolidada : cart.n_direta)} posições) está na aba “Carteiras” da planilha consolidada.</div>
        </div>
        <div class="card">
          <div class="card-h"><h3>Composição por classe</h3><span class="sub">% do PL · clique para filtrar</span></div>
          <div class="card-b"><div id="pf-groups"></div></div>
          <div class="card-note" id="pf-notes"></div>
        </div>
      </div>`;

    // Classes (barras HTML: valores negativos = passivos/posições vendidas)
    el.querySelector("#pf-groups").innerHTML = grupos.map((g) => {
      const w = Math.abs(g.pct || 0) / maxAbs * 100;
      const neg = (g.pct || 0) < 0, special = SPECIAL.includes(g.grupo);
      const color = special ? "#b7c2c5" : neg ? "#b4282c" : "#2e5562";
      return `<button type="button" class="pf-row ${st.group === g.grupo ? "on" : ""}" data-g="${esc(g.grupo)}" ${special ? "disabled" : ""}>
        <span class="pf-l">${esc(g.grupo)}</span>
        <span class="pf-bar"><i style="width:${w.toFixed(1)}%;background:${color}"></i></span>
        <span class="pf-v num">${fmt.pct(g.pct, 1, false)}</span></button>`;
    }).join("");

    // Tabela de posições
    const rows = top.filter((x) => !SPECIAL.includes(x.grupo) && (!st.group || x.grupo === st.group));
    el.querySelector("#pf-top").innerHTML = `<thead><tr><th class="l">Ativo</th><th class="l">Tipo</th><th class="l">Vencimento</th><th>% PL</th><th>Valor</th></tr></thead><tbody>` +
      (rows.length ? rows.map((x) => `<tr style="cursor:default"><td class="l fund"><div class="name" style="font-weight:500">${esc(x.ativo)}</div>${x.emissor && !x.ativo.includes(x.emissor) ? `<div class="meta">${esc(x.emissor)}</div>` : ""}</td>
        <td class="l"><span class="small">${esc(x.grupo)}</span><div class="meta">${esc(x.tipo || x.aplic)}</div></td>
        <td class="l">${x.venc ? fmt.date(x.venc) : '<span class="muted">—</span>'}</td>
        <td>${App.cell(x.pct, "pct", "PL não informado", { sign: false, color: x.pct < 0 })}</td><td>${App.cell(x.valor, "money")}</td></tr>`).join("")
        : `<tr><td colspan="5" class="l muted">Nenhuma posição desta classe entre as ${top.length} maiores.</td></tr>`) + "</tbody>";

    // Notas
    const notes = [];
    const adj = grupos.find((g) => g.grupo === "Ajuste de conciliação");
    if (cons && adj && Math.abs(adj.pct) > 0.001) notes.push(`<b>Ajuste de conciliação (${fmt.pct(adj.pct, 1, false)})</b>: a carteira reportada à CVM por fundo(s) investido(s) não fecha com o PL deles — em geral posições no exterior ou derivativos informados em valor bruto. As posições são mostradas como reportadas e a diferença é explicitada aqui.${(cart.fundos_nao_conciliados || []).length ? " Fundos: " + cart.fundos_nao_conciliados.slice(0, 3).map((x) => `${esc(x.fundo)} (soma ${fmt.pct(x.soma_pl, 0, false)} do PL)`).join("; ") + "." : ""}`);
    if (cons && (cart.fundos_sem_carteira || []).length) notes.push(`${cart.fundos_sem_carteira.length} fundo(s) investido(s) sem carteira na mesma data (gestoras externas, ETFs, FIDCs etc.) permanecem como “Cotas de fundos”.`);
    if (cart.conciliacao != null && Math.abs(cart.conciliacao) > 0.02) notes.push(`A carteira direta do fundo difere ${fmt.pct(cart.conciliacao, 1)} do PL informado.`);
    notes.push(`Valores negativos = passivos, posições vendidas e obrigações. Derivativos aparecem pelo valor de mercado/ajuste reportado, não pela exposição (nocional).`);
    notes.push(`Fonte: <a href="https://dados.cvm.gov.br/dataset/fi-doc-cda" target="_blank" rel="noopener">CVM — CDA</a>, competência ${fmt.date(cart.data)}.`);
    el.querySelector("#pf-notes").innerHTML = notes.map((n) => `<p style="margin:0 0 6px">${n}</p>`).join("");

    // Interações
    el.querySelectorAll("#pf-which button").forEach((b) => b.addEventListener("click", () => { st.which = b.dataset.v; st.group = null; draw(el, f); }));
    el.querySelectorAll("#pf-view button").forEach((b) => b.addEventListener("click", () => { st.view = b.dataset.v; st.group = null; draw(el, f); }));
    el.querySelectorAll(".pf-row:not([disabled])").forEach((b) => b.addEventListener("click", () => { st.group = st.group === b.dataset.g ? null : b.dataset.g; draw(el, f); }));
    const cg = el.querySelector("[data-clear-group]"); if (cg) cg.addEventListener("click", (e) => { e.preventDefault(); st.group = null; draw(el, f); });
    const go = el.querySelector("[data-go]"); if (go) go.addEventListener("click", (e) => { e.preventDefault(); st.which = "completa"; draw(el, f); });
  }
})();
