// Site visitors tab — reads live tracking data (web_events / visitor_summary).
// Only signed-in CRM users can read these tables (RLS: private.is_crm_user()).
(function () {
  const $ = (id) => document.getElementById(id);
  const tabs = $("dash-tabs");
  const leadsScreen = $("crm-screen");
  const visScreen = $("visitors-screen");
  let current = "leads";
  let signedIn = false;
  let loading = false;

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function fmtET(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    if (isNaN(d)) return "";
    return (
      d.toLocaleString("en-US", {
        timeZone: "America/New_York",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }) + " ET"
    );
  }
  const CLICK_NAMES = {
    tel_phone: "phone",
    mailto_email: "email",
    brochure: "brochure",
    quote_form: "quote",
    quote_cta: "quote",
  };
  function clickName(label) {
    if (!label) return "click";
    if (CLICK_NAMES[label]) return CLICK_NAMES[label];
    if (label.indexOf("nav_") === 0) return "menu: " + label.slice(4);
    if (label.indexOf("anchor_") === 0) return "link: #" + label.slice(7);
    if (label === "outbound_link") return "outbound link";
    return label;
  }

  function showTab(name) {
    current = name;
    document.querySelectorAll(".tab-btn").forEach((b) => {
      b.classList.toggle("active", b.getAttribute("data-tab") === name);
    });
    if (!signedIn) return;
    if (name === "visitors") {
      leadsScreen.classList.add("hidden");
      visScreen.classList.remove("hidden");
      load();
    } else {
      visScreen.classList.add("hidden");
      leadsScreen.classList.remove("hidden");
    }
  }

  document.addEventListener("ftr:auth", (e) => {
    signedIn = !!(e.detail && e.detail.signedIn);
    if (!signedIn) {
      tabs.classList.add("hidden");
      visScreen.classList.add("hidden");
      current = "leads";
      document.querySelectorAll(".tab-btn").forEach((b) => {
        b.classList.toggle("active", b.getAttribute("data-tab") === "leads");
      });
      return;
    }
    tabs.classList.remove("hidden");
    if (current === "visitors") {
      leadsScreen.classList.add("hidden");
      visScreen.classList.remove("hidden");
    }
  });

  document.querySelectorAll(".tab-btn").forEach((b) => {
    b.addEventListener("click", () => showTab(b.getAttribute("data-tab")));
  });

  // crm.js may have signed in before this script loaded: pick up the current state.
  const userLabel = $("user-label");
  if (userLabel && !userLabel.classList.contains("hidden")) {
    signedIn = true;
    tabs.classList.remove("hidden");
  }
  $("visitors-refresh").addEventListener("click", load);

  function setMsg(text) {
    const m = $("visitors-msg");
    m.textContent = text || "";
    m.classList.toggle("hidden", !text);
  }

  async function load() {
    const sb = window.FTR_SB;
    if (!sb || loading) return;
    loading = true;
    setMsg("Loading…");
    try {
      const [tot, vis, evs] = await Promise.all([
        sb.rpc("site_traffic_totals"),
        sb.from("visitor_summary").select("*").order("last_seen", { ascending: false }).limit(50),
        sb
          .from("web_events")
          .select("server_ts,ip,visitor_id,event,path,click_label,click_href,referrer,utm_source")
          .order("server_ts", { ascending: false })
          .limit(1000),
      ]);
      const err = tot.error || vis.error || evs.error;
      if (err) {
        setMsg("Could not load visitors: " + err.message);
        return;
      }
      render((tot.data && tot.data[0]) || {}, vis.data || [], evs.data || []);
    } finally {
      loading = false;
    }
  }

  function render(t, visitors, events) {
    const n = (v) => Number(v || 0);
    $("visitor-stats").innerHTML = [
      ["Page views", n(t.pageviews)],
      ["Unique visitors", n(t.unique_visitors)],
      ["Phone taps", n(t.phone_clicks)],
      ["Email clicks", n(t.email_clicks)],
      ["Brochure", n(t.brochure_clicks)],
      ["Quote clicks", n(t.quote_clicks)],
    ]
      .map(([l, v]) => `<div class="stat-chip"><span class="n">${v}</span><span class="l">${l}</span></div>`)
      .join("");
    $("visitors-since").textContent = t.first_event ? "Tracking since " + fmtET(t.first_event) : "";

    if (!visitors.length) {
      setMsg("No site visits recorded yet. Data appears here once track.js is live on ftrkitchens.com.");
      $("visitor-list").innerHTML = "";
      $("event-list").innerHTML = "";
      return;
    }
    setMsg("");

    // Pages and clicks per IP from recent events
    const byIp = {};
    events.forEach((e) => {
      const k = e.ip || "";
      if (!byIp[k]) byIp[k] = { pages: [], clicks: [], referrer: "", utm: "" };
      const g = byIp[k];
      if (e.event === "pageview") {
        if (e.path && g.pages.indexOf(e.path) < 0) g.pages.push(e.path);
        if (e.referrer && !g.referrer) g.referrer = e.referrer;
        if (e.utm_source && !g.utm) g.utm = e.utm_source;
      } else if (e.event === "click") {
        g.clicks.push(clickName(e.click_label));
      }
    });

    $("visitor-list").innerHTML = visitors
      .map((v) => {
        const g = byIp[v.ip] || { pages: [], clicks: [], referrer: "", utm: "" };
        const place = [v.city, v.region].filter(Boolean).join(", ") || (v.country || "Location pending");
        const who = v.company_name ? `${esc(v.company_name)} · ${esc(v.company_type || "")}` : esc(v.ip);
        const counts = {};
        g.clicks.forEach((c) => (counts[c] = (counts[c] || 0) + 1));
        const clickTxt = Object.keys(counts).length
          ? Object.entries(counts).map(([c, k]) => `${esc(c)}${k > 1 ? " ×" + k : ""}`).join(", ")
          : "no clicks";
        const src = g.utm ? "utm: " + g.utm : g.referrer ? "from " + g.referrer : "";
        return `<article class="v-card">
          <div class="who">${esc(place)}</div>
          <div class="meta">${who}${v.company_name ? " · " + esc(v.ip) : ""}</div>
          <div class="meta">${n(v.pageviews)} page views · ${n(v.clicks)} clicks (${clickTxt}) · last seen ${esc(fmtET(v.last_seen))}</div>
          <div class="pages">Pages: ${g.pages.length ? g.pages.map(esc).join(", ") : "—"}${src ? " · " + esc(src) : ""}</div>
        </article>`;
      })
      .join("");

    const geo = {};
    visitors.forEach((v) => (geo[v.ip] = [v.city, v.region].filter(Boolean).join(", ")));
    const clicks = events.filter((e) => e.event === "click").slice(0, 40);
    $("event-list").innerHTML = clicks.length
      ? clicks
          .map(
            (e) => `<div class="e-row">
          <div><span class="ev">${esc(clickName(e.click_label))}</span> · ${esc(fmtET(e.server_ts))}</div>
          <div class="meta">${esc(e.click_href || "")}${e.path ? " on " + esc(e.path) : ""}</div>
          <div class="meta">${esc(geo[e.ip] || e.ip || "")}</div>
        </div>`
          )
          .join("")
      : '<p class="muted">No clicks yet.</p>';
  }
})();
