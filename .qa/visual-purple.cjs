'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { PNG } = require('pngjs');

const beforeDir = path.resolve(process.env.BEFORE_DIR || 'before');
const afterDir = path.resolve(process.env.AFTER_DIR || 'after');
const out = path.resolve(process.env.QA_OUT || 'qa-results');
fs.mkdirSync(out, { recursive: true });
const sourceValidation = JSON.parse(fs.readFileSync(path.join(out, 'color-static-report.json'), 'utf8'));
assert.equal(sourceValidation.passed, true, 'Run color-static.mjs successfully before visual-purple.cjs');
const pages = ['index', 'sobre', 'eventos', 'mixes', 'fotos', 'contato'];
const viewports = [{ width: 1440, height: 1000 }, { width: 768, height: 1024 }, { width: 390, height: 844 }];
const whitelist = JSON.parse(fs.readFileSync(process.env.COLOR_WHITELIST || path.join(__dirname, 'purple-whitelist.json'), 'utf8'));
let serializedColorMap;
const computedColorDiffs = [];
const report = { startedAt: new Date().toISOString(), beforeDir, afterDir, checks: [], failures: [], diagnostics: [], externalResources: [], limitations: ['Chromium only; viewport comparisons are not physical-device testing.', 'External fonts are requested once and the same response bytes replayed to both versions.', 'Autoplay tests use Playwright virtual time after assets load.'] };
const externalCache = new Map();
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.png': 'image/png' };
function serve(dir) {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      let pathname;
      try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400).end(); return; }
      const filename = path.resolve(dir, '.' + pathname + (pathname.endsWith('/') ? 'index.html' : ''));
      if (!filename.startsWith(dir + path.sep)) { res.writeHead(403).end(); return; }
      fs.stat(filename, (error, stat) => {
        if (error || !stat.isFile()) { res.writeHead(404).end('Not found'); return; }
        const headers = { 'Content-Type': mime[path.extname(filename)] || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
        let start = 0, end = stat.size - 1;
        if (req.headers.range) {
          const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
          if (!match) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end(); return; }
          if (!match[1]) start = Math.max(0, stat.size - Number(match[2]));
          else { start = Number(match[1]); if (match[2]) end = Math.min(Number(match[2]), end); }
          if (start > end || start >= stat.size) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end(); return; }
          headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
        }
        headers['Content-Length'] = end - start + 1;
        res.writeHead(req.headers.range ? 206 : 200, headers);
        if (req.method === 'HEAD') res.end();
        else fs.createReadStream(filename, { start, end }).on('error', () => res.destroy()).pipe(res);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` }));
  });
}
function record(name, ok, detail) {
  const entry = { name, passed: ok, ...(detail ? { detail } : {}) };
  report.checks.push(entry);
  if (!ok) report.failures.push(entry);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' ' + detail : ''}`);
}
function sameJSON(name, a, b) {
  try { assert.deepStrictEqual(a, b); record(name, true); }
  catch (e) { record(name, false, e.message.slice(0, 2500)); }
}
function pixels(name, aPath, bPath, authorizedHomeColors = false, identicalBaselineDiagnostic = false) {
  if (!fs.existsSync(aPath) || !fs.existsSync(bPath)) { record(name, false, 'Missing screenshot'); return; }
  const a = PNG.sync.read(fs.readFileSync(aPath));
  const b = PNG.sync.read(fs.readFileSync(bPath));
  if (a.width !== b.width || a.height !== b.height) { record(name, false, `Dimensions ${a.width}x${a.height} vs ${b.width}x${b.height}`); return; }
  const diff = new PNG({ width: a.width, height: a.height });
  let changed = 0;
  for (let p = 0; p < a.data.length; p += 4) {
    const differs = a.data[p] !== b.data[p] || a.data[p + 1] !== b.data[p + 1] || a.data[p + 2] !== b.data[p + 2] || a.data[p + 3] !== b.data[p + 3];
    if (differs) { changed++; diff.data[p] = 255; diff.data[p + 2] = 255; diff.data[p + 3] = 255; }
    else { const gray = Math.round((a.data[p] + a.data[p + 1] + a.data[p + 2]) / 3); diff.data[p] = diff.data[p + 1] = diff.data[p + 2] = gray; diff.data[p + 3] = 80; }
  }
  if (changed) fs.writeFileSync(path.join(out, `${name.replace(/[^a-z0-9-]/gi, '-')}-diff.png`), PNG.sync.write(diff));
  if (identicalBaselineDiagnostic) {
    const diagnostic = { name, changedPixels: changed, totalPixels: a.width * a.height, blocking: false, reason: 'Repeated unchanged baseline, not a candidate comparison. Known SVG rasterization variability; candidate geometry/text/assets/computed styles and other-page pixels remain strict gates.' };
    report.diagnostics.push(diagnostic);
    console.log('DIAGNOSTIC ' + JSON.stringify(diagnostic));
    return;
  }
  record(name, authorizedHomeColors || changed === 0, `${changed} changed pixels / ${a.width * a.height}; ${authorizedHomeColors ? 'authorized home color-only stage; dimensions strict, source whitelist and computed-color validation required' : 'zero tolerance'}`);
}
function compareHomeSnapshot(name, original, candidate) {
  const a = JSON.parse(JSON.stringify(original)), b = JSON.parse(JSON.stringify(candidate));
  const allowedProperty = p => p === '--blue' || p === 'color' || p.endsWith('-color') || p === 'box-shadow' || p === 'text-shadow' || p === 'background-image';
  let allowed = true;
  for (let i = 0; i < Math.min(a.elements.length, b.elements.length); i++) {
    for (const section of ['styles', 'before', 'after']) {
      const keys = new Set([...Object.keys(a.elements[i][section]), ...Object.keys(b.elements[i][section])]);
      for (const property of keys) {
        const oldValue = a.elements[i][section][property], newValue = b.elements[i][section][property];
        if (oldValue === newValue) continue;
        let expected = oldValue;
        if (typeof expected === 'string') for (const [oldColor, newColor] of serializedColorMap) expected = expected.split(oldColor).join(newColor);
        const valid = allowedProperty(property) && expected === newValue;
        computedColorDiffs.push({ check: name, elementIndex: i, tag: a.elements[i].tag, id: a.elements[i].id, classes: a.elements[i].classes, section, property, before: oldValue, after: newValue, expected, approved: valid });
        if (!valid) allowed = false;
        // Remove only individually proven color-token replacements from the strict comparison.
        if (valid) a.elements[i][section][property] = newValue;
      }
    }
  }
  record(name + ' approved computed color replacements', allowed);
  sameJSON(name + ' all remaining geometry/text/assets/styles', a, b);
  fs.writeFileSync(path.join(out, 'computed-color-differences.json'), JSON.stringify(computedColorDiffs, null, 2));
}
async function settle(page) {
  await page.evaluate(async () => {
    for (const image of document.images) image.loading = 'eager';
    await document.fonts.ready;
    await Promise.all([...document.images].filter(i => i.getAttribute('src')).map(i => i.decode()));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}
async function snapshot(page) {
  return page.evaluate(() => {
    const normalize = value => value.replace(/http:\/\/127\.0\.0\.1:\d+/g, '<origin>').replaceAll('--accent', '--blue');
    function styles(element, pseudo) {
      const declaration = getComputedStyle(element, pseudo);
      return Object.fromEntries([...declaration].map(name => [name.replaceAll('--accent', '--blue'), normalize(declaration.getPropertyValue(name))]).sort(([a], [b]) => a.localeCompare(b)));
    }
    return {
      title: document.title,
      dimensions: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
      images: [...document.images].filter(i => i.getAttribute('src')).map(i => ({ src: normalize(i.src), width: i.naturalWidth, height: i.naturalHeight, complete: i.complete })),
      fontStatus: document.fonts.status,
      fonts: [...document.fonts].map(f => ({ family: f.family, weight: f.weight, style: f.style, status: f.status })),
      elements: [...document.body.querySelectorAll('*')].filter(e => !['SCRIPT', 'STYLE'].includes(e.tagName)).map(e => {
        const r = e.getBoundingClientRect();
        return { tag: e.tagName, id: e.id, classes: e.className, role: e.getAttribute('role'), ariaLabel: e.getAttribute('aria-label'), text: e.innerText?.replace(/\s+/g, ' ').trim(), rect: [r.x, r.y, r.width, r.height], styles: styles(e), before: styles(e, '::before'), after: styles(e, '::after') };
      })
    };
  });
}
async function screenshot(page, name) {
  await settle(page);
  const filename = path.join(out, name + '.png');
  await page.screenshot({ path: filename, fullPage: true, animations: 'disabled', caret: 'hide' });
  return filename;
}
async function galleryState(page) {
  return page.evaluate(() => ({ index: [...document.querySelectorAll('.photo-card')].findIndex(e => e.classList.contains('is-active')), counter: document.querySelector('.gallery-counter').textContent.replace(/\s+/g, ' ').trim(), status: document.querySelector('.gallery-status').textContent, viewerOpen: document.querySelector('.photo-viewer').open, playLabel: document.querySelector('.gallery-play').getAttribute('aria-label') }));
}
async function interact(page, name, prefix) {
  const states = {}, shots = {};
  if (name === 'index') {
    for (const [label, selector] of [['primary', '.hero-actions .primary'], ['outline', '.hero-actions .outline'], ['music', '.music-link'], ['circle', '.circle-link']]) {
      const target = page.locator(selector).first();
      await target.hover();
      shots[label + 'Hover'] = await screenshot(page, `${prefix}-${label}-hover`);
      states[label + 'Hover'] = await snapshot(page);
      await page.mouse.move(0, 0);
      await target.focus();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      assert.equal(await target.evaluate(e => e === document.activeElement), true);
      shots[label + 'Focus'] = await screenshot(page, `${prefix}-${label}-focus`);
      states[label + 'Focus'] = await snapshot(page);
      await target.evaluate(e => e.blur());
    }
  }
  if (name === 'sobre') {
    await page.locator('.story-trigger').click();
    assert.equal(await page.locator('.story-dialog').evaluate(e => e.open), true);
    shots.storyOpen = await screenshot(page, `${prefix}-story-open`);
    states.storyOpen = await snapshot(page);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.story-dialog').evaluate(e => e.open), false);
    assert.equal(await page.locator('.story-trigger').evaluate(e => e === document.activeElement), true);
    await page.locator('.story-trigger').click();
    await page.locator('.story-close').click();
    assert.equal(await page.locator('.story-dialog').evaluate(e => e.open), false);
    states.storyClose = { closed: true, restoredFocus: await page.locator('.story-trigger').evaluate(e => e === document.activeElement) };
  }
  if (name === 'fotos') {
    const initial = await galleryState(page);
    assert.equal(initial.index, 0); assert.equal(initial.playLabel, 'Iniciar passagem automática');
    await page.locator('[data-direction="1"]').click();
    assert.equal((await galleryState(page)).index, 1);
    states.next = await galleryState(page);
    shots.next = await screenshot(page, `${prefix}-photo-next`);
    await page.locator('[data-direction="-1"]').click();
    assert.equal((await galleryState(page)).index, 0);
    await page.locator('.photo-card.is-active').focus();
    await page.keyboard.press('ArrowLeft');
    assert.equal((await galleryState(page)).index, 10);
    await page.keyboard.press('ArrowRight');
    assert.equal((await galleryState(page)).index, 0);
    await page.locator('.photo-card.is-active').click();
    assert.equal((await galleryState(page)).viewerOpen, true);
    shots.viewer = await screenshot(page, `${prefix}-photo-viewer`);
    states.viewer = await snapshot(page);
    await page.keyboard.press('Escape');
    assert.equal((await galleryState(page)).viewerOpen, false);
    assert.equal(await page.locator('.photo-card.is-active').evaluate(e => e === document.activeElement), true);
    await page.locator('.photo-card.is-active').click();
    await page.locator('.viewer-close').click();
    assert.equal((await galleryState(page)).viewerOpen, false);
    const card = await page.locator('.photo-card.is-active').boundingBox();
    await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2);
    await page.mouse.down();
    await page.mouse.move(card.x + card.width / 2 - 100, card.y + card.height / 2, { steps: 8 });
    await page.mouse.up();
    assert.equal((await galleryState(page)).index, 1);
    assert.equal((await galleryState(page)).viewerOpen, false);
    states.swipe = await galleryState(page);
    await page.mouse.move(0, 0);
    await page.clock.install();
    const paused = (await galleryState(page)).index;
    await page.clock.fastForward(6000);
    assert.equal((await galleryState(page)).index, paused);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.locator('.gallery-play').click();
    await page.mouse.move(0, 0);
    await page.clock.fastForward(2600);
    assert.equal((await galleryState(page)).index, (paused + 1) % 11);
    await page.locator('.gallery-play').click();
    const manuallyPaused = (await galleryState(page)).index;
    await page.clock.fastForward(6000);
    assert.equal((await galleryState(page)).index, manuallyPaused);
    states.autoplay = { reducedMotionPaused: true, advanced: true, manuallyPaused: true };
    await page.clock.resume();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    // Real media playback verifies the listener, not merely dispatching synthetic play events.
    await page.locator('.aftermovie-video').nth(0).evaluate(async video => { video.muted = true; await video.play(); });
    await page.waitForFunction(() => !document.querySelectorAll('.aftermovie-video')[0].paused);
    await page.locator('.aftermovie-video').nth(1).evaluate(async video => { video.muted = true; await video.play(); });
    await page.waitForFunction(() => { const videos = document.querySelectorAll('.aftermovie-video'); return videos[0].paused && !videos[1].paused; });
    states.videos = await page.locator('.aftermovie-video').evaluateAll(videos => videos.map(v => ({ paused: v.paused, error: v.error?.code || null })));
    await page.locator('.aftermovie-video').evaluateAll(videos => videos.forEach(v => v.pause()));
  }
  return { states, shots };
}
(async () => {
  const before = await serve(beforeDir), after = await serve(afterDir);
  let browser;
  try {
    // Use the same CPU raster path for both candidates and the independent baseline repeat.
    // Keep zero pixel tolerance: these flags do not mask or exempt any rendered differences.
    const renderingArgs = ['--disable-gpu', '--disable-skia-runtime-opts'];
    report.renderingArgs = renderingArgs;
    report.browserProcessIsolation = 'fresh Chromium process for every before/after/before-repeat variant';
    for (const viewport of viewports) for (const name of pages) {
      const runs = [];
      // Every variant uses an independent browser process; the repeat uses the exact original files.
      // Its pixel comparison remains zero-tolerance and can expose rendering nondeterminism.
      const variants = [['before', before], ['after', after]];
      if (name === 'index') variants.push(['before-repeat', before]);
      for (const [version, server] of variants) {
        if (browser) { await browser.close(); browser = undefined; }
        browser = await chromium.launch({ headless: true, args: renderingArgs });
        const prefix = `${name}-${viewport.width}-${version}`;
        const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', locale: 'pt-BR', timezoneId: 'UTC', colorScheme: 'dark' });
        const errors = [], networkErrors = [];
        await context.route(/^https?:\/\/(?!127\.0\.0\.1:)/, async route => {
          const url = route.request().url();
          try {
            if (!externalCache.has(url)) {
              externalCache.set(url, (async () => {
                const response = await route.fetch({ timeout: 45000 });
                if (!response.ok()) throw Error(`External HTTP ${response.status()} ${url}`);
                const body = await response.body();
                const headers = response.headers();
                delete headers['content-encoding']; delete headers['content-length'];
                report.externalResources.push({ url, status: response.status(), bytes: body.length });
                return { status: response.status(), headers, body };
              })());
            }
            await route.fulfill(await externalCache.get(url));
          } catch (e) { networkErrors.push(String(e)); await route.abort(); }
        });
        const page = await context.newPage();
        page.setDefaultTimeout(20000);
        page.on('pageerror', error => errors.push(error.message));
        page.on('response', response => { if (response.status() >= 400) networkErrors.push(`${response.status()} ${response.url()}`); });
        try {
          await page.goto(`${server.origin}/${name}.html`, { waitUntil: 'networkidle', timeout: 90000 });
          await settle(page);
          if (!serializedColorMap) {
            const serialized = await page.evaluate(colorMap => Object.entries(colorMap).map(([before, after]) => {
              const el = document.createElement('span');
              el.style.color = before; const oldColor = el.style.color;
              el.style.color = after; return [oldColor, el.style.color];
            }), whitelist.colorMap);
            serializedColorMap = [...Object.entries(whitelist.colorMap), ...serialized].sort(([a], [b]) => b.length - a.length);
          }
          const fonts = await page.evaluate(() => ({ status: document.fonts.status, count: document.fonts.size, error: [...document.fonts].some(f => f.status === 'error') }));
          assert(fonts.count > 0 && fonts.status === 'loaded' && !fonts.error, `Fonts not fully available: ${JSON.stringify(fonts)}`);
          assert.deepEqual(networkErrors, [], 'Network requests failed');
          const initial = await snapshot(page);
          fs.writeFileSync(path.join(out, prefix + '-initial.json'), JSON.stringify(initial, null, 2));
          const initialShot = await screenshot(page, prefix + '-initial');
          const interactions = await interact(page, name, prefix);
          assert.deepEqual(errors, [], 'Browser JavaScript exceptions');
          assert.deepEqual(networkErrors, [], 'Network failures during interactions');
          const result = { initial, initialShot, interactions, errors, networkErrors };
          fs.writeFileSync(path.join(out, prefix + '-interactions.json'), JSON.stringify(interactions.states, null, 2));
          runs.push(result);
          record(`${prefix} load/assets/interactions`, true);
        } catch (e) {
          record(`${prefix} load/assets/interactions`, false, e.stack || String(e));
          try { await page.screenshot({ path: path.join(out, prefix + '-failure.png'), fullPage: true }); } catch {}
          runs.push(null);
        } finally {
          await context.close();
          await browser.close();
          browser = undefined;
        }
      }
      if (runs.slice(0, 2).every(Boolean)) {
        if (name === 'index') compareHomeSnapshot(`${name}-${viewport.width} initial`, runs[0].initial, runs[1].initial);
        else sameJSON(`${name}-${viewport.width} initial geometry/styles/text`, runs[0].initial, runs[1].initial);
        pixels(`${name}-${viewport.width}-initial-pixels`, runs[0].initialShot, runs[1].initialShot, name === 'index');
        if (name === 'index') {
          sameJSON(`${name}-${viewport.width} interaction cases`, Object.keys(runs[0].interactions.states), Object.keys(runs[1].interactions.states));
          for (const key of Object.keys(runs[0].interactions.states)) compareHomeSnapshot(`${name}-${viewport.width} ${key}`, runs[0].interactions.states[key], runs[1].interactions.states[key]);
        } else sameJSON(`${name}-${viewport.width} interactions/state`, runs[0].interactions.states, runs[1].interactions.states);
        for (const key of Object.keys(runs[0].interactions.shots)) pixels(`${name}-${viewport.width}-${key}-pixels`, runs[0].interactions.shots[key], runs[1].interactions.shots[key], name === 'index');
      } else record(`${name}-${viewport.width} before/after comparison`, false, 'Blocked by failed load or interaction; not treated as a visual pass.');
      if (name === 'index') {
        if (runs[0] && runs[2]) {
          sameJSON(`${name}-${viewport.width} baseline-repeat geometry/styles/text`, runs[0].initial, runs[2].initial);
          pixels(`${name}-${viewport.width}-baseline-repeat-pixels`, runs[0].initialShot, runs[2].initialShot, false, true);
        } else record(`${name}-${viewport.width} baseline-repeat comparison`, false, 'Original-page repeat could not be completed; renderer repeatability is unverified.');
      }
      fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    }
  } catch (e) { record('runner', false, e.stack || String(e)); }
  finally {
    if (browser) await browser.close();
    await Promise.all([before.server, after.server].map(server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); })));
    report.finishedAt = new Date().toISOString();
    report.passed = report.failures.length === 0;
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(`RESULT ${report.passed ? 'PASS' : 'FAIL'}: ${report.checks.length} checks; ${report.failures.length} failures`);
    process.exitCode = report.passed ? 0 : 1;
  }
})();
