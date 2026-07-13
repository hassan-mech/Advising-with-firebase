"""Take a content snapshot after clicking Prereq Map; check what is rendered."""
import asyncio
import json
from playwright.async_api import async_playwright


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1600, "height": 1000})
        page = await ctx.new_page()
        page.on("console", lambda msg: None)
        page.on("pageerror", lambda exc: print("PAGEERR:", exc))

        await page.goto("http://localhost:3001/", wait_until="networkidle", timeout=30000)
        await page.wait_for_timeout(1000)

        await page.locator("text=Generate demo rows").first.click()
        await page.wait_for_timeout(1500)
        await page.locator("text=Prereq Map").first.click()
        await page.wait_for_timeout(1500)

        # Extract structure
        out = await page.evaluate("""() => {
          const root = document.getElementById('root');
          const main = document.querySelector('main');
          const map = document.querySelector('[data-map-body]');
          return {
            rootChildren: root ? root.children.length : 0,
            rootHTML: root ? root.innerHTML.length : 0,
            mainExists: !!main,
            mainHTML: main ? main.innerHTML.length : 0,
            mainChildTags: main ? Array.from(main.children).map(c => c.tagName + (c.className ? '.'+String(c.className).slice(0,30) : '')) : [],
            bodyText: document.body.innerText.slice(0, 800),
          };
        }""")
        print("STRUCTURE:")
        print(json.dumps(out, indent=2, ensure_ascii=False))

        # Check viewport-relative area where the map should be
        bbox = await page.evaluate("""() => {
          const main = document.querySelector('main');
          if (!main) return null;
          const r = main.getBoundingClientRect();
          return { top: r.top, left: r.left, w: r.width, h: r.height };
        }""")
        print("MAIN BBOX:", bbox)

        # Click a student to see if map renders
        await page.locator("text=Prereq Map").first.click()
        await page.wait_for_timeout(800)
        await page.evaluate("window.scrollTo(0, 0)")
        await page.screenshot(path="diag_map_rescroll.png", full_page=True)

        await browser.close()


asyncio.run(main())
