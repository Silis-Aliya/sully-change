const express = require('express');
const { exec } = require('child_process');

const app = express();
const PORT = Number(process.env.PORT || 8765);
const DEVICE = process.env.PIXEL_DEVICE || '100.67.26.88:5555';
const TOKEN = process.env.PIXEL_AGENT_TOKEN || '';
const PUBLIC_BASE_URL = (process.env.PIXEL_PUBLIC_BASE_URL || 'https://pixel-agent.whisper-aliya.uk').replace(/\/+$/, '');
const ADBKEYBOARD_IME = process.env.ADBKEYBOARD_IME || 'com.android.adbkeyboard/.AdbIME';

let lastPasteCapture = { nonce: '', text: '', link: '', at: 0 };

app.use(express.json({ limit: '50mb' }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID, X-Pixel-Agent-Token');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use((req, res, next) => {
  if (!TOKEN) return next();
  if (req.path === '/paste-capture' && req.method === 'POST') return next();
  const bearer = (req.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const legacy = String(req.query.token || req.get('X-Pixel-Agent-Token') || '');
  if (bearer !== TOKEN && legacy !== TOKEN) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  next();
});

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function sh(cmd, maxBuffer = 50 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    exec(cmd, { maxBuffer }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || stdout || err.message).trim()));
      resolve(stdout);
    });
  });
}

function adb(args) {
  return sh(`adb -s ${DEVICE} ${args}`);
}

function shell(cmd) {
  return adb(`shell ${cmd}`);
}

function quoteShell(s) {
  return `'${String(s).replace(/'/g, "'\\''")}'`;
}

function xmlUnescape(s) {
  return String(s || '')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function parseBounds(bounds) {
  const m = String(bounds || '').match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!m) return null;
  const [x1, y1, x2, y2] = m.slice(1).map(Number);
  return { x1, y1, x2, y2, cx: Math.round((x1 + x2) / 2), cy: Math.round((y1 + y2) / 2), w: x2 - x1, h: y2 - y1 };
}

function parseNodes(xml) {
  const nodes = [];
  const re = /<node\b([^>]*)>/g;
  let match;
  while ((match = re.exec(xml))) {
    const attrs = {};
    const raw = match[1];
    raw.replace(/([\w:-]+)="([^"]*)"/g, (_, k, v) => {
      attrs[k] = xmlUnescape(v);
      return '';
    });
    const b = parseBounds(attrs.bounds);
    nodes.push({
      text: attrs.text || '',
      desc: attrs['content-desc'] || '',
      id: attrs['resource-id'] || '',
      cls: attrs.class || '',
      clickable: attrs.clickable === 'true',
      focusable: attrs.focusable === 'true',
      scrollable: attrs.scrollable === 'true',
      bounds: attrs.bounds || '',
      b,
      raw: attrs,
    });
  }
  return nodes.filter(n => n.b && n.b.w > 0 && n.b.h > 0);
}

async function ensureDevice() {
  await sh(`adb connect ${DEVICE}`).catch(() => '');
  const out = await sh('adb devices');
  const line = out.split('\n').find(l => l.startsWith(DEVICE));
  const state = line ? line.trim().split(/\s+/)[1] : 'missing';
  if (state !== 'device') throw new Error(`Pixel ADB not ready: ${state}`);
  return { device: DEVICE, state };
}

async function currentFocus() {
  return shell(`dumpsys window | grep -E 'mCurrentFocus|mFocusedApp'`).catch(() => '');
}

async function dumpXml() {
  await ensureDevice();
  await shell('uiautomator dump /sdcard/window.xml >/dev/null');
  return shell('cat /sdcard/window.xml');
}

async function observe() {
  const xml = await dumpXml();
  const nodes = parseNodes(xml);
  const focus = await currentFocus();
  const lines = nodes
    .map(n => {
      const label = [n.text, n.desc].filter(Boolean).join(' | ');
      if (!label) return '';
      return `${label} ${n.id ? `(${n.id})` : ''} ${n.bounds}`;
    })
    .filter(Boolean);
  return {
    ok: true,
    device: DEVICE,
    focus,
    nodes,
    xml,
    observationText: lines.slice(0, 160).join('\n'),
  };
}

async function tap(x, y) {
  await shell(`input tap ${Number(x)} ${Number(y)}`);
}

async function swipe(x1, y1, x2, y2, duration = 500) {
  await shell(`input swipe ${Number(x1)} ${Number(y1)} ${Number(x2)} ${Number(y2)} ${Number(duration)}`);
}

function nodeMatches(n, patterns) {
  const hay = `${n.text}\n${n.desc}\n${n.id}`;
  return patterns.some(p => typeof p === 'string' ? hay.includes(p) : p.test(hay));
}

async function tapNode(patterns, opts = {}) {
  const xml = await dumpXml();
  const nodes = parseNodes(xml);
  const candidates = nodes
    .filter(n => nodeMatches(n, patterns))
    .filter(n => opts.clickable == null || n.clickable === opts.clickable || n.focusable)
    .filter(n => !opts.minY || n.b.y1 >= opts.minY)
    .filter(n => !opts.maxY || n.b.y2 <= opts.maxY)
    .sort((a, b) => (a.b.y1 - b.b.y1) || (a.b.x1 - b.b.x1));
  const node = candidates[0];
  if (!node) return { ok: false, matched: null };
  await tap(node.b.cx, node.b.cy);
  return { ok: true, matched: node.text || node.desc || node.id, bounds: node.bounds, x: node.b.cx, y: node.b.cy };
}

async function openXhs() {
  await ensureDevice();
  await shell('monkey -p com.xingin.xhs -c android.intent.category.LAUNCHER 1');
  await sleep(1500);
}

function isDetailScreenText(text) {
  return /DetailFeedActivity|navBarShareBtn|noteContentText|bottomComment|说点什么|收藏\d*|评论\d*|关注/.test(text);
}

async function isDetailScreen() {
  const focus = await currentFocus();
  if (/DetailFeedActivity/.test(focus)) return true;
  const xml = await dumpXml();
  return isDetailScreenText(focus + '\n' + xml);
}

async function openDetailFromCurrent() {
  if (await isDetailScreen()) return { ok: true, alreadyDetail: true, observationText: (await observe()).observationText };

  await shell('input keyevent 111').catch(() => {});
  await sleep(300);

  for (let attempt = 0; attempt < 4; attempt++) {
    const xml = await dumpXml();
    const nodes = parseNodes(xml);
    const cards = nodes
      .filter(n => /com\.xingin\.xhs:id\/card_view$/.test(n.id))
      .filter(n => n.b.y1 >= 330 && n.b.y2 <= 2260 && n.b.w > 180 && n.b.h > 160)
      .sort((a, b) => {
        const ac = Math.abs(a.b.cy - 1200);
        const bc = Math.abs(b.b.cy - 1200);
        return ac - bc;
      });

    for (const card of cards.slice(0, 3)) {
      await tap(card.b.cx, card.b.cy);
      await sleep(1300);
      if (await isDetailScreen()) {
        return { ok: true, tapped: { bounds: card.bounds, x: card.b.cx, y: card.b.cy }, observationText: (await observe()).observationText };
      }
      await shell('input keyevent 4').catch(() => {});
      await sleep(700);
    }

    const descCards = nodes
      .filter(n => /^(笔记|视频)/.test(n.desc || ''))
      .filter(n => n.b.y1 >= 330 && n.b.y2 <= 2260 && n.b.w > 180 && n.b.h > 160)
      .sort((a, b) => Math.abs(a.b.cy - 1200) - Math.abs(b.b.cy - 1200));
    if (descCards[0]) {
      await tap(descCards[0].b.cx, Math.min(descCards[0].b.cy, descCards[0].b.y1 + 220));
      await sleep(1300);
      if (await isDetailScreen()) {
        return { ok: true, tapped: { bounds: descCards[0].bounds, x: descCards[0].b.cx, y: descCards[0].b.cy }, observationText: (await observe()).observationText };
      }
      await shell('input keyevent 4').catch(() => {});
      await sleep(700);
    }

    await swipe(820, 1780, 820, 980, 350);
    await sleep(900);
  }

  throw new Error('Could not open a note detail: no stable card_view/detail transition found');
}

async function hasAdbKeyboard() {
  const list = await shell('ime list -s');
  return list.includes('com.android.adbkeyboard');
}

async function inputKeyword(keyword) {
  if (!keyword || !String(keyword).trim()) throw new Error('Search keyword is empty');
  if (!(await hasAdbKeyboard())) {
    throw new Error('ADBKeyboard not installed. Install ADB Keyboard and enable com.android.adbkeyboard/.AdbIME for stable Chinese input.');
  }
  const previousIme = (await shell('settings get secure default_input_method').catch(() => '')).trim();
  await shell(`ime set ${ADBKEYBOARD_IME}`);
  await sleep(300);
  await shell(`am broadcast -a ADB_INPUT_TEXT --es msg ${quoteShell(keyword)}`);
  await sleep(500);
  await shell('input keyevent 66');
  await sleep(1400);
  if (previousIme && previousIme !== 'null') {
    await shell(`ime set ${quoteShell(previousIme)}`).catch(() => {});
  }
}

async function searchXhs(keyword) {
  await openXhs();
  await tapNode([/content-desc="搜索"/, /搜索/, /com\.xingin\.xhs:id\/search$/], { minY: 80, maxY: 330 }).catch(() => tap(1008, 196));
  await sleep(900);
  const before = await observe();
  await inputKeyword(keyword);
  const after = await observe();
  const combined = `Before search input:\n${before.observationText}\n\nAfter searching "${keyword}":\n${after.observationText}`;
  if (/表情|emoji|Gboard/.test(after.observationText) && !after.observationText.includes(keyword)) {
    throw new Error('Search input appears stuck in keyboard/emoji state');
  }
  return { ok: true, keyword, observationText: combined, before, after };
}

function extractLink(text) {
  const m = String(text || '').match(/(?:https?:\/\/)?(?:www\.)?(?:xhslink\.com|xiaohongshu\.com)\/[A-Za-z0-9/_?&=.%:-]+/i);
  if (!m) return '';
  return /^https?:\/\//i.test(m[0]) ? m[0] : `http://${m[0]}`;
}

async function captureClipboardPreview() {
  for (const [x, y] of [[160, 2180], [170, 2140], [210, 2200]]) {
    await tap(x, y).catch(() => {});
    await sleep(800);
    const obs = await observe().catch(() => null);
    const text = obs?.observationText || '';
    const link = extractLink(text);
    if (link) {
      const done = await tapNode([/^完成$/, /完成/], { maxY: 350 }).catch(() => null);
      if (!done?.ok) await tap(150, 185).catch(() => {});
      await sleep(500);
      return { link, text };
    }
  }
  return { link: '', text: '' };
}

async function captureClipboardViaPage() {
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  lastPasteCapture = { nonce, text: '', link: '', at: 0 };
  const url = `${PUBLIC_BASE_URL}/paste-capture?nonce=${encodeURIComponent(nonce)}`;
  await shell(`am start -a android.intent.action.VIEW -d ${quoteShell(url)}`);
  await sleep(1800);
  await tap(540, 260);
  await sleep(300);
  await shell('input keyevent 279').catch(() => {});
  await sleep(1200);
  for (let i = 0; i < 8; i++) {
    if (lastPasteCapture.nonce === nonce && lastPasteCapture.link) {
      await shell('input keyevent 4').catch(() => {});
      return { link: lastPasteCapture.link, text: lastPasteCapture.text };
    }
    await sleep(500);
  }
  await shell('input keyevent 4').catch(() => {});
  return { link: '', text: '' };
}

async function shareCurrent() {
  if (!(await isDetailScreen())) throw new Error('Current screen is not a note detail page; refusing to share/search screen');
  const before = await observe();
  const shareTapped = await tapNode([/com\.xingin\.xhs:id\/navBarShareBtn$/, /^分享$/], { maxY: 360 });
  if (!shareTapped.ok) throw new Error('Share button not found on detail page');
  await sleep(900);
  const panel = await observe();
  const copyTapped = await tapNode([/^复制链接$/, /复制链接/], { minY: 1700 });
  if (!copyTapped.ok) throw new Error('Copy link button not found in share panel');
  await sleep(450);

  let captured = await captureClipboardPreview();
  if (!captured.link) captured = await captureClipboardViaPage();

  const after = await observe();
  const shareLink = captured.link || extractLink(`${panel.observationText}\n${after.observationText}`);
  return {
    ok: true,
    shareLink,
    clipboardText: captured.text,
    tapped: { shareTapped, copyTapped },
    observationText: [
      'Before sharing:',
      before.observationText,
      '',
      'Share panel:',
      panel.observationText,
      '',
      'Clipboard capture:',
      shareLink ? `copied link: ${shareLink}` : 'no link captured',
      captured.text || '',
      '',
      'After sharing:',
      after.observationText,
    ].join('\n'),
    before,
    panel,
    after,
  };
}

async function browseXhs() {
  await openXhs();
  await swipe(820, 1780, 820, 980, 350);
  await sleep(900);
  return observe();
}

async function myProfile() {
  await openXhs();
  await tapNode([/com\.xingin\.xhs:id\/index_me$/, /^我$/], { minY: 2200 }).catch(() => tap(970, 2290));
  await sleep(1200);
  return observe();
}

async function toolCall(name, args = {}) {
  if (name === 'xhs_phone_health') {
    const dev = await ensureDevice();
    return { ok: true, ...dev };
  }
  if (name === 'xhs_phone_open') {
    await openXhs();
    return observe();
  }
  if (name === 'xhs_phone_observe') return observe();
  if (name === 'xhs_phone_browse') return browseXhs();
  if (name === 'xhs_phone_search') return searchXhs(String(args.keyword || '').trim());
  if (name === 'xhs_phone_open_detail') return openDetailFromCurrent();
  if (name === 'xhs_phone_share_current') return shareCurrent();
  if (name === 'xhs_phone_like_current') {
    const tapped = await tapNode([/^赞$/, /喜欢/, /like/i], { minY: 1800 }).catch(() => null);
    await sleep(600);
    return { ok: true, tapped, observationText: (await observe()).observationText };
  }
  if (name === 'xhs_phone_my_profile') return myProfile();
  if (name === 'xhs_phone_back') {
    await shell('input keyevent 4');
    await sleep(700);
    return observe();
  }
  throw new Error(`Unknown tool: ${name}`);
}

const tools = [
  { name: 'xhs_phone_health', description: 'Check Pixel ADB/Tailscale state.', inputSchema: { type: 'object', properties: { deviceAddress: { type: 'string' } } } },
  { name: 'xhs_phone_open', description: 'Open XHS on the Pixel and observe.', inputSchema: { type: 'object', properties: {} } },
  { name: 'xhs_phone_observe', description: 'Read current Pixel screen.', inputSchema: { type: 'object', properties: {} } },
  { name: 'xhs_phone_browse', description: 'Browse XHS feed and observe.', inputSchema: { type: 'object', properties: {} } },
  { name: 'xhs_phone_search', description: 'Search XHS with stable ADBKeyboard input.', inputSchema: { type: 'object', properties: { keyword: { type: 'string' } }, required: ['keyword'] } },
  { name: 'xhs_phone_open_detail', description: 'Open a note detail by UIAutomator card_view node.', inputSchema: { type: 'object', properties: {} } },
  { name: 'xhs_phone_like_current', description: 'Like current note.', inputSchema: { type: 'object', properties: {} } },
  { name: 'xhs_phone_share_current', description: 'Copy/share current note link by UI nodes and clipboard preview.', inputSchema: { type: 'object', properties: {} } },
  { name: 'xhs_phone_my_profile', description: 'Open profile.', inputSchema: { type: 'object', properties: {} } },
  { name: 'xhs_phone_back', description: 'Press back and observe.', inputSchema: { type: 'object', properties: {} } },
];

function mcpResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function mcpError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

app.post('/mcp', async (req, res) => {
  const body = req.body || {};
  const id = body.id;
  try {
    if (body.method === 'initialize') {
      res.setHeader('Mcp-Session-Id', 'xhs-pixel-session');
      return res.json(mcpResult(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'xhs-pixel-mcp', version: '1.1.0' },
      }));
    }
    if (body.method === 'notifications/initialized') return res.status(202).end();
    if (body.method === 'tools/list') return res.json(mcpResult(id, { tools }));
    if (body.method === 'tools/call') {
      const data = await toolCall(body.params?.name, body.params?.arguments || {});
      return res.json(mcpResult(id, { content: [{ type: 'text', text: JSON.stringify(data) }] }));
    }
    return res.json(mcpError(id, -32601, `Method not found: ${body.method}`));
  } catch (e) {
    return res.json(mcpResult(id, {
      isError: true,
      content: [{ type: 'text', text: e.message || String(e) }],
    }));
  }
});

app.get('/health', async (_, res) => {
  try {
    const dev = await ensureDevice();
    res.json({ ok: true, ...dev });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

app.post('/open_xhs', async (_, res) => {
  await openXhs();
  res.json({ ok: true });
});

app.post('/tap', async (req, res) => {
  await tap(req.body?.x, req.body?.y);
  res.json({ ok: true });
});

app.post('/swipe', async (req, res) => {
  const { x1, y1, x2, y2, duration = 500 } = req.body || {};
  await swipe(x1, y1, x2, y2, duration);
  res.json({ ok: true });
});

app.post('/back', async (_, res) => {
  await shell('input keyevent 4');
  res.json({ ok: true });
});

app.get('/screenshot', async (_, res) => {
  const out = await shell('screencap -p | base64 -w 0');
  res.json({ ok: true, device: DEVICE, imageBase64: out.trim() });
});

app.get('/paste-capture', (req, res) => {
  const nonce = String(req.query.nonce || '');
  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Paste link</title></head><body><textarea id="box" autofocus style="width:100%;height:220px;font-size:20px"></textarea><script>
const nonce=${JSON.stringify(nonce)};
const box=document.getElementById('box');
function send(){const text=box.value||'';const m=text.match(/https?:\\/\\/[^\\s"'<>]+|(?:www\\.)?(?:xhslink\\.com|xiaohongshu\\.com)\\/[^\\s"'<>]+/i);fetch('/paste-capture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nonce,text,link:m?m[0]:''})}).catch(()=>{});}
box.addEventListener('input',send);box.addEventListener('paste',()=>setTimeout(send,100));setTimeout(()=>box.focus(),300);
</script></body></html>`);
});

app.post('/paste-capture', (req, res) => {
  const nonce = String(req.body?.nonce || '');
  const text = String(req.body?.text || '');
  const link = String(req.body?.link || '') || extractLink(text);
  lastPasteCapture = { nonce, text, link, at: Date.now() };
  res.json({ ok: true, link });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Pixel agent listening on 127.0.0.1:${PORT}`);
});
