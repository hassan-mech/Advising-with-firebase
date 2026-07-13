"""Load demo data, then click Prereq Map; report console + DOM."""
import asyncio
import json
from playwright.async_api import async_playwright


async def main():
    out = {"console": [], "pageerrors": []}
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1600, "height": 1000})
        page = await ctx.new_page()

        page.on("console", lambda msg: out["console"].append(f"{msg.type}: {msg.text}"))
        page.on("pageerror", lambda exc: out["pageerrors"].append(str(exc)))

        await page.goto("http://localhost:3001/", wait_until="networkidle", timeout=30000)
        await page.wait_for_timeout(1500)

        # Click "Generate demo rows" button if present
        try:
            btn = page.locator("text=Generate demo rows").first
            if await btn.count() > 0:
                await btn.click(timeout=5000)
                await page.wait_for_timeout(1500)
        except Exception as e:
            out["demo_error"] = str(e)

        await page.screenshot(path="diag_demo_loaded.png", full_page=True)
        out["after_demo_root_len"] = len(await page.evaluate(
            "() => document.body.innerHTML"
        ))

        # Now click "Prereq Map" in the header
        try:
            map_btn = page.locator("text=Prereq Map").first
            if await map_btn.count() > 0:
                await map_btn.click(timeout=5000)
                await page.wait_for_timeout(2000)
                await page.screenshot(path="diag_prereq_map.png", full_page=True)
                out["after_map_root_len"] = len(await page.evaluate(
                    "() => document.body.innerHTML"
                ))
                out["has_prereq_header"] = await page.locator(
                    "text=Prerequisite Map"
                ).count()
        except Exception as e:
            out["map_error"] = str(e)

        await browser.close()

    print(json.dumps(out, indent=2, ensure_ascii=False))


asyncio.run(main())
