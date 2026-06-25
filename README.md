# SKale

> 월급을 받았다. 이제 어떻게 하지?

SKale은 사용자와 대화하며 과거 월 사용내역과 소비 취향을 이해하고, 월급을 필수 생활비, 부채·카드 결제, 비상금, 목표 자금, 여유 생활비, 장기 투자로 나누는 월급 의사결정 Agent입니다.

## 실행

```bash
npm install
npm run dev:web
```

월급 배분 계산은 브라우저 안의 도메인 규칙이 수행합니다. 대화와 과거 사용내역 분석은 사용자가 `Agent에게 보내기`를 누를 때만 서버로 전송되며, `AI_ENABLED=true`를 명시적으로 설정하기 전에는 Gemini 호출이 차단됩니다.

## 검증

```bash
npm run lint
npm run build
```

## 구조

- `src/domain/paydayConversation.ts`: 대화, 재무 프로필, 월별 사용 요약 계약
- `src/domain/paydayPlan.ts`: 월급 배분과 포트폴리오 정책
- `src/domain/netSalary.ts`: 2026년 기준 월 실수령액 모의계산
- `src/data/httpPaydayConversationAgent.ts`: 명시적 채팅 요청
- `src/data/localPaydayWorkspaceRepository.ts`: 승인된 대화 컨텍스트 저장
- `src/data/localPaydayPlanRepository.ts`: 확정 계획의 로컬 저장
- `src/App.tsx`: 단일 사용자 여정 UI
- `guide`: 제품·흐름·AI 안전 원칙 문서

## 핵심 원칙

1. 쓸 돈을 먼저 확보합니다.
2. 지킬 돈을 투자금과 분리합니다.
3. 남은 돈만 장기 투자 대상으로 봅니다.
4. 사용자가 확정한 계획만 저장합니다.
5. AI가 추출한 값은 사용자가 적용해야만 프로필에 반영됩니다.
6. AI는 계산을 대신하지 않으며 명시적 전송 없이 호출하지 않습니다.
