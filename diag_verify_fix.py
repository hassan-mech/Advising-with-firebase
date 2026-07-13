"""Verify fix: load demo data (rows + catalog), click Prereq Map, expect courses to render."""
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

        # Clear any existing localStorage from prior runs so we get a clean slate.
        await page.goto("http://localhost:3001/", wait_until="networkidle", timeout=30000)
        await page.evaluate("() => localStorage.clear()")
        await page.reload(wait_until="networkidle", timeout=30000)
        await page.wait_for_timeout(1000)

        # Click "Generate demo rows" — should now load BOTH rows and catalog
        await page.locator("text=Generate demo rows").first.click()
        await page.wait_for_timeout(1500)

        # Now click Prereq Map
        await page.locator("text=Prereq Map").first.click()
        await page.wait_for_timeout(2000)

        # Count course cards by [data-card-code]
        out["courseCardCount"] = await page.evaluate(
            "() => document.querySelectorAll('[data-card-code]').length"
        )

        # Get unique course codes rendered
        out["courseCodes"] = await page.evaluate(
            "() => Array.from(new Set(Array.from(document.querySelectorAll('[data-card-code]')).map(el => el.dataset.cardCode))).sort()"
        )

        # Get status badge text per course card
        out["courseStatuses"] = await page.evaluate("""() => {
          return Array.from(document.querySelectorAll('[data-card-code]')).map(el => ({
            code: el.dataset.cardCode,
            classification: el.dataset.cardClassification || null,
            text: el.innerText.replace(/\\n+/g, ' | ').slice(0, 200),
          }));
        }""")

        # Check the semester counts (should not all be 0)
        out["semesterCounts"] = await page.evaluate("""() => {
          return Array.from(document.querySelectorAll('main')).map(m => {
            return Array.from(m.querySelectorAll('.text-\\\\[9px\\\\].text-slate-600')).map(el => el.innerText);
          });
        }""")

        # Check stats panel — "New CH" / "Enhancing CH" should be > 0 once you click a course
        out["statsPanel"] = await page.evaluate("""() => {
          return document.body.innerText.match(/(New CH|Enhancing CH|Repeated CH|Term registered hours|Current GPA).*?(?=\\n|$)/g) || [];
        }""")

        # Take screenshot
        await page.screenshot(path="diag_prereq_map_FIXED.png", full_page=True)

        await browser.close()

    print(json.dumps(out, indent=2, ensure_ascii=False))


asyncio.run(main())