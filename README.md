# SKale

> 월급을 받았다. 이제 어떻게 하지?

SKale은 월급을 필수 생활비, 부채·카드 결제, 비상금, 목표 자금, 여유 생활비, 장기 투자로 나누는 월급 의사결정 Agent입니다.

## 실행

```bash
npm install
npm run dev:web
```

기본 사용자 흐름은 브라우저 안에서만 계산되며 Gemini API를 호출하지 않습니다. 서버의 기존 AI 엔드포인트는 현재 UI에서 사용하지 않으며, `AI_ENABLED=true`를 명시적으로 설정하기 전에는 서버에서도 호출이 차단됩니다.

## 검증

```bash
npm run lint
npm run build
```

## 구조

- `src/domain/paydayPlan.ts`: 월급 배분과 포트폴리오 정책
- `src/data/localPaydayPlanRepository.ts`: 확정 계획의 로컬 저장
- `src/App.tsx`: 단일 사용자 여정 UI
- `guide`: 제품·흐름·AI 안전 원칙 문서

## 핵심 원칙

1. 쓸 돈을 먼저 확보합니다.
2. 지킬 돈을 투자금과 분리합니다.
3. 남은 돈만 장기 투자 대상으로 봅니다.
4. 사용자가 확정한 계획만 저장합니다.
5. AI는 계산을 대신하지 않으며 명시적 실행 없이 호출하지 않습니다.
