import { useState } from "react";
import { since, useAdmin } from "./adminContext";
import "./admin.css";

const RANGES = [
  [7, "Last 7 days"],
  [30, "Last 30 days"],
  [90, "Last 90 days"],
];
const SOURCE = { direct: "Direct", search: "Search", social: "Social", referral: "Other sites" };
const DEVICE = { desktop: "Desktop", phone: "Phone", tablet: "Tablet", program: "Program", bot: "Bot" };
const nf = new Intl.NumberFormat();

/** A list of counts, each with a bar (the biggest is full width). */
function Bars({ rows, label, empty }) {
  const top = Math.max(...rows.map((r) => r.views), 1);
  return (
    <div className="vz-breakdown">
      <h3>{label}</h3>
      {rows.length ? (
        <ul className="vz-bars">
          {rows.map((r) => (
            <li key={r.key}>
              <span className="vz-bar-label" title={r.key}>{r.name}</span>
              <span className="vz-bar-track" aria-hidden="true"><span className="vz-bar" style={{ width: `${(r.views / top) * 100}%` }} /></span>
              <span className="vz-bar-n">{nf.format(r.views)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="admin-muted">{empty}</p>
      )}
    </div>
  );
}

/**
 * Visitors (Admin): who is reading the public website — visits and a rough
 * unique count, each day, top pages, where they came from, countries, devices
 * and browsers. Anonymous: no visitor is identified. Below, the leads the site
 * captured (people who left an email), newest first.
 */
export default function Visitors() {
  const { visits, leads, visitDays, setVisitDays, markLead } = useAdmin();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function mark(l, to) {
    setBusy(l.id);
    try {
      await markLead(l.id, to);
    } catch (err) {
      setError(err.message);
    }
    setBusy("");
  }

  const topDay = visits?.perDay?.length ? Math.max(...visits.perDay.map((d) => d.views), 1) : 1;
  const leadItems = leads?.items ?? [];

  return (
    <section aria-label="Visitors">
      <header className="admin-head">
        <h2>Visitors</h2>
        <span className="admin-muted">The public website, {visits ? `${nf.format(visits.views)} views` : "loading…"}. Anonymous — no visitor is identified.</span>
        <span className="admin-check">
          <select value={visitDays} onChange={(e) => setVisitDays(Number(e.target.value))} aria-label="Range">
            {RANGES.map(([d, label]) => (
              <option key={d} value={d}>{label}</option>
            ))}
          </select>
        </span>
      </header>
      {error && <p className="admin-error" role="alert">{error}</p>}

      {!visits ? (
        <p className="admin-muted">Reading the site's traffic…</p>
      ) : (
        <>
          <div className="vz-stats">
            <div className="vz-stat"><span className="vz-stat-n">{nf.format(visits.views)}</span><span className="admin-muted">Page views</span></div>
            <div className="vz-stat"><span className="vz-stat-n">{nf.format(visits.visitors)}</span><span className="admin-muted">Unique visitors (est.)</span></div>
            <div className="vz-stat"><span className="vz-stat-n">{nf.format(visits.bots)}</span><span className="admin-muted">Bot views (not counted)</span></div>
            <div className="vz-stat"><span className="vz-stat-n">{nf.format(visits.enriched)}</span><span className="admin-muted">Confirmed real browsers</span></div>
          </div>

          <div className="vz-breakdown">
            <h3>Each day</h3>
            {visits.perDay.length ? (
              <div className="vz-days" role="img" aria-label="Views each day">
                {visits.perDay.map((d) => (
                  <span key={d.day} className="vz-day" title={`${d.day}: ${nf.format(d.views)} views, ${nf.format(d.visitors)} visitors`}>
                    <span style={{ height: `${Math.max(2, (d.views / topDay) * 100)}%` }} />
                  </span>
                ))}
              </div>
            ) : (
              <p className="admin-muted">No visits in this range yet.</p>
            )}
          </div>

          <div className="vz-grid">
            <Bars label="Top pages" empty="No pages yet." rows={visits.topPages.map((p) => ({ key: p.path, name: p.path, views: p.views }))} />
            <Bars label="Where they came from" empty="Nothing yet." rows={visits.sources.map((s) => ({ key: s.source, name: SOURCE[s.source] ?? s.source, views: s.views }))} />
            <Bars label="Countries" empty="No locations reported." rows={visits.countries.map((c) => ({ key: c.country, name: c.country, views: c.views }))} />
            <Bars label="Devices" empty="Nothing yet." rows={visits.devices.map((d) => ({ key: d.device, name: DEVICE[d.device] ?? d.device, views: d.views }))} />
            <Bars label="Browsers" empty="Nothing yet." rows={visits.browsers.map((b) => ({ key: b.browser, name: b.browser, views: b.views }))} />
          </div>
        </>
      )}

      <div className="vz-breakdown">
        <h3>Leads {leads ? <span className="admin-muted">· {leads.open} new</span> : null}</h3>
        <p className="admin-muted">People who left their email on the site. Reach out, then mark them contacted.</p>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr><th>Left</th><th>Email</th><th>Page</th><th>Message</th><th /></tr>
            </thead>
            <tbody>
              {leadItems.map((l) => (
                <tr key={l.id}>
                  <td title={new Date(l.createdAt).toLocaleString()}>{since(l.createdAt)}</td>
                  <td><a className="admin-link" href={`mailto:${l.email}`}>{l.email}</a>{l.name && <span className="admin-client">{l.name}</span>}</td>
                  <td className="admin-mono admin-muted">{l.page || "—"}</td>
                  <td className="callback-note">{l.note || <span className="admin-muted">—</span>}</td>
                  <td className="callback-act">
                    {l.status === "contacted" ? (
                      <>
                        <span className="admin-pill" title={l.contactedAt ? new Date(l.contactedAt).toLocaleString() : ""}>Contacted {since(l.contactedAt)}{l.contactedBy && ` · ${l.contactedBy}`}</span>
                        <button type="button" className="admin-link" disabled={busy === l.id} onClick={() => mark(l, "new")}>Not yet</button>
                      </>
                    ) : (
                      <button type="button" className="admin-btn is-primary" disabled={busy === l.id} onClick={() => mark(l, "contacted")}>Mark contacted</button>
                    )}
                  </td>
                </tr>
              ))}
              {leads && !leadItems.length && (
                <tr><td colSpan={5} className="admin-empty">No leads yet.</td></tr>
              )}
              {!leads && (
                <tr><td colSpan={5} className="admin-empty">Loading…</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
