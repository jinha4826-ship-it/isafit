# 이사핏 (ISAFIT)

내 가구가 후보 집의 공간에 들어가는지 이사 전에 확인하는 정적 웹앱 MVP입니다.

- 라이브: https://jinha4826-ship-it.github.io/isafit/ (캐시 우회 `?v=...`)

## 실행
GitHub Pages에서 `main` 브랜치의 `/(root)`를 배포 대상으로 선택하면 됩니다. 빌드 과정 없이 `index.html` 하나로 작동합니다.

## 기능
- 이사 프로젝트 생성 및 지역/이사일/메모 기록
- 아파트 단지 자동 검색(국토교통부 공동주택 단지 목록)
- **단지 선택 → `[🔍 도면 자동 불러오기]` → 앱 안에 평면도 후보 6장 카드 표시**
- **후보를 누르면 AI가 방·치수를 읽어 공간 목록과 캔버스 배경 도면을 한 번에 채움**
- **평면도 이미지 파일 업로드 → `[✨ AI로 방·치수 자동 인식]`**
- **도면에 치수 숫자가 있으면 그대로 읽고(도면 치수 직접 인식), 없으면 문 폭·가구 비율로 추정해 `(추정)` 표시**
- `[네이버에서 평면도 찾기]` 외부 링크(백업용)
- 공간 추가·이름/치수(mm) 수정, 공간별 도면 배경 업로드
- 가구 보관함(종류·가로·세로·높이) 및 2D 캔버스 배치·드래그·90도 회전
- 가구 겹침·방 경계 초과 검사, 인쇄 리포트, JSON 백업/불러오기
- 브라우저 localStorage 저장, 로그인/서버 불필요

## 사용 시 참고
- 가구를 선택하면 회전 및 삭제 버튼이 활성화됩니다.
- 도면은 공간 비율에 맞춰 표시되며, 모바일 화면에서도 크기를 조정합니다.
- AI 인식 결과는 공간 목록에서 바로 수정할 수 있고, `이 공간에 적용`으로 이름·치수를 바꿉니다.

## 주의 및 한계
검사는 입력한 방 경계와 가구 직사각형 외곽 치수만 비교합니다. 문·창문·벽 두께·기둥·콘센트·운반 경로, PDF 도면 업로드, 여러 후보 주택 간 종합 비교는 지원하지 않습니다. AI 인식은 Gemini Vision 결과이므로 도면이 흐리거나 여러 타입이 한 장에 들어 있으면 부정확할 수 있습니다. **치수는 실제 도면·현장에서 다시 확인**해 주세요.

## 기술
HTML, CSS, Vanilla JavaScript, Canvas 2D, localStorage, Cloudflare Worker + Gemini Vision.

## API (Cloudflare Worker `isafit-apartment-api`)

앱은 `https://isafit-apartment-api.cba4826.workers.dev` 하나만 호출합니다(주소는 `index.html` 상수로 고정, 사용자 설정 없음).

| 엔드포인트 | 설명 |
|---|---|
| `GET /?q=푸르지오&region=경남 김해시` | 국토교통부 단지 목록 검색(시·도 단위 캐시) |
| `GET /floorplan-search?apt=부원역푸르지오&pyeong=84㎡&area=경상남도 김해시 부원동` | 평면도 후보 이미지 6장. 검색어는 `"단지명" 지역 평형 평면도`로 만들고 1시간 캐시 |
| `GET /image-proxy?url=...` | 외부 이미지 CORS 프록시(`format=json`이면 data URL) |
| `POST /analyze-floorplan` | `{ imageBase64 \| imageUrl, mimeType, aptName }` → `{ hasExplicitDimensions, summary, rooms:[{name,w,d,estimated}], image:{dataUrl} }` |

분석은 같은 계정의 `maeum-bingsan-ai` Worker `/analyze-floorplan`(v10, Gemini Vision)이 수행하고, 이 Worker는 **Service binding `AI_WORKER`** 로 호출합니다. (같은 계정 Worker를 HTTP로 부르면 Cloudflare `1042` 오류가 납니다.)

### Worker secrets
| 이름 | 용도 |
|---|---|
| `DATA_GO_KR_SERVICE_KEY` | 국토교통부 단지 목록 API |
| `GOOGLE_SEARCH_API_KEY`, `GOOGLE_CSE_ID` | Google Programmable Search(이미지) — 현재 403, 아래 참고 |
| `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` | 네이버 개발자센터 검색 API(기존 발급자만, 2027-06-30 종료) |
| `NCP_API_KEY_ID`, `NCP_API_KEY` | NAVER API HUB(NCP) 자격증명 |
| `AI_ANALYZE_URL` (선택) | 분석 엔드포인트 재정의 |

`/floorplan-search`는 설정된 자격증명을 **네이버 개발자센터 → NCP → Google → Bing → DuckDuckGo** 순으로 시도하고, 모두 실패하면 오류를 반환합니다.

### 이미지 검색 제공자 현황 (2026-11-21 실측)
- **네이버 개발자센터 검색 API**: 2026-07-31부터 신규 신청 불가(공지 developers.naver.com/notice/article/32530). 대안은 NCP NAVER API HUB이며 **가입·실명인증·카드 등록이 필요**(검색 API는 무료, 일 25,000회).
- **Google Custom Search JSON API**: 2026-01-20부터 신규 고객 종료. 신규 프로젝트는 `403 This project does not have the access to Custom Search JSON API`가 계속되며 2027-01-01 전면 종료 예정.
- 따라서 지금은 **키가 필요 없는 Bing 이미지 + DuckDuckGo 폴백**으로 동작합니다(비공식, 차단될 수 있음). 품질·안정성을 높이려면 NCP(네이버) 또는 Serper 같은 API 키를 secrets에 넣으면 코드 수정 없이 자동 전환됩니다.

공식 단지 API: https://www.data.go.kr/data/15057332/openapi.do
