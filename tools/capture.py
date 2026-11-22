#!/usr/bin/env python3
"""capture.py: save frames of the demo as PNGs, one per step of its fixed clock.

    python tools/capture.py OUT_DIR [--size 1280x720] [--step 2] [--first 0] [--last 720] [--query "&tour&hsr=1"]

Needs Playwright (pip install playwright; playwright install chromium). Each frame is asked for by number
(demo.seek) and then photographed, so the result is the same on every run and never drops a frame.
"""
import argparse, asyncio, os, pathlib
from playwright.async_api import async_playwright


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('out')
    ap.add_argument('--size', default='1280x720')
    ap.add_argument('--step', type=int, default=1)
    ap.add_argument('--first', type=int, default=0)
    ap.add_argument('--last', type=int, default=-1)
    ap.add_argument('--query', default='')
    ap.add_argument('--software', action='store_true')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    w, h = [int(v) for v in a.size.split('x')]
    url = (pathlib.Path(__file__).resolve().parent.parent / 'index.html').as_uri() + '?hold' + a.query
    gpu = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] if a.software else ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu-rasterization']
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=gpu)
        page = await browser.new_page(viewport={'width': w, 'height': h}, device_scale_factor=1)
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        await page.goto(url)
        try:
            await page.wait_for_function('window.demo && window.demo.ready', timeout=20000)
        except Exception:
            print('the page did not start; errors:', errors[:5])
            raise SystemExit(1)
        info = await page.evaluate('demo.ready')
        last = info['frames'] if a.last < 0 else a.last
        n = 0
        for f in range(a.first, last, a.step):
            await page.evaluate('(f) => demo.seek(f)', f)
            await page.screenshot(path=os.path.join(a.out, '%04d.png' % n))
            n += 1
        print('frames', n, 'renderer', await page.evaluate('demo.engine.renderer'), 'errors', errors[:5])
        await browser.close()

asyncio.run(main())
