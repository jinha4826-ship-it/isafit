import base64, json, sys, re
from playwright.sync_api import sync_playwright

CHROME = "/workspace/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome"
URL = "file:///workspace/work/isafit/index.html"
OUT = "/workspace/work/isafit/test/"

SEED = {
    "projects": [{
        "id": "p1", "name": "새집 후보 A", "area": "경남 김해시", "aptName": "부원역푸르지오", "aptSize": "84㎡",
        "entry": {"w": 700, "h": 2000},
        "elevator": {"use": True, "w": 700, "d": 700, "h": 2000},
        "stairs": True, "crane": False,
        "rooms": [
            {"id": "r1", "name": "거실", "w": 4500, "d": 4200, "win": {"top": True, "right": True},
             "out": {"bottom": True}, "winW": 1600,
             "door": {"wall": "bottom", "pos": .5, "width": 800, "swing": "in", "hinge": "start"},
             "items": [
                 {"id": "i1", "fid": "f1", "name": "4인 소파", "type": "소파", "w": 2400, "d": 950, "h": 800, "x": 300, "y": 200, "rot": 0},
                 {"id": "i2", "fid": "f2", "name": "양문형 냉장고", "type": "냉장고", "w": 912, "d": 920, "h": 1800, "x": 3400, "y": 3100, "rot": 0},
             ]},
            {"id": "r2", "name": "침실", "w": 3300, "d": 3000, "win": {"left": True}, "out": {"top": True},
             "winW": 1400,
             "door": {"wall": "bottom", "pos": .5, "width": 750, "swing": "in", "hinge": "start"},
             "items": [
                 {"id": "i3", "fid": "f3", "name": "퀸 침대", "type": "침대", "w": 1500, "d": 2000, "h": 600, "x": 0, "y": 60, "rot": 0},
                 {"id": "i4", "fid": "f4", "name": "6인 식탁", "type": "식탁", "w": 1800, "d": 850, "h": 750, "x": 2900, "y": 900, "rot": 0},
             ]},
        ],
    }],
    "furniture": [
        {"id": "f1", "type": "소파", "name": "4인 소파", "w": 2400, "d": 950, "h": 800},
        {"id": "f2", "type": "냉장고", "name": "양문형 냉장고", "w": 912, "d": 920, "h": 1800},
        {"id": "f3", "type": "침대", "name": "퀸 침대", "w": 1500, "d": 2000, "h": 600},
        {"id": "f4", "type": "식탁", "name": "6인 식탁", "w": 1800, "d": 850, "h": 750},
    ],
}

fails = []


def check(cond, label, extra=""):
    print(("PASS " if cond else "FAIL ") + label + ((" | " + str(extra)) if extra else ""))
    if not cond:
        fails.append(label)


def run(pw, name, vp, mobile):
    print("\n===== " + name + " =====")
    b = pw.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])
    ctx = b.new_context(viewport={"width": vp[0], "height": vp[1]}, is_mobile=mobile,
                        has_touch=mobile, device_scale_factor=3 if mobile else 1,
                        locale="ko-KR", timezone_id="Asia/Seoul")
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
    pg.on("console", lambda m: errs.append("CONSOLE " + m.text) if m.type == "error" else None)
    pg.goto(URL)
    pg.evaluate("d=>localStorage.setItem('isafit-v1',JSON.stringify(d))", SEED)
    pg.reload()
    pg.wait_for_timeout(300)

    # 밝은 톤 확인
    theme = pg.evaluate("""()=>({bg:getComputedStyle(document.body).backgroundColor,
        green:getComputedStyle(document.documentElement).getPropertyValue('--green').trim(),
        paper:getComputedStyle(document.documentElement).getPropertyValue('--paper').trim(),
        heroBg:getComputedStyle(document.querySelector('.hero')).backgroundImage})""")
    check(theme["bg"] == "rgb(246, 248, 250)", "body 배경이 연한 쿨그레이(#F6F8FA)", theme["bg"])
    check(theme["green"].upper() == "#0284C7", "포인트 컬러 적용(--green)", theme["green"])
    check("gradient" in theme["heroBg"], "히어로 밝은 그라디언트", theme["heroBg"][:60])

    # 프로젝트 열기 → 리포트 탭
    pg.click("[data-project]")
    pg.wait_for_timeout(400)
    pg.click('.tabbar [data-tab="report"]')
    pg.wait_for_timeout(500)

    # 1) 오늘의집 링크
    links = pg.eval_on_selector_all(".ohou", "els=>els.map(e=>({t:e.textContent.trim(),h:e.href}))")
    bad = [l for l in links if not l["h"].startswith("https://ohou.se/store/search?query=")]
    check(len(links) >= 6, "오늘의집 링크 6개 이상", len(links))
    check(not bad, "모든 오늘의집 링크 형식 정상", bad[:2])
    labels = " ".join(l["t"] for l in links)
    check("오늘의집에서 들어가는" in labels and "찾기 ↗" in labels, "링크 문구 형식", labels[:80])
    dis_links = pg.evaluate("""()=>{const s=[...document.querySelectorAll('.rsec')].find(x=>x.querySelector('h3')&&x.querySelector('h3').textContent.includes('처분·교체'));return s?[...s.querySelectorAll('.ohou')].map(a=>a.textContent.trim()):[]}""")
    check(len(dis_links) >= 1, "처분·교체 카드에 오늘의집 링크", dis_links)
    room_links = pg.evaluate("""()=>{const s=[...document.querySelectorAll('.rsec')].find(x=>x.querySelector('h3')&&x.querySelector('h3').textContent.includes('맞춤 사이즈'));return s?[...s.querySelectorAll('.ohou')].length:0}""")
    check(room_links >= 4, "방별 추천 섹션 링크", room_links)
    q = pg.evaluate("()=>document.querySelector('.ohou').href")
    check("cm" in q, "검색어에 cm 폭 포함", q)

    # 2) 이사·사다리차 카드
    mv = pg.inner_text(".movecard")
    check("이사·사다리차 준비 요약" in mv, "사다리차 준비 카드 존재")
    check("사다리차 필요" in mv, "사다리차 필요 판정", mv.split("\n")[2:4])
    check("배치 가구" in mv, "총 가구 수 표기")
    mvlinks = pg.eval_on_selector_all(".movecard .cmpsearch", "els=>els.map(e=>e.href)")
    check(len(mvlinks) == 2 and all("search.naver.com" in h for h in mvlinks), "포장이사/사다리차 비교 링크", mvlinks)
    check("포장이사" in mvlinks[0] or "포장이사" in pg.inner_text(".movecard .mvlinks"), "포장이사 링크 문구")

    # 3) 중개사 모드
    check(pg.is_hidden("#agOffice") or pg.query_selector("#agOffice") is None, "처음엔 중개사 입력창 숨김")
    pg.click("#agentToggle")
    pg.wait_for_timeout(350)
    check(pg.query_selector("#agOffice") is not None, "토글 켜면 입력창 표시")
    pg.fill("#agOffice", "부원공인중개사사무소")
    pg.fill("#agName", "김공인")
    pg.fill("#agPhone", "055-123-4567")
    pg.fill("#agComment", "이 단지는 엘리베이터 폭이 좁아 양문형 냉장고는 사다리차 반입을 권합니다.")
    pg.wait_for_timeout(250)
    stored = pg.evaluate("()=>JSON.parse(localStorage.getItem('isafit-v1')).agent")
    check(stored.get("on") is True and stored.get("office") == "부원공인중개사사무소", "localStorage 저장", stored)
    badge = pg.inner_text("#agentBadgeHost")
    check("부원공인중개사사무소" in badge and "김공인" in badge and "055-123-4567" in badge, "리포트 상단 중개사 배지", badge[:60])
    check("담당자 코멘트" in badge, "고객 전달 코멘트 노출")

    # 4) PNG 카드
    pg.click("#pngReport")
    pg.wait_for_timeout(900)
    dlg_open = pg.evaluate("()=>!!document.querySelector('#cardDialog[open]')")
    check(dlg_open, "PNG 미리보기 다이얼로그 열림")
    info = pg.evaluate("""()=>{const im=document.querySelector('#cardImg');return{s:im.src.slice(0,22),w:im.naturalWidth,h:im.naturalHeight,len:im.src.length}}""")
    check(info["s"].startswith("data:image/png"), "PNG dataURL 생성", info["s"])
    check(info["w"] == 1080 and info["h"] > 900, "카드 크기 1080×N", (info["w"], info["h"]))
    check(info["len"] > 20000, "카드 이미지 용량", info["len"])
    data = pg.evaluate("()=>document.querySelector('#cardImg').src.split(',')[1]")
    with open(OUT + f"card-{name}.png", "wb") as f:
        f.write(base64.b64decode(data))
    pb = pg.evaluate("""()=>{const d=document.querySelector('#cardDialog');d.close();
       const t=document.createElement('canvas');t.width=10;t.height=10;return typeof t.toBlob==='function'}""")
    check(pb, "toBlob 지원")
    pg.wait_for_timeout(200)
    pg.screenshot(path=OUT + f"v-{name}-report.png")
    pg.evaluate("()=>{const b=document.querySelector('.dbody');b.scrollTop=b.scrollHeight*0.55}")
    pg.wait_for_timeout(400)
    pg.screenshot(path=OUT + f"v-{name}-report2.png")

    # 5) 가로 오버플로
    ov = pg.evaluate("""()=>{const d=document.documentElement,b=document.querySelector('.dbody');
      return{doc:d.scrollWidth,win:window.innerWidth,body:b?b.scrollWidth:0,box:b?b.clientWidth:0}}""")
    check(ov["doc"] <= ov["win"] + 1, "문서 가로 오버플로 없음", ov)
    check(ov["body"] <= ov["box"] + 1, "리포트 가로 오버플로 없음", ov)
    wide = pg.evaluate("""()=>{const W=window.innerWidth;const out=[];
      document.querySelectorAll('#reportWrap *').forEach(e=>{const r=e.getBoundingClientRect();
        if(r.width>0&&r.right>W+2)out.push(e.className+' '+Math.round(r.right))});return out.slice(0,6)}""")
    check(not wide, "화면 밖으로 나간 요소 없음", wide)

    # 6) 새로고침 후 유지
    pg.reload()
    pg.wait_for_timeout(350)
    pg.click("[data-project]")
    pg.wait_for_timeout(350)
    pg.click('.tabbar [data-tab="report"]')
    pg.wait_for_timeout(450)
    badge2 = pg.inner_text("#agentBadgeHost")
    check("부원공인중개사사무소" in badge2, "새로고침 후 중개사 정보 유지")
    check(pg.query_selector("#agOffice") is not None, "새로고침 후 토글 켜짐 유지")

    # 7) 가구 탭 링크
    pg.click('.tabbar [data-tab="furn"]')
    pg.wait_for_timeout(300)
    pg.click("#itemList .itm:nth-child(2)")
    pg.wait_for_timeout(350)
    fit = pg.query_selector(".fitbuy")
    check(fit is not None, "가구 판정 카드에 맞춤 사이즈 안내", bool(fit))
    if fit:
        check("https://ohou.se" in fit.inner_html(), "판정 카드 오늘의집 링크")
        check("들어가요" in fit.inner_text(), "최대 폭 문구", fit.inner_text()[:60])

    # 8) 콘솔/페이지 에러
    check(not errs, "JS 오류 0건", errs[:3])
    pg.wait_for_timeout(200)
    b.close()


with sync_playwright() as pw:
    run(pw, "m", (390, 844), True)
    run(pw, "d", (1280, 900), False)

print("\n=== 실패 " + str(len(fails)) + "건 ===")
for f in fails:
    print(" - " + f)
sys.exit(1 if fails else 0)
