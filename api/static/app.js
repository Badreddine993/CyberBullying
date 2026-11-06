"use strict";
// Sentinelle front-end (Bootstrap 5 + Chart.js).

const $ = (id) => document.getElementById(id);
function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}
function icon(name, extra = "") {
  const i = el("i", `bi ${name} ${extra}`.trim());
  i.setAttribute("aria-hidden", "true");
  return i;
}

const TYPES = { Troll: "Moquerie / trolling", Sexual: "Harcèlement sexuel", Vocational: "Travail / études",
  Political: "Politique", Religion: "Religion", Threat: "Menaces", Ethnicity: "Origine / racisme" };
const EXAMPLES = [
  "you are a worthless idiot, nobody wants you here",
  "I will find you and kill you",
  "Politicians like you are a disgrace to this country",
  "Thanks for sharing, this video really inspired me",
  "Have a wonderful day everyone!",
];
let mode = "one", lastBatch = [], history = [];
const pct = (p) => Math.round(p * 100);

function level(p) {
  if (p >= 0.8) return { txt: "Risque élevé", cls: "text-danger-emphasis", color: "#dc2626",
    reco: "Recommandation : masquer le message et le transmettre à un modérateur." };
  if (p >= 0.5) return { txt: "Risque modéré", cls: "text-warning-emphasis", color: "#ea580c",
    reco: "Recommandation : faire vérifier le message par un modérateur." };
  if (p >= 0.2) return { txt: "Risque faible", cls: "text-success-emphasis", color: "#ca8a04", reco: "Aucune action nécessaire." };
  return { txt: "Risque très faible", cls: "text-success-emphasis", color: "#16a34a", reco: "Aucune action nécessaire." };
}
function announce(msg) {           // read by screen readers via aria-live
  $("announce").textContent = "";
  setTimeout(() => { $("announce").textContent = msg; }, 50);
}

// ---------- Tabs (WAI-ARIA tabs pattern: click + arrow keys) ----------
const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
function selectTab(tab, focus) {
  tabs.forEach((t) => {
    const on = t === tab;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
  });
  if (focus) tab.focus();
  $("inputPanel").setAttribute("aria-labelledby", tab.id);
  mode = tab.dataset.mode;
  $("inputLabel").textContent = mode === "one" ? "Contenu du message" : "Messages (un par ligne)";
  $("input").placeholder = mode === "one" ? "Collez le message à vérifier..." : "Un message par ligne, jusqu'à 1 000 messages...";
  $("inputHelpText").textContent = mode === "one"
    ? "Le modèle est entraîné sur des messages en anglais." : "Chaque ligne est analysée séparément.";
  updateCounter();
  resetResult();
}
tabs.forEach((t, i) => {
  t.addEventListener("click", () => selectTab(t, false));
  t.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      selectTab(tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length], true);
    }
  });
});

// ---------- Examples menu ----------
EXAMPLES.forEach((text) => {
  const li = el("li"), a = el("button", "dropdown-item small", text);
  a.type = "button"; a.lang = "en";
  a.addEventListener("click", () => { $("input").value = text; updateCounter(); analyse(); });
  li.append(a); $("examples").append(li);
});
{
  const sep = el("li"); sep.append(el("hr", "dropdown-divider"));
  const li = el("li"), a = el("button", "dropdown-item small fw-medium");
  a.type = "button"; a.append(icon("bi-collection", "me-2"), "Tous les exemples en lot");
  a.addEventListener("click", () => {
    selectTab($("tab-many"), false);
    $("input").value = EXAMPLES.join("\n"); updateCounter(); analyse();
  });
  li.append(a); $("examples").append(sep, li);
}

// ---------- Input ----------
function updateCounter() {
  const v = $("input").value;
  $("counter").textContent = mode === "many"
    ? `${v.split("\n").filter((s) => s.trim()).length} message(s)`
    : `${v.length} caractère${v.length > 1 ? "s" : ""}`;
}
$("input").addEventListener("input", updateCounter);
$("input").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) analyse(); });
$("clear").addEventListener("click", () => { $("input").value = ""; updateCounter(); resetResult(); $("input").focus(); });
$("go").addEventListener("click", analyse);

function resetResult() {
  ["result", "batchSummary", "tableCard"].forEach((id) => $(id).classList.add("d-none"));
  $("empty").classList.remove("d-none");
  hideError();
}
function showError(msg) {
  $("err").textContent = msg; $("err").classList.remove("d-none");
  $("input").setAttribute("aria-invalid", "true");
}
function hideError() { $("err").classList.add("d-none"); $("input").removeAttribute("aria-invalid"); }
function busy(on) {
  $("go").disabled = on;
  $("go").setAttribute("aria-busy", String(on));
  $("spin").classList.toggle("d-none", !on);
  $("goLabel").textContent = on ? "Analyse en cours..." : "Analyser";
}

async function post(url, body) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

async function analyse() {
  const raw = $("input").value.trim();
  hideError();
  if (!raw) { showError("Veuillez saisir au moins un message."); $("input").focus(); return; }
  busy(true);
  try {
    if (mode === "one") renderOne(await post("/predict", { text: raw }));
    else renderBatch(await post("/predict/batch", { texts: raw.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 1000) }));
  } catch (e) {
    showError("Le service d'analyse ne répond pas. Réessayez dans quelques instants.");
  } finally { busy(false); }
}

// ---------- Rendering ----------
function keywordBadge(word, tag = "li") {
  const b = el(tag, "badge kw bg-danger-subtle text-danger-emphasis border border-danger-subtle", word);
  b.lang = "en";
  return b;
}

function renderOne(p) {
  const l = level(p.probability_bullying), score = pct(p.probability_bullying);
  $("empty").classList.add("d-none"); $("batchSummary").classList.add("d-none"); $("tableCard").classList.add("d-none");
  $("result").classList.remove("d-none");

  const g = $("gauge");
  g.style.setProperty("--c", l.color);
  g.style.setProperty("--v", score);
  g.setAttribute("aria-label", `Score de risque : ${score} sur 100`);
  $("score").textContent = score;

  const badge = $("badge");
  badge.className = "badge rounded-pill mb-2 " + (p.is_bullying ? "text-bg-danger" : "text-bg-success");
  badge.replaceChildren(icon(p.is_bullying ? "bi-exclamation-triangle" : "bi-check2", "me-1"), p.is_bullying ? "Signalé" : "Conforme");
  $("verdict").textContent = p.is_bullying ? "Harcèlement détecté" : "Aucun harcèlement détecté";
  $("level").textContent = l.txt;
  $("level").className = "small fw-medium mb-0 " + l.cls;

  const kw = $("keywords");
  kw.replaceChildren(...(p.key_words.length
    ? p.key_words.map((w) => keywordBadge(w))
    : [el("li", "small text-body-secondary", "Aucun terme à risque identifié.")]));
  $("recommendation").replaceChildren(icon("bi-lightbulb", "me-1"), l.reco);

  announce(`${$("verdict").textContent}. ${l.txt}, score ${score} sur 100.` +
           (p.key_words.length ? ` Termes déterminants : ${p.key_words.join(", ")}.` : ""));
  addHistory([p]);
}

function renderBatch(preds) {
  lastBatch = preds;
  const bad = preds.filter((p) => p.is_bullying).length;
  $("empty").classList.add("d-none"); $("result").classList.add("d-none");
  $("batchSummary").classList.remove("d-none"); $("tableCard").classList.remove("d-none");
  $("bTotal").textContent = preds.length; $("bBad").textContent = bad; $("bOk").textContent = preds.length - bad;
  $("bBar").style.width = (bad / preds.length * 100) + "%";

  const rows = [...preds].sort((a, b) => b.probability_bullying - a.probability_bullying).map((p) => {
    const l = level(p.probability_bullying), score = pct(p.probability_bullying), tr = el("tr");

    const tdStatus = el("td");
    tdStatus.append(el("span", "badge rounded-pill " + (p.is_bullying ? "text-bg-danger" : "text-bg-success"),
                       p.is_bullying ? "Signalé" : "Conforme"));
    const tdMsg = el("td", "msg", p.text); tdMsg.lang = "en";

    const tdScore = el("td"), wrap = el("div", "d-flex align-items-center gap-2");
    const bar = el("div", "progress score-bar"), fill = el("div", "progress-bar");
    bar.setAttribute("aria-hidden", "true");
    fill.style.width = score + "%"; fill.style.background = l.color;
    bar.append(fill);
    const num = el("span", "small fw-medium", String(score));
    num.title = l.txt;
    wrap.append(bar, num, el("span", "visually-hidden", ` sur 100, ${l.txt}`));
    tdScore.append(wrap);

    const tdKw = el("td");
    p.key_words.forEach((w) => { const b = keywordBadge(w, "span"); b.classList.add("me-1"); tdKw.append(b); });
    tr.append(tdStatus, tdMsg, tdScore, tdKw);
    return tr;
  });
  $("rows").replaceChildren(...rows);
  announce(`${preds.length} messages analysés : ${bad} signalés comme harcèlement, ${preds.length - bad} conformes.`);
  addHistory(preds);
}

function addHistory(preds) {
  const time = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  preds.forEach((p) => history.unshift({ ...p, time }));
  history = history.slice(0, 8);
  $("history").replaceChildren(...history.map((h) => {
    const li = el("li", "list-group-item d-flex align-items-center gap-3 py-2");
    const txt = el("span", "txt flex-grow-1", h.text); txt.lang = "en"; txt.title = h.text;
    li.append(
      icon(h.is_bullying ? "bi-exclamation-circle-fill text-danger" : "bi-check-circle-fill text-success"),
      el("span", "visually-hidden", h.is_bullying ? "Signalé : " : "Conforme : "),
      txt,
      el("span", "small text-body-secondary text-nowrap", `${pct(h.probability_bullying)} · ${h.time}`),
    );
    return li;
  }));
  $("histCount").textContent = `${history.length} analyse${history.length > 1 ? "s" : ""}`;
}

$("export").addEventListener("click", () => {
  const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const csv = ["message;statut;score;termes"].concat(lastBatch.map((p) =>
    [esc(p.text), p.is_bullying ? "Signalé" : "Conforme", pct(p.probability_bullying), esc(p.key_words.join(", "))].join(";"))).join("\n");
  const a = el("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
  a.download = "analyse_messages.csv"; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// ---------- Status, model and dataset overview ----------
function setStatus(ok) {
  const dot = el("span", `status-dot ${ok ? "bg-success" : "bg-danger"} me-1`);
  dot.setAttribute("aria-hidden", "true");
  $("apiStatus").replaceChildren(dot, ok ? "Service opérationnel" : "Service indisponible");
}

async function loadOverview() {
  try {
    await (await fetch("/health")).json();
    setStatus(true);
    const m = await (await fetch("/model")).json();
    $("modelName").textContent = "Modèle : " + m.best_model;
    $("kF1").textContent = pct(m.test_metrics.F1) + " %";
    $("kRecall").textContent = pct(m.test_metrics.Recall) + " %";
  } catch (e) { setStatus(false); }

  try {
    const s = await (await fetch("/stats")).json();
    const fmt = (n) => n.toLocaleString("fr-FR");
    const bully = s.by_label["Bullying"] || 0, notBully = s.by_label["Not-Bullying"] || 0;
    $("kTotal").textContent = fmt(s.total); $("kBully").textContent = fmt(bully);

    const types = s.bullying_by_type.filter((t) => TYPES[t.type]);
    // Text alternative of each chart for screen readers (WCAG 1.1.1)
    $("typesDesc").textContent = types.map((t) => `${TYPES[t.type]} : ${t.count}`).join(", ") + ".";
    $("labelDesc").textContent = `Harcèlement : ${fmt(bully)} messages, non harcèlement : ${fmt(notBully)} messages.`;

    const css = getComputedStyle(document.body);
    Chart.defaults.font.family = "Inter, system-ui, sans-serif";
    Chart.defaults.color = css.getPropertyValue("--bs-secondary-color").trim();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) Chart.defaults.animation = false;
    new Chart($("typesChart"), {
      type: "bar",
      data: { labels: types.map((t) => TYPES[t.type]),
              datasets: [{ label: "Messages", data: types.map((t) => t.count), backgroundColor: "#6366f1", borderRadius: 6, barThickness: 18 }] },
      options: { indexAxis: "y", maintainAspectRatio: false, plugins: { legend: { display: false } },
                 scales: { x: { grid: { color: css.getPropertyValue("--bs-border-color-translucent").trim() } }, y: { grid: { display: false } } } },
    });
    new Chart($("labelChart"), {
      type: "doughnut",
      data: { labels: ["Harcèlement", "Non harcèlement"],
              datasets: [{ data: [bully, notBully], backgroundColor: ["#ef4444", "#22c55e"], borderWidth: 0 }] },
      options: { maintainAspectRatio: false, cutout: "68%", plugins: { legend: { position: "bottom" } } },
    });
  } catch (e) {
    $("typesDesc").textContent = $("labelDesc").textContent = "Statistiques indisponibles.";
  }
}
loadOverview();

// Shareable links: /?q=message  or  /?mode=many&q=line1%0Aline2
const params = new URLSearchParams(location.search);
if (params.get("mode") === "many") selectTab($("tab-many"), false);
if (params.get("q")) { $("input").value = params.get("q"); updateCounter(); analyse(); }
