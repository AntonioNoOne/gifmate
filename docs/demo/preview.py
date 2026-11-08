"""Render docs/social-preview.png (1280x640) from preview.html, headless. Run from the repo root."""
from pathlib import Path
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    page = b.new_page(viewport={"width": 1280, "height": 640})
    page.goto((HERE / "preview.html").as_uri())
    page.wait_for_timeout(300)
    page.screenshot(path=str(HERE.parent / "social-preview.png"))
    b.close()
print("docs/social-preview.png")
