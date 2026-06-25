import 'dotenv/config'

import { GoogleGenAI } from '@google/genai'
import cors from 'cors'
import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express'
import { z } from 'zod'

const DEFAULT_PORT = 8787
const DEFAULT_MODEL = 'gemini-2.5-flash'
const CONFIDENCE_REVIEW_THRESHOLD = 0.75
const MAX_IMAGE_COUNT = 4
const MAX_IMAGE_BYTES = 4 * 1024 * 1024

const imageAttachmentSchema = z.object({
  name: z.string().trim().min(1).max(200),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/heic']),
  data: z.string().min(1),
})

const spendingAnalysisRequestSchema = z.object({
  input: z.string().trim().max(20_000),
  userFeedback: z.string().trim().max(2_000).optional(),
  images: z.array(imageAttachmentSchema).max(MAX_IMAGE_COUNT).default([]),
}).refine((request) => request.input.length > 0 || request.images.length > 0, {
  message: '소비 내역 또는 이미지가 필요합니다.',
})

const assetAnalysisRequestSchema = z.object({
  input: z.string().trim().min(1).max(20_000),
  userFeedback: z.string().trim().max(2_000).optional(),
})

const portfolioAnalysisRequestSchema = z.object({
  riskProfile: z.enum(['안정형', '중립형', '공격형']),
  investmentPeriod: z.enum(['1년 미만', '1~3년', '3년 이상']),
  monthlyInvestmentAmount: z.number().nonnegative(),
  interests: z.string().trim().max(1_000),
  strategy: z.string().trim().max(5_000),
  assetContext: z.string().trim().max(5_000),
  userFeedback: z.string().trim().max(2_000).optional(),
})

const stockAnalysisRequestSchema = z.object({
  companyName: z.string().trim().min(1).max(200),
  ticker: z.string().trim().max(50).optional(),
  industryDescription: z.string().trim().max(5_000),
  businessDescription: z.string().trim().max(5_000),
  financialData: z.string().trim().max(10_000),
  valuationData: z.string().trim().max(5_000),
  managementNotes: z.string().trim().max(5_000),
  userConcern: z.string().trim().max(5_000),
  userFeedback: z.string().trim().max(2_000).optional(),
})

const spendingAnalysisSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    proposals: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          rawText: { type: 'string' },
          date: { type: 'string' },
          merchant: { type: 'string' },
          amount: { type: 'number' },
          nature: {
            type: 'string',
            enum: ['expense', 'fixedExpense', 'saving', 'investment', 'transfer', 'income', 'unknown'],
          },
          spendingCategory: {
            type: ['string', 'null'],
            enum: ['고정비', '생활비', '식비/카페', '교통', '쇼핑', '여행', '의료/건강', '데이트', '기타', null],
          },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          reason: { type: 'string', minLength: 1 },
        },
        required: ['rawText', 'date', 'merchant', 'amount', 'nature', 'spendingCategory', 'confidence', 'reason'],
      },
    },
    insight: { type: 'string' },
    actionItems: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 4 },
  },
  required: ['proposals', 'insight', 'actionItems'],
} as const

const assetAnalysisSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    proposals: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          rawText: { type: 'string' },
          name: { type: 'string' },
          amount: { type: 'number', minimum: 0 },
          category: {
            type: 'string',
            enum: ['반복 수입', '필수 지출', '현금성 자산', '저축성 자산', '투자 자산', '목적 자금', '부채/미결제', '기타'],
          },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          reason: { type: 'string' },
        },
        required: ['rawText', 'name', 'amount', 'category', 'confidence', 'reason'],
      },
    },
    healthStatus: { type: 'string', enum: ['양호', '주의', '확인 필요'] },
    insight: { type: 'string' },
    actionItems: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 4 },
    missingData: { type: 'array', items: { type: 'string' }, maxItems: 6 },
    payday: { type: ['string', 'null'] },
    salaryAllocations: {
      type: 'array',
      maxItems: 7,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          category: {
            type: 'string',
            enum: ['필수 생활비', '부채/카드 결제', '비상금', '목적 자금', '저축', '투자', '여유 자금'],
          },
          amount: { type: 'number', minimum: 0 },
          reason: { type: 'string' },
        },
        required: ['category', 'amount', 'reason'],
      },
    },
    allocationInsight: { type: 'string' },
  },
  required: ['proposals', 'healthStatus', 'insight', 'actionItems', 'missingData', 'payday', 'salaryAllocations', 'allocationInsight'],
} as const

const portfolioAnalysisSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    allocations: {
      type: 'array',
      minItems: 2,
      maxItems: 7,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          assetClass: { type: 'string' },
          percentage: { type: 'number', minimum: 0, maximum: 100 },
          reason: { type: 'string' },
          riskNote: { type: 'string' },
        },
        required: ['assetClass', 'percentage', 'reason', 'riskNote'],
      },
    },
    strategyFit: { type: 'string' },
    priority: { type: 'string' },
    riskComment: { type: 'string' },
    actionItems: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 4 },
    missingData: { type: 'array', items: { type: 'string' }, maxItems: 6 },
    disclaimer: { type: 'string' },
  },
  required: ['allocations', 'strategyFit', 'priority', 'riskComment', 'actionItems', 'missingData', 'disclaimer'],
} as const

const nullableScore = (maximum: number) => ({
  type: ['number', 'null'],
  minimum: 0,
  maximum,
})

const stockAnalysisSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    companyName: { type: 'string' },
    ticker: { type: ['string', 'null'] },
    verdict: {
      type: 'string',
      enum: ['핵심 검토 후보', '좋은 후보', '관찰 후보', '보류', '제외', '데이터 부족'],
    },
    scoreBreakdown: {
      type: 'object',
      additionalProperties: false,
      properties: {
        industryStructure: nullableScore(25),
        competitiveAdvantage: nullableScore(20),
        financialQuality: nullableScore(25),
        valuation: nullableScore(15),
        managementCapitalAllocation: nullableScore(10),
        riskControl: nullableScore(5),
      },
      required: ['industryStructure', 'competitiveAdvantage', 'financialQuality', 'valuation', 'managementCapitalAllocation', 'riskControl'],
    },
    oneSentenceThesis: { type: 'string' },
    strengths: { type: 'array', items: { type: 'string' }, maxItems: 6 },
    weaknesses: { type: 'array', items: { type: 'string' }, maxItems: 6 },
    fatalFlags: { type: 'array', items: { type: 'string' }, maxItems: 6 },
    missingData: { type: 'array', items: { type: 'string' }, maxItems: 10 },
    assumptions: { type: 'array', items: { type: 'string' }, maxItems: 6 },
    questionsToCheck: { type: 'array', items: { type: 'string' }, maxItems: 8 },
    monitoringMetrics: { type: 'array', items: { type: 'string' }, maxItems: 8 },
    nextAction: { type: 'string' },
    disclaimer: { type: 'string' },
  },
  required: ['companyName', 'ticker', 'verdict', 'scoreBreakdown', 'oneSentenceThesis', 'strengths', 'weaknesses', 'fatalFlags', 'missingData', 'assumptions', 'questionsToCheck', 'monitoringMetrics', 'nextAction', 'disclaimer'],
} as const

type SpendingOutput = {
  proposals: Array<{
    rawText: string
    date: string
    merchant: string
    amount: number
    nature: string
    spendingCategory: string | null
    confidence: number
    reason: string
  }>
  insight: string
  actionItems: string[]
}

const app = express()
const port = Number(process.env.PORT ?? DEFAULT_PORT)
const allowedOrigin = process.env.ALLOWED_ORIGIN

app.use(cors({
  origin: allowedOrigin ? allowedOrigin.split(',').map((origin) => origin.trim()) : true,
}))
app.use(express.json({ limit: '24mb' }))

app.get('/api/health', (_request: Request, response: Response) => {
  response.json({ status: 'ok', aiConfigured: Boolean(process.env.AI_API_KEY) })
})

app.post('/api/spending/analyze', async (request, response, next) => {
  try {
    const parsedRequest = spendingAnalysisRequestSchema.safeParse(request.body)
    if (!parsedRequest.success) {
      response.status(400).json({ message: parsedRequest.error.issues[0]?.message ?? '소비 분석 요청 형식이 올바르지 않습니다.' })
      return
    }

    validateImageSizes(parsedRequest.data.images)
    const { client, model } = createModelClient()
    const { input, images, userFeedback } = parsedRequest.data
    const contents = [
      {
        role: 'user',
        parts: [
          {
            text: [
              `텍스트 소비 내역:\n${input || '(없음)'}`,
              userFeedback ? `\n사용자 수정 요청:\n${userFeedback}` : '',
              '\n첨부 이미지와 텍스트에 같은 거래가 반복되면 반드시 한 건만 반환하라.',
            ].join(''),
          },
          ...images.map((image) => ({
            inlineData: { mimeType: image.mimeType, data: image.data },
          })),
        ],
      },
    ]
    const modelResponse = await client.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction: [
          '너는 개인 자산관리 Agent SKale의 소비 분석 역할이다.',
          '사용자가 제공한 텍스트와 이미지에서 확인되는 거래만 추출하고 숫자나 날짜를 지어내지 않는다.',
          '같은 날짜, 같은 금액, 같거나 유사한 사용처의 거래는 입력 출처가 달라도 중복으로 간주해 한 번만 반환한다.',
          '이미지 OCR이 불확실하면 confidence를 낮추고 reason에 확인할 내용을 적는다.',
          '투자, 저축, 이체, 수입은 일반 소비로 분류하지 않는다.',
          `현재 날짜는 ${new Date().toISOString().slice(0, 10)}이다. 연도가 없는 날짜는 현재 연도로 해석한다.`,
          '각 reason에는 분류 근거를 반드시 한 문장 이상 작성한다.',
          '판단은 제안이며 사용자가 최종 검토한다.',
        ].join('\n'),
        responseMimeType: 'application/json',
        responseJsonSchema: spendingAnalysisSchema,
        temperature: 0.1,
        maxOutputTokens: 4_000,
      },
    })
    const analysis = parseModelJson<SpendingOutput>(modelResponse.text)
    const normalizedProposals = analysis.proposals.map((proposal) => ({
      ...proposal,
      date: normalizeTransactionDate(proposal.rawText, proposal.date),
      reason: proposal.reason.trim() || '거래명과 입력 맥락을 기준으로 분류했습니다.',
    }))
    const deduplicated = deduplicateTransactions(normalizedProposals)

    response.json({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      proposals: deduplicated.unique.map((proposal) => ({
        ...proposal,
        id: crypto.randomUUID(),
        spendingCategory: proposal.spendingCategory ?? undefined,
        needReview: proposal.confidence < CONFIDENCE_REVIEW_THRESHOLD,
        decision: 'pending',
        userNote: '',
      })),
      duplicateCount: deduplicated.duplicateCount,
      insight: analysis.insight,
      actionItems: analysis.actionItems,
      appliedFeedback: userFeedback || undefined,
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/assets/analyze', async (request, response, next) => {
  try {
    const parsedRequest = assetAnalysisRequestSchema.safeParse(request.body)
    if (!parsedRequest.success) {
      response.status(400).json({ message: '자산 현황 또는 수정 요청 형식이 올바르지 않습니다.' })
      return
    }

    const { client, model } = createModelClient()
    const { input, userFeedback } = parsedRequest.data
    const modelResponse = await client.models.generateContent({
      model,
      contents: [
        `자산 현황:\n${input}`,
        userFeedback ? `\n사용자 수정 요청:\n${userFeedback}` : '',
      ].join(''),
      config: {
        systemInstruction: [
          '너는 개인 자산관리 Agent SKale의 자산 분석 역할이다.',
          '사용자가 제공한 항목과 금액만 사용하고 숫자를 지어내지 않는다.',
          '사용자는 월급, 월급일, 자산, 부채, 필수 지출, 목적 자금을 한 입력에 자연스럽게 섞어 쓸 수 있다.',
          '월급·상여 등 정기적으로 들어오는 돈은 반복 수입이며 보유 자산에 합산하지 않는다.',
          '월세·통신비·보험료 등 정기적으로 나가는 돈은 필수 지출이며 부채나 자산에 합산하지 않는다.',
          '입금되어 현재 계좌에 남아 있는 돈만 현금성 자산이다.',
          '각 금액 항목을 반복 수입, 필수 지출, 현금성 자산, 저축성 자산, 투자 자산, 목적 자금, 부채/미결제, 기타 중 하나로 분류한다.',
          '월급일은 payday에 기록하고 금액 proposal로 만들지 않는다.',
          '반복 수입이 있으면 월급 전체를 필수 생활비, 부채/카드 결제, 비상금, 목적 자금, 저축, 투자, 여유 자금으로 배분한다.',
          '배분 금액 합계는 반복 수입 합계와 정확히 같아야 한다.',
          '부채·카드 미결제와 필수 지출을 먼저 반영하고 비상금이 부족하면 투자보다 비상금을 우선한다.',
          '반복 수입이 없으면 salaryAllocations는 빈 배열로 반환하고 월급 정보를 missingData에 넣는다.',
          '소득, 월 생활비, 고정비가 부족하면 투자 가능 금액을 단정하지 않고 missingData에 넣는다.',
          '총자산, 총부채, 순자산 합계는 응답에서 직접 계산하거나 숫자로 단정하지 않는다. 합산은 애플리케이션 코드가 수행한다.',
          '불확실한 항목은 confidence를 낮추며 사용자가 최종 검토한다.',
        ].join('\n'),
        responseMimeType: 'application/json',
        responseJsonSchema: assetAnalysisSchema,
        temperature: 0.1,
        maxOutputTokens: 8_000,
      },
    })
    const analysis = parseModelJson<{
      proposals: Array<{ confidence: number; [key: string]: unknown }>
      healthStatus: string
      insight: string
      actionItems: string[]
      missingData: string[]
      payday: string | null
      salaryAllocations: Array<{
        category: string
        amount: number
        reason: string
      }>
      allocationInsight: string
    }>(modelResponse.text)

    response.json({
      ...analysis,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      proposals: analysis.proposals.map((proposal) => ({
        ...proposal,
        id: crypto.randomUUID(),
        needReview: proposal.confidence < CONFIDENCE_REVIEW_THRESHOLD,
        decision: 'pending',
        userNote: '',
      })),
      payday: analysis.payday || undefined,
      salaryAllocations: analysis.salaryAllocations,
      allocationInsight: analysis.allocationInsight,
      allocationDecision: 'pending',
      appliedFeedback: userFeedback || undefined,
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/portfolio/analyze', async (request, response, next) => {
  try {
    const parsedRequest = portfolioAnalysisRequestSchema.safeParse(request.body)
    if (!parsedRequest.success) {
      response.status(400).json({ message: '포트폴리오 분석 요청 형식이 올바르지 않습니다.' })
      return
    }

    const { client, model } = createModelClient()
    const modelResponse = await client.models.generateContent({
      model,
      contents: JSON.stringify(parsedRequest.data),
      config: {
        systemInstruction: [
          '너는 개인 자산관리 Agent SKale의 포트폴리오 분석 역할이다.',
          '비상금, 부채, 카드 미결제, 단기 목적 자금을 투자보다 먼저 고려한다.',
          '매수·매도 지시를 하지 않고 자산군 배분 방향만 제안한다.',
          '사용자가 제공하지 않은 수치나 현재 시장 데이터를 지어내지 않는다.',
          '배분 비율의 합은 정확히 100이 되게 한다.',
          '결과는 참고용이며 사용자가 수정·수락·거절할 수 있는 제안이다.',
        ].join('\n'),
        responseMimeType: 'application/json',
        responseJsonSchema: portfolioAnalysisSchema,
        temperature: 0.15,
        maxOutputTokens: 4_000,
      },
    })
    const analysis = parseModelJson<Record<string, unknown>>(modelResponse.text)
    response.json({
      ...analysis,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      decision: 'pending',
      appliedFeedback: parsedRequest.data.userFeedback || undefined,
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/stocks/analyze', async (request, response, next) => {
  try {
    const parsedRequest = stockAnalysisRequestSchema.safeParse(request.body)
    if (!parsedRequest.success) {
      response.status(400).json({ message: '종목 분석 요청 형식이 올바르지 않습니다.' })
      return
    }

    const { client, model } = createModelClient()
    const modelResponse = await client.models.generateContent({
      model,
      contents: JSON.stringify(parsedRequest.data),
      config: {
        systemInstruction: [
          '너는 개인 자산관리 Agent SKale의 종목 검토 역할이다.',
          '오직 사용자가 제공한 정보만 사용하며 최신 실적, 주가, 밸류에이션을 검색하거나 추정하지 않는다.',
          '평가 배점은 산업 구조 25, 경쟁우위 20, 재무제표 25, 밸류에이션 15, 경영진/자본배분 10, 리스크 관리 5이다.',
          '평가할 근거가 부족한 영역은 점수를 null로 반환하고 verdict를 데이터 부족 또는 보류로 판단한다.',
          '재무 데이터가 거의 없으면 전체 영역에 억지 점수를 주지 않는다.',
          '영업현금흐름 지속 악화, 재고·매출채권 급증, 감당하기 어려운 부채, 반복 희석, 단순 하청, 과열 밸류에이션은 fatalFlags에 넣는다.',
          '매수, 매도, 보유를 지시하지 않는다.',
          '점수는 전략 적합도이며 사용자가 수락하거나 거절할 분석 초안이다.',
          'disclaimer에는 제공 데이터 기반 참고용 분석이며 실제 투자 판단은 사용자 책임임을 명시한다.',
        ].join('\n'),
        responseMimeType: 'application/json',
        responseJsonSchema: stockAnalysisSchema,
        temperature: 0.1,
        maxOutputTokens: 5_000,
      },
    })
    const analysis = parseModelJson<{
      ticker: string | null
      [key: string]: unknown
    }>(modelResponse.text)

    response.json({
      ...analysis,
      ticker: analysis.ticker || undefined,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      totalScore: null,
      decision: 'pending',
      appliedFeedback: parsedRequest.data.userFeedback || undefined,
    })
  } catch (error) {
    next(error)
  }
})

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  const status = getErrorStatus(error)
  if (status === 429) {
    response.status(429).json({ message: 'AI API 사용 한도를 초과했습니다. 프로젝트의 할당량과 결제 상태를 확인해 주세요.' })
    return
  }
  if (status === 401 || status === 403) {
    response.status(401).json({ message: 'AI API 키가 유효하지 않거나 권한이 없습니다. 서버 환경변수를 확인해 주세요.' })
    return
  }
  if (status && status >= 400 && status < 500) {
    response.status(status).json({
      message: error instanceof Error ? error.message : '요청 형식이 올바르지 않습니다.',
    })
    return
  }
  console.error('AI analysis failed', {
    name: error instanceof Error ? error.name : 'UnknownError',
    status,
  })
  response.status(500).json({ message: 'AI 분석 요청을 처리하지 못했습니다.' })
})

app.listen(port, () => {
  console.log(`SKale API listening on http://localhost:${port}`)
})

function createModelClient(): { client: GoogleGenAI; model: string } {
  const apiKey = process.env.AI_API_KEY
  if (!apiKey) {
    const error = new Error('AI_API_KEY가 설정되지 않아 AI 분석을 시작할 수 없습니다.')
    Object.assign(error, { status: 401 })
    throw error
  }
  return {
    client: new GoogleGenAI({ apiKey }),
    model: process.env.AI_MODEL ?? DEFAULT_MODEL,
  }
}

function parseModelJson<T>(text: string | undefined): T {
  if (!text) {
    throw new Error('AI 응답에 분석 결과가 없습니다.')
  }
  const normalizedText = text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/\s*```$/, '')
  return JSON.parse(normalizedText) as T
}

function validateImageSizes(images: z.infer<typeof imageAttachmentSchema>[]): void {
  for (const image of images) {
    const estimatedBytes = Math.ceil((image.data.length * 3) / 4)
    if (estimatedBytes > MAX_IMAGE_BYTES) {
      const error = new Error(`${image.name} 이미지가 4MB를 초과합니다.`)
      Object.assign(error, { status: 400 })
      throw error
    }
  }
}

function deduplicateTransactions(proposals: SpendingOutput['proposals']): {
  unique: SpendingOutput['proposals']
  duplicateCount: number
} {
  const unique: SpendingOutput['proposals'] = []
  let duplicateCount = 0

  for (const proposal of proposals) {
    const duplicate = unique.some((existing) =>
      existing.date === proposal.date &&
      existing.amount === proposal.amount &&
      merchantsAreEquivalent(existing.merchant, proposal.merchant),
    )
    if (duplicate) {
      duplicateCount += 1
    } else {
      unique.push(proposal)
    }
  }
  return { unique, duplicateCount }
}

function merchantsAreEquivalent(left: string, right: string): boolean {
  const normalizedLeft = normalizeMerchant(left)
  const normalizedRight = normalizeMerchant(right)
  return normalizedLeft === normalizedRight ||
    (normalizedLeft.length >= 3 && normalizedRight.length >= 3 &&
      (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)))
}

function normalizeMerchant(value: string): string {
  return value.toLowerCase().replace(/[^0-9a-z가-힣]/g, '')
}

function normalizeTransactionDate(rawText: string, proposedDate: string): string {
  const partialDate = rawText.match(/(?<!\d)(\d{1,2})[./-](\d{1,2})(?!\d)/)
  if (partialDate) {
    const currentYear = new Date().getFullYear()
    return `${currentYear}-${partialDate[1].padStart(2, '0')}-${partialDate[2].padStart(2, '0')}`
  }
  return proposedDate
}

function getErrorStatus(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number') {
    return error.status
  }
  return undefined
}
