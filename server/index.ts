import 'dotenv/config'

import cors from 'cors'
import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express'
import OpenAI from 'openai'
import { z } from 'zod'

const DEFAULT_PORT = 8787
const DEFAULT_MODEL = 'gpt-5.4-mini'
const CONFIDENCE_REVIEW_THRESHOLD = 0.75

const spendingAnalysisRequestSchema = z.object({
  input: z.string().trim().min(1).max(20_000),
  userFeedback: z.string().trim().max(2_000).optional(),
})

const assetAnalysisRequestSchema = z.object({
  input: z.string().trim().min(1).max(20_000),
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
            enum: [
              'expense',
              'fixedExpense',
              'saving',
              'investment',
              'transfer',
              'income',
              'unknown',
            ],
          },
          spendingCategory: {
            type: ['string', 'null'],
            enum: [
              '고정비',
              '생활비',
              '식비/카페',
              '교통',
              '쇼핑',
              '여행',
              '의료/건강',
              '데이트',
              '기타',
              null,
            ],
          },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          reason: { type: 'string' },
        },
        required: [
          'rawText',
          'date',
          'merchant',
          'amount',
          'nature',
          'spendingCategory',
          'confidence',
          'reason',
        ],
      },
    },
    insight: { type: 'string' },
    actionItems: {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      maxItems: 4,
    },
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
            enum: [
              '현금성 자산',
              '저축성 자산',
              '투자 자산',
              '목적 자금',
              '부채/미결제',
              '기타',
            ],
          },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          reason: { type: 'string' },
        },
        required: [
          'rawText',
          'name',
          'amount',
          'category',
          'confidence',
          'reason',
        ],
      },
    },
    healthStatus: {
      type: 'string',
      enum: ['양호', '주의', '확인 필요'],
    },
    insight: { type: 'string' },
    actionItems: {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      maxItems: 4,
    },
    missingData: {
      type: 'array',
      items: { type: 'string' },
      maxItems: 6,
    },
  },
  required: [
    'proposals',
    'healthStatus',
    'insight',
    'actionItems',
    'missingData',
  ],
} as const

const app = express()
const port = Number(process.env.PORT ?? DEFAULT_PORT)
const allowedOrigin = process.env.ALLOWED_ORIGIN

app.use(
  cors({
    origin: allowedOrigin
      ? allowedOrigin.split(',').map((origin) => origin.trim())
      : true,
  }),
)
app.use(express.json({ limit: '256kb' }))

app.get('/api/health', (_request: Request, response: Response) => {
  response.json({
    status: 'ok',
    aiConfigured: Boolean(process.env.OPENAI_API_KEY),
  })
})

app.post(
  '/api/spending/analyze',
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const parsedRequest = spendingAnalysisRequestSchema.safeParse(request.body)

      if (!parsedRequest.success) {
        response.status(400).json({
          message: '소비 내역 또는 수정 요청 형식이 올바르지 않습니다.',
        })
        return
      }

      const apiKey = process.env.OPENAI_API_KEY

      if (!apiKey) {
        response.status(503).json({
          message: 'OPENAI_API_KEY가 설정되지 않아 AI 분석을 시작할 수 없습니다.',
          code: 'AI_NOT_CONFIGURED',
        })
        return
      }

      const openai = new OpenAI({ apiKey })
      const { input, userFeedback } = parsedRequest.data
      const result = await openai.responses.create({
        model: process.env.OPENAI_MODEL ?? DEFAULT_MODEL,
        reasoning: { effort: 'low' },
        instructions: [
          '너는 개인 자산관리 AI Agent SKale의 소비 분석가다.',
          '사용자가 제공한 거래만 분석하고 숫자나 날짜를 지어내지 않는다.',
          '소비, 고정비, 저축, 투자, 이체, 수입을 구분한다.',
          '투자, 저축, 이체, 수입은 일반 소비로 분류하지 않는다.',
          '불확실하면 confidence를 낮추고 reason에 무엇이 불확실한지 설명한다.',
          '사용자의 수정 요청이 있으면 원본 거래와 충돌하지 않는 범위에서 우선 반영한다.',
          '판단은 제안일 뿐이며 사용자가 최종 검토한다.',
        ].join('\n'),
        input: [
          {
            role: 'user',
            content: [
              `소비 내역:\n${input}`,
              userFeedback
                ? `\n사용자 수정 요청:\n${userFeedback}`
                : '',
            ].join(''),
          },
        ],
        text: {
          verbosity: 'low',
          format: {
            type: 'json_schema',
            name: 'spending_analysis',
            strict: true,
            schema: spendingAnalysisSchema,
          },
        },
        max_output_tokens: 4_000,
      })

      if (!result.output_text) {
        throw new Error('OpenAI 응답에 분석 결과가 없습니다.')
      }

      const analysis = JSON.parse(result.output_text) as {
        proposals: Array<{
          confidence: number
          spendingCategory: string | null
          [key: string]: unknown
        }>
        insight: string
        actionItems: string[]
      }

      response.json({
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        proposals: analysis.proposals.map((proposal, index) => ({
          ...proposal,
          id: crypto.randomUUID(),
          spendingCategory: proposal.spendingCategory ?? undefined,
          needReview: proposal.confidence < CONFIDENCE_REVIEW_THRESHOLD,
          decision: 'pending',
          userNote: '',
          order: index,
        })),
        insight: analysis.insight,
        actionItems: analysis.actionItems,
        appliedFeedback: userFeedback || undefined,
      })
    } catch (error) {
      next(error)
    }
  },
)

app.post(
  '/api/assets/analyze',
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const parsedRequest = assetAnalysisRequestSchema.safeParse(request.body)

      if (!parsedRequest.success) {
        response.status(400).json({
          message: '자산 현황 또는 수정 요청 형식이 올바르지 않습니다.',
        })
        return
      }

      const apiKey = process.env.OPENAI_API_KEY

      if (!apiKey) {
        response.status(503).json({
          message: 'OPENAI_API_KEY가 설정되지 않아 AI 분석을 시작할 수 없습니다.',
          code: 'AI_NOT_CONFIGURED',
        })
        return
      }

      const openai = new OpenAI({ apiKey })
      const { input, userFeedback } = parsedRequest.data
      const result = await openai.responses.create({
        model: process.env.OPENAI_MODEL ?? DEFAULT_MODEL,
        reasoning: { effort: 'low' },
        instructions: [
          '너는 개인 자산관리 AI Agent SKale의 자산 분석가다.',
          '사용자가 제공한 항목과 금액만 사용하고 숫자를 지어내지 않는다.',
          '각 항목을 현금성 자산, 저축성 자산, 투자 자산, 목적 자금, 부채/미결제, 기타 중 하나로 분류한다.',
          '카드 미결제, 대출, 마이너스 잔액은 부채/미결제로 분류한다.',
          '사용 목적이 명시된 단기 자금은 목적 자금으로 분류한다.',
          '월 생활비, 소득, 고정비가 없으면 투자 가능 금액을 단정하지 말고 missingData에 넣는다.',
          '불확실한 항목은 confidence를 낮추고 reason에 확인할 내용을 설명한다.',
          '사용자의 수정 요청이 원본 데이터와 충돌하지 않으면 우선 반영한다.',
          'healthStatus와 행동 제안은 참고용이며 사용자가 최종 판단한다.',
        ].join('\n'),
        input: [
          {
            role: 'user',
            content: [
              `자산 현황:\n${input}`,
              userFeedback
                ? `\n사용자 수정 요청:\n${userFeedback}`
                : '',
            ].join(''),
          },
        ],
        text: {
          verbosity: 'low',
          format: {
            type: 'json_schema',
            name: 'asset_analysis',
            strict: true,
            schema: assetAnalysisSchema,
          },
        },
        max_output_tokens: 4_000,
      })

      if (!result.output_text) {
        throw new Error('OpenAI 응답에 자산 분석 결과가 없습니다.')
      }

      const analysis = JSON.parse(result.output_text) as {
        proposals: Array<{
          confidence: number
          [key: string]: unknown
        }>
        healthStatus: string
        insight: string
        actionItems: string[]
        missingData: string[]
      }

      response.json({
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        proposals: analysis.proposals.map((proposal) => ({
          ...proposal,
          id: crypto.randomUUID(),
          needReview: proposal.confidence < CONFIDENCE_REVIEW_THRESHOLD,
          decision: 'pending',
          userNote: '',
        })),
        healthStatus: analysis.healthStatus,
        insight: analysis.insight,
        actionItems: analysis.actionItems,
        missingData: analysis.missingData,
        appliedFeedback: userFeedback || undefined,
      })
    } catch (error) {
      next(error)
    }
  },
)

app.use(
  (
    error: unknown,
    _request: Request,
    response: Response,
    _next: NextFunction,
  ) => {
    const status = getErrorStatus(error)

    if (status === 429) {
      response.status(429).json({
        message:
          'OpenAI API 사용 한도를 초과했습니다. API 프로젝트의 결제 및 크레딧 상태를 확인해 주세요.',
      })
      return
    }

    if (status === 401) {
      response.status(401).json({
        message: 'OpenAI API 키가 유효하지 않습니다. 서버 환경변수를 확인해 주세요.',
      })
      return
    }

    console.error('OpenAI analysis failed', {
      name: error instanceof Error ? error.name : 'UnknownError',
      status,
    })
    response.status(500).json({ message: 'AI 분석 요청을 처리하지 못했습니다.' })
  },
)

app.listen(port, () => {
  console.log(`SKale API listening on http://localhost:${port}`)
})

function getErrorStatus(error: unknown): number | undefined {
  if (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number'
  ) {
    return error.status
  }

  return undefined
}
