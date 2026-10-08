/* Roteador (hash), cabeçalho, rodapé e bandeja de comparação. */
(function () {
  "use strict";
  const App = window.App;
  if (!App.ds) return;
  const view = document.getElementById("view");
  const V = App.views || {};

  // Cabeçalho
  document.getElementById("pill-db").textContent = App.fmt.date(App.meta.data_base);
  const g = App.ds.gestoras;
  document.getElementById("pill-gestoras").innerHTML = g.length === 1 ? `Gestora <b>${App.esc(g[0].nome)}</b>` : `<b>${g.length}</b> gestoras`;
  if (g.length === 1) document.getElementById("app-subtitle").textContent = `${g[0].nome} · análise e comparação de fundos`;
  document.getElementById("btn-print").addEventListener("click", () => window.print());

  // Rodapé discreto com fontes e data-base
  const src = App.meta.fontes.map((s) => `<a href="${App.esc(s.url)}" target="_blank" rel="noopener">${App.esc(s.nome.replace("Dados Abertos: ", "").replace(/ \(.*\)$/, "").replace(/ — fonte secundária$/, ""))}</a>`).join("");
  document.getElementById("footer").innerHTML = `
    <div><b>Fontes de dados</b></div>
    <div class="src">${src}</div>
    <div>Data-base: <b>${App.fmt.date(App.meta.data_base)}</b> · Gerado em ${App.fmt.date(App.meta.gerado_em)} · Fonte e metodologia: consultar <a href="#/metodologia">Metodologia e fontes</a>.</div>
    ${(window.SITE_CONFIG || {}).downloads ? `<div style="margin-top:6px"><b>Downloads:</b> <a href="downloads/base_fundos.xlsx" download>planilha completa (Excel)</a> · <a href="downloads/Relatorio_Fundos.html" download>relatório em arquivo único (HTML, abre offline)</a></div>` : ""}
    <div style="margin-top:6px">Relatório independente, elaborado a partir de dados públicos (CVM, Banco Central) e de material comercial divulgado pelas gestoras; não é material oficial das gestoras citadas.</div>
    <div style="margin-top:6px">Material de caráter informativo e descritivo, sem recomendação de investimento. Rentabilidade passada não representa garantia de rentabilidade futura. Rentabilidades divulgadas são líquidas de taxas de administração e performance e brutas de impostos. Leia a lâmina, o regulamento e o formulário de informações complementares antes de investir.</div>`;

  // Bandeja de comparação
  const tray = document.getElementById("tray");
  function renderTray() {
    const sel = App.state.selection;
    const cnt = document.getElementById("cmp-count");
    cnt.textContent = sel.length; cnt.classList.toggle("hidden", !sel.length);
    const route = (location.hash.split("/")[1] || "");
    tray.classList.toggle("hidden", !sel.length || route === "comparacao");
    if (!sel.length) return;
    tray.innerHTML = `
      <div class="items">${sel.map((id) => `<span class="it">${App.swatch(id)}${App.esc(App.fundName(id))}<button type="button" data-rm="${id}" aria-label="Remover ${App.esc(App.fundName(id))}">×</button></span>`).join("")}</div>
      <button class="btn ghost" type="button" data-clear>Limpar</button>
      <a class="btn primary" href="#/comparacao">Comparar ${sel.length} ${sel.length === 1 ? "fundo" : "fundos"} →</a>`;
  }
  tray.addEventListener("click", (e) => {
    const rm = e.target.closest("[data-rm]");
    if (rm) App.toggleSelect(rm.dataset.rm, false);
    if (e.target.closest("[data-clear]")) App.clearSelection();
  });
  App.on("selection", renderTray);

  // Roteador
  const routes = {
    "visao-geral": V.overview, fundos: V.funds, fundo: V.detail,
    comparacao: V.compare, analise: V.analysis, metodologia: V.methodology,
  };
  let current = null;
  function go() {
    const parts = location.hash.replace(/^#\/?/, "").split("/");
    const name = parts[0] in routes ? parts[0] : "visao-geral";
    if (current && current.destroy) current.destroy();
    App.charts.disposeIn(view);
    view.innerHTML = "";
    document.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-current", t.dataset.route === (name === "fundo" ? "fundos" : name) ? "page" : "false"));
    current = routes[name];
    if (!current) { // script da página não carregou (erro de JavaScript): avisa em vez de mudar de página
      view.innerHTML = `<div class="card empty"><h3>Não foi possível abrir esta página</h3><p>Erro ao carregar o script da seção. Gere o relatório novamente (atualizar.bat) e, se persistir, verifique o console do navegador.</p><p><a href="#/fundos">Voltar aos fundos</a></p></div>`;
      return;
    }
    current.render(view, parts.slice(1).map(decodeURIComponent));
    renderTray();
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", go);
  go();
})();
