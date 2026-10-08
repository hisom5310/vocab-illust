@AGENTS.md

# vocab-illust 프로젝트

TEUIDA 보캡 일러스트 일괄 생성 웹툴. 단어 목록을 입력하면 OpenAI gpt-image-1로 플래시카드용 일러스트를 배치 생성하고 검토·다운로드하는 내부 도구.

- **배포**: https://vocab-illust.vercel.app (Vercel, 무료)
- **GitHub**: https://github.com/hisom5310/vocab-illust
- **로컬 실행**: `npm run dev`

## 페이지 구조

```
/ (홈)          단어 입력 (텍스트 직접 입력 or CSV/TXT 파일 업로드)
/generate       배치 생성 진행 화면 → 완료 시 /review 자동 이동
/review         생성 결과 검토·승인·재생성·다운로드 (메인 화면)
```

## 핵심 기술 결정

- **이미지 생성**: OpenAI `gpt-image-1.5` (b64_json 응답, 투명 배경)
  - gpt-image-1은 2026-10-23 지원 종료 예정이라 gpt-image-1.5로 마이그레이션함
  - gpt-image-2는 투명 배경(`background: 'transparent'`) 자체를 지원하지 않아 제외 (요청 시 400 에러, 미지정 시 체커보드 무늬를 opaque 픽셀로 그림)
- **저장소**: Vercel Blob이 원본 (`app/lib/blobStore.ts`). 브라우저·기기와 무관하게 팀 전체가 같은 데이터를 봄
  - `v2/cards/{코스slug}/{카드key}/{timestamp}-{status}.json` 카드 상태 스냅샷 (저장마다 새 파일 → 이전 것 삭제, CDN 캐시 문제 회피)
  - `v2/images/{코스slug}/{카드key}/{timestamp}.png` 생성된 모든 이미지 (재생성해도 이전 버전 유지)
  - 카드 상태: queued(생성 대기) / pending(검토 대기) / approved(그대로 사용) / edited(수정해서 사용) / redrawn(직접 제작), 삭제는 휴지통(soft delete)
  - IndexedDB(`app/lib/storage.ts`)는 v1 데이터 이전용으로만 남음 (검토 화면 첫 방문 시 자동 이전)
- **로컬 테스트용**: Gemini MCP (`mcp__gemini__gemini-generate-image`) — API 키 불필요

## 일러스트 스타일 가이드

`/Users/somi/teuida/Vocabulary/illustration_guide.md` 참조 (필수).
레퍼런스 이미지: `/Users/somi/teuida/Vocabulary/reference/` 하위 style/layout/character/color 폴더.

**핵심 원칙** (프롬프트에 항상 반영):
- fill(면)만 사용. stroke/outline/gradient/shadow 절대 금지
- 배경 #FFFFFF 고정
- 12색 팔레트 (route.ts STYLE_BASE에 전체 hex 명시됨)
- 단어 유형: Type A(사물), B(직업), C(동사/감정), D(자연/계절)

**꾸밈 요소 규칙** (2026-10 업데이트, Figma ESEN Unit 16 최종본 기준):
- 단어를 분명하게 하거나 같은 세트의 비슷한 단어와 구분해 주는 소품 1~3개 추가 (장소→나무·구름, 배→갈매기, 숙소 종류→구분 요소)
- 같은 세트 안에서 사물만으로 구분이 확실할 때만 생략
- 글자 자리는 빈 칸 (글자는 디자이너가 Figma에서 입력), 손은 필요할 때만 — 상세는 auto memory `illustration-style-decisions`

## 주요 API

- `POST /api/queue` — body `{ course: "ESEN Unit 17", words: [{ id, en, ko, kr?, type }] }` → 카드를 queued로 만들고 `{ url: /generate?course=... }` 반환. 이미 있는 id는 건너뜀
- `POST /api/generate-image` — body `{ word, type, course?, unitWords?, feedback?, referenceImage?, series?, store?: { course, cardId } }`
  - store 있으면 Blob에 저장하고 `{ imageUrl }`, 없으면 `{ image: data URL }`
  - 후처리(`app/lib/postprocess.ts`): 단색 배경 보정 → 그라데이션 평탄화 → 흰 배경 제거 → 8% 여백으로 크기 맞춤
- `GET /api/courses`, `GET /api/courses/{slug}`, `PUT /api/cards` — 코스 목록 / 코스 카드 / 카드 저장

## 환경 변수 (Vercel에 설정됨)

- `OPENAI_API_KEY` — gpt-image-1 사용

## 알려진 이슈 / 주의사항

- 프리뷰 배포도 같은 Blob 저장소를 씀 → 프리뷰에서 테스트하면 실제 데이터에 반영됨
- 투명 배경: gpt-image-1.5는 `images.generate()`·`images.edit()` 둘 다 `background: 'transparent'` + `output_format: 'png'`를 함께 넘겨야 실제 알파 투명이 적용됨 (하나만 넘기면 opaque로 나오거나 alpha=0 전체로 깨짐).
