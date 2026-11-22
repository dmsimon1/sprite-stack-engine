#!/usr/bin/env python3
"""bench.py: measure the demo and print a table. Also saves a still of each configuration.

    python tools/bench.py [--out out/bench] [--frames 120] [--software]

Needs Playwright (pip install playwright; playwright install chromium). The page runs at 1920x1080 in headless
Chromium. For each configuration it asks the page for:
  - fragments per pixel, counted exactly by the additive count pass (demo.measure)
  - milliseconds per frame over N frames, each one waited for (demo.bench)
--software forces the CPU rasteriser (SwiftShader), where fill cost is not hidden by a fast GPU.
"""
import argparse, asyncio, json, os, pathlib
from playwright.async_api import async_playwright

VIEWS = ['overview', 'street']
RES = [(1, 'native 1920x1080'), (2, 'internal 960x540')]
ORDERS = [(0, 0, 'painter, whole stacks'), (0, 1, 'painter, shell stacks'), (1, 0, 'hidden-surface, whole stacks'), (1, 1, 'hidden-surface, shell stacks')]


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='out/bench')
    ap.add_argument('--frames', type=int, default=120)
    ap.add_argument('--software', action='store_true')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    url = (pathlib.Path(__file__).resolve().parent.parent / 'index.html').as_uri() + '?hold'
    gpu = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] if a.software else ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu-rasterization']
    rows = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=gpu)
        page = await browser.new_page(viewport={'width': 1920, 'height': 1080}, device_scale_factor=1)
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        await page.goto(url)
        try:
            await page.wait_for_function('window.demo && window.demo.ready', timeout=20000)
        except Exception:
            print('the page did not start; errors:', errors[:5])
            raise SystemExit(1)
        for view in VIEWS:
            for res, res_name in RES:
                for hsr, shell, name in ORDERS:
                    cfg = {'view': view, 'res': res, 'hsr': bool(hsr), 'shell': bool(shell), 'heat': 0, 'measure': False}
                    await page.evaluate('(c) => demo.set(c)', cfg)
                    m = await page.evaluate('demo.measure(0)')
                    ms = await page.evaluate('(n) => demo.bench(n)', a.frames)
                    rows.append(dict(view=view, res=res_name, order=name, ms=ms, **m))
                    tag = '%s-res%d-hsr%d-shell%d' % (view, res, hsr, shell)
                    await page.evaluate('demo.seek(0)'); await page.screenshot(path=os.path.join(a.out, tag + '.png'))
                    await page.evaluate('(c) => { demo.set(c); demo.measure(0); }', {'heat': 1}); await page.screenshot(path=os.path.join(a.out, tag + '-heat.png'))
        await browser.close()
    json.dump(rows, open(os.path.join(a.out, 'bench.json'), 'w'), indent=1)
    print('renderer:', rows[0]['renderer'], '| errors:', errors[:5])
    print('| view | resolution | order | quads | written avg | written max | covered avg | covered max | ms/frame |')
    print('| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |')
    for r in rows:
        print('| %s | %s | %s | %d | %.2f | %d | %.1f | %d | %.2f |' % (r['view'], r['res'], r['order'], r['quads'], r['written']['avg'], r['written']['max'], r['covered']['avg'], r['covered']['max'], r['ms']))

asyncio.run(main())
