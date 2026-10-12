// Dashboard interactions, attached once to the server-rendered HTML.
// Plain DOM, no framework: the markup comes from lib/render.ts as a string.
//   [data-open="<dialog id>"]   opens that dialog (click, Enter, Space)
//   [data-run-date="YYYY-MM-DD"] also scrolls to and highlights that run
//   [data-filter="<bucket>"]    filters the run log rows by data-b
//   #running in the URL opens the fitness modal on load
// Returns a cleanup function.

export function attachDashboard(doc: Document): () => void {
  const HASH: Record<string, string> = { "m-fitness": "#running" };

  const setFilter = (dlg: Element, key: string) => {
    dlg.querySelectorAll<HTMLElement>("[data-filter]").forEach((b) => {
      b.classList.toggle("on", b.dataset.filter === key);
      b.setAttribute("aria-pressed", String(b.dataset.filter === key));
    });
    dlg.querySelectorAll<HTMLElement>("tbody tr[data-b]").forEach((tr) => {
      tr.hidden = key !== "all" && tr.dataset.b !== key;
    });
  };

  const open = (id: string, runDate?: string) => {
    const dlg = doc.getElementById(id) as HTMLDialogElement | null;
    if (!dlg) return;
    if (!dlg.open) dlg.showModal();
    doc.documentElement.classList.add("modal-open");
    if (HASH[id] && location.hash !== HASH[id]) history.replaceState(null, "", HASH[id]);
    if (runDate) {
      setFilter(dlg, "all");
      const row = dlg.querySelector<HTMLElement>(`tr[data-date="${runDate}"]`);
      if (row) {
        row.scrollIntoView({ block: "center" });
        row.classList.remove("flash");
        void row.offsetWidth; // restart the animation
        row.classList.add("flash");
      }
    }
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
    const f = t.closest<HTMLElement>("[data-filter]");
    if (f) {
      const dlg = f.closest("dialog");
      if (dlg) setFilter(dlg, f.dataset.filter!);
      return;
    }
    const o = t.closest<HTMLElement>("[data-open]");
    if (o) open(o.dataset.open!, o.dataset.runDate);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const o = (e.target as HTMLElement).closest<HTMLElement>("[data-open]");
    if (o && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      open(o.dataset.open!, o.dataset.runDate);
    }
  };

  const onClose = (e: Event) => {
    if (!(e.target instanceof HTMLDialogElement)) return;
    doc.documentElement.classList.remove("modal-open");
    if (Object.values(HASH).includes(location.hash)) history.replaceState(null, "", location.pathname + location.search);
  };

  doc.addEventListener("click", onClick);
  doc.addEventListener("keydown", onKey);
  doc.addEventListener("close", onClose, true); // "close" doesn't bubble; capture it

  const openFromHash = () => {
    const hit = Object.entries(HASH).find(([, h]) => h === location.hash);
    if (hit) open(hit[0]);
  };
  openFromHash();
  window.addEventListener("hashchange", openFromHash);

  return () => {
    doc.removeEventListener("click", onClick);
    doc.removeEventListener("keydown", onKey);
    doc.removeEventListener("close", onClose, true);
    window.removeEventListener("hashchange", openFromHash);
  };
}
