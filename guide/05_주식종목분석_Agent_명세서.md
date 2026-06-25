# 05. 주식 종목 분석 Agent 명세서

## 1. 기능 개요

주식 종목 분석 Agent는 사용자가 입력한 종목명, 사업 설명, 재무 데이터, 밸류에이션 정보를 바탕으로 `stock_strategy_간소화` 기준에 따라 종목을 점수화한다.

이 기능은 실제 매수/매도 추천이 아니라, 사용자가 관심 종목을 **검토 후보로 볼 수 있는지** 판단하도록 돕는 분석 도구이다.

---

## 2. 핵심 원칙

1. 사용자가 제공하지 않은 최신 재무 정보는 지어내지 않는다.
2. 데이터가 부족하면 부족한 항목을 명확히 표시한다.
3. 매수/매도/보유 지시를 하지 않는다.
4. 종목명만 입력된 경우에는 분석하지 않고 필요한 데이터를 요청한다.
5. 점수는 확정 투자 판단이 아니라 전략 적합도 점수이다.
6. 투자 고지 문구를 항상 포함한다.

---

## 3. 입력 필드

```typescript
export interface StockAnalysisRequest {
  companyName: string;
  ticker?: string;
  market?: string;
  industryDescription?: string;
  businessDescription?: string;
  revenueTrend?: string;
  grossMarginTrend?: string;
  operatingMarginTrend?: string;
  operatingCashFlowTrend?: string;
  freeCashFlowTrend?: string;
  debtCondition?: string;
  inventoryReceivablesTrend?: string;
  valuationData?: string;
  managementNotes?: string;
  userConcern?: string;
}
```

---

## 4. 출력 필드

```typescript
export type StockVerdict =
  | "핵심 검토 후보"
  | "좋은 후보"
  | "관찰 후보"
  | "보류"
  | "제외"
  | "데이터 부족";

export interface StockAnalysisResult {
  companyName: string;
  ticker?: string;
  verdict: StockVerdict;
  totalScore: number | null;
  scoreBreakdown: {
    industryStructure: number | null;
    competitiveAdvantage: number | null;
    financialQuality: number | null;
    valuation: number | null;
    managementCapitalAllocation: number | null;
    riskControl: number | null;
  };
  oneSentenceThesis: string;
  strengths: string[];
  weaknesses: string[];
  fatalFlags: string[];
  missingData: string[];
  assumptions: string[];
  questionsToCheck: string[];
  monitoringMetrics: string[];
  nextAction: string;
  disclaimer: string;
}
```

---

## 5. 점수화 기준

| 영역 | 배점 | 핵심 질문 |
|---|---:|---|
| 산업 구조 | 25 | 5~10년 구조적 성장 산업인가? |
| 경쟁우위/밸류체인 | 20 | 산업 내 이익이 집중되는 위치인가? |
| 재무제표 | 25 | 성장, 마진, 현금흐름, 부채가 건강한가? |
| 밸류에이션 | 15 | 성장 대비 가격이 과도하게 선반영되지 않았는가? |
| 경영진/자본배분 | 10 | 현금을 주주에게 유리하게 배분하는가? |
| 리스크 관리 | 5 | 틀렸을 때 알 수 있는 기준이 있는가? |

---

## 6. 판정 로직

```text
데이터 부족:
- 재무 데이터가 거의 없거나, 산업/사업 설명만 있는 경우

제외:
- 치명적 제외 조건이 1개 이상 강하게 확인되는 경우

보류:
- 산업은 좋아 보이나 재무/가격/리스크가 불명확한 경우

관찰 후보:
- 65~74점. 스토리는 있으나 숫자 확인 필요

좋은 후보:
- 75~84점. 일부 리스크를 확인하면 검토 가능

핵심 검토 후보:
- 85점 이상. 단, 가격과 리스크 재확인 필요
```

---

## 7. 치명적 제외 조건

- 영업현금흐름이 지속적으로 마이너스이다.
- 매출 성장에도 재고와 매출채권이 급증한다.
- 부채 또는 이자비용을 감당하기 어렵다.
- 유상증자, 전환사채, 신주인수권부사채 발행이 반복된다.
- 산업은 성장하지만 기업이 단순 하청 위치이다.
- 밸류에이션이 지나치게 과열되어 기대수익률이 낮다.
- 사업 설명이 지나치게 복잡하고 핵심 수익 구조가 불명확하다.

---

## 8. UI 구성

### 입력 영역

- 종목명
- 티커
- 산업 설명
- 사업 설명
- 최근 재무 데이터
- 밸류에이션 데이터
- 우려되는 점
- 예시 데이터 불러오기
- 전략 기준으로 분석하기

### 결과 영역

- 종합 판정 카드
- 총점 카드
- 확인 필요 데이터 카드
- 영역별 점수 차트
- 한 문장 투자 논리
- 강점/약점
- 치명적 리스크
- 다음 확인 질문
- 추적 지표
- 투자 고지 문구

---

## 9. 프롬프트 예시

```text
다음 종목 정보를 바탕으로 SKale의 간소화된 stock_strategy 기준에 따라 분석하라.

분석 원칙:
- 제공된 정보만 사용한다.
- 제공되지 않은 최신 실적, 주가, 밸류에이션은 추정하지 않는다.
- 데이터가 부족하면 missingData에 표시한다.
- 매수/매도/보유 지시를 하지 않는다.
- 판정은 핵심 검토 후보, 좋은 후보, 관찰 후보, 보류, 제외, 데이터 부족 중 하나로 한다.
- 결과는 JSON으로만 반환한다.

평가 기준:
산업 구조 25점, 경쟁우위/밸류체인 20점, 재무제표 25점, 밸류에이션 15점, 경영진/자본배분 10점, 리스크 관리 5점.

종목 정보:
{userInput}
```

---

## 10. 예시 결과

```json
{
  "companyName": "예시반도체장비",
  "ticker": "000000",
  "verdict": "관찰 후보",
  "totalScore": 72,
  "scoreBreakdown": {
    "industryStructure": 20,
    "competitiveAdvantage": 15,
    "financialQuality": 16,
    "valuation": 9,
    "managementCapitalAllocation": 8,
    "riskControl": 4
  },
  "oneSentenceThesis": "AI 인프라 확대에 따라 수요가 증가하는 산업에 속하지만, 현금흐름과 밸류에이션 확인이 필요한 기업입니다.",
  "strengths": [
    "구조적 성장 산업과 연결되어 있습니다.",
    "밸류체인 내 장비 공급 위치에 있습니다."
  ],
  "weaknesses": [
    "최근 3년 영업현금흐름 데이터가 부족합니다.",
    "현재 가격이 성장 기대를 얼마나 반영했는지 확인이 필요합니다."
  ],
  "fatalFlags": [],
  "missingData": [
    "최근 3년 영업현금흐름",
    "자유현금흐름",
    "현재 PER 또는 EV/EBITDA"
  ],
  "assumptions": [
    "사용자가 제공한 산업 설명이 사실이라는 전제에서 평가했습니다."
  ],
  "questionsToCheck": [
    "수주 증가가 실제 매출과 영업현금흐름으로 전환되고 있는가?",
    "고객사 CAPEX 둔화 시 매출 방어력이 있는가?"
  ],
  "monitoringMetrics": [
    "매출 성장률",
    "매출총이익률",
    "영업현금흐름",
    "재고 증가율",
    "수주잔고"
  ],
  "nextAction": "최근 사업보고서 또는 재무 요약 데이터를 입력한 뒤 재분석하는 것이 좋습니다.",
  "disclaimer": "본 결과는 사용자가 제공한 정보에 기반한 참고용 분석이며 실제 투자 판단은 사용자의 책임하에 이루어져야 합니다."
}
```
