// Dashboard interactions, attached once to the server-rendered HTML.
// Plain DOM, no framework: the markup comes from lib/render.ts as a string.
//   [data-day="YYYY-MM-DD"]      opens the day dialog for that date only
//   [data-day-step="-1|1"]       moves the open day dialog back/forward a day
//   [data-filter="<bucket>"]     filters the run log rows by data-b (/running)
//   /running?d=YYYY-MM-DD        scrolls to and highlights that day's run
//   #day=YYYY-MM-DD in the URL   opens that day on load (shareable)
// Day data is read from <script type="application/json" id="day-data">.
// Returns a cleanup function.

import { renderDay, type DayData } from "./day-view";
import { addDays, toIso, toMs } from "./util";

export function attachDashboard(doc: Document): () => void {
  let data: DayData | null = null;
  const dataEl = doc.getElementById("day-data");
  if (dataEl?.textContent) {
    try {
      data = JSON.parse(dataEl.textContent) as DayData;
    } catch {
      data = null;
    }
  }
  const dlg = doc.getElementById("m-day") as HTMLDialogElement | null;
  const body = doc.getElementById("m-day-body");
  let current: string | null = null;

  const openDay = (iso: string) => {
    if (!data || !dlg || !body || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return;
    current = iso;
    body.innerHTML = renderDay(iso, data);
    dlg.scrollTop = 0;
    if (!dlg.open) dlg.showModal();
    doc.documentElement.classList.add("modal-open");
    history.replaceState(null, "", `#day=${iso}`);
    doc.querySelectorAll(".cell.sel").forEach((c) => c.classList.remove("sel"));
    doc.querySelector(`.cell[data-day="${iso}"]`)?.classList.add("sel");
  };

  const setFilter = (scope: ParentNode, key: string) => {
    scope.querySelectorAll<HTMLElement>("[data-filter]").forEach((b) => {
      b.classList.toggle("on", b.dataset.filter === key);
      b.setAttribute("aria-pressed", String(b.dataset.filter === key));
    });
    scope.querySelectorAll<HTMLElement>("tbody tr[data-b]").forEach((tr) => {
      tr.hidden = key !== "all" && tr.dataset.b !== key;
    });
  };

  const onClick = (e: MouseEvent) => {
    const t = e.target as HTMLElement;
    // backdrop click: the event target is the <dialog> itself
    if (t instanceof HTMLDialogElement && t.open) {
      const r = t.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) t.close();
      return;
    }
    const step = t.closest<HTMLElement>("[data-day-step]");
    if (step && current) {
      openDay(toIso(addDays(toMs(current), Number(step.dataset.dayStep))));
      return;
    }
    const f = t.closest<HTMLElement>("[data-filter]");
    if (f) {
      setFilter(f.closest("section") ?? doc, f.dataset.filter!);
      return;
    }
    const d = t.closest<HTMLElement>("[data-day]");
    if (d && !t.closest("a")) openDay(d.dataset.day!);
  };

  const onKey = (e: KeyboardEvent) => {
    if (dlg?.open && current && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      openDay(toIso(addDays(toMs(current), e.key === "ArrowLeft" ? -1 : 1)));
      return;
    }
    if (e.key !== "Enter" && e.key !== " ") return;
    const d = (e.target as HTMLElement).closest<HTMLElement>("[data-day]");
    if (d && !(e.target instanceof HTMLButtonElement) && !(e.target instanceof HTMLAnchorElement)) {
      e.preventDefault();
      openDay(d.dataset.day!);
    }
  };

  const onClose = (e: Event) => {
    if (!(e.target instanceof HTMLDialogElement)) return;
    doc.documentElement.classList.remove("modal-open");
    current = null;
    doc.querySelectorAll(".cell.sel").forEach((c) => c.classList.remove("sel"));
    if (location.hash.startsWith("#day=")) history.replaceState(null, "", location.pathname + location.search);
  };

  doc.addEventListener("click", onClick);
  doc.addEventListener("keydown", onKey);
  doc.addEventListener("close", onClose, true); // "close" doesn't bubble; capture it

  const fromUrl = () => {
    // Old links to the Running modal now go to the Running page.
    if (location.hash === "#running") {
      location.replace("/running");
      return;
    }
    const m = location.hash.match(/^#day=(\d{4}-\d{2}-\d{2})$/);
    if (m) openDay(m[1]);
  };
  fromUrl();
  window.addEventListener("hashchange", fromUrl);

  // /running?d=YYYY-MM-DD: highlight that day's run(s) in the log.
  const want = new URLSearchParams(location.search).get("d");
  if (want) {
    const rows = doc.querySelectorAll<HTMLElement>(`tr[data-date="${CSS.escape(want)}"]`);
    rows[0]?.scrollIntoView({ block: "center" });
    rows.forEach((r) => r.classList.add("flash"));
  }

  // Heatmap scrolls horizontally on narrow screens: start at the most recent weeks.
  doc.querySelectorAll<HTMLElement>(".hm-scroll").forEach((s) => {
    s.scrollLeft = s.scrollWidth;
  });

  // Color scheme switcher in the sidebar: saved per browser.
  const markTheme = () => {
    const cur = doc.documentElement.dataset.theme;
    doc.querySelectorAll<HTMLElement>("[data-theme-set]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.themeSet === cur)));
  };
  const onTheme = (e: MouseEvent) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-theme-set]");
    if (!b) return;
    doc.documentElement.dataset.theme = b.dataset.themeSet!;
    try {
      localStorage.setItem("ls-theme", b.dataset.themeSet!);
    } catch {
      /* private mode: the choice just won't persist */
    }
    markTheme();
  };
  markTheme();
  doc.addEventListener("click", onTheme);

  // Rings: hovering/focusing a ring or its legend row highlights it and swaps
  // the center text to that metric. Tapping (touch) toggles the same state.
  let pinned: string | null = null;
  const hero = doc.querySelector<HTMLElement>(".hero");
  const showRing = (key: string | null) => {
    if (!hero) return;
    const k = key ?? pinned;
    hero.classList.toggle("focus", !!k);
    hero.querySelectorAll<HTMLElement | SVGElement>("[data-ring]").forEach((el) => el.classList.toggle("hl", el.getAttribute("data-ring") === k));
    hero.querySelectorAll<HTMLElement>(".rc").forEach((el) => el.classList.toggle("on", el.dataset.for === (k ?? "def")));
  };
  const ringOf = (t: EventTarget | null) => (t instanceof Element ? t.closest("[data-ring]")?.getAttribute("data-ring") ?? null : null);
  const onOver = (e: Event) => { const k = ringOf(e.target); if (k) showRing(k); };
  const onOut = (e: Event) => { const to = (e as MouseEvent).relatedTarget; if (ringOf(e.target) && ringOf(to) !== ringOf(e.target)) showRing(ringOf(to)); };
  const onRingClick = (e: Event) => { const k = ringOf(e.target); if (!k) return; pinned = pinned === k ? null : k; showRing(pinned); };
  if (hero) {
    hero.addEventListener("mouseover", onOver);
    hero.addEventListener("mouseout", onOut);
    hero.addEventListener("focusin", onOver);
    hero.addEventListener("focusout", () => showRing(null));
    hero.addEventListener("click", onRingClick);
    showRing(null);
  }

  return () => {
    hero?.removeEventListener("mouseover", onOver);
    hero?.removeEventListener("mouseout", onOut);
    hero?.removeEventListener("focusin", onOver);
    hero?.removeEventListener("click", onRingClick);
    doc.removeEventListener("click", onTheme);
    doc.removeEventListener("click", onClick);
    doc.removeEventListener("keydown", onKey);
    doc.removeEventListener("close", onClose, true);
    window.removeEventListener("hashchange", fromUrl);
  };
}
