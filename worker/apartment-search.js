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

function findSidoCode(region) {
  return SIDO_CODES.find(([pattern]) => pattern.test(region))?.[1] || null;
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
      const normalizedRegion = region.replace(/특별자치도|특별자치시|특별시|광역시|도|시|군|구/g, "").toLocaleLowerCase("ko-KR");
      const matches = dataset.items.filter(item => {
        const name = item.kaptName.toLocaleLowerCase("ko-KR");
        const address = [item.as1, item.as2, item.as3, item.doroJuso].join(" ").toLocaleLowerCase("ko-KR");
        return name.includes(query) && (!normalizedRegion || address.replace(/\s/g, "").includes(normalizedRegion.replace(/\s/g, "")));
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
