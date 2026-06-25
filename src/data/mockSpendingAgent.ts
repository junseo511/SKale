import type {
  SpendingAgent,
  SpendingAnalysis,
  SpendingAnalysisRequest,
  SpendingCategory,
  SpendingProposal,
  TransactionNature,
} from '../domain/spending'

const DEFAULT_YEAR = 2026
const DEFAULT_MONTH = 6
const ANALYSIS_DELAY_MILLISECONDS = 650

interface Classification {
  merchant: string
  nature: TransactionNature
  category?: SpendingCategory
  confidence: number
  reason: string
}

export class MockSpendingAgent implements SpendingAgent {
  public async analyze(
    request: SpendingAnalysisRequest,
    signal: AbortSignal,
  ): Promise<SpendingAnalysis> {
    await waitForAnalysis(signal)

    const lines = request.input
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)

    const proposals = lines.map((line, index) =>
      createProposal(line, index, request.userFeedback),
    )

    return {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      proposals,
      insight:
        'AI가 거래 성격과 카테고리를 제안했습니다. 확정 전 각 항목의 근거와 신뢰도를 검토해 주세요.',
      actionItems: [
        '신뢰도가 낮은 항목은 사용처와 거래 목적을 확인하세요.',
        '투자·저축·이체는 일반 소비 합계에서 제외됩니다.',
      ],
      appliedFeedback: request.userFeedback?.trim() || undefined,
    }
  }
}

function waitForAnalysis(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(resolve, ANALYSIS_DELAY_MILLISECONDS)

    signal.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timeoutId)
        reject(new DOMException('분석이 취소되었습니다.', 'AbortError'))
      },
      { once: true },
    )
  })
}

function createProposal(
  rawText: string,
  index: number,
  userFeedback?: string,
): SpendingProposal {
  const amount = parseAmount(rawText)
  const classification = classifyTransaction(rawText, userFeedback)

  return {
    id: `${Date.now()}-${index}`,
    rawText,
    date: parseDate(rawText),
    merchant: classification.merchant,
    amount,
    nature: classification.nature,
    spendingCategory: classification.category,
    confidence: classification.confidence,
    needReview: classification.confidence < 0.75,
    reason: classification.reason,
    decision: 'pending',
    userNote: '',
  }
}

function parseAmount(rawText: string): number {
  const amountMatches = [...rawText.matchAll(/[\d,]+/g)]
  const amountText = amountMatches.at(-1)?.[0] ?? '0'
  return Number(amountText.replaceAll(',', ''))
}

function parseDate(rawText: string): string {
  const dateMatch = rawText.match(/(?:(\d{4})[./-])?(\d{1,2})[./-](\d{1,2})/)

  if (!dateMatch) {
    return `${DEFAULT_YEAR}-${String(DEFAULT_MONTH).padStart(2, '0')}-01`
  }

  const year = Number(dateMatch[1] ?? DEFAULT_YEAR)
  const month = Number(dateMatch[2])
  const day = Number(dateMatch[3])
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function classifyTransaction(
  rawText: string,
  userFeedback?: string,
): Classification {
  const normalizedText = `${rawText} ${userFeedback ?? ''}`.toLowerCase()

  if (includesAny(normalizedText, ['월세', '관리비', '통신비', '구독'])) {
    return classification('월세/고정비', 'fixedExpense', '고정비', 0.98, '정기적으로 발생하는 주거·통신 비용으로 판단했습니다.', rawText)
  }
  if (includesAny(normalizedText, ['증권', '주식', 'etf', '미래에셋'])) {
    return classification('증권 투자', 'investment', undefined, 0.96, '증권 계좌 또는 투자 상품 관련 거래로 판단했습니다.', rawText)
  }
  if (includesAny(normalizedText, ['적금', '예금', '청약'])) {
    return classification('저축', 'saving', undefined, 0.95, '저축성 금융 상품으로 이동한 금액으로 판단했습니다.', rawText)
  }
  if (includesAny(normalizedText, ['송금', '이체', '정산'])) {
    return classification('계좌 이체', 'transfer', undefined, 0.82, '소비가 아닌 계좌 이동 또는 정산으로 판단했습니다.', rawText)
  }
  if (includesAny(normalizedText, ['스타벅스', '카페', '커피', '식당', '배달'])) {
    return classification('식음료', 'expense', '식비/카페', 0.94, '카페 또는 음식점 이용으로 판단했습니다.', rawText)
  }
  if (includesAny(normalizedText, ['마트', '편의점', '쿠팡'])) {
    return classification('생활 구매', 'expense', '생활비', 0.68, '생활용품과 쇼핑 가능성이 모두 있어 확인이 필요합니다.', rawText)
  }
  if (includesAny(normalizedText, ['택시', '버스', '지하철', '주유'])) {
    return classification('교통', 'expense', '교통', 0.93, '이동 또는 차량 유지 비용으로 판단했습니다.', rawText)
  }
  if (includesAny(normalizedText, ['호텔', '항공', '여행', '숙박'])) {
    return classification('여행', 'expense', '여행', 0.91, '여행 또는 숙박 목적의 지출로 판단했습니다.', rawText)
  }

  return classification('사용처 확인 필요', 'unknown', '기타', 0.52, '거래 성격을 판단할 단서가 부족합니다.', rawText)
}

function classification(
  fallbackMerchant: string,
  nature: TransactionNature,
  category: SpendingCategory | undefined,
  confidence: number,
  reason: string,
  rawText: string,
): Classification {
  return {
    merchant: extractMerchant(rawText, fallbackMerchant),
    nature,
    category,
    confidence,
    reason,
  }
}

function extractMerchant(rawText: string, fallback: string): string {
  const withoutDate = rawText.replace(/(?:(\d{4})[./-])?\d{1,2}[./-]\d{1,2}/, '')
  const withoutAmount = withoutDate.replace(/[\d,]+\s*원?/g, '').trim()
  return withoutAmount || fallback
}

function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword))
}
