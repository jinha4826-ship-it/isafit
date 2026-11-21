import base64
from playwright.sync_api import sync_playwright
from quick import SEED, CHROME, OUT
URL="https://jinha4826-ship-it.github.io/isafit/?v=ai13"
with sync_playwright() as pw:
    b=pw.chromium.launch(executable_path=CHROME,args=["--no-sandbox"])
    ctx=b.new_context(viewport={"width":390,"height":844},is_mobile=True,has_touch=True,device_scale_factor=3,locale="ko-KR")
    pg=ctx.new_page(); errs=[]
    pg.on("pageerror",lambda e: errs.append(str(e)))
    pg.on("console",lambda m: errs.append("C:"+m.text) if m.type=="error" else None)
    r=pg.goto(URL); print("status", r.status, "url", pg.url)
    print("build meta:", pg.eval_on_selector('meta[name="isafit-build"]','e=>e.content'))
    pg.evaluate("d=>localStorage.setItem('isafit-v1',JSON.stringify(d))",SEED); pg.reload(); pg.wait_for_timeout(500)
    pg.click("[data-project]"); pg.wait_for_timeout(600)
    pg.click('.tabbar [data-tab="report"]'); pg.wait_for_timeout(700)
    print("ohou links:", pg.eval_on_selector_all(".ohou","e=>e.length"))
    print("move card:", pg.inner_text(".movecard").split("\n")[0:3])
    pg.click("#agentToggle"); pg.wait_for_timeout(300)
    pg.fill("#agOffice","부원공인중개사사무소"); pg.fill("#agName","김공인"); pg.fill("#agPhone","055-123-4567")
    pg.fill("#agComment","엘리베이터 폭이 좁아 양문형 냉장고는 사다리차 반입을 권합니다."); pg.wait_for_timeout(300)
    print("badge:", pg.inner_text("#agentBadgeHost").replace("\n"," | ")[:70])
    pg.click("#pngReport"); pg.wait_for_timeout(1200)
    info=pg.evaluate("()=>{const i=document.querySelector('#cardImg');return[document.querySelector('#cardDialog').open,i.naturalWidth,i.naturalHeight,(i.src||'').length]}")
    print("png:", info)
    data=pg.evaluate("()=>document.querySelector('#cardImg').src.split(',')[1]")
    open(OUT+"live-card.png","wb").write(base64.b64decode(data))
    pg.evaluate("()=>document.querySelector('#cardDialog').close()")
    pg.wait_for_timeout(200)
    pg.screenshot(path=OUT+"live-m.png")
    print("overflow:", pg.evaluate("()=>[document.documentElement.scrollWidth,window.innerWidth]"))
    print("errs:", errs)
    b.close()
