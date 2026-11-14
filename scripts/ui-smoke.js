// Headless UI smoke test. Needs: npm i jsdom --no-save, and a running server. Run: BASE=http://localhost:3055 node scripts/ui-smoke.js
const { JSDOM } = require('jsdom');
const base = process.env.BASE || 'http://localhost:3055';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const must = (c, m, extra = '') => { if (!c) { failed++; console.log('FAIL:', m, extra); } else console.log('ok  :', m); };
const boot = (token, extra) => JSDOM.fromURL(base + '/', {
  runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
  beforeParse(w) {
    w.fetch = (u, o) => fetch(new URL(u, base).href, o);
    if (!w.crypto || !w.crypto.randomUUID) Object.defineProperty(w, 'crypto', { value: require('crypto').webcrypto });
    w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    w.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.dispatchEvent(new w.Event('close')); };
    w.prompt = () => '10'; w.open = () => null;
    if (token) w.localStorage.setItem('mz', JSON.stringify(token));
    w.addEventListener('error', (e) => extra.errors.push(e.message));
    w.addEventListener('unhandledrejection', (e) => extra.errors.push('unhandled: ' + e.reason));
  },
});
(async () => {
  const errors = [];
  // ---- before sign-in: the free health check is visible
  let dom = await boot(null, { errors }); await wait(600);
  must(/Free books health check/.test(dom.window.document.body.textContent), 'Sign-in page offers the free Books Health Check');
  dom.window.close();
  // ---- signed in
  const slug = 'ui' + Math.random().toString(36).slice(2, 7);
  const su = await (await fetch(base + '/api/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug, business_name: 'UI Test Lounge', owner_name: 'Amani', email: slug + '@example.com', password: 'password123', pin: '1234', demo: true }) })).json();
  if (!su.token) throw new Error('signup failed ' + JSON.stringify(su));
  dom = await boot({ token: su.token, business: su.business, user: su.user }, { errors });
  const w = dom.window, d = w.document; await wait(1200);
  const txt = () => d.querySelector('#main').textContent;
  const click = async (el, ms = 700) => { el.click(); await wait(ms); };
  const btn = (re) => [...d.querySelectorAll('button')].find((b) => re.test(b.textContent));
  must(/Beef stew/.test(txt()), 'Sell screen shows the demo menu');
  await click([...d.querySelectorAll('.item')].find((b) => /Beef stew/.test(b.textContent)));
  await click([...d.querySelectorAll('.item')].find((b) => /Chapati/.test(b.textContent)));
  must(/700\.00/.test(txt()), 'Bill total updates');
  must(btn(/Kitchen ticket/) && btn(/Receipt/) && btn(/Service charge/) && btn(/Deposit, gift card/), 'Bill has kitchen ticket, receipt, service charge and other-payment buttons');
  await click(btn(/Service charge/), 900);
  must(/770\.00/.test(txt()), 'Service charge of 10% added to the balance');
  await click(btn(/Deposit, gift card/), 800);
  must(/Other ways to pay/.test(d.body.textContent), 'Other-payment dialog opens'); d.querySelector('dialog').close();
  await click([...d.querySelectorAll('button.primary')].find((b) => b.textContent === 'Cash'), 1000);
  must(/closed|No open bills/.test(txt()), 'Cash payment closes the bill');
  await click([...d.querySelectorAll('.tabs button')].find((b) => b.textContent === 'Paid'), 900);
  await click(d.querySelector('.billrow'), 900);
  must(btn(/Refund an item/), 'A paid bill offers a refund');
  await click(btn(/Refund an item/), 900); must(/Refund an item/.test(d.body.textContent), 'Refund dialog opens'); d.querySelector('dialog').close();
  for (const page of ['stock', 'buy', 'money', 'reports', 'setup']) { await click(d.querySelector(`nav button[data-page=${page}]`), 1000); must(txt().length > 40 && !/Request failed|Your role|undefined/.test(txt()), `${page} screen renders`); }
  await click(d.querySelector('nav button[data-page=more]'), 1200);
  for (const [label, expect] of [['Today', /Sales today/], ['Hotel', /New reservation/], ['Staff and pay', /Employees/], ['Trade', /Who owes you/], ['Planning', /What to order/], ['Import', /Check first/], ['Settings', /Tourism/], ['Plan and billing', /Your plan/], ['Outlets', /Sales by outlet/]]) {
    await click([...d.querySelectorAll('.tabs button')].find((b) => b.textContent === label), 1100);
    must(expect.test(txt()) && !/Request failed|Your role|undefined|TypeError/.test(txt()), `More → ${label} renders`, txt().slice(0, 120));
  }
  console.log('strip:', d.querySelector('#striptext').textContent);
  must(/Books balanced/.test(d.querySelector('#striptext').textContent), 'Header strip says books balanced');
  must(errors.length === 0, 'no script errors', JSON.stringify(errors));
  w.close(); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('smoke crashed', e); process.exit(1); });
