import json, sys
from playwright.sync_api import sync_playwright

CHROME = "/workspace/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome"
URL = "file:///workspace/work/isafit/index.html"

SEED = {
    "projects": [{
        "id": "p1", "name": "새집 후보 A", "area": "경남 김해시", "aptName": "부원역푸르지오",
        "aptSize": "84㎡", "memo": "", "entryWidth": 900,
        "rooms": [
            {"id": "r1", "name": "거실", "w": 4500, "d": 4200, "items": [],
             "door": {"wall": "bottom", "pos": .5, "width": 800, "swing": "in", "hinge": "start"}},
            {"id": "r2", "name": "주방/식당", "w": 3600, "d": 2400, "items": [],
             "door": {"wall": "top", "pos": .4, "width": 800, "swing": "in", "hinge": "start"}},
            {"id": "r3", "name": "침실", "w": 3300, "d": 3000, "items": [],
             "door": {"wall": "left", "pos": .5, "width": 750, "swing": "in", "hinge": "start"}},
        ],
    }],
    "furniture": [
        {"id": "f1", "type": "소파", "name": "4인 소파", "w": 2400, "d": 950, "h": 800, "memo": ""},
        {"id": "f2", "type": "냉장고", "name": "양문형 냉장고", "w": 912, "d": 920, "h": 1800, "memo": ""},
        {"id": "f3", "type": "침대", "name": "퀸 침대", "w": 1500, "d": 2000, "h": 600, "memo": ""},
    ],
}


def open_detail(pg):
    pg.goto(URL)
    pg.evaluate("d=>localStorage.setItem('isafit-v1',JSON.stringify(d))", SEED)
    pg.reload()
    pg.wait_for_timeout(250)
    pg.click("[data-project]")
    pg.wait_for_timeout(350)


with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])
    ctx = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True,
                        device_scale_factor=3, has_touch=True)
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append("PAGEERROR: " + str(e)))
    pg.on("console", lambda m: errs.append("CONSOLE " + m.type + ": " + m.text) if m.type == "error" else None)
    open_detail(pg)
    info = pg.evaluate("""() => {
      const r = el => { const b = el.getBoundingClientRect(); return {x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height)} };
      const body = document.querySelector('.dbody');
      const foot = document.querySelector('.dfoot');
      const tabs = [...document.querySelectorAll('.tabbar button')];
      const inp = document.querySelector('#rw');
      return {
        innerW: innerWidth, docScrollW: document.documentElement.scrollWidth,
        bodyClientW: body.clientWidth, bodyScrollW: body.scrollWidth,
        mobileClass: document.documentElement.className,
        tabbar: r(document.querySelector('.tabbar')),
        tabs: tabs.map(t => ({t: t.innerText.replace(/\\s+/g,' '), ...r(t)})),
        foot: r(foot), footBtn: r(foot.querySelector('.btn')),
        detail: r(document.querySelector('#detail')),
        inputFS: getComputedStyle(inp).fontSize,
        pathSummary: document.querySelector('#pathSummary').innerText,
        hasPlanBtn: !!document.querySelector('#showPlan'),
      };
    }""")
    print(json.dumps(info, ensure_ascii=False, indent=1))
    print("errors:", errs)
    pg.screenshot(path="/workspace/work/isafit/test/shot-mobile-space.png", full_page=False)
    b.close()
