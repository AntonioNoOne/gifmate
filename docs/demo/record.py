"""Record the README demo: stage.html played once, headless, then ffmpeg makes docs/demo.gif and docs/demo.mp4.

Run from the repo root:  python docs/demo/record.py   (needs Python Playwright + Chromium, ffmpeg on PATH)
Put the two GIFs in docs/demo/assets/ first (agent.gif, user.gif): they come from GIPHY and stay out of git.
"""
import shutil
import subprocess
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
DOCS = HERE.parent
W, H = 760, 520


def main() -> None:
    out = HERE / "out"
    shutil.rmtree(out, ignore_errors=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)  # never a visible window
        ctx = browser.new_context(viewport={"width": W, "height": H}, record_video_dir=str(out), record_video_size={"width": W, "height": H})
        # nothing leaves the machine: the stage is a local file
        ctx.route("**/*", lambda r: r.continue_() if r.request.url.startswith("file:") else r.abort())
        page = ctx.new_page()
        page.goto((HERE / "stage.html").as_uri())
        page.wait_for_timeout(page.evaluate("window.DEMO_MS"))
        ctx.close()
        browser.close()
    raw = next(out.glob("*.webm"))
    # trim the blank first frames, then a palette GIF (15 fps) and an MP4 for sites that prefer video
    ff = ["ffmpeg", "-y", "-loglevel", "error", "-ss", "0.25", "-i", str(raw)]
    subprocess.run(ff + ["-vf", "fps=15,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4", str(DOCS / "demo.gif")], check=True)
    subprocess.run(ff + ["-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(DOCS / "demo.mp4")], check=True)
    shutil.rmtree(out, ignore_errors=True)
    for f in ("demo.gif", "demo.mp4"):
        print(f, f"{(DOCS / f).stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    sys.exit(main())
