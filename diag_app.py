"""Diagnose the app — open in browser, capture console + page errors."""
import asyncio
import json
import sys
from playwright.async_api import async_playwright


async def main():
    out = {"console": [], "errors": [], "pageerrors": [], "html": None}
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1400, "height": 900})
        page = await ctx.new_page()

        page.on("console", lambda msg: out["console"].append(f"{msg.type}: {msg.text}"))
        page.on("pageerror", lambda exc: out["pageerrors"].append(str(exc)))
        page.on("requestfailed", lambda req: out["errors"].append(
            f"{req.method} {req.url} -> {req.failure}"
        ))

        url = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3001/"
        await page.goto(url, wait_until="networkidle", timeout=30000)
        await page.wait_for_timeout(2500)

        # Try clicking the prereq map button if present
        out["html"] = await page.evaluate("() => document.body.innerHTML.length")
        out["title"] = await page.title()
        out["rootHtml"] = (await page.inner_html("body"))[:500]

        # Look for any clickable elements — try to get into the prereq map
        for label in ("Prerequisite", "Map", "Explorer", "prereq"):
            try:
                el = await page.query_selector(f"text=/{label}/i")
                if el:
                    out.setdefault("found", []).append(f"contains '{label}'")
            except Exception:
                pass

        # Take a screenshot
        await page.screenshot(path="diag_app.png", full_page=True)

        await browser.close()

    print(json.dumps(out, indent=2, ensure_ascii=False))


asyncio.run(main())
