"""Check what the major-header looks like in the rendered DOM."""
import asyncio
from playwright.async_api import async_playwright


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1600, "height": 1000})
        page = await ctx.new_page()
        await page.goto("http://localhost:3001/", wait_until="networkidle", timeout=30000)
        await page.evaluate("() => localStorage.clear()")
        await page.reload(wait_until="networkidle", timeout=30000)
        await page.wait_for_timeout(1000)
        await page.locator("text=Generate demo rows").first.click()
        await page.wait_for_timeout(1500)
        await page.locator("text=Prereq Map").first.click()
        await page.wait_for_timeout(2000)

        # The major header paragraph
        info = await page.evaluate("""() => {
          // Find the student-name header and the major line
          const all = Array.from(document.querySelectorAll('p, span, div'));
          const hits = all.map(el => el.innerText).filter(t =>
            t && (t.includes('Mechatronics') || t.includes('major not matched'))
          );
          return Array.from(new Set(hits));
        }""")
        print("HEADER TEXTS:")
        for t in info:
            print(repr(t))

        # Just the major line
        majorLine = await page.evaluate("""() => {
          const ps = Array.from(document.querySelectorAll('p'));
          return ps.map(p => p.innerText).filter(t => t && (t.includes('Mechatronics') || t.includes('major')) );
        }""")
        print("\nMAJOR PARAGRAPHS:")
        for t in majorLine:
            print(repr(t))

        await browser.close()


asyncio.run(main())
