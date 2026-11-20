/**
 * Cloudflare Worker: secure proxy for the Korean public apartment complex list API.
 * Set DATA_GO_KR_SERVICE_KEY as a Worker secret. Never put the key in index.html.
 */
const UPSTREAM = "https://apis.data.go.kr/1613000/AptListService4/getTotalAptList4";
const ALLOWED_ORIGIN = "https://jinha4826-ship-it.github.io";
const CACHE_KEY = new Request("https://isafit-internal-cache.invalid/apartment-list-v1");

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

function extractItems(data) {
  const body = data?.response?.body || data?.body || {};
  const raw = body?.items?.item ?? body?.items ?? [];
  if (Array.isArray(raw)) return raw;
  return raw && typeof raw === "object" ? [raw] : [];
}

async function loadAllApartments(env) {
  const cache = caches.default;
  const cached = await cache.match(CACHE_KEY);
  if (cached) return cached.json();

  if (!env.DATA_GO_KR_SERVICE_KEY) throw new Error("Worker secret DATA_GO_KR_SERVICE_KEY is missing");

  const all = [];
  for (let pageNo = 1; pageNo <= 30; pageNo++) {
    const url = new URL(UPSTREAM);
    url.searchParams.set("serviceKey", env.DATA_GO_KR_SERVICE_KEY);
    url.searchParams.set("pageNo", String(pageNo));
    url.searchParams.set("numOfRows", "1000");

    const response = await fetch(url.toString(), { headers: { "Accept": "application/json" } });
    if (!response.ok) throw new Error("Public apartment API returned HTTP " + response.status);
    const data = await response.json();
    const header = data?.response?.header || data?.header || {};
    if (header.resultCode && header.resultCode !== "00") {
      throw new Error(header.resultMsg || "Public apartment API error");
    }
    const items = extractItems(data);
    all.push(...items);
    const total = Number(data?.response?.body?.totalCount ?? data?.body?.totalCount ?? 0);
    if (!items.length || (total && all.length >= total) || items.length < 1000) break;
  }

  const cleaned = all.map(x => ({
    kaptCode: x.kaptCode || "",
    kaptName: x.kaptName || "",
    bjdCode: x.bjdCode || "",
    as1: x.as1 || "",
    as2: x.as2 || "",
    as3: x.as3 || "",
    doroJuso: x.doroJuso || ""
  })).filter(x => x.kaptName);

  const cacheResponse = new Response(JSON.stringify(cleaned), {
    headers: { "content-type": "application/json", "cache-control": "public, max-age=21600" }
  });
  await cache.put(CACHE_KEY, cacheResponse);
  return cleaned;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "access-control-allow-origin": ALLOWED_ORIGIN,
          "access-control-allow-methods": "GET, OPTIONS",
          "access-control-allow-headers": "Content-Type",
          "access-control-max-age": "86400"
        }
      });
    }
    if (origin && origin !== ALLOWED_ORIGIN) return json({ error: "Origin not allowed" }, 403);
    if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);

    const url = new URL(request.url);
    const query = (url.searchParams.get("q") || "").trim().toLocaleLowerCase("ko-KR");
    const region = (url.searchParams.get("region") || "").trim().toLocaleLowerCase("ko-KR");
    if (query.length < 2) return json({ error: "Enter at least two characters", items: [] }, 400);

    try {
      const all = await loadAllApartments(env);
      const matches = all.filter(item => {
        const nameMatch = item.kaptName.toLocaleLowerCase("ko-KR").includes(query);
        const regionText = [item.as1, item.as2, item.as3, item.doroJuso].join(" ").toLocaleLowerCase("ko-KR");
        return nameMatch && (!region || regionText.includes(region.toLocaleLowerCase("ko-KR")));
      }).slice(0, 30);
      return json({ items: matches, count: matches.length, source: "국토교통부 공동주택 단지 목록" });
    } catch (error) {
      return json({ error: "Apartment search failed", detail: error.message, items: [] }, 502);
    }
  }
};
