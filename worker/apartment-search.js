/**
 * Cloudflare Worker: apartment search proxy for 국토교통부 AptListService4.
 * Worker secret: DATA_GO_KR_SERVICE_KEY (URL-decoded key recommended).
 * Search is scoped to the selected province using getSidoAptList4, then
 * filtered locally by apartment name and region. Results are cached for 1 hour.
 */
const BASE = "https://apis.data.go.kr/1613000/AptListService4";
const ALLOWED_ORIGIN = "https://jinha4826-ship-it.github.io";
const PAGE_SIZE = 1000;
const MAX_PAGES = 20;
const CACHE_SECONDS = 3600;

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

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": ALLOWED_ORIGIN,
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "Content-Type",
      "cache-control": "no-store",
      "vary": "Origin"
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

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: {
        "access-control-allow-origin": ALLOWED_ORIGIN,
        "access-control-allow-methods": "GET, OPTIONS",
        "access-control-allow-headers": "Content-Type",
        "access-control-max-age": "86400"
      }});
    }
    if (origin && origin !== ALLOWED_ORIGIN) return json({ error: "Origin not allowed" }, 403);
    if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);

    const url = new URL(request.url);
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
};
