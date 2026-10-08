/* Página "Fundos": filtros combinados, busca, ordenação, colunas configuráveis e seleção para comparação. */
(function () {
  "use strict";
  const App = window.App;
  if (!App.ds) return;
  const esc = App.esc;
  App.views = App.views || {};

  /* ---------- Referências de janela e benchmarks ---------- */
  App.windowBounds = {};
  App.windows.forEach((w) => {
    const f = App.funds.find((x) => x.ret && x.ret[w.id] && x.ret[w.id].start && x.ret[w.id].end);
    if (f) App.windowBounds[w.id] = { start: f.ret[w.id].start, end: f.ret[w.id].end, n: f.ret[w.id].n_du };
  });
  App.benchWindowReturn = function (bid, wid, ann) {
    const s = App.benchSeries(bid), wb = App.windowBounds[wid];
    if (!s || !wb) return null;
    const i0 = App.axis.indexOf(wb.start), i1 = App.axis.indexOf(wb.end);
    let a = null; for (let k = i0; k >= Math.max(0, i0 - 5); k--) if (s[k] != null) { a = s[k]; break; }
    const b = s[i1];
    if (a == null || b == null) return null;
    const r = b / a - 1;
    const w = App.W[wid];
    if (ann && w.type === "months" && w.n >= 12 && wb.n) return Math.pow(1 + r, App.meta.dias_uteis_ano / wb.n) - 1;
    return r;
  };

  /* ---------- Definição de filtros (adicione novos filtros aqui) ---------- */
  const uniq = (arr) => [...new Set(arr.filter((x) => x != null && x !== ""))];
  const riskW = () => App.state.riskWin;
  const FILTERS = [
    { id: "categoria", type: "multi", label: "Categoria", get: (f) => f.categoria, options: () => App.meta.categorias },
    { id: "gestora", type: "multi", label: "Gestora", get: (f) => (App.gestoraById[f.gestora_id] || {}).nome || f.gestora_id, options: () => uniq(App.funds.map((f) => (App.gestoraById[f.gestora_id] || {}).nome)) },
    { id: "benchmark", type: "multi", label: "Benchmark", get: (f) => App.benchName(f.benchmark_id), options: () => uniq(App.funds.map((f) => App.benchName(f.benchmark_id))) },
    { id: "estrutura", type: "multi", label: "Estrutura de gestão", get: (f) => f.estrutura, options: () => uniq(App.funds.map((f) => f.estrutura)).sort() },
    { id: "familia", type: "multi", label: "Família / estratégia", scroll: true, get: (f) => f.familia, options: () => uniq(App.funds.map((f) => f.familia)).sort((a, b) => a.localeCompare(b, "pt-BR")) },
    { id: "anbima", type: "multi", label: "Classificação ANBIMA (CVM)", scroll: true, get: (f) => (f.cvm && f.cvm.classificacao_anbima) || "N/D", options: () => uniq(App.funds.map((f) => (f.cvm && f.cvm.classificacao_anbima) || "N/D")).sort() },
    { id: "publico", type: "seg", label: "Público-alvo", options: [["", "Todos"], ["geral", "Geral"], ["iq", "Qualificado"]], test: (f, v) => !v || (v === "iq" ? f.qualificado : !f.qualificado) },
    { id: "attrs", type: "flags", label: "Características", options: [["previdencia", "Versão previdência disponível"], ["isento_ir", "Isento de IR (PF)"], ["sem_perf", "Sem taxa de performance"]],
      test: (f, v) => (v || []).every((k) => (k === "sem_perf" ? f.taxa_perf == null : f[k])) },
    { id: "hist", type: "select", label: "Histórico mínimo", options: [["", "Qualquer"], ["12m", "12 meses"], ["24m", "24 meses"], ["36m", "36 meses"], ["48m", "48 meses"]],
      test: (f, v) => !v || ((f.ret || {})[v] || {}).f != null },
    { id: "ranges", type: "ranges", label: "Indicadores", items: [
      { id: "pl_min", label: "PL mínimo", unit: "R$ mi", metric: () => "pl", test: (x, v) => x >= v * 1e6 },
      { id: "resg_max", label: "Resgate em até", unit: "dias", metric: () => "resg", test: (x, v) => x <= v },
      { id: "ret_min", label: "Rentab. 12M mínima", unit: "%", metric: () => "retabs:12m", test: (x, v) => x >= v / 100 },
      { id: "vol_max", label: () => `Volatilidade ${App.W[riskW()].label} máx.`, unit: "%", metric: () => "vol:" + riskW(), test: (x, v) => x <= v / 100 },
      { id: "sharpe_min", label: () => `Sharpe ${App.W[riskW()].label} mín.`, unit: "", metric: () => "sharpe:" + riskW(), test: (x, v) => x >= v },
      { id: "mdd_max", label: () => `Drawdown ${App.W[riskW()].label} até`, unit: "%", metric: () => "mdd:" + riskW(), test: (x, v) => x >= -Math.abs(v) / 100 },
      { id: "adm_max", label: "Taxa de adm. até", unit: "% a.a.", metric: () => "taxa_adm", test: (x, v) => x <= v / 100 },
    ] },
  ];
  const RANGE_ITEMS = FILTERS.find((f) => f.id === "ranges").items;
  const lbl = (x) => (typeof x === "function" ? x() : x);

  const defaultFilters = () => ({ q: "", categoria: [], gestora: [], benchmark: [], estrutura: [], familia: [], anbima: [], publico: "", attrs: [], hist: "", ranges: {} });
  const state = App.state;
  state.filters = Object.assign(defaultFilters(), App.store.get("filters", {}));
  state.sort = App.store.get("sort", { key: "pl", dir: -1 });
  state.group = App.store.get("group", true);

  /* ---------- Colunas (adicione novas colunas aqui) ---------- */
  const COLS = [
    { id: "categoria", label: "Categoria", l: true, def: false, text: (f) => esc(f.categoria), sortv: (f) => f.categoria },
    { id: "benchmark", label: "Benchmark", l: true, def: false, text: (f) => esc(App.benchName(f.benchmark_id)), sortv: (f) => App.benchName(f.benchmark_id) },
    { id: "pl", metric: () => "pl", def: true },
    ...App.windows.map((w) => ({ id: "ret:" + w.id, metric: () => "ret:" + w.id, def: w.id !== "m1", ret: true })),
    { id: "vol", metric: () => "vol:" + riskW(), def: true },
    { id: "sharpe", metric: () => "sharpe:" + riskW(), def: true },
    { id: "mdd", metric: () => "mdd:" + riskW(), def: false },
    { id: "resg", metric: () => "resg", def: true, title: "Prazo total até o crédito do resgate" },
    { id: "liq", label: "Aplic. / Cotiz. / Créd.", def: false, text: (f) => `<span class="num">${App.liquidityText(f)}</span>`, sortv: (f) => f.liq_resg },
    { id: "taxa_adm", metric: () => "taxa_adm", def: false },
    { id: "taxa_perf", metric: () => "taxa_perf", def: false },
    { id: "capt12", metric: () => "capt12", def: false },
    { id: "cotistas", metric: () => "cotistas", def: false },
    { id: "inicio", metric: () => "inicio", def: false },
  ];
  let visible = App.store.get("cols", null);
  if (!visible || !Array.isArray(visible)) visible = COLS.filter((c) => c.def).map((c) => c.id);

  /* ---------- Filtragem ---------- */
  const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  function passes(f, skip) {
    const F = state.filters;
    if (F.q && skip !== "q") {
      const q = norm(F.q), qd = F.q.replace(/\D/g, "");
      const hay = norm([f.nome, f.familia, f.categoria, f.cvm && f.cvm.denominacao].join(" "));
      if (!(hay.includes(q) || (qd.length >= 4 && f.cnpj.replace(/\D/g, "").includes(qd)))) return false;
    }
    for (const d of FILTERS) {
      if (d.id === skip) continue;
      const v = F[d.id];
      if (d.type === "multi") { if (v && v.length && !v.includes(d.get(f))) return false; }
      else if (d.type === "ranges") {
        for (const it of d.items) {
          const x = v[it.id];
          if (x === "" || x == null || isNaN(x)) continue;
          const mv = App.M[it.metric()].get(f).v;
          if (mv == null || !it.test(mv, +x)) return false;
        }
      } else if (d.test && !d.test(f, v)) return false;
    }
    return true;
  }
  App.filterFunds = () => App.funds.filter((f) => passes(f));
  function activeCount() {
    const F = state.filters; let n = F.q ? 1 : 0;
    FILTERS.forEach((d) => {
      const v = F[d.id];
      if (d.type === "ranges") n += Object.values(v).filter((x) => x !== "" && x != null).length;
      else if (Array.isArray(v)) n += v.length; else if (v) n += 1;
    });
    return n;
  }
  const save = () => { App.store.set("filters", state.filters); };

  /* ---------- Render ---------- */
  function render(root) {
    root.innerHTML = `
      <div class="page-head">
        <div><h2>Fundos</h2><p>Filtre, ordene e selecione fundos para comparar. Clique em um fundo para ver os detalhes.</p></div>
      </div>
      <div class="funds-layout">
        <aside class="card filters collapsed" id="filters" aria-label="Filtros"></aside>
        <section class="card" style="min-width:0">
          <div class="card-b" style="padding-bottom:10px">
            <div class="toolbar">
              <label class="search"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
                <input class="input" id="q" type="search" placeholder="Buscar por nome, família ou CNPJ" value="${esc(state.filters.q)}" aria-label="Buscar fundos"></label>
              <span class="result-count" id="count"></span>
              <span style="flex:1"></span>
              <button class="btn filters-toggle" id="btn-filters" type="button">Filtros</button>
              <div class="col-menu"><button class="btn" id="btn-cols" type="button" aria-expanded="false">Colunas</button><div class="menu hidden" id="col-menu"></div></div>
              <button class="btn" id="btn-csv" type="button" title="Exportar a tabela filtrada (CSV)">Exportar CSV</button>
            </div>
            <div class="toolbar" style="margin-top:10px">
              <div class="seg" id="seg-mode" role="group" aria-label="Métrica de rentabilidade">
                <button type="button" data-v="abs">Rentabilidade</button><button type="button" data-v="excess">Excesso s/ benchmark</button><button type="button" data-v="pctb">% do benchmark</button>
              </div>
              <div class="seg" id="seg-base" role="group" aria-label="Base">
                <button type="button" data-v="cum">Acumulada</button><button type="button" data-v="ann">Anualizada</button>
              </div>
              <span class="small muted">Risco:</span>
              <div class="seg" id="seg-risk" role="group" aria-label="Janela de risco">
                ${App.riskWindows.map((w) => `<button type="button" data-v="${w}">${App.W[w].label}</button>`).join("")}
              </div>
              <label class="f-check small"><input type="checkbox" id="chk-group" ${state.group ? "checked" : ""}> Agrupar por categoria</label>
            </div>
            <div class="active-filters" id="active"></div>
          </div>
          <div class="table-wrap" id="table-wrap"></div>
          <div class="card-note" id="table-note"></div>
        </section>
      </div>`;
    renderFilters(root.querySelector("#filters"));
    bindToolbar(root);
    renderTable();
  }

  function renderFilters(el) {
    const F = state.filters;
    let h = `<div class="f-head"><h3>Filtros</h3><button class="btn ghost small" type="button" id="btn-clear">Limpar tudo</button></div><div class="f-body">`;
    FILTERS.forEach((d) => {
      const opts = typeof d.options === "function" ? d.options() : d.options;
      if (d.type === "multi") {
        if (opts.length < 2 && !F[d.id].length) return; // filtro sem escolha útil
        const counts = {};
        App.funds.filter((f) => passes(f, d.id)).forEach((f) => { const k = d.get(f); counts[k] = (counts[k] || 0) + 1; });
        h += `<div class="f-group"><span class="f-label">${esc(d.label)}</span><div class="${d.scroll ? "f-scroll" : ""}">` +
          opts.map((o) => `<label class="f-check"><input type="checkbox" data-f="${d.id}" value="${esc(o)}" ${F[d.id].includes(o) ? "checked" : ""}> <span style="flex:1">${esc(o)}</span><span class="muted small">${counts[o] || 0}</span></label>`).join("") + `</div></div>`;
      } else if (d.type === "seg") {
        h += `<div class="f-group"><span class="f-label">${esc(d.label)}</span><div class="seg" data-seg="${d.id}">` +
          opts.map(([v, t]) => `<button type="button" data-v="${v}" aria-pressed="${F[d.id] === v}">${t}</button>`).join("") + `</div></div>`;
      } else if (d.type === "flags") {
        h += `<div class="f-group"><span class="f-label">${esc(d.label)}</span>` +
          opts.map(([v, t]) => `<label class="f-check"><input type="checkbox" data-flag="${d.id}" value="${v}" ${F[d.id].includes(v) ? "checked" : ""}> ${t}</label>`).join("") + `</div>`;
      } else if (d.type === "select") {
        h += `<div class="f-group"><label for="f-${d.id}">${esc(d.label)}</label><select class="select" id="f-${d.id}" data-sel="${d.id}" style="width:100%">` +
          opts.map(([v, t]) => `<option value="${v}" ${F[d.id] === v ? "selected" : ""}>${t}</option>`).join("") + `</select></div>`;
      } else if (d.type === "ranges") {
        h += `<div class="f-group"><span class="f-label">${esc(d.label)}</span>` +
          d.items.map((it) => `<div class="f-range"><span>${esc(lbl(it.label))}${it.unit ? ` <span class="muted">(${esc(it.unit)})</span>` : ""}</span><input class="input" inputmode="decimal" data-range="${it.id}" value="${esc(F.ranges[it.id] ?? "")}" placeholder="—" aria-label="${esc(lbl(it.label))}"></div>`).join("") +
          `<div class="small muted">Fundos sem o indicador (N/D) são excluídos quando o filtro está ativo.</div></div>`;
      }
    });
    el.innerHTML = h + "</div>";
    el.onchange = (e) => {
      const t = e.target;
      if (t.dataset.f) { const a = F[t.dataset.f]; t.checked ? a.push(t.value) : a.splice(a.indexOf(t.value), 1); }
      else if (t.dataset.flag) { const a = F[t.dataset.flag]; t.checked ? a.push(t.value) : a.splice(a.indexOf(t.value), 1); }
      else if (t.dataset.sel) F[t.dataset.sel] = t.value;
      else return;
      save(); refresh();
    };
    el.oninput = (e) => {
      const t = e.target;
      if (!t.dataset.range) return;
      const v = t.value.replace(",", ".").trim();
      if (v === "" || !isNaN(v)) { F.ranges[t.dataset.range] = v === "" ? "" : v; t.style.borderColor = ""; save(); renderTable(); }
      else t.style.borderColor = "var(--neg)";
    };
    el.onclick = (e) => {
      const b = e.target.closest("[data-seg] button");
      if (b) { F[b.parentElement.dataset.seg] = b.dataset.v; save(); refresh(); }
      if (e.target.id === "btn-clear") clearAll();
    };
  }
  function clearAll() {
    state.filters = defaultFilters(); save();
    document.getElementById("q").value = "";
    refresh();
  }
  function refresh() {
    const el = document.getElementById("filters");
    const collapsed = el.classList.contains("collapsed");
    const sc = el.scrollTop;
    renderFilters(el); el.classList.toggle("collapsed", collapsed); el.scrollTop = sc;
    renderTable();
  }

  function bindToolbar(root) {
    const segs = [["seg-mode", "retMode"], ["seg-base", "retBase"], ["seg-risk", "riskWin"]];
    segs.forEach(([id, key]) => {
      const el = root.querySelector("#" + id);
      const sync = () => el.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === state[key])));
      sync();
      el.addEventListener("click", (e) => {
        const b = e.target.closest("button"); if (!b) return;
        state[key] = b.dataset.v; App.store.set(key, state[key]); sync();
        if (key === "riskWin") refresh(); else renderTable();
      });
    });
    let t;
    root.querySelector("#q").addEventListener("input", (e) => { clearTimeout(t); t = setTimeout(() => { state.filters.q = e.target.value; save(); renderTable(); }, 120); });
    root.querySelector("#chk-group").addEventListener("change", (e) => { state.group = e.target.checked; App.store.set("group", state.group); renderTable(); });
    root.querySelector("#btn-filters").addEventListener("click", () => root.querySelector("#filters").classList.toggle("collapsed"));
    root.querySelector("#btn-csv").addEventListener("click", exportCsv);
    const menu = root.querySelector("#col-menu"), bc = root.querySelector("#btn-cols");
    bc.addEventListener("click", () => {
      const open = menu.classList.toggle("hidden") === false;
      bc.setAttribute("aria-expanded", String(open));
      if (open) {
        menu.innerHTML = `<div class="f-label" style="font-size:11.5px;font-weight:600;text-transform:uppercase;color:var(--text-2);margin-bottom:6px">Colunas visíveis</div>` +
          COLS.map((c) => `<label class="f-check"><input type="checkbox" value="${c.id}" ${visible.includes(c.id) ? "checked" : ""}> ${esc(colLabel(c))}</label>`).join("") +
          `<button class="btn ghost small" type="button" data-reset style="margin-top:6px">Restaurar padrão</button>`;
      }
    });
    menu.addEventListener("change", (e) => {
      const id = e.target.value;
      visible = e.target.checked ? COLS.filter((c) => c.id === id || visible.includes(c.id)).map((c) => c.id) : visible.filter((x) => x !== id);
      App.store.set("cols", visible); renderTable();
    });
    menu.addEventListener("click", (e) => { if (e.target.dataset.reset !== undefined && e.target.closest("[data-reset]")) { visible = COLS.filter((c) => c.def).map((c) => c.id); App.store.set("cols", visible); menu.classList.add("hidden"); renderTable(); } });
    document.addEventListener("click", (e) => { if (!e.target.closest(".col-menu")) menu.classList.add("hidden"); });
  }

  const colLabel = (c) => c.label || App.M[c.metric()].label;
  const colTitle = (c) => c.title || (c.metric ? App.M[c.metric()].long : c.label);
  function sortValue(f, key) {
    const c = COLS.find((x) => x.id === key);
    if (key === "nome") return f.nome;
    if (!c) return null;
    if (c.sortv) return c.sortv(f);
    return App.M[c.metric()].get(f).v;
  }
  function sorted(list) {
    const { key, dir } = state.sort;
    return list.slice().sort((a, b) => {
      const va = sortValue(a, key), vb = sortValue(b, key);
      if (va == null && vb == null) return a.nome.localeCompare(b.nome, "pt-BR");
      if (va == null) return 1; if (vb == null) return -1; // N/D sempre por último
      const c = typeof va === "string" ? va.localeCompare(vb, "pt-BR") : va - vb;
      return c * dir || a.nome.localeCompare(b.nome, "pt-BR");
    });
  }

  function renderTable() {
    const wrap = document.getElementById("table-wrap");
    if (!wrap) return;
    const list = sorted(App.filterFunds());
    const cols = COLS.filter((c) => visible.includes(c.id));
    const nAct = activeCount();
    document.getElementById("count").textContent = `${list.length} de ${App.funds.length} fundos`;
    renderActive(nAct);
    const arrow = (k) => (state.sort.key === k ? (state.sort.dir > 0 ? "▲" : "▼") : "");
    let h = `<table class="data"><thead><tr>
      <th class="sel-col" scope="col"><span class="hidden">Selecionar</span></th>
      <th class="l sortable sticky-col" data-sort="nome" style="left:36px" scope="col">Fundo <span class="arrow">${arrow("nome")}</span></th>
      ${cols.map((c) => `<th class="sortable ${c.l ? "l" : ""}" data-sort="${c.id}" title="${esc(colTitle(c))}" scope="col">${esc(colLabel(c))} <span class="arrow">${arrow(c.id)}</span></th>`).join("")}
    </tr></thead><tbody>`;
    // Linhas de referência (benchmarks com série) no modo de rentabilidade absoluta.
    if (state.retMode === "abs") {
      const refs = App.ds.benchmarks.filter((b) => b.disponivel && list.some((f) => f.benchmark_id === b.id));
      refs.forEach((b) => {
        h += `<tr class="ref" style="cursor:default"><td class="sel-col"></td><td class="l fund sticky-col" style="left:36px"><div class="name" style="font-weight:500;color:var(--text-2)">${esc(b.nome)}</div><div class="meta">Referência de mercado</div></td>` +
          cols.map((c) => {
            if (c.ret) return `<td>${App.cell(App.benchWindowReturn(b.id, c.id.split(":")[1], state.retBase === "ann"), "pct", "Sem dado do índice", { color: false })}</td>`;
            return `<td class="${c.l ? "l" : ""}"></td>`;
          }).join("") + `</tr>`;
      });
    }
    const groups = state.group ? App.meta.categorias.map((cat) => [cat, list.filter((f) => f.categoria === cat)]).filter(([, l]) => l.length) : [[null, list]];
    groups.forEach(([cat, items]) => {
      if (cat) h += `<tr><td class="group-h" colspan="${cols.length + 2}">${esc(cat)} <span class="muted" style="font-weight:500">· ${items.length}</span></td></tr>`;
      items.forEach((f) => {
        const sel = App.state.selection.includes(f.id);
        h += `<tr data-id="${f.id}" class="${sel ? "selected" : ""}">
          <td class="sel-col"><input type="checkbox" ${sel ? "checked" : ""} data-sel="${f.id}" aria-label="Selecionar ${esc(f.nome)} para comparação"></td>
          <td class="l fund sticky-col" style="left:36px"><div class="name">${esc(f.nome)} ${App.badges(f)}</div><div class="meta">${esc(f.familia || "")} · ${esc(f.cnpj)}</div><div class="quick no-print"><a href="#/fundo/${encodeURIComponent(f.id)}/mensal">Rentab. mensal</a><a href="#/fundo/${encodeURIComponent(f.id)}/carteira">Carteira</a></div></td>
          ${cols.map((c) => `<td class="${c.l ? "l" : ""}">${c.text ? c.text(f) : App.metricCell(f, c.metric())}</td>`).join("")}
        </tr>`;
      });
    });
    if (!list.length) h += `<tr><td colspan="${cols.length + 2}" class="l"><div class="empty"><h3>Nenhum fundo atende aos filtros</h3><p>Revise as condições ou <a href="#" data-clearall>limpe todos os filtros</a>.</p></div></td></tr>`;
    h += "</tbody></table>";
    wrap.innerHTML = h;
    document.getElementById("table-note").innerHTML =
      `${esc(App.retModeLabel())}. Rentabilidades líquidas de taxas, brutas de IR, até ${App.fmt.date(App.meta.data_base)}. Risco na janela ${App.W[state.riskWin].label}. ` +
      `<b>N/D</b> = não disponível (passe o mouse para ver o motivo). Liquidez: prazo total até o crédito do resgate, em dias úteis salvo indicação.`;
    wrap.onclick = (e) => {
      if (e.target.closest("[data-clearall]")) { e.preventDefault(); clearAll(); return; }
      const th = e.target.closest("th[data-sort]");
      if (th) {
        const k = th.dataset.sort;
        state.sort = state.sort.key === k ? { key: k, dir: -state.sort.dir } : { key: k, dir: k === "nome" || k === "categoria" || k === "resg" || k === "vol" ? 1 : -1 };
        App.store.set("sort", state.sort); renderTable(); return;
      }
      if (e.target.closest("a[href]")) return; // links rápidos (mensal/carteira) navegam sozinhos
      const cb = e.target.closest("[data-sel]");
      if (cb) { e.stopPropagation(); if (!App.toggleSelect(cb.dataset.sel, cb.checked)) cb.checked = false; return; }
      const tr = e.target.closest("tr[data-id]");
      if (tr) location.hash = "#/fundo/" + encodeURIComponent(tr.dataset.id);
    };
  }

  function renderActive(n) {
    const el = document.getElementById("active");
    const F = state.filters; const chips = [];
    if (F.q) chips.push(["q", null, `Busca: “${F.q}”`]);
    FILTERS.forEach((d) => {
      const v = F[d.id];
      if (d.type === "multi") v.forEach((x) => chips.push([d.id, x, x]));
      else if (d.type === "flags") v.forEach((x) => chips.push([d.id, x, d.options.find((o) => o[0] === x)[1]]));
      else if (d.type === "seg" || d.type === "select") { if (v) chips.push([d.id, null, `${d.label}: ${d.options.find((o) => o[0] === v)[1]}`]); }
      else if (d.type === "ranges") d.items.forEach((it) => { if (v[it.id] !== "" && v[it.id] != null) chips.push(["ranges", it.id, `${lbl(it.label)}: ${v[it.id]}${it.unit ? " " + it.unit : ""}`]); });
    });
    el.innerHTML = chips.length ? chips.map(([k, v, t]) => `<button class="chip" type="button" data-k="${k}" data-v="${esc(v ?? "")}" aria-pressed="true">${esc(t)}<span class="x" aria-hidden="true">×</span></button>`).join("") + `<button class="btn ghost small" type="button" data-all>Limpar filtros</button>` : "";
    el.onclick = (e) => {
      if (e.target.closest("[data-all]")) { clearAll(); return; }
      const c = e.target.closest(".chip"); if (!c) return;
      const k = c.dataset.k, v = c.dataset.v;
      if (k === "q") { F.q = ""; document.getElementById("q").value = ""; }
      else if (k === "ranges") F.ranges[v] = "";
      else if (Array.isArray(F[k])) F[k].splice(F[k].indexOf(v), 1);
      else F[k] = "";
      save(); refresh();
    };
  }

  function syncSelection() {
    document.querySelectorAll("#table-wrap tr[data-id]").forEach((tr) => {
      const sel = App.state.selection.includes(tr.dataset.id);
      tr.classList.toggle("selected", sel);
      const cb = tr.querySelector("[data-sel]"); if (cb) cb.checked = sel;
    });
  }

  function exportCsv() {
    const list = sorted(App.filterFunds());
    const cols = COLS.filter((c) => visible.includes(c.id));
    const head = ["Fundo", "CNPJ", "Categoria", ...cols.filter((c) => c.id !== "categoria").map((c) => colLabel(c) + (c.ret ? ` (${App.retModeLabel()})` : ""))];
    const raw = (f, c) => {
      if (c.id === "liq") return App.liquidityText(f);
      if (c.id === "benchmark") return App.benchName(f.benchmark_id);
      const v = App.M[c.metric()].get(f).v;
      if (v == null) return "N/D";
      return typeof v === "number" ? String(v).replace(".", ",") : v;
    };
    const rows = list.map((f) => [f.nome, f.cnpj, f.categoria, ...cols.filter((c) => c.id !== "categoria").map((c) => raw(f, c))]);
    const csv = "﻿" + [head, ...rows].map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(";")).join("\r\n") +
      `\r\n\r\n"Data-base: ${App.fmt.date(App.meta.data_base)}. Percentuais em forma decimal (0,0123 = 1,23%). Fontes: CVM, BCB, gestora."`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `fundos_${App.meta.data_base}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
  }

  App.on("selection", syncSelection);
  App.views.funds = { render, destroy() {} };
})();
