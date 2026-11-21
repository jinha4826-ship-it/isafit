/**
 * Cloudflare Worker: 이사핏 API (v2 · 2026-11-21)
 *
 *  GET  /                          아파트 단지 검색 (국토교통부 AptListService4)
 *      ?q=푸르지오&region=경남 김해시
 *  GET  /floorplan-search          평면도 이미지 후보 검색
 *      ?apt=부원역푸르지오&pyeong=84&query=...
 *  GET  /image-proxy?url=...       외부 이미지 프록시 (CORS) — format=json 이면 data URL
 *  POST /analyze-floorplan         평면도 이미지 → 방·치수 자동 인식 (Gemini Vision)
 *      { imageBase64, mimeType, aptName } 또는 { imageUrl, aptName }
 *
 * Secrets
 *  - DATA_GO_KR_SERVICE_KEY  (아파트 단지 목록 API, URL-decoded 권장)
 *  - NAVER_CLIENT_ID / NAVER_CLIENT_SECRET      네이버 개발자센터(기존 발급자 전용, 2027-06-30 종료)
 *  - NCP_API_KEY_ID / NCP_API_KEY               NAVER API HUB (NCP, 신규 발급 경로)
 *  - GOOGLE_SEARCH_API_KEY / GOOGLE_CSE_ID      Google Programmable Search (이미지)
 *  - AI_ANALYZE_URL (선택)                      Gemini 분석 엔드포인트 재정의
 * 이미지 검색은 위 자격증명 중 설정된 것을 자동으로 고르고, 아무 것도 없으면
 * 비공식 DuckDuckGo 이미지 엔드포인트로 폴백합니다(차단되면 오류를 그대로 알립니다).
 */
const BASE = "https://apis.data.go.kr/1613000/AptListService4";
const ALLOWED_ORIGIN = "https://jinha4826-ship-it.github.io";
const PAGE_SIZE = 1000;
const MAX_PAGES = 20;
const CACHE_SECONDS = 3600;
const IMAGE_LIMIT = 6 * 1024 * 1024; // 6MB (Gemini inline_data 여유 확보)
const DEFAULT_AI_URL = "https://maeum-bingsan-ai.cba4826.workers.dev/analyze-floorplan";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

const SIDO_CODES = [
  [/서울|서울특별시/, "11"],
  [/부산|부산광역시/, "26"],
  [/대구|대구광역시/, "27"],
  [/인천|인천광역시/, "28"],
  [/광주|광주광역시/, "29"],
  [/대전|대전광역시/, "30"],
  [/울산|울산광역시/, "31"],
  [/세종|세종특별자치시/, "36"],
  [/경기|경기도/, "41"],
  [/강원|강원특별자치도|강원도/, "42"],
  [/충북|충청북도/, "43"],
  [/충남|충청남도/, "44"],
  [/전북|전북특별자치도|전라북도/, "45"],
  [/전남|전라남도/, "46"],
  [/경북|경상북도/, "47"],
  [/경남|경상남도/, "48"],
  [/제주|제주특별자치도/, "50"]
];

function corsHeaders(methods = "GET, POST, OPTIONS") {
  return {
    "access-control-allow-origin": ALLOWED_ORIGIN,
    "access-control-allow-methods": methods,
    "access-control-allow-headers": "Content-Type",
    "access-control-max-age": "86400",
    vary: "Origin"
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...corsHeaders()
    }
  });
}

function normalizeItems(data) {
  const body = data?.response?.body || {};
  const raw = body?.items?.item ?? body?.items ?? [];
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
  return list.map(x => ({
    kaptCode: x.kaptCode || "",
    kaptName: x.kaptName || "",
    bjdCode: x.bjdCode || "",
    as1: x.as1 || "",
    as2: x.as2 || "",
    as3: x.as3 || "",
    doroJuso: x.doroJuso || ""
  })).filter(x => x.kaptName);
}

const CITY_TO_SIDO = [
  [/강남|서초|송파|강동|마포|용산|성동|광진|동대문|중랑|성북|강북|도봉|노원|은평|서대문|양천|강서|구로|금천|영등포|동작|관악|종로/, "11"],
  [/해운대|수영|동래|연제|부산진|사하|사상|금정|영도|기장/, "26"],
  [/수성|달서|달성/, "27"],
  [/연수|남동|부평|계양|미추홀/, "28"],
  [/유성/, "30"],
  [/수원|성남|분당|판교|용인|고양|일산|화성|동탄|부천|안양|평택|안산|남양주|시흥|파주|김포|의정부|하남|광명|과천|구리|군포|의왕|오산|이천|안성|양주|포천|여주/, "41"],
  [/춘천|원주|강릉|속초|동해/, "42"],
  [/청주|충주|제천/, "43"],
  [/천안|아산|서산|당진/, "44"],
  [/전주|익산|군산/, "45"],
  [/여수|순천|목포|광양/, "46"],
  [/포항|구미|경산|경주|안동|김천/, "47"],
  [/김해|창원|양산|진주|거제|통영|사천|밀양|함안|거창/, "48"],
  [/제주시|서귀포/, "50"]
];

function findSidoCode(region) {
  return (
    SIDO_CODES.find(([pattern]) => pattern.test(region))?.[1] ||
    CITY_TO_SIDO.find(([pattern]) => pattern.test(region))?.[1] ||
    null
  );
}

function extractSubRegionTokens(region) {
  const withoutSido = region
    .replace(/서울특별시|서울시|서울|부산광역시|부산시|부산|대구광역시|대구시|대구|인천광역시|인천시|인천|광주광역시|광주시|광주|대전광역시|대전시|대전|울산광역시|울산시|울산|세종특별자치시|세종시|세종|경기도|경기|강원특별자치도|강원도|강원|충청북도|충북|충청남도|충남|전북특별자치도|전라북도|전북|전라남도|전남|경상북도|경북|경상남도|경남|제주특별자치도|제주도|제주/g, " ")
    .trim();
  if (!withoutSido) return [];
  return withoutSido
    .split(/[\s,·]+/)
    .map(tok => tok.trim().toLocaleLowerCase("ko-KR"))
    .map(tok => (tok.length > 2 ? tok.replace(/(시|군|구|읍|면|동)$/g, "") : tok))
    .filter(Boolean);
}

async function apiPage(env, sidoCode, pageNo) {
  const url = new URL(BASE + "/getSidoAptList4");
  let key = String(env.DATA_GO_KR_SERVICE_KEY || "").trim();
  try { key = decodeURIComponent(key); } catch (_) {}
  url.searchParams.set("serviceKey", key);
  url.searchParams.set("sidoCode", sidoCode);
  url.searchParams.set("pageNo", String(pageNo));
  url.searchParams.set("numOfRows", String(PAGE_SIZE));
  url.searchParams.set("_type", "json");

  const response = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  const text = await response.text();
  if (!response.ok) throw new Error("공공데이터 API HTTP " + response.status + ": " + text.slice(0, 300));
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error("공공데이터 API가 JSON이 아닌 응답을 반환했습니다: " + text.slice(0, 300)); }

  const header = data?.response?.header || {};
  if (header.resultCode && header.resultCode !== "00") {
    throw new Error("공공데이터 API 오류 " + header.resultCode + ": " + (header.resultMsg || "알 수 없는 오류"));
  }
  return {
    items: normalizeItems(data),
    totalCount: Number(data?.response?.body?.totalCount || 0)
  };
}

async function loadApartments(env, sidoCode) {
  if (!env.DATA_GO_KR_SERVICE_KEY) throw new Error("Worker secret DATA_GO_KR_SERVICE_KEY is missing");

  const cache = caches.default;
  const cacheUrl = new URL("https://isafit-cache.invalid/sido/" + sidoCode);
  const cacheKey = new Request(cacheUrl.toString());
  const cached = await cache.match(cacheKey);
  if (cached) return cached.json();

  const first = await apiPage(env, sidoCode, 1);
  let items = first.items;
  const pages = Math.min(MAX_PAGES, Math.ceil(first.totalCount / PAGE_SIZE));
  for (let page = 2; page <= pages; page++) {
    const next = await apiPage(env, sidoCode, page);
    items = items.concat(next.items);
  }

  const unique = [...new Map(items.map(x => [x.kaptCode || x.kaptName, x])).values()];
  const result = { items: unique, totalCount: first.totalCount, sidoCode };
  await cache.put(cacheKey, new Response(JSON.stringify(result), {
    headers: { "content-type": "application/json", "cache-control": "max-age=" + CACHE_SECONDS }
  }));
  return result;
}

/* ------------------------------------------------------------------ */
/* 이미지 검색                                                         */
/* ------------------------------------------------------------------ */

function stripTags(s) {
  return String(s || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .trim();
}

function providerOrder(env) {
  const order = [];
  if (env.NAVER_CLIENT_ID && env.NAVER_CLIENT_SECRET) order.push('naver');
  if (env.NCP_API_KEY_ID && env.NCP_API_KEY) order.push('ncp');
  if ((env.GOOGLE_SEARCH_API_KEY || env.GOOGLE_API_KEY) && env.GOOGLE_CSE_ID) order.push('google');
  order.push('bing');
  order.push('duckduckgo');
  return order;
}

function providerOf(env) {
  return providerOrder(env)[0];
}

async function searchNaverDev(env, query, display) {
  const url = new URL("https://openapi.naver.com/v1/search/image");
  url.searchParams.set("query", query);
  url.searchParams.set("display", String(display));
  url.searchParams.set("sort", "sim");
  url.searchParams.set("filter", "large");
  const res = await fetch(url.toString(), {
    headers: {
      "X-Naver-Client-Id": env.NAVER_CLIENT_ID,
      "X-Naver-Client-Secret": env.NAVER_CLIENT_SECRET,
      Accept: "application/json"
    }
  });
  const text = await res.text();
  if (!res.ok) throw new Error("네이버 이미지 검색 HTTP " + res.status + ": " + text.slice(0, 200));
  const body = JSON.parse(text);
  return (body.items || []).map(it => ({
    title: stripTags(it.title),
    image: it.link || "",
    thumbnail: it.thumbnail || it.link || "",
    link: it.link || "",
    width: Number(it.sizewidth) || 0,
    height: Number(it.sizeheight) || 0
  }));
}

async function searchNcp(env, query, display) {
  const url = new URL("https://naverapihub.apigw.ntruss.com/search/v1/image");
  url.searchParams.set("query", query);
  url.searchParams.set("display", String(display));
  url.searchParams.set("sort", "sim");
  url.searchParams.set("filter", "large");
  const res = await fetch(url.toString(), {
    headers: {
      "X-NCP-APIGW-API-KEY-ID": env.NCP_API_KEY_ID,
      "X-NCP-APIGW-API-KEY": env.NCP_API_KEY,
      Accept: "application/json"
    }
  });
  const text = await res.text();
  if (!res.ok) throw new Error("NAVER API HUB 이미지 검색 HTTP " + res.status + ": " + text.slice(0, 200));
  const body = JSON.parse(text);
  return (body.items || []).map(it => ({
    title: stripTags(it.title),
    image: it.link || "",
    thumbnail: it.thumbnail || it.link || "",
    link: it.link || "",
    width: Number(it.sizewidth) || 0,
    height: Number(it.sizeheight) || 0
  }));
}

async function searchGoogle(env, query, display) {
  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", env.GOOGLE_SEARCH_API_KEY || env.GOOGLE_API_KEY);
  url.searchParams.set("cx", env.GOOGLE_CSE_ID);
  url.searchParams.set("q", query);
  url.searchParams.set("searchType", "image");
  url.searchParams.set("num", String(Math.min(10, display)));
  url.searchParams.set("safe", "off");
  url.searchParams.set("hl", "ko");
  const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  const text = await res.text();
  if (!res.ok) throw new Error("Google 이미지 검색 HTTP " + res.status + ": " + text.slice(0, 200));
  const body = JSON.parse(text);
  return (body.items || []).map(it => ({
    title: stripTags(it.title),
    image: it.link || "",
    thumbnail: it.image?.thumbnailLink || it.link || "",
    link: it.image?.contextLink || it.link || "",
    width: Number(it.image?.width) || 0,
    height: Number(it.image?.height) || 0
  }));
}

/**
 * 비공식 폴백 1: Bing 이미지(HTML async 엔드포인트). 키가 필요 없고
 * 한국 아파트 평면도(호갱노노·네이버 블로그) 결과가 꾀 좋다.
 */
async function searchBingImages(query, display) {
  const url = "https://www.bing.com/images/async?q=" + encodeURIComponent(query) +
    "&first=0&count=" + (display * 3) + "&mkt=ko-KR&adlt=off";
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.6",
      Accept: "text/html,application/xhtml+xml"
    }
  });
  if (!res.ok) throw new Error("Bing 이미지 HTTP " + res.status);
  const html = await res.text();
  const out = [];
  const re = /m="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    const raw = m[1]
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#39;/g, "'");
    let o;
    try { o = JSON.parse(raw); } catch (e) { continue; }
    if (!o || !o.murl) continue;
    out.push({
      title: String(o.t || ""),
      image: String(o.murl),
      thumbnail: String(o.turl || o.murl),
      link: String(o.purl || ""),
      width: Number(o.mw) || 0,
      height: Number(o.mh) || 0
    });
    if (out.length >= display * 2) break;
  }
  if (!out.length) throw new Error("Bing 이미지 결과를 해석하지 못했어요.");
  return out;
}

/**
 * 비공식 폴백 2: DuckDuckGo 이미지(토큰 → i.js). 공식 API가 아니므로
 * 다른 경로가 모두 싱패했을 때만 쓰고, 실패는 그대로 사용자에게 알린다.
 */
async function searchDuckDuckGo(query, display) {
  const page = await fetch("https://duckduckgo.com/?q=" + encodeURIComponent(query) + "&iax=images&ia=images", {
    headers: { "User-Agent": UA, Accept: "text/html" }
  });
  if (!page.ok) throw new Error("DuckDuckGo HTTP " + page.status);
  const html = await page.text();
  const m = html.match(/vqd=["']?([\d-]{6,})["']?/) || html.match(/vqd=([\d-]{6,})&/);
  if (!m) throw new Error("DuckDuckGo 검색 토큰을 받지 못했어요.");
  const vqd = m[1];
  const api = "https://duckduckgo.com/i.js?l=wt-wt&o=json&q=" + encodeURIComponent(query) +
    "&vqd=" + encodeURIComponent(vqd) + "&f=,,,&p=1";
  const res = await fetch(api, {
    headers: { "User-Agent": UA, Referer: "https://duckduckgo.com/", Accept: "application/json" }
  });
  const text = await res.text();
  if (!res.ok) throw new Error("DuckDuckGo 이미지 HTTP " + res.status + ": " + text.slice(0, 150));
  const body = JSON.parse(text);
  return (body.results || []).slice(0, display).map(it => ({
    title: stripTags(it.title),
    image: it.image || "",
    thumbnail: it.thumbnail || it.image || "",
    link: it.url || "",
    width: Number(it.width) || 0,
    height: Number(it.height) || 0
  }));
}

function looksLikeFloorplan(item) {
  const hay = (item.title + " " + item.link).toLowerCase();
  const bad = /로고|logo|아이콘|icon|지도|map|분양광고|현수막|조감도|배너/.test(hay);
  return !bad;
}

function cityFromArea(area) {
  const raw = String(area || "").trim();
  if (!raw) return "";
  const tokens = raw.split(/[\s,]+/).filter(Boolean);
  for (const t of tokens) {
    if (/(시|군|구)$/.test(t) && t.length >= 2) return t.replace(/(시|군|구)$/, "");
  }
  return tokens.length > 1 ? tokens[1] : "";
}

async function floorplanSearch(env, { apt, pyeong, area, query }) {
  const cleanApt = String(apt || "").trim();
  const city = cityFromArea(area);
  const rawPyeong = String(pyeong || "").trim();
  let sizeToken = "";
  if (rawPyeong) {
    const num = rawPyeong.replace(/[^0-9.]/g, "");
    if (num) {
      const isPyeong = /평/.test(rawPyeong) && !/㎡|m2|제곱/i.test(rawPyeong);
      const n = Number(num);
      // 84 처럼 큰 숫자는 전용면적(㎡), 24·34 처럼 작은 숫자는 평으로 읽는다.
      sizeToken = (isPyeong || (n > 0 && n < 50)) ? num + "평" : num + "㎡";
    }
  }
  const given = String(query || "").trim();
  const plain = [cleanApt, sizeToken, "평면도"].filter(Boolean).join(" ").trim();
  const variants = given
    ? [given]
    : [
        [cleanApt ? `"${cleanApt}"` : "", city, sizeToken, "평면도"].filter(Boolean).join(" "),
        [cleanApt ? `"${cleanApt}"` : "", city, "평면도"].filter(Boolean).join(" "),
        plain
      ];
  const uniqVariants = [...new Set(variants.map(v => v.trim()).filter(v => v.length >= 2))];
  if (!uniqVariants.length) throw new Error("검색어가 너무 짧아요. 단지명을 입력해 주세요.");

  const provider = providerOrder(env);
  let items = [];
  let used = '';
  let usedQuery = uniqVariants[0];
  const failures = [];
  for (const vq of uniqVariants) {
    for (const p of provider) {
      try {
        let got = [];
        if (p === "naver") got = await searchNaverDev(env, vq, 8);
        else if (p === "ncp") got = await searchNcp(env, vq, 8);
        else if (p === "google") got = await searchGoogle(env, vq, 8);
        else if (p === "bing") got = await searchBingImages(vq, 8);
        else got = await searchDuckDuckGo(vq, 8);
        if (got && got.length) {
          items = items.concat(got);
          if (!used) { used = p; usedQuery = vq; }
          break;
        }
      } catch (error) {
        failures.push(p + ": " + String(error.message || error).slice(0, 160));
      }
    }
    if (items.length >= 8) break;
  }
  const q = usedQuery;

  const seen = new Set();
  const aptKey = cleanApt.replace(/\s+/g, "").toLowerCase();
  const score = it => {
    const hay = ((it.title || "") + " " + (it.link || "")).toLowerCase().replace(/\s+/g, "");
    let s = 0;
    if (aptKey && hay.includes(aptKey)) s += 6;
    else if (aptKey && aptKey.length >= 3) {
      const head = aptKey.slice(0, 4);
      if (hay.includes(head)) s += 2;
    }
    if (/평면도|도면|평면/.test(hay)) s += 2;
    if (/naver|tistory|daum|blog/.test(hay)) s += 1;
    if (/인스티즈|instiz|클리앙|뽐뿌|디시|중고|매매|전세/.test(hay)) s -= 2;
    return s;
  };
  const filtered = items.filter(it => {
    if (!it.image || seen.has(it.image)) return false;
    seen.add(it.image);
    return looksLikeFloorplan(it);
  }).sort((a, b) => score(b) - score(a)).slice(0, 6);

  if (!filtered.length && !items.length) {
    const err = new Error("평면도 이미지를 찾지 못했어요.");
    err.failures = failures;
    throw err;
  }
  return { query: q, provider: used || provider[0], failures, items: filtered.length ? filtered : items.slice(0, 6) };
}

/* ------------------------------------------------------------------ */
/* 이미지 바이트                                                        */
/* ------------------------------------------------------------------ */

function sniffMime(bytes) {
  const b = bytes;
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length > 12 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  if (b.length > 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b.length > 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return "image/heic";
  return "";
}

function toBase64(bytes) {
  let out = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(out);
}

async function fetchImage(url) {
  let target;
  try { target = new URL(url); } catch { throw new Error("이미지 주소가 올바르지 않아요."); }
  if (!/^https?:$/.test(target.protocol)) throw new Error("http(s) 이미지 주소만 지원해요.");
  const res = await fetch(target.toString(), {
    headers: { "User-Agent": UA, Accept: "image/avif,image/webp,image/*,*/*;q=0.8", Referer: target.origin + "/" },
    redirect: "follow"
  });
  if (!res.ok) throw new Error("이미지를 가져오지 못했어요 (HTTP " + res.status + ").");
  const len = Number(res.headers.get("content-length") || 0);
  if (len && len > IMAGE_LIMIT) throw new Error("이미지가 너무 커요(" + Math.round(len / 1024 / 1024) + "MB). 다른 도면을 골라 주세요.");
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length > IMAGE_LIMIT) throw new Error("이미지가 너무 커요(" + Math.round(buf.length / 1024 / 1024) + "MB). 다른 도면을 골라 주세요.");
  let mime = String(res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!mime.startsWith("image/")) mime = sniffMime(buf);
  if (!mime) throw new Error("이미지 형식을 알아보지 못했어요.");
  return { buf, mime };
}

function decodeBase64(str) {
  const cleanStr = String(str || "").replace(/^data:[^,]*,/, "").replace(/\s/g, "");
  const bin = atob(cleanStr);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ------------------------------------------------------------------ */
/* 라우팅                                                               */
/* ------------------------------------------------------------------ */

async function handleApartmentSearch(env, url) {
  const query = (url.searchParams.get("q") || "").trim().toLocaleLowerCase("ko-KR");
  const region = (url.searchParams.get("region") || "").trim();
  if (query.length < 2) return json({ error: "Enter at least two characters", items: [] }, 400);

  const sidoCode = findSidoCode(region);
  if (!sidoCode) {
    return json({
      error: "지역을 시·도까지 입력해 주세요.",
      detail: "예: 경남 김해시, 서울특별시 강남구, 부산광역시 해운대구",
      items: []
    }, 400);
  }

  try {
    const dataset = await loadApartments(env, sidoCode);
    const subTokens = extractSubRegionTokens(region);
    const matches = dataset.items.filter(item => {
      const name = item.kaptName.toLocaleLowerCase("ko-KR");
      const address = [item.as1, item.as2, item.as3, item.doroJuso].join(" ").replace(/\s/g, "").toLocaleLowerCase("ko-KR");
      return name.includes(query) && subTokens.every(tok => address.includes(tok));
    }).slice(0, 30);

    return json({
      items: matches,
      count: matches.length,
      source: "국토교통부 공동주택 단지 목록",
      regionScope: sidoCode,
      totalInProvince: dataset.totalCount
    });
  } catch (error) {
    return json({ error: "Apartment search failed", detail: error.message, items: [] }, 502);
  }
}

async function handleImageProxy(url) {
  const raw = url.searchParams.get("url") || "";
  if (!raw) return json({ error: "url 파라미터가 필요해요." }, 400);
  try {
    const { buf, mime } = await fetchImage(raw);
    if (url.searchParams.get("format") === "json") {
      return json({ ok: true, mimeType: mime, bytes: buf.length, dataUrl: "data:" + mime + ";base64," + toBase64(buf) });
    }
    return new Response(buf, {
      headers: {
        "content-type": mime,
        "cache-control": "public, max-age=3600",
        ...corsHeaders()
      }
    });
  } catch (error) {
    return json({ error: "image_proxy_failed", detail: error.message }, 502);
  }
}

async function handleAnalyzeFloorplan(env, request) {  let body;
  try { body = await request.json(); } catch { return json({ error: "invalid_json" }, 400); }
  if (!body || typeof body !== "object") return json({ error: "invalid_body" }, 400);

  let bytes = null;
  let mimeType = String(body.mimeType || "").trim();
  let imageUrl = "";

  if (body.imageBase64) {
    try { bytes = decodeBase64(body.imageBase64); } catch { return json({ error: "invalid_base64" }, 400); }
    if (!mimeType) mimeType = sniffMime(bytes) || "image/jpeg";
  } else if (body.imageUrl) {
    imageUrl = String(body.imageUrl);
    try {
      const got = await fetchImage(imageUrl);
      bytes = got.buf;
      mimeType = mimeType || got.mime;
    } catch (error) {
      return json({ error: "image_fetch_failed", detail: error.message }, 502);
    }
  } else {
    return json({ error: "image_required", detail: "imageBase64 또는 imageUrl 중 하나가 필요해요." }, 400);
  }

  if (!bytes || !bytes.length) return json({ error: "empty_image" }, 400);
  if (bytes.length > IMAGE_LIMIT) {
    return json({ error: "image_too_large", detail: "평면도 이미지는 6MB 이하만 분석할 수 있어요." }, 413);
  }

  const aiUrl = String(env.AI_ANALYZE_URL || DEFAULT_AI_URL);
  let upstream;
  try {
    const init = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        imageBase64: toBase64(bytes),
        mimeType,
        aptName: String(body.aptName || "").slice(0, 80)
      })
    };
    // 같은 계정의 Worker를 HTTP로 부르면 Cloudflare 1042로 막힌다 → Service binding 우선.
    if (env.AI_WORKER && typeof env.AI_WORKER.fetch === "function") {
      upstream = await env.AI_WORKER.fetch("https://ai.local/analyze-floorplan", init);
    } else {
      upstream = await fetch(aiUrl, init);
    }
  } catch (error) {
    return json({ error: "ai_unreachable", detail: String(error.message || error) }, 502);
  }

  const text = await upstream.text();
  let payload = {};
  try { payload = JSON.parse(text); } catch { payload = { error: "ai_bad_response", detail: text.slice(0, 300) }; }
  if (!upstream.ok || payload.error) {
    return json({
      error: "ai_failed",
      detail: payload.detail || payload.error || ("HTTP " + upstream.status),
      rooms: payload.rooms || []
    }, upstream.status >= 400 ? upstream.status : 502);
  }

  return json({
    ok: true,
    hasExplicitDimensions: !!payload.hasExplicitDimensions,
    summary: String(payload.summary || ""),
    rooms: (Array.isArray(payload.rooms) ? payload.rooms : []).map((r) => {
      const room = r && typeof r === "object" ? { ...r } : {};
      // 방 위치(전체 평면도 대비 %)가 오면 함께 넘겨 클라이언트가 평면도 위에서 방을 클릭할 수 있게 한다.
      const b = room.bbox && typeof room.bbox === "object" ? room.bbox : null;
      if (b) {
        let x = Number(b.x), y = Number(b.y), w = Number(b.w), h = Number(b.h);
        if ([x, y, w, h].every(Number.isFinite)) {
          if (Math.max(x, y, w, h) <= 1.0001) { x *= 100; y *= 100; w *= 100; h *= 100; }
          x = Math.max(0, Math.min(100, x)); y = Math.max(0, Math.min(100, y));
          w = Math.min(100 - x, Math.max(1, w)); h = Math.min(100 - y, Math.max(1, h));
          room.bbox = { x, y, w, h };
        } else delete room.bbox;
      }
      return room;
    }),
    model: payload.model || "",
    image: {
      mimeType,
      bytes: bytes.length,
      source: imageUrl || "upload",
      dataUrl: "data:" + mimeType + ";base64," + toBase64(bytes)
    }
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (origin && origin !== ALLOWED_ORIGIN) return json({ error: "Origin not allowed" }, 403);

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "").toLowerCase();

    if (path.endsWith("/floorplan-search")) {
      if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
      const aptParam = (url.searchParams.get("apt") || "").trim();
      const pyeongParam = (url.searchParams.get("pyeong") || "").trim();
      const areaParam = (url.searchParams.get("area") || "").trim();
      const customQuery = (url.searchParams.get("query") || "").trim();
      const cache = caches.default;
      const cacheKey = new Request("https://isafit-cache.invalid/fp/" + encodeURIComponent(((aptParam + "|" + pyeongParam + "|" + areaParam + "|" + customQuery).toLowerCase()).slice(0, 160)));
      if (!customQuery) {
        const hit = await cache.match(cacheKey);
        if (hit) return json(await hit.json());
      }
      try {
        const result = await floorplanSearch(env, { apt: aptParam, pyeong: pyeongParam, area: areaParam, query: customQuery });
        if (!customQuery) {
          await cache.put(cacheKey, new Response(JSON.stringify(result), {
            headers: { "content-type": "application/json", "cache-control": "max-age=" + CACHE_SECONDS }
          }));
        }
        return json(result);
      } catch (error) {
        return json({ error: "floorplan_search_failed", detail: error.message, failures: error.failures || [], items: [] }, 502);
      }
    }

    if (path.endsWith("/image-proxy")) {
      if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
      return handleImageProxy(url);
    }

    if (path.endsWith("/analyze-floorplan")) {
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
      return handleAnalyzeFloorplan(env, request);
    }

    if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
    if (path && path !== "/") return json({ error: "Not found" }, 404);

    return handleApartmentSearch(env, url);
  }
};
