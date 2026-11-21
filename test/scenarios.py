import json, base64, io
from playwright.sync_api import sync_playwright

CHROME = "/workspace/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome"
URL = "file:///workspace/work/isafit/index.html"
OUT = "/workspace/work/isafit/test/"

SEED = {
    "projects": [{
        "id": "p1", "name": "새집 후보 A", "area": "경남 김해시", "aptName": "부원역푸르지오",
        "aptSize": "84㎡", "memo": "",
        "entryWidth": 850, "entry": {"w": 700, "h": 2000},
        "elevator": {"use": True, "w": 700, "d": 700, "h": 2000}, "stairs": True, "crane": False,
        "rooms": [
            {"id": "r1", "name": "거실", "w": 4500, "d": 4200,
             "win": {"top": True, "right": True}, "out": {"bottom": True}, "winW": 1600,
             "door": {"wall": "bottom", "pos": .5, "width": 800, "swing": "in", "hinge": "start"},
             "items": [
                 {"id": "i1", "fid": "f1", "name": "4인 소파", "type": "소파", "w": 2400, "d": 950, "h": 800, "x": 300, "y": 200, "rot": 0},
                 {"id": "i2", "fid": "f2", "name": "양문형 냉장고", "type": "냉장고", "w": 912, "d": 920, "h": 1800, "x": 3000, "y": 2600, "rot": 0},
             ]},
            {"id": "r2", "name": "침실", "w": 3300, "d": 3000, "win": {"left": True}, "out": {"top": True}, "winW": 1400,
             "door": {"wall": "bottom", "pos": .5, "width": 750, "swing": "in", "hinge": "start"},
             "items": [{"id": "i3", "fid": "f3", "name": "퀸 침대", "type": "침대", "w": 1500, "d": 2000, "h": 600, "x": 0, "y": 60, "rot": 0}]},
        ],
    }],
    "furniture": [
        {"id": "f1", "type": "소파", "name": "4인 소파", "w": 2400, "d": 950, "h": 800, "memo": ""},
        {"id": "f2", "type": "냉장고", "name": "양문형 냉장고", "w": 912, "d": 920, "h": 1800, "memo": ""},
        {"id": "f3", "type": "침대", "name": "퀸 침대", "w": 1500, "d": 2000, "h": 600, "memo": ""},
    ],
}

# whole-house plan image (drawn by the browser so the modal has something to show)
PLAN_JS = """() => {
  const c = document.createElement('canvas'); c.width = 1200; c.height = 900;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, 1200, 900);
  x.strokeStyle = '#5d6b5f'; x.lineWidth = 8; x.strokeRect(40, 40, 1120, 820);
  x.strokeStyle = '#b9b39c'; x.lineWidth = 4;
  [400, 760].forEach(v => { x.beginPath(); x.moveTo(v, 40); x.lineTo(v, 860); x.stroke(); });
  x.beginPath(); x.moveTo(40, 520); x.lineTo(1160, 520); x.stroke();
  x.fillStyle = '#8a9a88'; x.font = 'bold 40px sans-serif';
  x.fillText('거실', 120, 300); x.fillText('주방', 470, 300); x.fillText('침실', 850, 300);
  return c.toDataURL('image/png');
}"""

results = {}

with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])
    ctx = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True,
                        device_scale_factor=3, has_touch=True)
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append("PAGEERROR: " + str(e)))
    pg.on("console", lambda m: errs.append("CONSOLE " + m.type + ": " + m.text) if m.type == "error" else None)
    pg.goto(URL)
    pg.evaluate("d=>localStorage.setItem('isafit-v1',JSON.stringify(d))", SEED)
    # store a project-level plan image in IndexedDB, then set the key
    plan = pg.evaluate(PLAN_JS)
    pg.evaluate("""([key,url])=>new Promise(res=>{
        const rq=indexedDB.open('isafit-db',1);
        rq.onupgradeneeded=()=>{const d=rq.result;if(!d.objectStoreNames.contains('images'))d.createObjectStore('images')};
        rq.onsuccess=()=>{const d=rq.result;const t=d.transaction('images','readwrite');t.objectStore('images').put(url,key);t.oncomplete=()=>res(true)};
        rq.onerror=()=>res(false);
      })""", ["p:p1", plan])
    pg.evaluate("""()=>{const v=JSON.parse(localStorage.getItem('isafit-v1'));v.projects[0].planImageKey='p:p1';localStorage.setItem('isafit-v1',JSON.stringify(v))}""")
    pg.reload(); pg.wait_for_timeout(250)
    pg.click("[data-project]"); pg.wait_for_timeout(500)

    # ---- carry path summary + item statuses ----
    results["pathSummary"] = pg.inner_text("#pathSummary")
    results["itemStatuses"] = [t.inner_text().replace("\n", " | ") for t in pg.query_selector_all(".itm")]
    results["hasPlanBtn"] = pg.is_visible("#showPlan")
    pg.screenshot(path=OUT + "m-space.png")

    # canvas pixels: window on top wall, outlet bottom, room photo not used
    results["canvas"] = pg.evaluate("""() => {
      const c = document.querySelector('#floor');
      const x = c.getContext('2d');
      const d = x.getImageData(0, 0, c.width, c.height).data;
      let blue = 0, outlet = 0;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i+1], bl = d[i+2];
        if (bl > 150 && bl - r > 25 && g > 110 && g < 210) blue++;
        if (r > 240 && g > 225 && bl > 180 && bl < 235) outlet++;
      }
      const cw = c.width, ch = c.height;
      const topBlue = (() => { let n = 0; for (let px = 0; px < cw; px++) for (let py = 0; py < 26; py++) { const i = (py*cw+px)*4; if (d[i+2] > 150 && d[i+2]-d[i] > 25) n++; } return n; })();
      return {w: cw, h: ch, bluePx: blue, outletPx: outlet, topBluePx: topBlue};
    }""")

    # ---- select the sofa: notes + reasons ----
    pg.click('.tabbar [data-tab="furn"]'); pg.wait_for_timeout(300)
    pg.click(".itm"); pg.wait_for_timeout(300)
    sel = pg.inner_text("#selPanelWrap")
    results["selPanel"] = sel.replace("\n", " | ")[:600]

    # ---- toggle a window wall chip, confirm redraw ----
    pg.click('.tabbar [data-tab="space"]'); pg.wait_for_timeout(250)
    pg.click('[data-win="left"]'); pg.wait_for_timeout(250)
    results["canvasAfterWinToggle"] = pg.evaluate("""() => {
      const c = document.querySelector('#floor'); const d = c.getContext('2d').getImageData(0,0,c.width,c.height).data;
      let blue = 0; for (let i = 0; i < d.length; i += 4) { if (d[i+2] > 150 && d[i+2]-d[i] > 25) blue++; }
      return blue;
    }""")

    # ---- entry door tightened: reason text ----
    pg.fill("#entryW", "500")
    pg.dispatch_event("#entryW", "input")
    pg.wait_for_timeout(250)
    results["pathSummaryAfterEntry500"] = pg.inner_text("#pathSummary")

    # ---- report tab ----
    pg.click('.tabbar [data-tab="report"]'); pg.wait_for_timeout(350)
    rep = pg.inner_text("#reportWrap")
    results["reportHasPathSection"] = "반입 경로" in rep
    results["reportSnippet"] = [l for l in rep.split("\n") if "현관문" in l or "엘리베이터" in l][:6]
    pg.screenshot(path=OUT + "m-report.png")

    # ---- whole-plan modal ----
    pg.click('.tabbar [data-tab="space"]'); pg.wait_for_timeout(250)
    pg.click("#showPlan"); pg.wait_for_timeout(500)
    results["planModalOpen"] = pg.evaluate("() => document.querySelector('#planDialog').open")
    results["planImgW"] = pg.evaluate("() => { const i = document.querySelector('#planImg'); return {natural: i.naturalWidth, shown: Math.round(i.getBoundingClientRect().width)} }")
    pg.click("#planZoomIn"); pg.wait_for_timeout(200)
    results["planZoom"] = pg.evaluate("() => document.querySelector('#planZoomLbl').textContent")
    pg.screenshot(path=OUT + "m-plan.png")
    pg.click("#planClose"); pg.wait_for_timeout(200)

    # ---- horizontal overflow check across panels ----
    results["overflow"] = pg.evaluate("""() => {
      const body = document.querySelector('.dbody');
      const wide = [...document.querySelectorAll('.dbody *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1)
        .map(e => e.tagName + '.' + (e.className || '') + '#' + (e.id || '') + ':' + Math.round(e.getBoundingClientRect().right)).slice(0, 8);
      return {docW: document.documentElement.scrollWidth, innerW: innerWidth, bodyScrollW: body && body.scrollWidth, wide};
    }""")
    results["errors_mobile"] = errs[:6]

    # ---- desktop ----
    ctx2 = b.new_context(viewport={"width": 1280, "height": 900})
    pg2 = ctx2.new_page()
    errs2 = []
    pg2.on("pageerror", lambda e: errs2.append(str(e)))
    pg2.goto(URL)
    pg2.evaluate("d=>localStorage.setItem('isafit-v1',JSON.stringify(d))", SEED)
    pg2.reload(); pg2.wait_for_timeout(250)
    pg2.click("[data-project]"); pg2.wait_for_timeout(500)
    results["desktop"] = pg2.evaluate("""() => {
      const t = [...document.querySelectorAll('.tabbar button')].map(b => b.innerText.replace(/\\s+/g,' '));
      const c = document.querySelector('#floor');
      return {tabs: t, canvas: {w: c.width, h: c.height, css: Math.round(c.getBoundingClientRect().width)},
              docScrollW: document.documentElement.scrollWidth, innerW: innerWidth,
              path: document.querySelector('#pathSummary').innerText.split('\\n')[0]};
    }""")
    pg2.screenshot(path=OUT + "d-space.png")
    pg2.click('.tabbar [data-tab="report"]'); pg2.wait_for_timeout(300)
    pg2.screenshot(path=OUT + "d-report.png")
    results["errors_desktop"] = errs2[:6]
    b.close()

print(json.dumps(results, ensure_ascii=False, indent=1))
