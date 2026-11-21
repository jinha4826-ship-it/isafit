import json, copy
from playwright.sync_api import sync_playwright

CHROME = "/workspace/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome"
URL = "file:///workspace/work/isafit/index.html"
OUT = "/workspace/work/isafit/test/"

SEED = {
    "projects": [{
        "id": "p1", "name": "새집 후보 A", "area": "경남 김해시", "aptName": "부원역푸르지오", "aptSize": "84㎡",
        "entry": {"w": 850, "h": 2000}, "elevator": {"use": True, "w": 1000, "d": 1200, "h": 2100},
        "stairs": True, "crane": False,
        "rooms": [{
            "id": "r1", "name": "거실", "w": 4500, "d": 4200,
            "win": {"top": True, "right": True}, "out": {"bottom": True}, "winW": 1600,
            "door": {"wall": "bottom", "pos": .5, "width": 800, "swing": "in", "hinge": "start"},
            "items": [], "altItems": [], "activePlan": "A"}],
    }],
    "furniture": [
        {"id": "f1", "type": "소파", "name": "4인 소파", "w": 2400, "d": 950, "h": 800},
        {"id": "f2", "type": "냉장고", "name": "양문형 냉장고", "w": 912, "d": 920, "h": 1800},
        {"id": "f3", "type": "침대", "name": "퀸 침대", "w": 1500, "d": 2000, "h": 600},
    ],
}

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
    pg.evaluate("""()=>{const v=JSON.parse(localStorage.getItem('isafit-v1'));const r=v.projects[0].rooms[0];
      r.items=[
        {id:'a1',fid:'f1',name:'4인 소파',type:'소파',w:2400,d:950,h:800,x:150,y:1600,rot:0},
        {id:'a2',fid:'f2',name:'양문형 냉장고',type:'냉장고',w:912,d:920,h:1800,x:3480,y:3000,rot:0},
        {id:'a3',fid:'f3',name:'퀸 침대',type:'침대',w:1500,d:2000,h:600,x:1400,y:400,rot:0}];
      r.altItems=[
        {id:'b1',fid:'f1',name:'4인 소파',type:'소파',w:2400,d:950,h:800,x:900,y:1400,rot:0},
        {id:'b2',fid:'f2',name:'양문형 냉장고',type:'냉장고',w:912,d:920,h:1800,x:1600,y:1900,rot:0},
        {id:'b3',fid:'f3',name:'퀸 침대',type:'침대',w:1500,d:2000,h:600,x:1000,y:2400,rot:0}];
      r.activePlan='A';localStorage.setItem('isafit-v1',JSON.stringify(v))}""")
    pg.reload(); pg.wait_for_timeout(250)
    pg.click("[data-project]"); pg.wait_for_timeout(450)

    res["planbar"] = pg.evaluate("()=>[...document.querySelectorAll('.planbar .mini')].map(b=>b.innerText+(b.classList.contains('on')?'*':''))")
    res["summaryA"] = pg.inner_text("#roomreport")

    # switch to B (empty)
    pg.click('[data-plan="B"]'); pg.wait_for_timeout(450)
    res["afterSwitchB"] = pg.evaluate("()=>({bar:[...document.querySelectorAll('.planbar .mini')].map(b=>b.innerText+(b.classList.contains('on')?'*':'')), items:document.querySelectorAll('.itm').length, sum:document.querySelector('#roomreport').innerText.split('\\n')[0]})")

    # copy A into B (currently B empty -> copy B->A? we want A->B; go back to A and copy)
    pg.click('[data-plan="A"]'); pg.wait_for_timeout(400)
    pg.click("#copyPlan"); pg.wait_for_timeout(400)
    res["copyLabel"] = pg.evaluate("()=>document.querySelector('#copyPlan').innerText")
    res["stored"] = pg.evaluate("""()=>{const v=JSON.parse(localStorage.getItem('isafit-v1'));const r=v.projects[0].rooms[0];
      return {active:r.activePlan, items:r.items.length, alt:r.altItems.length, altIds:r.altItems.map(x=>x.id)};}""")

    # now B holds a copy; switch to B and move the bed to overlap the sofa -> worse layout
    pg.click('[data-plan="B"]'); pg.wait_for_timeout(450)
    res["Bitems"] = pg.evaluate("()=>[...document.querySelectorAll('.itm')].map(e=>e.innerText.replace(/\\n/g,' '))")
    # nudge the selected bed via item click then many nudges to cause overlap
    pg.click('[data-tab="furn"]'); pg.wait_for_timeout(300)
    items = pg.query_selector_all(".itm")
    items[0].click(); pg.wait_for_timeout(250)
    for _ in range(6):
        pg.click('[data-move="0,-50"]'); pg.wait_for_timeout(60)
    pg.wait_for_timeout(300)
    res["summaryB_afterMove"] = pg.evaluate("()=>document.querySelector('#roomreport').innerText.split('\\n').slice(0,3)")

    # comparison
    pg.click("#cmpPlan"); pg.wait_for_timeout(500)
    res["cmpOpen"] = pg.evaluate("()=>document.querySelector('#cmpDialog').open")
    res["cmpTable"] = pg.evaluate("()=>[...document.querySelectorAll('table.cmpt tr')].map(tr=>[...tr.children].map(td=>td.innerText).join(' | '))")
    res["cmpVerdict"] = pg.evaluate("()=>document.querySelector('.cmpverdict').innerText")
    pg.screenshot(path=OUT + "m-cmp.png")
    pg.click("#cmpClose"); pg.wait_for_timeout(250)

    # switching back preserves A untouched
    pg.click('[data-plan="A"]'); pg.wait_for_timeout(400)
    res["backToA"] = pg.evaluate("""()=>{const v=JSON.parse(localStorage.getItem('isafit-v1'));const r=v.projects[0].rooms[0];
      return {active:r.activePlan, items:r.items.length, alt:r.altItems.length, ok:document.querySelector('#roomreport').innerText.split('\\n')[0]};}""")
    res["errs"] = errs[:8]

    # desktop + reload persistence
    ctx2 = b.new_context(viewport={"width": 1280, "height": 900})
    pg2 = ctx2.new_page()
    e2 = []
    pg2.on("pageerror", lambda e: e2.append(str(e)))
    pg2.goto(URL)
    pg2.evaluate("d=>localStorage.setItem('isafit-v1',JSON.stringify(d))", SEED)
    pg2.reload(); pg2.wait_for_timeout(200)
    pg2.click("[data-project]"); pg2.wait_for_timeout(400)
    pg2.click("#cmpPlan"); pg2.wait_for_timeout(400)
    res["desktopCmp"] = pg2.evaluate("()=>{const t=document.querySelector('table.cmpt');return {w:Math.round(t.getBoundingClientRect().width), rows:t.querySelectorAll('tr').length, verdict:document.querySelector('.cmpverdict').innerText.slice(0,80)}}")
    pg2.screenshot(path=OUT + "d-cmp.png")
    res["errs2"] = e2[:4]
    b.close()

print(json.dumps(res, ensure_ascii=False, indent=1))
