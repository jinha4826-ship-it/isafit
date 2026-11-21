import json
from playwright.sync_api import sync_playwright

CHROME = "/workspace/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome"
URL = "file:///workspace/work/isafit/index.html"
OUT = "/workspace/work/isafit/test/"

SEED = {
    "projects": [{
        "id": "p1", "name": "새집 후보 A", "area": "경남 김해시", "aptName": "부원역푸르지오",
        "aptSize": "84㎡",
        "entry": {"w": 850, "h": 2000}, "elevator": {"use": True, "w": 1000, "d": 1200, "h": 2100},
        "stairs": True, "crane": False,
        "rooms": [
            {"id": "r1", "name": "거실", "w": 4500, "d": 4200, "items": [],
             "bbox": {"x": 3, "y": 40, "w": 33, "h": 55}, "win": {"top": True}, "out": {"bottom": True},
             "door": {"wall": "bottom", "pos": .5, "width": 800, "swing": "in", "hinge": "start"}},
            {"id": "r2", "name": "주방/식당", "w": 3600, "d": 2400, "items": [],
             "bbox": {"x": 38, "y": 5, "w": 28, "h": 33}, "win": {"left": True}, "out": {"right": True},
             "door": {"wall": "bottom", "pos": .4, "width": 800, "swing": "in", "hinge": "start"}},
            {"id": "r3", "name": "침실", "w": 3300, "d": 3000, "items": [],
             "door": {"wall": "left", "pos": .5, "width": 750, "swing": "in", "hinge": "start"}},
        ],
    }],
    "furniture": [],
}

PLAN_JS = """() => {
  const c = document.createElement('canvas'); c.width = 1000; c.height = 800;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, 1000, 800);
  x.strokeStyle = '#5d6b5f'; x.lineWidth = 10; x.strokeRect(20, 20, 960, 760);
  x.fillStyle = '#9fb29b';
  x.fillRect(30, 320, 330, 440); x.fillRect(380, 40, 280, 264);
  x.fillStyle = '#3c473c'; x.font = 'bold 34px sans-serif';
  x.fillText('거실', 130, 540); x.fillText('주방', 470, 180);
  return c.toDataURL('image/png');
}"""

res = {}
with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])
    ctx = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, device_scale_factor=3, has_touch=True)
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append("PAGEERROR: " + str(e)))
    pg.on("console", lambda m: errs.append("CONSOLE " + m.type + ": " + m.text) if m.type == "error" else None)
    pg.goto(URL)
    pg.evaluate("d=>localStorage.setItem('isafit-v1',JSON.stringify(d))", SEED)
    plan = pg.evaluate(PLAN_JS)
    pg.evaluate("""([k,u])=>new Promise(r=>{const q=indexedDB.open('isafit-db',1);q.onupgradeneeded=()=>{const d=q.result;if(!d.objectStoreNames.contains('images'))d.createObjectStore('images')};q.onsuccess=()=>{const t=q.result.transaction('images','readwrite');t.objectStore('images').put(u,k);t.oncomplete=()=>r(1)};q.onerror=()=>r(0)})""", ["p:p1", plan])
    pg.evaluate("""()=>{const v=JSON.parse(localStorage.getItem('isafit-v1'));v.projects[0].planImageKey='p:p1';localStorage.setItem('isafit-v1',JSON.stringify(v))}""")
    pg.reload(); pg.wait_for_timeout(250)
    pg.click("[data-project]"); pg.wait_for_timeout(450)

    pg.click("#showPlan"); pg.wait_for_timeout(500)
    res["hotspots"] = pg.evaluate("()=>[...document.querySelectorAll('#planHot .phot,#planHot .ppin')].map(e=>e.className+'|'+e.innerText+'|'+e.getAttribute('style'))")
    res["roomBar"] = pg.evaluate("()=>[...document.querySelectorAll('#planRooms button')].map(e=>e.innerText+(e.className?'(on)':''))")
    res["currentRoomBefore"] = pg.evaluate("()=>document.querySelector('.roomchips button.on').innerText")
    pg.screenshot(path=OUT + "m-planhot.png")

    # click the 침실 pin? 침실 has no bbox yet -> create a pin via pin mode
    pg.click("#planPin"); pg.wait_for_timeout(250)
    res["pinModeClass"] = pg.evaluate("()=>document.getElementById('planStage').className+' / '+document.getElementById('planPin').innerText")
    pg.click('#planRooms button:nth-child(3)'); pg.wait_for_timeout(250)
    res["pinTargetLabel"] = pg.evaluate("()=>document.getElementById('planPin').innerText")
    im = pg.query_selector("#planImg").bounding_box()
    pg.mouse.click(im["x"] + im["width"] * 0.78, im["y"] + im["height"] * 0.62)
    pg.wait_for_timeout(350)
    res["afterPin"] = pg.evaluate("()=>{const v=JSON.parse(localStorage.getItem('isafit-v1'));const r=v.projects[0].rooms.find(x=>x.id==='r3');return r.pin||null}")
    res["pins"] = pg.evaluate("()=>[...document.querySelectorAll('#planHot .ppin')].map(e=>e.innerText+'|'+e.getAttribute('style'))")
    pg.screenshot(path=OUT + "m-planpin.png")

    # click the 주방 bbox hotspot -> should switch room and close modal
    pg.click('#planHot .phot[data-goroom="r2"]')
    pg.wait_for_timeout(500)
    res["modalClosed"] = pg.evaluate("()=>!document.querySelector('#planDialog').open")
    res["currentRoomAfter"] = pg.evaluate("()=>document.querySelector('.roomchips button.on').innerText")
    res["roomSummary"] = pg.evaluate("()=>document.querySelector('#roomreport').innerText.split('\\n')[0]")
    res["winChipsOn"] = pg.evaluate("()=>[...document.querySelectorAll('#winChips .chip.on')].map(e=>e.innerText)")

    # reopen and click the new pin (침실)
    pg.click("#showPlan"); pg.wait_for_timeout(400)
    pg.click('#planHot .ppin[data-goroom="r3"]'); pg.wait_for_timeout(450)
    res["roomAfterPinClick"] = pg.evaluate("()=>document.querySelector('.roomchips button.on').innerText")

    # room bar click
    pg.click("#showPlan"); pg.wait_for_timeout(400)
    pg.click('#planRooms button:nth-child(1)'); pg.wait_for_timeout(450)
    res["roomAfterBarClick"] = pg.evaluate("()=>document.querySelector('.roomchips button.on').innerText")

    # desktop overlay check
    ctx2 = b.new_context(viewport={"width": 1280, "height": 900})
    pg2 = ctx2.new_page()
    e2 = []
    pg2.on("pageerror", lambda e: e2.append(str(e)))
    pg2.goto(URL)
    pg2.evaluate("d=>localStorage.setItem('isafit-v1',JSON.stringify(d))", SEED)
    pg2.evaluate("""([k,u])=>new Promise(r=>{const q=indexedDB.open('isafit-db',1);q.onupgradeneeded=()=>{const d=q.result;if(!d.objectStoreNames.contains('images'))d.createObjectStore('images')};q.onsuccess=()=>{const t=q.result.transaction('images','readwrite');t.objectStore('images').put(u,k);t.oncomplete=()=>r(1)};q.onerror=()=>r(0)})""", ["p:p1", plan])
    pg2.evaluate("""()=>{const v=JSON.parse(localStorage.getItem('isafit-v1'));v.projects[0].planImageKey='p:p1';localStorage.setItem('isafit-v1',JSON.stringify(v))}""")
    pg2.reload(); pg2.wait_for_timeout(250)
    pg2.click("[data-project]"); pg2.wait_for_timeout(400)
    pg2.click("#showPlan"); pg2.wait_for_timeout(500)
    res["desktopHot"] = pg2.evaluate("()=>{const o=document.querySelector('#planHot .phot');const r=o.getBoundingClientRect();return {n:document.querySelectorAll('#planHot .phot').length,x:Math.round(r.x),w:Math.round(r.width)}}")
    pg2.screenshot(path=OUT + "d-planhot.png")
    res["errors"] = errs[:8] + e2[:4]
    b.close()

print(json.dumps(res, ensure_ascii=False, indent=1))
