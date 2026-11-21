import json
from playwright.sync_api import sync_playwright

CHROME = "/workspace/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome"
URL = "file:///workspace/work/isafit/index.html"
OUT = "/workspace/work/isafit/test/"

SEED = {"projects": [{"id": "p1", "name": "새집 후보 A", "area": "경남 김해시", "aptName": "부원역푸르지오", "aptSize": "84㎡",
                      "entry": {"w": 700, "h": 2000}, "elevator": {"use": True, "w": 700, "d": 700, "h": 2000},
                      "stairs": True, "crane": False,
                      "rooms": [{"id": "r1", "name": "거실", "w": 4500, "d": 4200, "win": {"top": True},
                                 "out": {"bottom": True}, "winW": 1600,
                                 "door": {"wall": "bottom", "pos": .5, "width": 800, "swing": "in", "hinge": "start"},
                                 "items": [{"id": "i1", "fid": "f1", "name": "4인 소파", "type": "소파", "w": 2400, "d": 950, "h": 800, "x": 300, "y": 200, "rot": 0},
                                           {"id": "i2", "fid": "f2", "name": "양문형 냉장고", "type": "냉장고", "w": 912, "d": 920, "h": 1800, "x": 3400, "y": 3100, "rot": 0}]},
                                {"id": "r2", "name": "침실", "w": 3300, "d": 3000, "win": {"left": True}, "out": {"top": True},
                                 "winW": 1400,
                                 "door": {"wall": "bottom", "pos": .5, "width": 750, "swing": "in", "hinge": "start"},
                                 "items": [{"id": "i3", "fid": "f3", "name": "퀸 침대", "type": "침대", "w": 1500, "d": 2000, "h": 600, "x": 0, "y": 60, "rot": 0}]}]}],
        "furniture": [{"id": "f1", "type": "소파", "name": "4인 소파", "w": 2400, "d": 950, "h": 800},
                      {"id": "f2", "type": "냉장고", "name": "양문형 냉장고", "w": 912, "d": 920, "h": 1800},
                      {"id": "f3", "type": "침대", "name": "퀸 침대", "w": 1500, "d": 2000, "h": 600}]}

if __name__ == "__main__":
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])
        for name, vp, mob in [("home-d", 1280, False), ("home-m", 390, True)]:
            ctx = b.new_context(viewport={"width": vp, "height": 844 if mob else 900}, is_mobile=mob,
                                device_scale_factor=2, has_touch=mob)
            pg = ctx.new_page()
            errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.goto(URL)
            pg.evaluate("d=>localStorage.setItem('isafit-v1',JSON.stringify(d))", SEED)
            pg.reload()
            pg.wait_for_timeout(300)
            pg.screenshot(path=OUT + f"q-{name}.png")
            print(name, "errs", errs)
            ctx.close()
        b.close()
