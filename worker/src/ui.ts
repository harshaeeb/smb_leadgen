/**
 * The app shell: one page, no build step, no external assets. Ranking runs
 * client-side because results stream in out of order and the sort needs the
 * whole set -- same rules as rankAndTrim() in rank.ts, applied once the
 * stream closes.
 */

export const APP_HTML = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lead Finder</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #f6f7f9; --panel: #fff; --fg: #14161a; --muted: #5b6472;
    --line: #e2e6ec; --accent: #1f6feb; --accent-fg: #fff;
    --t1: #b42318; --t1bg: #fef3f2; --t2: #b54708; --t2bg: #fffaeb;
    --unk: #475467; --unkbg: #f2f4f7;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0f1115; --panel: #171a21; --fg: #e6e9ef; --muted: #97a1b0;
      --line: #262b35; --accent: #4d8ef7; --accent-fg: #0b0d11;
      --t1: #ff9a8f; --t1bg: #2a1614; --t2: #f5c078; --t2bg: #2a1f10;
      --unk: #a9b2c0; --unkbg: #1c2029;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 16px; background: var(--bg); color: var(--fg);
    font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  .wrap { max-width: 1100px; margin: 0 auto; }
  h1 { font-size: 19px; margin: 0 0 4px; }
  .sub { color: var(--muted); font-size: 13px; margin-bottom: 16px; }
  form, .card {
    background: var(--panel); border: 1px solid var(--line);
    border-radius: 10px; padding: 14px; margin-bottom: 16px;
  }
  .row { display: flex; gap: 10px; flex-wrap: wrap; }
  .field { flex: 1 1 150px; display: flex; flex-direction: column; gap: 5px; }
  label { font-size: 12px; color: var(--muted); font-weight: 600; }
  input, select, button {
    font: inherit; padding: 10px; border-radius: 8px;
    border: 1px solid var(--line); background: var(--bg); color: var(--fg);
  }
  button {
    background: var(--accent); color: var(--accent-fg);
    border: none; font-weight: 600; cursor: pointer; padding: 11px 18px;
  }
  button:disabled { opacity: .55; cursor: default; }
  .actions { margin-top: 12px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .ghost { background: transparent; color: var(--accent); border: 1px solid var(--line); }
  #status { color: var(--muted); font-size: 13px; }
  .scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  table { border-collapse: collapse; width: 100%; font-size: 14px; }
  th, td { text-align: left; padding: 9px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .03em; white-space: nowrap; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .biz { font-weight: 600; }
  .badge {
    display: inline-block; padding: 2px 8px; border-radius: 999px;
    font-size: 11px; font-weight: 700; white-space: nowrap;
  }
  .b1 { background: var(--t1bg); color: var(--t1); }
  .b2 { background: var(--t2bg); color: var(--t2); }
  .bu { background: var(--unkbg); color: var(--unk); }
  .issues { color: var(--muted); font-size: 12.5px; }
  a { color: var(--accent); }
  .tel { font-weight: 600; white-space: nowrap; }
  h2 { font-size: 15px; margin: 22px 0 8px; }
  .note { color: var(--muted); font-size: 13px; margin: 0 0 10px; }
  .err { color: var(--t1); }
  .hidden { display: none; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Lead Finder</h1>
  <div class="sub">Local businesses with no real web presence, ranked for outreach.</div>

  <form id="f">
    <div class="row">
      <div class="field"><label for="city">City</label><input id="city" value="Garland" required></div>
      <div class="field"><label for="state">State</label><input id="state" value="TX" size="4" required></div>
      <div class="field" style="flex:2 1 240px"><label for="service">Service (comma-separated)</label><input id="service" placeholder="plumber, electrician"></div>
      <div class="field" style="flex:0 1 120px"><label for="industry">or preset</label><select id="industry"></select></div>
      <div class="field" style="flex:0 1 90px"><label for="limit">Limit</label><input id="limit" type="number" value="25" min="1" max="200"></div>
    </div>
    <div class="actions">
      <button id="go" type="submit">Find leads</button>
      <button id="copy" type="button" class="ghost hidden">Copy as TSV</button>
      <span id="status"></span>
    </div>
  </form>

  <div id="out"></div>
</div>

<script>
(function () {
  var PRESETS = __PRESETS__;
  var sel = document.getElementById('industry');
  sel.appendChild(new Option('--', ''));
  Object.keys(PRESETS).forEach(function (k) { sel.appendChild(new Option(k, k)); });

  var leads = [], unverified = [], dropped = 0, limit = 25;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function rank() {
    var t1 = leads.filter(function (l) { return l.tier === 0; })
      .sort(function (a, b) { return b.reviews - a.reviews || b.rating - a.rating; });
    var t2 = leads.filter(function (l) { return l.tier === 1; })
      .sort(function (a, b) {
        return b.issues.length - a.issues.length || b.reviews - a.reviews || b.rating - a.rating;
      });
    var all = t1.concat(t2);
    dropped = Math.max(0, all.length - limit);
    return all.slice(0, limit);
  }

  function telLink(p) {
    if (!p) return '';
    return '<a class="tel" href="tel:' + esc(p.replace(/[^0-9+]/g, '')) + '">' + esc(p) + '</a>';
  }

  function render() {
    var kept = rank();
    var html = '';

    if (kept.length) {
      html += '<div class="card"><div class="scroll"><table><thead><tr>' +
        '<th class="num">#</th><th>Business</th><th>Presence</th><th class="num">Reviews</th>' +
        '<th class="num">Rating</th><th>Phone</th><th>Issues / site</th><th>AI ready</th>' +
        '</tr></thead><tbody>';
      kept.forEach(function (l, i) {
        var badge = l.tier === 0 ? 'b1' : 'b2';
        var site = l.website
          ? '<div><a href="' + esc(l.website) + '" target="_blank" rel="noopener">' +
            esc(l.website.replace(/^https?:\\/\\//, '').slice(0, 40)) + '</a></div>'
          : '';
        var iss = l.issues.length ? '<div class="issues">' + esc(l.issues.join(', ')) + '</div>' : '';
        var note = l.note ? '<div class="issues">' + esc(l.note) + '</div>' : '';
        html += '<tr><td class="num">' + (i + 1) + '</td>' +
          '<td><div class="biz">' + esc(l.name) + '</div><div class="issues">' + esc(l.category) + '</div></td>' +
          '<td><span class="badge ' + badge + '">' + esc(l.presence) + '</span></td>' +
          '<td class="num">' + l.reviews + '</td><td class="num">' + (l.rating || '') + '</td>' +
          '<td>' + telLink(l.phone) + '</td>' +
          '<td>' + site + iss + note + '</td>' +
          '<td>' + esc(l.aiReady) + '</td></tr>';
      });
      html += '</tbody></table></div>';
      if (dropped > 0) {
        html += '<p class="note" style="margin:10px 0 0">' + dropped +
          ' more qualifying leads found beyond the limit of ' + limit + '.</p>';
      }
      html += '</div>';
    }

    if (unverified.length) {
      html += '<h2>Could not verify (' + unverified.length + ')</h2>';
      html += '<p class="note">These sites blocked or failed our check from Cloudflare\\'s network, ' +
        'which often just means bot protection. They are <strong>not</strong> ranked as leads \\u2014 ' +
        'open each one to see for yourself before calling.</p>';
      html += '<div class="card"><div class="scroll"><table><thead><tr>' +
        '<th>Business</th><th class="num">Reviews</th><th>Phone</th><th>Site</th><th>Why</th>' +
        '</tr></thead><tbody>';
      unverified.forEach(function (l) {
        html += '<tr><td><div class="biz">' + esc(l.name) + '</div></td>' +
          '<td class="num">' + l.reviews + '</td>' +
          '<td>' + telLink(l.phone) + '</td>' +
          '<td><a href="' + esc(l.website) + '" target="_blank" rel="noopener">open</a></td>' +
          '<td class="issues">' + esc(l.note || '') + '</td></tr>';
      });
      html += '</tbody></table></div></div>';
    }

    document.getElementById('out').innerHTML = html;
    document.getElementById('copy').classList.toggle('hidden', kept.length === 0);
    window.__kept = kept;
  }

  document.getElementById('copy').addEventListener('click', function () {
    var head = ['Rank', 'Business', 'Category', 'Reviews', 'Rating', 'Phone', 'Presence', 'Website', 'Issues', 'AI Ready'];
    var rows = (window.__kept || []).map(function (l, i) {
      return [i + 1, l.name, l.category, l.reviews, l.rating, l.phone, l.presence, l.website, l.issues.join('; '), l.aiReady].join('\\t');
    });
    navigator.clipboard.writeText([head.join('\\t')].concat(rows).join('\\n')).then(function () {
      var b = document.getElementById('copy');
      b.textContent = 'Copied';
      setTimeout(function () { b.textContent = 'Copy as TSV'; }, 1500);
    });
  });

  document.getElementById('f').addEventListener('submit', async function (e) {
    e.preventDefault();
    var go = document.getElementById('go');
    var status = document.getElementById('status');
    leads = []; unverified = []; dropped = 0;
    limit = parseInt(document.getElementById('limit').value, 10) || 25;
    go.disabled = true;
    document.getElementById('out').innerHTML = '';
    status.textContent = 'Searching\\u2026';
    status.className = '';

    var q = new URLSearchParams({
      city: document.getElementById('city').value,
      state: document.getElementById('state').value,
      service: document.getElementById('service').value,
      industry: document.getElementById('industry').value,
      limit: String(limit)
    });

    try {
      var resp = await fetch('/api/run?' + q.toString());
      if (!resp.ok) throw new Error('HTTP ' + resp.status + ': ' + (await resp.text()).slice(0, 200));
      var reader = resp.body.getReader();
      var dec = new TextDecoder();
      var buf = '';
      var scanned = 0, kept = 0;

      while (true) {
        var r = await reader.read();
        if (r.done) break;
        buf += dec.decode(r.value, { stream: true });
        var lines = buf.split('\\n');
        buf = lines.pop();
        for (var i = 0; i < lines.length; i++) {
          if (!lines[i].trim()) continue;
          var msg = JSON.parse(lines[i]);
          if (msg.type === 'progress') {
            status.textContent = msg.text;
          } else if (msg.type === 'checked') {
            scanned++;
            status.textContent = 'Checked ' + scanned + ' of ' + msg.total + ' \\u2014 ' + kept + ' leads so far';
          } else if (msg.type === 'lead') {
            kept++;
            if (msg.lead.tier === null) unverified.push(msg.lead); else leads.push(msg.lead);
            render();
          } else if (msg.type === 'error') {
            throw new Error(msg.message);
          }
        }
      }
      render();
      status.textContent = leads.length + ' leads' +
        (unverified.length ? ', ' + unverified.length + ' unverified' : '') + '. Done.';
    } catch (err) {
      status.textContent = String(err.message || err);
      status.className = 'err';
    } finally {
      go.disabled = false;
    }
  });
})();
</script>
</body>
</html>`;

export function renderApp(presets: Record<string, string[]>): string {
  return APP_HTML.replace('__PRESETS__', JSON.stringify(presets));
}
