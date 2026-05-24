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

- **이미지 생성**: OpenAI `gpt-image-1` (b64_json 응답, 투명 배경)
- **저장소**: IndexedDB (`app/lib/storage.ts` — `idbGet`/`idbSet`)
  - localStorage는 5MB 한계로 이미지 저장 불가 → IndexedDB 사용
  - `vocab-words`: 입력 단어 목록
  - `vocab-results`: 생성된 이미지 포함 결과 배열
  - `vocab-card-statuses`: 카드별 승인 상태·코멘트
- **로컬 테스트용**: Gemini MCP (`mcp__gemini__gemini-generate-image`) — API 키 불필요

## 일러스트 스타일 가이드

`/Users/somi/teuida/Vocabulary/illustration_guide.md` 참조 (필수).
레퍼런스 이미지: `/Users/somi/teuida/Vocabulary/reference/` 하위 style/layout/character/color 폴더.

**핵심 원칙** (프롬프트에 항상 반영):
- fill(면)만 사용. stroke/outline/gradient/shadow 절대 금지
- 배경 #FFFFFF 고정
- 12색 팔레트 (route.ts STYLE_BASE에 전체 hex 명시됨)
- 단어 유형: Type A(사물), B(직업), C(동사/감정), D(자연/계절)

**꾸밈 요소 규칙** (2025-05 업데이트):
- 의미 강화할 때만 추가 (party→색종이, music→음표)
- 의류·음식·색상 등 실루엣으로 충분한 경우 생략

## 주요 API

- `POST /api/generate-image`
  - body: `{ word, type, feedback?, referenceImage? }`
  - referenceImage 없으면 `images.generate()`, 있으면 `images.edit()`
  - 응답: `{ image: "data:image/png;base64,..." }`

## 환경 변수 (Vercel에 설정됨)

- `OPENAI_API_KEY` — gpt-image-1 사용

## 알려진 이슈 / 주의사항

- 새로고침 후 데이터 유지: 같은 프로덕션 URL(vocab-illust.vercel.app)에서만 가능. Vercel 배포별 고유 URL은 IndexedDB 다름.
- 서버 저장 미구현: 다른 브라우저·기기에서는 데이터 공유 안 됨 (Vercel KV + Blob 연동 예정)
- 투명 배경: `images.generate()`에만 적용. `images.edit()`(레퍼런스 사용 시)는 배경 불투명.
