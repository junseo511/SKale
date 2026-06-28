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
const DEFAULT_MODEL_CANDIDATES = [
  'gemini-3.5-flash',
  'gemini-3-flash-preview',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
] as const
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

const customSalaryUseSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    amount: z.number().nonnegative(),
    bucket: z.enum(['essential', 'goal', 'flexible']),
    note: z.string().trim().max(200),
  })
  .strict()

const financialProfileSchema = z.object({
  monthlySalary: z.number().nonnegative().nullable(),
  essentialExpense: z.number().nonnegative().nullable(),
  debtPayment: z.number().nonnegative().nullable(),
  currentEmergencyFund: z.number().nonnegative().nullable(),
  targetEmergencyFund: z.number().nonnegative().nullable(),
  goalName: z.string().max(200),
  goalMonthlyAmount: z.number().nonnegative().nullable(),
  flexibleSpending: z.number().nonnegative().nullable(),
  riskProfile: z
    .preprocess(
      (value) => (value === '성장형' ? '공격형' : value),
      z.enum(['안정형', '균형형', '공격형']).nullable(),
    ),
  investmentHorizon: z
    .enum(['1년 미만', '1~3년', '3년 이상'])
    .nullable(),
  preferences: z.array(z.string().trim().min(1).max(300)).max(20),
  customUses: z.array(customSalaryUseSchema).max(20).default([]),
})

type FinancialProfile = z.infer<typeof financialProfileSchema>
type PaydayProfilePatchValue =
  | string
  | number
  | string[]
  | Array<{
      name: string
      amount: number
      bucket: 'essential' | 'goal' | 'flexible'
      note: string
    }>
type PaydayProfilePatch = Record<string, PaydayProfilePatchValue>

const monthlySpendingSummarySchema = z.object({
  id: z.string(),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  source: z.enum(['text', 'image', 'mixed']),
  totalExpense: z.number().nonnegative().nullable(),
  essentialExpense: z.number().nonnegative().nullable(),
  flexibleExpense: z.number().nonnegative().nullable(),
  categoryBreakdown: z
    .array(
      z
        .object({
          category: z.string().trim().min(1).max(40),
          amount: z.number().nonnegative(),
        })
        .strict(),
    )
    .max(12)
    .default([]),
  notableCategories: z.array(z.string().trim().min(1)).max(8),
  insight: z.string(),
  needReview: z.boolean(),
})

const paydayConversationAppContextSchema = z.object({
  stage: z.enum([
    'empty',
    'salary_only',
    'spending_ready',
    'budget_detail_ready',
    'investment_ready',
  ]),
  completedActions: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  confirmedFacts: z.array(z.string().trim().min(1).max(200)).max(20),
  planSnapshot: z.object({
    monthlySalary: z.number().nonnegative().nullable(),
    availableInvestmentAmount: z.number().nonnegative().nullable(),
    safetyStatus: z.string().trim().max(80).nullable(),
    allocationSummary: z
      .array(
        z
          .object({
            label: z.string().trim().min(1).max(80),
            amount: z.number().nonnegative(),
          })
          .strict(),
      )
      .max(12),
  }).strict(),
  recommendationPolicy: z.object({
    priority: z.array(z.string().trim().min(1).max(120)).max(8),
    avoid: z.array(z.string().trim().min(1).max(120)).max(8),
  }).strict(),
}).strict()

const paydayConversationModelResponseValidationSchema = z
  .object({
    reply: z.string().min(1),
    profilePatch: z
      .object({
        monthlySalary: z.number().nonnegative().nullable(),
        essentialExpense: z.number().nonnegative().nullable(),
        debtPayment: z.number().nonnegative().nullable(),
        currentEmergencyFund: z.number().nonnegative().nullable(),
        targetEmergencyFund: z.number().nonnegative().nullable(),
        goalName: z.string().max(200).nullable(),
        goalMonthlyAmount: z.number().nonnegative().nullable(),
        flexibleSpending: z.number().nonnegative().nullable(),
        riskProfile: z
          .preprocess(
            (value) => (value === '성장형' ? '공격형' : value),
            z.enum(['안정형', '균형형', '공격형']).nullable(),
          ),
        investmentHorizon: z
          .enum(['1년 미만', '1~3년', '3년 이상'])
          .nullable(),
        preferences: z
          .array(z.string().trim().min(1).max(300))
          .max(8)
          .nullable(),
        customUses: z.array(customSalaryUseSchema).max(20).nullable(),
      })
      .strict(),
    monthlySpendingProposal: z
      .object({
        month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
        source: z.enum(['text', 'image', 'mixed']),
        totalExpense: z.number().nonnegative().nullable(),
        essentialExpense: z.number().nonnegative().nullable(),
        flexibleExpense: z.number().nonnegative().nullable(),
        categoryBreakdown: z
          .array(
            z
              .object({
                category: z.string().trim().min(1).max(40),
                amount: z.number().nonnegative(),
              })
              .strict(),
          )
          .max(12),
        notableCategories: z.array(z.string().trim().min(1)).max(8),
        insight: z.string(),
        needReview: z.boolean(),
      })
      .strict()
      .nullable(),
    missingData: z.array(z.string().trim().min(1)).max(8),
    appliedFacts: z.array(z.string().trim().min(1)).max(10),
    nextActionRecommendation: z
      .object({
        title: z.string().trim().min(1).max(80),
        description: z.string().trim().min(1).max(200),
        primaryLabel: z.string().trim().min(1).max(40),
        draft: z.string().trim().min(1).max(500),
      })
      .strict(),
    secondaryActionRecommendations: z
      .array(
        z
          .object({
            title: z.string().trim().min(1).max(80),
            description: z.string().trim().min(1).max(200),
            primaryLabel: z.string().trim().min(1).max(40),
            draft: z.string().trim().min(1).max(500),
          })
          .strict(),
      )
      .max(3)
      .optional(),
  })
  .strict()

const paydayConversationRequestSchema = z
  .object({
    message: z.string().trim().max(4_000),
    targetMonth: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .optional(),
    attachments: z
      .array(imageAttachmentSchema)
      .max(MAX_IMAGE_COUNT)
      .default([]),
    profile: financialProfileSchema,
    monthlySpending: z.array(monthlySpendingSummarySchema).max(24),
    appContext: paydayConversationAppContextSchema.optional(),
    recentMessages: z
      .array(
        z.object({
          role: z.enum(['agent', 'user']),
          content: z.string().max(1_500),
        }),
      )
      .max(8),
  })
  .refine(
    (request) =>
      request.message.length > 0 || request.attachments.length > 0,
    { message: '대화 내용 또는 사용내역 이미지가 필요합니다.' },
  )

type PaydayConversationAppContext = z.infer<typeof paydayConversationAppContextSchema>
type MonthlySpendingSummary = z.infer<typeof monthlySpendingSummarySchema>
type MonthlySpendingProposal = NonNullable<
  z.infer<typeof paydayConversationModelResponseValidationSchema>['monthlySpendingProposal']
>
type NextActionRecommendation = z.infer<
  typeof paydayConversationModelResponseValidationSchema
>['nextActionRecommendation']
type PaydayConversationResponsePayload = {
  reply: string
  profilePatch: PaydayProfilePatch
  monthlySpendingProposal: MonthlySpendingProposal | undefined
  missingData: string[]
  appliedFacts: string[]
  nextActionRecommendation: NextActionRecommendation
}
type ConversationIntent =
  | 'salary'
  | 'spending_distribution'
  | 'fixed_costs'
  | 'safety_check'
  | 'detail_plan'
  | 'detail_compare'
  | 'detail_adjust'
  | 'investment_research'
  | 'preference_adjust'

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

const paydayConversationResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    reply: { type: 'string' },
    profilePatch: {
      type: 'object',
      additionalProperties: false,
      properties: {
        monthlySalary: { type: ['number', 'null'], minimum: 0 },
        essentialExpense: { type: ['number', 'null'], minimum: 0 },
        debtPayment: { type: ['number', 'null'], minimum: 0 },
        currentEmergencyFund: { type: ['number', 'null'], minimum: 0 },
        targetEmergencyFund: { type: ['number', 'null'], minimum: 0 },
        goalName: { type: ['string', 'null'] },
        goalMonthlyAmount: { type: ['number', 'null'], minimum: 0 },
        flexibleSpending: { type: ['number', 'null'], minimum: 0 },
        riskProfile: {
          type: ['string', 'null'],
          enum: ['안정형', '균형형', '공격형', null],
        },
        investmentHorizon: {
          type: ['string', 'null'],
          enum: ['1년 미만', '1~3년', '3년 이상', null],
        },
        preferences: {
          type: ['array', 'null'],
          items: { type: 'string' },
          maxItems: 8,
        },
        customUses: {
          type: ['array', 'null'],
          maxItems: 20,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              name: { type: 'string' },
              amount: { type: 'number', minimum: 0 },
              bucket: {
                type: 'string',
                enum: ['essential', 'goal', 'flexible'],
              },
              note: { type: 'string' },
            },
            required: ['name', 'amount', 'bucket', 'note'],
          },
        },
      },
      required: [
        'monthlySalary',
        'essentialExpense',
        'debtPayment',
        'currentEmergencyFund',
        'targetEmergencyFund',
        'goalName',
        'goalMonthlyAmount',
        'flexibleSpending',
        'riskProfile',
        'investmentHorizon',
        'preferences',
        'customUses',
      ],
    },
    monthlySpendingProposal: {
      type: ['object', 'null'],
      additionalProperties: false,
      properties: {
        month: {
          type: 'string',
          pattern: '^\\d{4}-(0[1-9]|1[0-2])$',
        },
        source: {
          type: 'string',
          enum: ['text', 'image', 'mixed'],
        },
        totalExpense: { type: ['number', 'null'], minimum: 0 },
        essentialExpense: { type: ['number', 'null'], minimum: 0 },
        flexibleExpense: { type: ['number', 'null'], minimum: 0 },
        categoryBreakdown: {
          type: 'array',
          maxItems: 12,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              category: { type: 'string' },
              amount: { type: 'number', minimum: 0 },
            },
            required: ['category', 'amount'],
          },
        },
        notableCategories: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 8,
        },
        insight: { type: 'string' },
        needReview: { type: 'boolean' },
      },
      required: [
        'month',
        'source',
        'totalExpense',
        'essentialExpense',
        'flexibleExpense',
        'categoryBreakdown',
        'notableCategories',
        'insight',
        'needReview',
      ],
    },
    missingData: {
      type: 'array',
      items: { type: 'string' },
      maxItems: 8,
    },
    appliedFacts: {
      type: 'array',
      items: { type: 'string' },
      maxItems: 10,
    },
    nextActionRecommendation: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        primaryLabel: { type: 'string' },
        draft: { type: 'string' },
      },
      required: ['title', 'description', 'primaryLabel', 'draft'],
    },
    secondaryActionRecommendations: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          primaryLabel: { type: 'string' },
          draft: { type: 'string' },
        },
        required: ['title', 'description', 'primaryLabel', 'draft'],
      },
    },
  },
  required: [
    'reply',
    'profilePatch',
    'monthlySpendingProposal',
    'missingData',
    'appliedFacts',
    'nextActionRecommendation',
  ],
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
  origin(origin, callback) {
    if (!origin || isAllowedOrigin(origin, allowedOrigin)) {
      callback(null, true)
      return
    }
    callback(new Error('Not allowed by CORS'))
  },
}))
app.use(express.json({ limit: '24mb' }))

app.get('/api/health', (_request: Request, response: Response) => {
  response.json({
    status: 'ok',
    aiConfigured: Boolean(process.env.AI_API_KEY),
  })
})

app.post('/api/payday/chat', async (request, response, next) => {
  let fallbackMessage = ''
  try {
    const parsedRequest = paydayConversationRequestSchema.safeParse(
      request.body,
    )
    if (!parsedRequest.success) {
      response.status(400).json({
        message:
          parsedRequest.error.issues[0]?.message ??
          '월급 Agent 요청 형식이 올바르지 않습니다.',
      })
      return
    }

    validateImageSizes(parsedRequest.data.attachments)
    const {
      message,
      targetMonth,
      attachments,
      profile,
      monthlySpending,
      appContext,
      recentMessages,
    } = parsedRequest.data
    fallbackMessage = message

    if (attachments.length === 0) {
      const quickResponse = createQuickPaydayConversationResponse({
        message,
        profile,
        monthlySpending,
        appContext,
      })
      if (quickResponse) {
        response.json(quickResponse)
        return
      }
    }

    const hasKnownFinancialContext =
      hasFinancialProfileContext(profile) ||
      monthlySpending.length > 0 ||
      recentMessages.some((recentMessage) =>
        hasPaydayScopeTerm(recentMessage.content),
      )
    if (
      attachments.length === 0 &&
      isClearlyOutsidePaydayScope(message, hasKnownFinancialContext)
    ) {
      response.json({
        reply:
          '잘 모르겠어요. 월급, 소비, 저축, 부채, 목표, 투자처럼 돈의 흐름과 관련된 이야기라면 근거를 붙여 함께 정리해 드릴게요.',
        profilePatch: {},
        monthlySpendingProposal: undefined,
        missingData: [],
        appliedFacts: [],
        nextActionRecommendation: createDefaultNextActionRecommendation(profile),
      })
      return
    }

    const deterministicInvestmentAllocation =
      createDeterministicInvestmentAllocationResponse(message, profile)
    if (deterministicInvestmentAllocation) {
      response.json(deterministicInvestmentAllocation)
      return
    }

    const deterministicDetailAdjustment = createDeterministicDetailAdjustmentResponse(
      message,
      profile,
      monthlySpending,
    )
    if (deterministicDetailAdjustment) {
      response.json(deterministicDetailAdjustment)
      return
    }

    const deterministicDetailComparison = createDeterministicDetailComparisonResponse(
      message,
      profile,
      monthlySpending,
    )
    if (deterministicDetailComparison) {
      response.json(deterministicDetailComparison)
      return
    }

    const deterministicFixedExpenses = createDeterministicFixedExpenseResponse(
      message,
      profile,
    )
    if (deterministicFixedExpenses) {
      response.json(deterministicFixedExpenses)
      return
    }

    const deterministicDetailPlan = createDeterministicDetailPlanResponse(
      message,
      profile,
    )
    if (deterministicDetailPlan) {
      response.json(deterministicDetailPlan)
      return
    }

    const result = await runModelRequest(async (client, model) => {
      const modelResponse = await retryModelRequest(() => client.models.generateContent({
        model,
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: buildPaydayConversationPrompt({
                  profile,
                  monthlySpending,
                  appContext,
                  recentMessages,
                  message,
                  targetMonth,
                }),
              },
              ...attachments.map((attachment) => ({
                inlineData: {
                  mimeType: attachment.mimeType,
                  data: attachment.data,
                },
              })),
            ],
          },
        ],
        config: {
        systemInstruction: buildPaydayConversationInstruction({
          message,
          attachmentsCount: attachments.length,
          appContext,
        }),
        responseMimeType: 'application/json',
        responseJsonSchema: paydayConversationResponseSchema,
        temperature: 0.2,
        maxOutputTokens: 4_000,
        },
      }))
      const modelJson = parseModelJson<unknown>(
        readGenerateContentText(modelResponse),
      )
      return paydayConversationModelResponseValidationSchema.parse(modelJson)
    })
    let profilePatch: PaydayProfilePatch = Object.fromEntries(
      Object.entries(result.profilePatch).filter(
        ([key, value]) =>
          value !== null &&
          !(typeof value === 'string' && value.trim().length === 0) &&
          !(key === 'preferences' && Array.isArray(value) && value.length === 0),
      ),
    ) as PaydayProfilePatch
    profilePatch = sanitizeProfilePatchScope(profilePatch)
    let visibleMissingData = sanitizeMissingData(result.missingData, profile, profilePatch)
    let visibleAppliedFacts = result.appliedFacts.map(replaceInternalFieldNames)
    let visibleReply = sanitizeReply(
      replaceInternalFieldNames(result.reply),
      profile,
      profilePatch,
    )
    visibleReply = sanitizeReplyForConversationIntent(visibleReply, message)
    const proactiveDetailPlan = createProactiveDetailPlanIfNeeded(
      message,
      visibleReply,
      profile,
      profilePatch,
    )
    if (proactiveDetailPlan) {
      profilePatch = sanitizeProfilePatchScope(proactiveDetailPlan.profilePatch)
      visibleReply = sanitizeReplyForConversationIntent(
        proactiveDetailPlan.reply,
        message,
      )
      visibleMissingData = []
      visibleAppliedFacts = [
        ...visibleAppliedFacts,
        '저장된 월급 계획을 기준으로 세부 사용처 초안을 만들었어요.',
      ]
    }
    const requestedMonthlySpendingProposal =
      result.monthlySpendingProposal ?? undefined
    const visibleMonthlySpendingProposal = sanitizeMonthlySpendingProposal(
      requestedMonthlySpendingProposal,
    )
    let visibleNextActionRecommendation = sanitizeNextActionRecommendation({
      recommendation: result.nextActionRecommendation,
      message,
      profile,
      monthlySpending,
      hasFreshMonthlySpendingProposal:
        visibleMonthlySpendingProposal !== undefined,
      appContext,
    })
    let visibleSecondaryActionRecommendations =
      sanitizeSecondaryActionRecommendations({
        recommendations: result.secondaryActionRecommendations ?? [],
        primaryRecommendation: visibleNextActionRecommendation,
        message,
        monthlySpending,
        hasFreshMonthlySpendingProposal:
          visibleMonthlySpendingProposal !== undefined,
        appContext,
      })
    if (
      requestedMonthlySpendingProposal !== undefined &&
      visibleMonthlySpendingProposal === undefined
    ) {
      visibleReply =
        '분석할 카드 내역 데이터가 확인되지 않았어요. 분석하려는 월의 카드 사용 내역을 텍스트로 붙여넣거나 이미지를 업로드해 주세요.'
      visibleMissingData = ['카드 내역 텍스트 또는 사진']
      visibleAppliedFacts = []
      visibleNextActionRecommendation =
        createSpendingDataNextActionRecommendation()
      visibleSecondaryActionRecommendations = []
    }

    response.json({
      ...result,
      reply: visibleReply,
      profilePatch,
      missingData: visibleMissingData,
      appliedFacts: visibleAppliedFacts,
      nextActionRecommendation: visibleNextActionRecommendation,
      secondaryActionRecommendations: visibleSecondaryActionRecommendations,
      monthlySpendingProposal: visibleMonthlySpendingProposal,
    })
  } catch (error) {
    if (isEmptyModelTextError(error)) {
      response.json(createFallbackPaydayResponse(fallbackMessage))
      return
    }
    const status = getErrorStatus(error)
    if (status !== 401 && status !== 403 && status !== 429) {
      response.json(createFallbackPaydayResponse(fallbackMessage))
      return
    }
    next(error)
  }
})

app.post('/api/spending/analyze', async (request, response, next) => {
  try {
    const parsedRequest = spendingAnalysisRequestSchema.safeParse(request.body)
    if (!parsedRequest.success) {
      response.status(400).json({ message: parsedRequest.error.issues[0]?.message ?? '소비 분석 요청 형식이 올바르지 않습니다.' })
      return
    }

    validateImageSizes(parsedRequest.data.images)
    const { input, images, userFeedback } = parsedRequest.data
    const contents = [
      {
        role: 'user',
        parts: [
          {
            text: [
              `Text spending records:\n${input || '(none)'}`,
              userFeedback
                ? `\nUser correction request:\n${userFeedback}`
                : '',
              '\nIf the same transaction appears in both an attachment and the text, return it only once.',
            ].join(''),
          },
          ...images.map((image) => ({
            inlineData: { mimeType: image.mimeType, data: image.data },
          })),
        ],
      },
    ]
    const analysis = await runModelRequest(async (client, model) => {
      const modelResponse = await retryModelRequest(() => client.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: [
            'You are the spending-analysis component of the personal finance agent SKale.',
            'The user may write in Korean or English. Write all user-facing natural-language output in Korean.',
            'Extract only transactions directly supported by the submitted text and images. Never invent a number or date.',
            'Treat transactions with the same date, amount, and identical or similar merchant as duplicates even when they come from different input sources. Return each transaction once.',
            'If image OCR is uncertain, lower confidence and explain what the user should verify in Korean in reason.',
            'Do not classify investments, savings, transfers, refunds, or income as ordinary expenses.',
            `The current date is ${new Date().toISOString().slice(0, 10)}. Interpret a date without a year as belonging to the current year.`,
            'Write at least one Korean sentence explaining each classification in reason.',
            'The result is a proposal that requires user review.',
            'If the submitted content is unrelated, nonsensical, or contains no recognizable transaction, return an empty proposals array and explain in Korean that the spending data could not be understood.',
          ].join('\n'),
          responseMimeType: 'application/json',
          responseJsonSchema: spendingAnalysisSchema,
          temperature: 0.1,
          maxOutputTokens: 4_000,
        },
      }))
      return parseModelJson<SpendingOutput>(
        readGenerateContentText(modelResponse),
      )
    })
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

    const { input, userFeedback } = parsedRequest.data
    const analysis = await runModelRequest(async (client, model) => {
      const modelResponse = await retryModelRequest(() => client.models.generateContent({
        model,
        contents: [
          `Financial and asset information:\n${input}`,
          userFeedback
            ? `\nUser correction request:\n${userFeedback}`
            : '',
        ].join(''),
        config: {
          systemInstruction: [
            'You are the asset-analysis component of the personal finance agent SKale.',
            'The user may write in Korean or English. Write all user-facing natural-language output in Korean.',
            'Use only items and amounts explicitly provided by the user. Never invent a number.',
            'The user may mix salary, payday, assets, debt, essential expenses, and goal funds in one natural-language message.',
            'Recurring inflows such as salary and bonuses are recurring income and must not be included in owned assets.',
            'Recurring outflows such as rent, telecommunications, and insurance are essential expenses and must not be included in assets or debt.',
            'Only money already deposited and currently remaining in an account is a liquid asset.',
            'Classify each monetary item into one of the Korean enum values defined by the response schema.',
            'Store payday in payday and do not create a monetary proposal for it.',
            'When recurring income exists, allocate the entire recurring-income total across the Korean salary allocation categories defined by the schema.',
            'The allocation total must equal the recurring-income total exactly.',
            'Prioritize debt, outstanding card payments, and essential expenses. Prioritize an emergency fund over investment when the emergency fund is insufficient.',
            'When recurring income is absent, return an empty salaryAllocations array and mention the missing salary information in Korean in missingData.',
            'When income, monthly living costs, or fixed costs are insufficient, do not assert an investable amount; list the missing information in Korean.',
            'Do not calculate or assert total assets, total debt, or net worth in the model response. Application code performs those calculations.',
            'Lower confidence for uncertain items. The user must review the proposal.',
            'If the message is unrelated, nonsensical, or cannot be interpreted as financial information, return no proposals, explain in Korean that it could not be understood, and do not invent missing values.',
          ].join('\n'),
          responseMimeType: 'application/json',
          responseJsonSchema: assetAnalysisSchema,
          temperature: 0.1,
          maxOutputTokens: 8_000,
        },
      }))
      return parseModelJson<{
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
      }>(readGenerateContentText(modelResponse))
    })

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

    const analysis = await runModelRequest(async (client, model) => {
      const modelResponse = await retryModelRequest(() => client.models.generateContent({
        model,
        contents: JSON.stringify(parsedRequest.data),
        config: {
          systemInstruction: [
            'You are the portfolio-analysis component of the personal finance agent SKale.',
            'The user may write in Korean or English. Write all user-facing natural-language output in Korean.',
            'Consider emergency funds, debt, outstanding card payments, and short-term goal funds before investment.',
            'Do not give buy or sell instructions. Propose only asset-class allocation directions.',
            'Never invent a number or current market fact that the user did not provide.',
            'Make the allocation percentages total exactly 100.',
            'The result is a reference proposal that the user may edit, accept, or reject.',
            'If the input is unrelated, nonsensical, or insufficient to discuss a portfolio, state in Korean that it cannot be determined and list the necessary missing information instead of guessing.',
          ].join('\n'),
          responseMimeType: 'application/json',
          responseJsonSchema: portfolioAnalysisSchema,
          temperature: 0.15,
          maxOutputTokens: 4_000,
        },
      }))
      return parseModelJson<Record<string, unknown>>(
        readGenerateContentText(modelResponse),
      )
    })
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

    const analysis = await runModelRequest(async (client, model) => {
      const modelResponse = await retryModelRequest(() => client.models.generateContent({
        model,
        contents: JSON.stringify(parsedRequest.data),
        config: {
          systemInstruction: [
            'You are the stock-review component of the personal finance agent SKale.',
            'The user may write in Korean or English. Write all user-facing natural-language output in Korean.',
            'Use only information provided by the user. Do not search for or infer current earnings, stock prices, or valuation data.',
            'Use these maximum scores: industry structure 25, competitive advantage 20, financial quality 25, valuation 15, management and capital allocation 10, and risk control 5.',
            'Return null for any score without sufficient evidence, and use the Korean verdict meaning insufficient data or hold when appropriate.',
            'Do not force scores across all areas when financial data is sparse.',
            'Include persistently deteriorating operating cash flow, sharp inventory or receivables growth, unaffordable debt, repeated dilution, commodity subcontracting, and overheated valuation in fatalFlags when supported by the submitted data.',
            'Do not instruct the user to buy, sell, or hold.',
            'The score represents strategy fit and is a draft that the user may accept or reject.',
            'Write a Korean disclaimer stating that the analysis uses only submitted data and that the user is responsible for investment decisions.',
            'If the input is unrelated, nonsensical, or provides no usable company information, use the Korean verdict for insufficient data and state in Korean that the request could not be understood without guessing.',
          ].join('\n'),
          responseMimeType: 'application/json',
          responseJsonSchema: stockAnalysisSchema,
          temperature: 0.1,
          maxOutputTokens: 5_000,
        },
      }))
      return parseModelJson<{
      ticker: string | null
      [key: string]: unknown
      }>(readGenerateContentText(modelResponse))
    })

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
    response.status(429).json({
      message: '지금은 AI 답변 사용량이 다 찼어요. API 할당량이나 결제 상태를 확인해 주세요.',
    })
    return
  }
  if (status === 401 || status === 403) {
    response.status(status).json({
      message:
        error instanceof Error
          ? error.message
          : 'AI API 설정과 권한을 확인해 주세요.',
    })
    return
  }
  if (status && status >= 400 && status < 500) {
    response.status(status).json({
      message: error instanceof Error ? error.message : '요청 형식이 올바르지 않습니다.',
    })
    return
  }
  if (error instanceof z.ZodError) {
    response.status(502).json({
      message: '답변을 화면에 맞게 정리하지 못했어요. 잠시 후 다시 시도해 주세요.',
    })
    return
  }
  if (status === 502) {
    response.status(502).json({
      message:
        error instanceof Error
          ? error.message
          : '답변을 정리하지 못했어요. 잠시 후 다시 시도해 주세요.',
    })
    return
  }
  console.error('AI analysis failed', {
    name: error instanceof Error ? error.name : 'UnknownError',
    status,
  })
  response.status(500).json({
    message:
      'AI 답변을 이해하지 못했어요. 잠시 후 다시 시도하거나 방금 요청을 조금 짧게 보내주세요.',
  })
})

app.listen(port, () => {
  console.log(`SKale API listening on http://localhost:${port}`)
})

function createModelClient(): { client: GoogleGenAI; models: string[] } {
  const apiKey = process.env.AI_API_KEY
  if (!apiKey) {
    const error = new Error('AI_API_KEY가 설정되지 않아 AI 분석을 시작할 수 없습니다.')
    Object.assign(error, { status: 401 })
    throw error
  }
  return {
    client: new GoogleGenAI({ apiKey }),
    models: getModelCandidates(),
  }
}

function getModelCandidates(): string[] {
  const explicitModels = (process.env.AI_MODELS ?? '')
      .split(',')
      .map((model) => model.trim())
      .filter(Boolean)
  if (explicitModels.length > 0) {
    return [...new Set(explicitModels)]
  }

  const configuredModels = [
    ...DEFAULT_MODEL_CANDIDATES,
    process.env.AI_MODEL?.trim() ?? '',
  ].filter(Boolean)

  return [...new Set(configuredModels)]
}

async function runModelRequest<T>(
  request: (client: GoogleGenAI, model: string) => Promise<T>,
): Promise<T> {
  const { client, models } = createModelClient()
  let lastError: unknown

  for (const model of models) {
    try {
      return await request(client, model)
    } catch (error) {
      lastError = error
      if (!shouldTryNextModel(error)) {
        throw error
      }
      console.warn('Retrying AI request with next model', {
        model,
        status: getErrorStatus(error),
        reason: error instanceof Error ? error.message : 'unknown',
      })
    }
  }

  throw createAllModelsFailedError(lastError, models)
}

async function retryModelRequest<T>(request: () => Promise<T>): Promise<T> {
  try {
    return await request()
  } catch (error) {
    if (!shouldRetrySameModel(error)) {
      throw error
    }
    await delay(350)
    return request()
  }
}

function shouldRetrySameModel(error: unknown): boolean {
  const status = getErrorStatus(error)
  return status !== 401 && status !== 403 && status !== 404 && status !== 429
}

function shouldTryNextModel(error: unknown): boolean {
  const status = getErrorStatus(error)
  if (status === 401 || status === 403) {
    return false
  }
  if (status === 404 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504) {
    return true
  }
  if (error instanceof z.ZodError) {
    return true
  }
  if (!(error instanceof Error)) {
    return false
  }
  return /quota|rate.?limit|resource exhausted|empty|비어|json|읽지 못|parse|model/i.test(error.message)
}

function createAllModelsFailedError(error: unknown, models: string[]): Error {
  const finalError = new Error(
    `AI 모델 후보가 모두 응답하지 못했어요. 잠시 후 다시 시도해 주세요. (시도: ${models.join(', ')})`,
  )
  Object.assign(finalError, {
    status: getErrorStatus(error) ?? 502,
    cause: error,
  })
  return finalError
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}

function readGenerateContentText(response: unknown): string | undefined {
  if (
    typeof response === 'object' &&
    response !== null &&
    'text' in response &&
    typeof response.text === 'string' &&
    response.text.trim()
  ) {
    return response.text
  }

  const candidates =
    typeof response === 'object' &&
    response !== null &&
    'candidates' in response &&
    Array.isArray(response.candidates)
      ? response.candidates
      : []
  const partTexts = candidates.flatMap((candidate) => {
    if (
      typeof candidate !== 'object' ||
      candidate === null ||
      !('content' in candidate) ||
      typeof candidate.content !== 'object' ||
      candidate.content === null ||
      !('parts' in candidate.content) ||
      !Array.isArray(candidate.content.parts)
    ) {
      return []
    }
    return candidate.content.parts
      .map((part: unknown) =>
        typeof part === 'object' &&
        part !== null &&
        'text' in part &&
        typeof part.text === 'string'
          ? part.text
          : '',
      )
      .filter((text: string) => text.trim().length > 0)
  })

  return partTexts.length > 0 ? partTexts.join('\n') : undefined
}

function parseModelJson<T>(text: string | undefined): T {
  if (!text) {
    const error = new Error('답변이 비어 있어요. 잠시 후 다시 보내주세요.')
    Object.assign(error, { status: 502 })
    throw error
  }
  const normalizedText = text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/\s*```$/, '')
  try {
    return JSON.parse(normalizedText) as T
  } catch {
    const error = new Error('답변을 읽지 못했어요. 잠시 후 다시 시도해 주세요.')
    Object.assign(error, { status: 502 })
    throw error
  }
}

function isEmptyModelTextError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('답변이 비어 있어요')
}

function isSpendingDataRequest(message: string): boolean {
  const normalizedMessage = normalizeKoreanText(message)
  if (isSafetyPriorityRequest(message) || isInvestmentResearchRequest(message)) {
    return false
  }
  return (
    normalizedMessage.includes('사용내역') ||
    normalizedMessage.includes('카드내역') ||
    normalizedMessage.includes('명세서') ||
    normalizedMessage.includes('영수증') ||
    normalizedMessage.includes('지출분포') ||
    normalizedMessage.includes('카테고리별') ||
    (
      normalizedMessage.includes('소비') &&
      !normalizedMessage.includes('소비줄')
    )
  )
}

function isSafetyPriorityRequest(message: string): boolean {
  const normalizedMessage = normalizeKoreanText(message)
  return (
    normalizedMessage.includes('비상금') ||
    normalizedMessage.includes('카드값') ||
    normalizedMessage.includes('카드대금') ||
    normalizedMessage.includes('대출') ||
    normalizedMessage.includes('부채') ||
    normalizedMessage.includes('상환') ||
    (
      normalizedMessage.includes('투자') &&
      (
        normalizedMessage.includes('전에') ||
        normalizedMessage.includes('보다먼저') ||
        normalizedMessage.includes('우선') ||
        normalizedMessage.includes('안전망')
      )
    )
  )
}

function isInvestmentResearchRequest(message: string): boolean {
  return /투자|종목|주식|ETF|포트폴리오|후보|시장|현재가|실적|밸류에이션/.test(message)
}

function createQuickPaydayConversationResponse({
  message,
  profile,
  monthlySpending,
  appContext,
}: {
  message: string
  profile: FinancialProfile
  monthlySpending: MonthlySpendingSummary[]
  appContext: PaydayConversationAppContext | undefined
}): PaydayConversationResponsePayload | null {
  const intentText = normalizeQuickIntentText(message)
  if (!intentText) {
    return null
  }
  const hasActionableFinancialInput = hasQuickActionableFinancialInput(message)

  if (isGreetingIntent(intentText)) {
    return createStaticPaydayResponse(
      '안녕하세요. 월급이 들어왔을 때 쓸 돈, 지킬 돈, 남은 돈을 나눠서 같이 정리해드릴게요.',
      profile,
    )
  }

  if (isThanksIntent(intentText)) {
    return createStaticPaydayResponse(
      '좋아요. 지금 저장된 정보는 유지해둘게요. 다음에 조정할 항목만 말해주시면 이어서 정리하겠습니다.',
      profile,
    )
  }

  if (isAcknowledgementIntent(intentText)) {
    const nextAction = createDefaultNextActionRecommendation(profile)
    return createStaticPaydayResponse(
      `${nextAction.title} ${nextAction.description}`,
      profile,
      nextAction,
    )
  }

  if (isCapabilityQuestionIntent(intentText)) {
    return createStaticPaydayResponse(
      [
        '저는 월급을 받은 뒤 돈을 어떻게 나눌지 정리하는 Agent예요.',
        '월급·고정비·카드값·비상금·목표 저축을 확인하고, 사용내역을 보내주시면 지출 분포까지 이어서 정리할 수 있어요.',
      ].join('\n'),
      profile,
    )
  }

  if (
    !hasActionableFinancialInput &&
    isCurrentPlanSummaryIntent(intentText)
  ) {
    return createPlanSummaryResponse(profile, monthlySpending, appContext)
  }

  if (
    !hasActionableFinancialInput &&
    !isInvestmentResearchRequest(message) &&
    isNextStepQuestionIntent(intentText)
  ) {
    const nextAction = createDefaultNextActionRecommendation(profile)
    return createStaticPaydayResponse(
      `${nextAction.title} ${nextAction.description}`,
      profile,
      nextAction,
    )
  }

  return null
}

function createStaticPaydayResponse(
  reply: string,
  profile: FinancialProfile,
  nextActionRecommendation = createDefaultNextActionRecommendation(profile),
): PaydayConversationResponsePayload {
  return {
    reply,
    profilePatch: {},
    monthlySpendingProposal: undefined,
    missingData: [],
    appliedFacts: [],
    nextActionRecommendation,
  }
}

function createPlanSummaryResponse(
  profile: FinancialProfile,
  monthlySpending: MonthlySpendingSummary[],
  appContext: PaydayConversationAppContext | undefined,
): PaydayConversationResponsePayload {
  const summaryLines = createKnownPlanSummaryLines(
    profile,
    monthlySpending,
    appContext,
  )
  if (summaryLines.length === 0) {
    return {
      reply:
        '아직 저장된 월급 정보가 없어요. 월 실수령액부터 알려주시면 생활비, 목표 자금, 남은 돈 순서로 바로 나눠볼게요.',
      profilePatch: {},
      monthlySpendingProposal: undefined,
      missingData: ['월 실수령액'],
      appliedFacts: [],
      nextActionRecommendation: createDefaultNextActionRecommendation(profile),
    }
  }

  return {
    reply: ['현재 저장된 내용은 이렇습니다.', ...summaryLines].join('\n'),
    profilePatch: {},
    monthlySpendingProposal: undefined,
    missingData: [],
    appliedFacts: [],
    nextActionRecommendation: createDefaultNextActionRecommendation(profile),
  }
}

function createKnownPlanSummaryLines(
  profile: FinancialProfile,
  monthlySpending: MonthlySpendingSummary[],
  appContext: PaydayConversationAppContext | undefined,
): string[] {
  const lines: string[] = []

  if (profile.monthlySalary !== null) {
    lines.push(`- 월 실수령액: ${formatWonForReply(profile.monthlySalary)}`)
  }
  if (profile.essentialExpense !== null) {
    lines.push(`- 필수 생활비: ${formatWonForReply(profile.essentialExpense)}`)
  }
  if (profile.debtPayment !== null) {
    lines.push(`- 카드·부채 결제: ${formatWonForReply(profile.debtPayment)}`)
  }
  if (profile.currentEmergencyFund !== null) {
    lines.push(`- 현재 비상금: ${formatWonForReply(profile.currentEmergencyFund)}`)
  }
  if (profile.targetEmergencyFund !== null) {
    lines.push(`- 비상금 목표: ${formatWonForReply(profile.targetEmergencyFund)}`)
  }
  if (profile.goalName.trim()) {
    const goalAmount =
      profile.goalMonthlyAmount === null
        ? ''
        : ` ${formatWonForReply(profile.goalMonthlyAmount)}`
    lines.push(`- 목표 자금: ${profile.goalName}${goalAmount}`)
  }
  if (profile.flexibleSpending !== null) {
    lines.push(`- 여유 생활비: ${formatWonForReply(profile.flexibleSpending)}`)
  }
  if (profile.riskProfile !== null || profile.investmentHorizon !== null) {
    lines.push(
      `- 투자 조건: ${profile.riskProfile ?? '성향 미정'} · ${profile.investmentHorizon ?? '기간 미정'}`,
    )
  }
  if (profile.customUses.length > 0) {
    lines.push(
      `- 세부 사용처: ${profile.customUses
        .slice(0, 4)
        .map((use) => `${use.name} ${formatWonForReply(use.amount)}`)
        .join(', ')}`,
    )
  }

  const planSnapshot = appContext?.planSnapshot
  if (planSnapshot?.availableInvestmentAmount !== null && planSnapshot?.availableInvestmentAmount !== undefined) {
    lines.push(
      `- 앱 계산 기준 투자 가능 금액: ${formatWonForReply(planSnapshot.availableInvestmentAmount)}`,
    )
  }
  if (planSnapshot?.safetyStatus) {
    lines.push(`- 안전 상태: ${planSnapshot.safetyStatus}`)
  }

  const latestSpending = getLatestMonthlySpending(monthlySpending)
  if (latestSpending) {
    const totalExpense =
      latestSpending.totalExpense === null
        ? '금액 확인 필요'
        : formatWonForReply(latestSpending.totalExpense)
    lines.push(
      `- 최근 사용내역: ${formatMonthForReply(latestSpending.month)} ${totalExpense}`,
    )
  }

  return lines
}

function normalizeQuickIntentText(message: string): string {
  return normalizeKoreanText(message)
    .toLowerCase()
    .replace(/[?？!！.,。~"'`]/g, '')
}

function hasQuickActionableFinancialInput(message: string): boolean {
  return (
    /\d[\d,.\s]*(원|만원|만 원|억|천만)/.test(message) ||
    extractFixedExpenses(message).length > 0
  )
}

function isGreetingIntent(intentText: string): boolean {
  return ['안녕', '안녕하세요', '하이', 'hello', 'hi', '헬로'].includes(intentText)
}

function isThanksIntent(intentText: string): boolean {
  return ['고마워', '고맙습니다', '감사', '감사합니다', '땡큐', 'thanks', 'thankyou'].includes(intentText)
}

function isAcknowledgementIntent(intentText: string): boolean {
  return ['좋아', '좋아요', '오케이', 'ok', 'okay', 'ㅇㅋ', '네', '넵', '응', '알겠어', '알겠습니다'].includes(intentText)
}

function isCapabilityQuestionIntent(intentText: string): boolean {
  return (
    intentText.includes('뭐할수있어') ||
    intentText.includes('무엇을할수있어') ||
    intentText.includes('어떤걸할수있어') ||
    intentText.includes('어떻게써') ||
    intentText.includes('사용법') ||
    intentText.includes('도움말') ||
    intentText === 'help'
  )
}

function isCurrentPlanSummaryIntent(intentText: string): boolean {
  return (
    intentText.includes('현재상태') ||
    intentText.includes('저장된내용') ||
    intentText.includes('내정보') ||
    intentText.includes('계획요약') ||
    intentText.includes('요약해') ||
    intentText.includes('정리해줘') ||
    intentText.includes('상태보여')
  )
}

function isNextStepQuestionIntent(intentText: string): boolean {
  return (
    intentText.includes('다음뭐') ||
    intentText.includes('다음단계') ||
    intentText.includes('이제뭐') ||
    intentText.includes('뭘하면') ||
    intentText.includes('뭐하면돼') ||
    intentText.includes('추천액션')
  )
}

function formatWonForReply(value: number): string {
  return `${Math.round(value).toLocaleString()}원`
}

function createFallbackPaydayResponse(message: string): {
  reply: string
  profilePatch: Record<string, never>
  monthlySpendingProposal: undefined
  missingData: string[]
  appliedFacts: string[]
  nextActionRecommendation: {
    title: string
    description: string
    primaryLabel: string
    draft: string
  }
} {
  const hasSpendingSummaryRequest = isSpendingDataRequest(message)
  const hasSafetyRequest = isSafetyPriorityRequest(message)
  const hasInvestmentRequest = isInvestmentResearchRequest(message)

  if (hasSafetyRequest) {
    return {
      reply:
        '비상금, 카드값, 대출은 투자보다 먼저 확인해야 하는 항목이에요. 이미 알려주신 값은 유지하고, 부족한 항목만 기준으로 월급 배분 우선순위를 정리하겠습니다.',
      profilePatch: {},
      monthlySpendingProposal: undefined,
      missingData: [],
      appliedFacts: [],
      nextActionRecommendation: {
        title: '안전망 우선순위를 볼까요',
        description:
          '비상금과 카드값을 먼저 보고 남는 금액만 저축이나 투자로 넘깁니다.',
        primaryLabel: '우선순위 보기',
        draft:
          '현재 저장된 비상금, 카드값, 고정비를 기준으로 이번 달 월급 배분 우선순위를 정리해 주세요.',
      },
    }
  }

  if (hasSpendingSummaryRequest) {
    return {
      reply:
        '카드 내역 텍스트나 사진을 보내주시면 자료 월을 확인하고 카테고리별 지출 분포로 정리해볼게요.',
      profilePatch: {},
      monthlySpendingProposal: undefined,
      missingData: ['카드 내역 텍스트 또는 사진'],
      appliedFacts: [],
      nextActionRecommendation: {
        title: '사용내역을 분석해볼까요',
        description: '카드 내역을 보내주시면 자료 월을 판단하고 카테고리별 지출 분포로 정리해요.',
        primaryLabel: '사용내역 분석하기',
        draft: '카드 내역을 보고 자료 월을 먼저 판단한 뒤 카테고리별 지출 분포로 분석해 주세요.',
      },
    }
  }

  if (hasInvestmentRequest) {
    return {
      reply: createFallbackInvestmentResearchReply(),
      profilePatch: {},
      monthlySpendingProposal: undefined,
      missingData: [],
      appliedFacts: [],
      nextActionRecommendation: {
        title: '투자 후보 조사표를 만들까요',
        description:
          '확인된 투자금 안에서 역할별 후보, 확인할 출처, 주요 위험을 표로 정리합니다.',
        primaryLabel: '조사표 만들기',
        draft:
          '확인된 투자금과 투자 조건을 기준으로 ETF와 개별 종목 후보를 실제 티커 단위로 역할별 조사표로 정리해 주세요. 현재가와 재무 데이터는 출처가 있을 때만 써 주세요.',
      },
    }
  }

  return {
    reply:
      '방금 요청을 완성하지 못했지만, 저장된 월급 정보와 사용내역을 기준으로 다음 계획은 이어갈 수 있어요. 지금 단계에서 바로 조정할 항목을 골라 정리하겠습니다.',
    profilePatch: {},
    monthlySpendingProposal: undefined,
    missingData: [],
    appliedFacts: [],
    nextActionRecommendation: {
      title: '월급 계획을 이어갈까요',
      description: '저장된 금액과 사용내역을 기준으로 다음 조정안을 바로 만들 수 있어요.',
      primaryLabel: '계획 이어가기',
      draft: '지금까지 저장된 정보를 기준으로 다음에 조정하면 좋은 월급 계획을 제안해 주세요.',
    },
  }
}

function createFallbackInvestmentResearchReply(): string {
  return [
    '실시간 가격과 최신 실적은 출처가 있어야만 쓸 수 있어요. 대신 지금 확인된 투자금과 성향을 기준으로 실제 티커가 있는 검토 후보를 역할별로 정리합니다.',
    '| 역할 | 후보(티커) | 비중 초안 | 근거 | 주요 위험 | 추가 확인 자료 |',
    '| --- | --- | --- | --- | --- | --- |',
    '| 시장 중심 ETF | VOO 또는 SPY | 40~50% | 미국 대형주 분산 | 미국 시장 전반 하락 | 현재가·운용보수·추적오차 확인 필요 |',
    '| 성장 ETF | QQQM 또는 QQQ | 20~30% | 나스닥 100 성장주 노출 | 기술주 집중과 변동성 | 구성 종목·금리 민감도 확인 필요 |',
    '| 배당/방어 ETF | SCHD 또는 DGRO | 10~20% | 배당 성장과 방어 역할 | 성장주 대비 상승 제한 | 배당수익률·배당성장률 확인 필요 |',
    '| 개별 성장 후보 | MSFT 또는 AAPL | 0~15% | 대형 우량 기술주 후보 | 개별 기업 리스크 | 최신 실적·현금흐름·밸류에이션 확인 필요 |',
    '| 고변동 성장 후보 | NVDA | 0~10% | AI 반도체 성장 후보 | 고평가와 실적 변동성 | 최신 실적·가이던스·매출 집중도 확인 필요 |',
  ].join('\n')
}

function sanitizeNextActionRecommendation({
  recommendation,
  message,
  profile,
  monthlySpending,
  hasFreshMonthlySpendingProposal,
  appContext,
}: {
  recommendation: NextActionRecommendation
  message: string
  profile: FinancialProfile
  monthlySpending: MonthlySpendingSummary[]
  hasFreshMonthlySpendingProposal: boolean
  appContext: PaydayConversationAppContext | undefined
}): NextActionRecommendation {
  const currentIntent = getConversationIntent(message)
  const recommendedIntent = getConversationIntent(
    [
      recommendation.title,
      recommendation.description,
      recommendation.primaryLabel,
      recommendation.draft,
    ].join(' '),
  )
  const completedIntents = new Set<ConversationIntent>(
    (appContext?.completedActions ?? []) as ConversationIntent[],
  )
  const hasSpendingContext =
    monthlySpending.length > 0 || hasFreshMonthlySpendingProposal
  if (hasSpendingContext) {
    completedIntents.add('spending_distribution')
  }

  const contextualRecommendation = createContextualNextActionRecommendation(
    currentIntent,
    profile,
    hasSpendingContext,
  )
  const isMismatchedCurrentIntent =
    currentIntent !== null &&
    recommendedIntent !== null &&
    recommendedIntent !== currentIntent
  const repeatsCompletedDifferentIntent =
    recommendedIntent !== null &&
    recommendedIntent !== currentIntent &&
    completedIntents.has(recommendedIntent)

  if (
    contextualRecommendation &&
    (isMismatchedCurrentIntent || repeatsCompletedDifferentIntent)
  ) {
    return contextualRecommendation
  }

  if (
    recommendedIntent === 'spending_distribution' &&
    currentIntent !== 'spending_distribution' &&
    hasSpendingContext
  ) {
    return contextualRecommendation ?? createDefaultNextActionRecommendation(profile)
  }

  return recommendation
}

function sanitizeSecondaryActionRecommendations({
  recommendations,
  primaryRecommendation,
  message,
  monthlySpending,
  hasFreshMonthlySpendingProposal,
  appContext,
}: {
  recommendations: NextActionRecommendation[]
  primaryRecommendation: NextActionRecommendation
  message: string
  monthlySpending: MonthlySpendingSummary[]
  hasFreshMonthlySpendingProposal: boolean
  appContext: PaydayConversationAppContext | undefined
}): NextActionRecommendation[] {
  const currentIntent = getConversationIntent(message)
  const completedIntents = new Set<ConversationIntent>(
    (appContext?.completedActions ?? []) as ConversationIntent[],
  )
  const hasSpendingContext =
    monthlySpending.length > 0 || hasFreshMonthlySpendingProposal
  if (hasSpendingContext) {
    completedIntents.add('spending_distribution')
  }
  const primaryDraft = normalizeKoreanText(primaryRecommendation.draft)
  const seenDrafts = new Set<string>([primaryDraft])

  return recommendations.filter((recommendation) => {
    const normalizedDraft = normalizeKoreanText(recommendation.draft)
    if (!normalizedDraft || seenDrafts.has(normalizedDraft)) {
      return false
    }

    const recommendedIntent = getConversationIntent(
      [
        recommendation.title,
        recommendation.description,
        recommendation.primaryLabel,
        recommendation.draft,
      ].join(' '),
    )
    if (
      recommendedIntent === 'spending_distribution' &&
      currentIntent !== 'spending_distribution' &&
      hasSpendingContext
    ) {
      return false
    }
    if (
      recommendedIntent !== null &&
      currentIntent !== null &&
      recommendedIntent !== currentIntent &&
      completedIntents.has(recommendedIntent)
    ) {
      return false
    }

    seenDrafts.add(normalizedDraft)
    return true
  })
}

function createContextualNextActionRecommendation(
  intent: ConversationIntent | null,
  profile: FinancialProfile,
  hasSpendingContext: boolean,
): NextActionRecommendation | null {
  switch (intent) {
    case 'investment_research':
      return {
        title: '투자 후보를 이어서 볼까요',
        description:
          '방금 포트폴리오 맥락에서 ETF와 후보군을 더 좁혀 비교합니다.',
        primaryLabel: '후보 더 비교',
        draft:
          '방금 포트폴리오 초안을 기준으로 ETF와 개별 종목 후보를 더 좁혀서 장단점과 확인할 자료를 비교해 주세요.',
      }
    case 'preference_adjust':
      return {
        title: '지킨 소비 기준으로 조정할까요',
        description:
          '외식과 여행을 유지하고 줄일 수 있는 항목만 다시 좁힙니다.',
        primaryLabel: '조정 항목 좁히기',
        draft:
          '외식과 여행은 유지하고, 나머지 지출 중 줄일 후보만 우선순위로 정리해 주세요.',
      }
    case 'spending_distribution':
      return hasSpendingContext
        ? {
            title: '분석한 내역으로 조정할까요',
            description:
              '이미 확인한 사용내역을 기준으로 과한 항목과 유지할 항목을 나눕니다.',
            primaryLabel: '지출 조정',
            draft:
              '이미 분석한 사용내역을 기준으로 과한 항목과 유지할 항목을 나눠 월급 조정안을 제안해 주세요.',
          }
        : createSpendingDataNextActionRecommendation()
    case 'safety_check':
      return {
        title: '안전망 기준으로 이어볼까요',
        description:
          '비상금과 카드값을 기준으로 이번 달 먼저 지킬 금액을 구체화합니다.',
        primaryLabel: '우선순위 구체화',
        draft:
          '방금 안전망 점검 결과를 기준으로 이번 달 먼저 지킬 금액과 조정할 금액을 구체화해 주세요.',
      }
    case 'detail_adjust':
      return {
        title: '이번 월급 계획을 확인할까요',
        description:
          '방금 조정한 세부 사용처가 반영됐어요. 이제 전체 배분을 확인하면 됩니다.',
        primaryLabel: '계획 보기',
        draft: '지금까지 반영된 월급 계획 전체를 확인해 주세요.',
      }
    case 'detail_plan':
    case 'detail_compare':
      return {
        title: '세부 사용처를 이어서 다듬을까요',
        description:
          '방금 정한 사용처를 유지하면서 과하거나 부족한 항목만 조정합니다.',
        primaryLabel: '세부 항목 다듬기',
        draft:
          '방금 정한 세부 사용처를 기준으로 과하거나 부족한 항목만 골라 조정해 주세요.',
      }
    case 'fixed_costs':
      return {
        title: '고정비 기준으로 이어볼까요',
        description:
          '매달 먼저 나갈 돈을 유지하고 변동비에서 조정할 항목을 찾습니다.',
        primaryLabel: '변동비 조정',
        draft:
          '확인된 고정비는 유지하고, 변동비에서 줄일 수 있는 항목을 우선순위로 정리해 주세요.',
      }
    case 'salary':
      return profile.monthlySalary === null
        ? createDefaultNextActionRecommendation(profile)
        : {
            title: '월급 기준으로 다음을 정할까요',
            description:
              '월급 기준은 잡혔으니 사용내역, 고정비, 목표 중 하나를 이어서 반영합니다.',
            primaryLabel: '사용내역 반영',
            draft:
              '입력했던 월급 기준으로 사용내역과 고정비를 반영해 월급 계획을 이어서 정리해 주세요.',
          }
    default:
      return null
  }
}

function createSpendingDataNextActionRecommendation(): NextActionRecommendation {
  return {
    title: '사용내역을 다시 보내주세요',
    description:
      '카드 내역 텍스트나 이미지를 받아야 자료 월과 지출 금액을 확인할 수 있어요.',
    primaryLabel: '사용내역 보내기',
    draft:
      '분석할 카드 사용내역을 다시 보낼게요. 자료 월을 먼저 판단한 뒤 카테고리별 지출 분포로 정리해 주세요.',
  }
}

function getConversationIntent(message: string): ConversationIntent | null {
  const normalizedMessage = normalizeKoreanText(message)
  if (!normalizedMessage) {
    return null
  }

  if (
    normalizedMessage.includes('외식') ||
    normalizedMessage.includes('여행') ||
    normalizedMessage.includes('취향') ||
    normalizedMessage.includes('줄이고싶지')
  ) {
    return 'preference_adjust'
  }
  if (isInvestmentResearchRequest(message)) {
    return 'investment_research'
  }
  if (
    normalizedMessage.includes('조정안') ||
    normalizedMessage.includes('조정해') ||
    normalizedMessage.includes('보완안') ||
    normalizedMessage.includes('부족한항목') ||
    normalizedMessage.includes('과한항목')
  ) {
    return 'detail_adjust'
  }
  if (
    normalizedMessage.includes('비교') ||
    normalizedMessage.includes('다른지') ||
    normalizedMessage.includes('차이') ||
    normalizedMessage.includes('맞춰')
  ) {
    return 'detail_compare'
  }
  if (
    normalizedMessage.includes('세부계획') ||
    normalizedMessage.includes('세부사용처') ||
    normalizedMessage.includes('각범주') ||
    normalizedMessage.includes('어디에얼마')
  ) {
    return 'detail_plan'
  }
  if (isSafetyPriorityRequest(message)) {
    return 'safety_check'
  }
  if (
    normalizedMessage.includes('월세') ||
    normalizedMessage.includes('보험료') ||
    normalizedMessage.includes('통신비') ||
    normalizedMessage.includes('관리비') ||
    normalizedMessage.includes('고정비')
  ) {
    return 'fixed_costs'
  }
  if (isSpendingDataRequest(message)) {
    return 'spending_distribution'
  }
  if (
    normalizedMessage.includes('월실수령액') ||
    normalizedMessage.includes('실수령액') ||
    normalizedMessage.includes('월급')
  ) {
    return 'salary'
  }

  return null
}

function buildPaydayConversationPrompt({
  profile,
  monthlySpending,
  appContext,
  recentMessages,
  message,
  targetMonth,
}: {
  profile: FinancialProfile
  monthlySpending: Array<z.infer<typeof monthlySpendingSummarySchema>>
  appContext: PaydayConversationAppContext | undefined
  recentMessages: Array<{ role: 'agent' | 'user'; content: string }>
  message: string
  targetMonth: string | undefined
}): string {
  return [
    `Application flow context:\n${JSON.stringify(appContext ?? null)}`,
    `Confirmed profile:\n${JSON.stringify(compactFinancialProfile(profile))}`,
    `Confirmed spending summaries:\n${JSON.stringify(compactMonthlySpending(monthlySpending))}`,
    `Recent conversation:\n${JSON.stringify(compactRecentMessages(recentMessages))}`,
    `Current user message:\n${message || '(no text)'}`,
    `Target month:\n${targetMonth ?? '(auto)'}`,
  ].join('\n\n')
}

function buildPaydayConversationInstruction({
  message,
  attachmentsCount,
  appContext,
}: {
  message: string
  attachmentsCount: number
  appContext: PaydayConversationAppContext | undefined
}): string {
  return [
    ...createBasePaydayInstructions(),
    ...createFlowInstructions(appContext),
    ...createIntentInstructions(message, attachmentsCount),
  ].join('\n')
}

function createBasePaydayInstructions(): string[] {
  return [
    'You are SKale, a Korean payday-planning agent.',
    'Always write user-facing fields in polite Korean honorific style. Do not mix 반말 and 존댓말.',
    'Return JSON that follows the response schema.',
    'Keep reply concise. Ask at most one follow-up only when it materially changes the next action.',
    'Only put clearly stated or directly visible facts into profilePatch. Return null for unchanged profilePatch fields.',
    'Use user-facing labels 안정형, 균형형, 공격형. Treat 성장형 as 공격형.',
    'Do not ask again for facts already present in Application flow context, confirmed profile, or recent conversation.',
    'The current user message is authoritative. Continue the user’s current intent instead of pivoting back to a default checklist or older stage.',
    'nextActionRecommendation must be a natural continuation of the current user message. Do not recommend spending history, safety checks, preferences, or investment research unless that is the current intent or directly necessary to complete it.',
    'The app calculates salary allocations and investable cash. Do not claim the model finalized those amounts.',
    'Always return nextActionRecommendation as a concrete Korean message the user can send next.',
    'When useful, return secondaryActionRecommendations with 1 to 3 distinct next actions that are also natural continuations. Do not repeat the primary action, completed actions, or requests for data already provided.',
    'If the message is unrelated or unintelligible, answer with a gentle 잘 모르겠어요-style scope guide and return no proposals.',
  ]
}

function createFlowInstructions(
  appContext: PaydayConversationAppContext | undefined,
): string[] {
  const instructions = [
    'Use Application flow context as the strongest signal for nextActionRecommendation.',
    'Follow recommendationPolicy.priority and avoid recommendationPolicy.avoid unless the current user explicitly asks otherwise.',
    'Treat confirmedFacts as already known; do not ask the user to repeat them.',
    'Treat completedActions as already handled user intents. Do not recommend the same completed action again; choose a different next action.',
  ]

  if (appContext?.stage === 'salary_only') {
    instructions.push(
      'Stage salary_only: recommend spending history, fixed costs, emergency fund, debt/card payment, or budget details next. Do not recommend investment candidates, stock analysis, or portfolio construction.',
    )
  }

  return instructions
}

function createIntentInstructions(
  message: string,
  attachmentsCount: number,
): string[] {
  const instructions: string[] = []
  const isSpendingRequest =
    attachmentsCount > 0 ||
    isSpendingDataRequest(message)
  const isSafetyRequest = isSafetyPriorityRequest(message)
  const isInvestmentRequest =
    !isSafetyRequest && isInvestmentResearchRequest(message)
  const isDetailBudgetRequest = isDetailPlanningRequest(message)
  const isDetailComparison = isDetailComparisonRequest(message)

  if (isSpendingRequest) {
    instructions.push(
      'For spending data, create monthlySpendingProposal only from current text/images. Infer target month when visible. Group verifiable expenses into user-friendly categoryBreakdown. Exclude transfers, savings, investments, refunds, and income.',
      'If month or numbers are unclear, set needReview true and ask one concise clarification.',
    )
  }

  if (isSafetyRequest) {
    instructions.push(
      'For safety-priority requests about emergency fund, card payment, debt, or loan repayment, do not turn the answer into investment research. Check saved facts first and propose a practical monthly allocation priority.',
    )
  }

  if (isDetailComparison) {
    instructions.push(
      'For requests comparing saved detailed uses with actual card/spending history, do not recreate the same customUses. Compare planned vs actual amounts, identify gaps, and recommend one adjustment step.',
    )
  }

  if (isDetailBudgetRequest) {
    instructions.push(
      'For detailed budget planning, propose practical customUses for known bucket amounts instead of interrogating every sub-item. Preserve existing customUses unless the user asks to change them.',
      'Never invent a custom-use amount. If an amount is missing, ask one concise clarification.',
    )
  }

  if (isInvestmentRequest) {
    instructions.push(
      'For investment questions, answer the investment request directly when an investable amount or portfolio request is provided. Mention safety constraints briefly only as context; do not turn the response into a safety-check question unless investment amount cannot be determined at all.',
      'For investment research requests, return concrete research candidates with real tickers whenever possible. Do not answer only with broad product groups such as S&P 500 ETF or Nasdaq 100 ETF; write examples such as VOO/SPY, QQQM/QQQ, SCHD/DGRO, MSFT/AAPL, or NVDA when they fit the role.',
      'Prefer a compact markdown table with columns 역할, 후보(티커), 비중 초안, 근거, 주요 위험, 추가 확인 자료. Include both ETF candidates and individual-stock candidates when the user asks for ETF and stocks. Keep each cell short enough for mobile. If current data is missing, write 확인 필요 instead of inventing it.',
      'Do not give buy/sell/hold instructions. Frame securities as research candidates or reference allocations, not personalized recommendations.',
      'Do not invent current prices, recent earnings, valuation multiples, news, rankings, reports, exact quotes, tax rules, or legal details. Use only source-backed data provided by the user; otherwise say live/source verification is needed.',
    )
  }

  if (!isInvestmentRequest) {
    instructions.push(
      'Do not introduce investment candidates unless the current stage and user request make investment appropriate.',
    )
  }

  return instructions
}

function compactFinancialProfile(profile: FinancialProfile): Partial<FinancialProfile> {
  return Object.fromEntries(
    Object.entries(profile).filter(([, value]) => {
      if (value === null) {
        return false
      }
      if (Array.isArray(value)) {
        return value.length > 0
      }
      if (typeof value === 'string') {
        return value.trim().length > 0
      }
      return true
    }),
  ) as Partial<FinancialProfile>
}

function compactMonthlySpending(
  summaries: Array<z.infer<typeof monthlySpendingSummarySchema>>,
): Array<{
  month: string
  totalExpense: number | null
  essentialExpense: number | null
  flexibleExpense: number | null
  categoryBreakdown: Array<{ category: string; amount: number }>
  needReview: boolean
}> {
  return summaries.slice(-6).map((summary) => ({
    month: summary.month,
    totalExpense: summary.totalExpense,
    essentialExpense: summary.essentialExpense,
    flexibleExpense: summary.flexibleExpense,
    categoryBreakdown: summary.categoryBreakdown.slice(0, 8),
    needReview: summary.needReview,
  }))
}

function compactRecentMessages(
  messages: Array<{ role: 'agent' | 'user'; content: string }>,
): Array<{ role: 'agent' | 'user'; content: string }> {
  return messages.slice(-8).map((message) => ({
    role: message.role,
    content:
      message.content.length > 1_500
        ? `${message.content.slice(0, 1_480)}...`
        : message.content,
  }))
}

function createDeterministicFixedExpenseResponse(
  message: string,
  profile: FinancialProfile,
): {
  reply: string
  profilePatch: PaydayProfilePatch
  monthlySpendingProposal: undefined
  missingData: string[]
  appliedFacts: string[]
  nextActionRecommendation: {
    title: string
    description: string
    primaryLabel: string
    draft: string
  }
} | null {
  const fixedExpenses = extractFixedExpenses(message)
  if (fixedExpenses.length === 0) {
    return null
  }

  const mergedCustomUses = mergeCustomUses(profile.customUses, fixedExpenses)
  const addedText = fixedExpenses
    .map((expense) => `${expense.name} ${expense.amount.toLocaleString()}원`)
    .join(', ')
  const essentialTotal = mergedCustomUses
    .filter((use) => use.bucket === 'essential')
    .reduce((total, use) => total + use.amount, 0)

  return {
    reply:
      `${addedText}을 매달 먼저 나가는 필수 생활비로 반영했어요. 이제 확인된 필수 생활비는 ${essentialTotal.toLocaleString()}원입니다.`,
    profilePatch: { customUses: mergedCustomUses },
    monthlySpendingProposal: undefined,
    missingData: [],
    appliedFacts: [`고정비 ${addedText} 반영`],
    nextActionRecommendation: {
      title: '비상금과 카드값을 점검할까요',
      description:
        '고정비를 반영했으니 비상금 현황과 갚아야 할 카드값을 먼저 확인해 안전한 배분을 만들 수 있어요.',
      primaryLabel: '비상금·카드값 점검',
      draft:
        '현재 비상금과 이번 달 갚아야 할 카드값을 기준으로 월급 배분 우선순위를 점검해 주세요.',
    },
  }
}

function extractFixedExpenses(
  message: string,
): Array<{ name: string; amount: number; bucket: 'essential'; note: string }> {
  const expenseNames = ['월세', '보험료', '보험', '통신비', '구독료', '교통비', '관리비']
  const expenses: Array<{ name: string; amount: number; bucket: 'essential'; note: string }> = []

  for (const name of expenseNames) {
    const pattern = new RegExp(`${name}[^\\d]{0,12}([\\d,]+(?:\\.\\d+)?)\\s*(만원|만 원|원)`)
    const match = message.match(pattern)
    if (!match) {
      continue
    }
    const amount = parseKoreanMoneyAmount(match[1], match[2])
    if (amount > 0) {
      expenses.push({
        name: name === '보험' ? '보험료' : name,
        amount,
        bucket: 'essential',
        note: '월급날 먼저 분리',
      })
    }
  }

  return deduplicateFixedExpenses(expenses)
}

function parseKoreanMoneyAmount(rawAmount: string, unit: string): number {
  const amount = Number(rawAmount.replaceAll(',', ''))
  if (!Number.isFinite(amount) || amount <= 0) {
    return 0
  }
  return unit.includes('만') ? Math.round(amount * 10_000) : Math.round(amount)
}

function deduplicateFixedExpenses(
  expenses: Array<{ name: string; amount: number; bucket: 'essential'; note: string }>,
): Array<{ name: string; amount: number; bucket: 'essential'; note: string }> {
  return [...new Map(expenses.map((expense) => [expense.name, expense])).values()]
}

function mergeCustomUses(
  currentUses: FinancialProfile['customUses'],
  fixedExpenses: Array<{ name: string; amount: number; bucket: 'essential'; note: string }>,
): FinancialProfile['customUses'] {
  const fixedExpenseNames = new Set(fixedExpenses.map((expense) => expense.name))
  return [
    ...currentUses.filter((use) => !fixedExpenseNames.has(use.name)),
    ...fixedExpenses,
  ]
}

function createDeterministicDetailPlanResponse(
  message: string,
  profile: FinancialProfile,
): {
  reply: string
  profilePatch: PaydayProfilePatch
  monthlySpendingProposal: undefined
  missingData: string[]
  appliedFacts: string[]
  nextActionRecommendation: {
    title: string
    description: string
    primaryLabel: string
    draft: string
  }
} | null {
  if (!isDetailPlanningRequest(message)) {
    return null
  }

  if (profile.monthlySalary === null) {
    return {
      reply:
        '세부 사용 계획을 만들려면 먼저 월 실수령액이 필요해요. 월급이 들어오는 금액만 알려주시면 바로 범주별 초안을 잡겠습니다.',
      profilePatch: {},
      monthlySpendingProposal: undefined,
      missingData: ['월 실수령액'],
      appliedFacts: [],
      nextActionRecommendation: createDefaultNextActionRecommendation(profile),
    }
  }

  if (profile.customUses.length > 0) {
    const shouldAdjustExistingUses = isDetailAdjustmentRequest(message)
    const latestNextAction = shouldAdjustExistingUses
      ? {
          title: '차이가 큰 항목을 조정할까요',
          description:
            '저장된 세부 사용처에서 과하거나 부족한 항목만 조정할 수 있어요.',
          primaryLabel: '조정안 만들기',
          draft:
            '최근 사용내역과 저장된 세부 사용처의 차이를 기준으로 과하거나 부족한 항목만 조정해 주세요.',
        }
      : {
          title: '실제 사용내역과 맞춰볼까요',
          description:
            '이미 저장된 세부 사용처가 있으니 새로 만들기보다 카드 내역과 비교해 조정할 곳을 찾는 편이 좋아요.',
          primaryLabel: '사용내역 비교',
          draft:
            '최근 카드 내역을 기준으로 저장된 세부 사용처와 실제 지출이 어떻게 다른지 비교해 주세요.',
        }

    return {
      reply:
        '이미 세부 사용처가 저장되어 있어요. 실제 사용내역과 비교하거나 마음에 안 드는 항목만 조정하겠습니다.',
      profilePatch: {},
      monthlySpendingProposal: undefined,
      missingData: [],
      appliedFacts: [],
      nextActionRecommendation: latestNextAction,
    }
  }

  const customUses = createDetailPlanCustomUses(profile)
  if (customUses.length === 0) {
    return {
      reply:
        '이미 등록된 세부 사용처를 기준으로 이번 월급 계획에 반영해둘게요. 바꾸고 싶은 항목만 말해주세요.',
      profilePatch: {},
      monthlySpendingProposal: undefined,
      missingData: [],
      appliedFacts: ['등록된 세부 사용처가 이미 있어요.'],
      nextActionRecommendation: {
        title: '세부 항목을 조정할까요',
        description: '이미 등록된 사용처 중 마음에 안 드는 항목만 말하면 그 부분만 다시 배분해요.',
        primaryLabel: '세부 항목 조정하기',
        draft: '등록된 세부 사용처 중에서 과하거나 부족한 항목을 찾아서 조정안을 제안해 주세요.',
      },
    }
  }

  return {
    reply: [
      '좋아요. 저장된 월급 계획을 기준으로 먼저 세부 사용처 초안을 잡았어요.',
      describeCustomUses(customUses),
      '이대로 반영해두고, 마음에 안 드는 항목만 말해주시면 그 부분만 다시 조정할게요.',
    ].join('\n\n'),
    profilePatch: { customUses },
    monthlySpendingProposal: undefined,
    missingData: [],
    appliedFacts: ['월급 계획의 배분 금액을 기준으로 세부 사용처 초안을 만들었어요.'],
    nextActionRecommendation: {
      title: '실제 사용내역과 맞춰볼까요',
      description:
        '세부 사용처를 반영한 뒤 카드 내역과 비교하면 과하거나 부족한 항목을 바로 찾을 수 있어요.',
      primaryLabel: '사용내역 비교',
      draft:
        '최근 카드 내역을 기준으로 저장된 세부 사용처와 실제 지출이 어떻게 다른지 비교해 주세요.',
    },
  }
}

function createDeterministicDetailComparisonResponse(
  message: string,
  profile: FinancialProfile,
  monthlySpending: Array<z.infer<typeof monthlySpendingSummarySchema>>,
): {
  reply: string
  profilePatch: PaydayProfilePatch
  monthlySpendingProposal: undefined
  missingData: string[]
  appliedFacts: string[]
  nextActionRecommendation: {
    title: string
    description: string
    primaryLabel: string
    draft: string
  }
} | null {
  if (!isDetailComparisonRequest(message)) {
    return null
  }

  const latestSpending = getLatestMonthlySpending(monthlySpending)
  if (!latestSpending) {
    return {
      reply:
        '비교하려면 먼저 카드 사용내역이 필요해요. 사용내역 사진이나 텍스트를 보내주시면 자료 월을 판단해서 지출 분포부터 정리하겠습니다.',
      profilePatch: {},
      monthlySpendingProposal: undefined,
      missingData: ['카드 사용내역'],
      appliedFacts: [],
      nextActionRecommendation: createDefaultNextActionRecommendation(profile),
    }
  }

  if (profile.customUses.length === 0) {
    return {
      reply:
        '카드 사용내역은 확인되어 있어요. 다만 비교할 세부 사용처가 아직 없어서, 먼저 이번 월급의 범주별 사용처 초안을 잡겠습니다.',
      profilePatch: {},
      monthlySpendingProposal: undefined,
      missingData: [],
      appliedFacts: [],
      nextActionRecommendation: {
        title: '세부 사용처를 먼저 잡을까요',
        description:
          '저장된 월급 계획을 실제 지출 항목으로 나누면 카드 내역과 바로 비교할 수 있어요.',
        primaryLabel: '세부 계획하기',
        draft:
          '이번 월급 계획의 각 범주별로 실제 어디에 얼마를 쓸지 세부 계획을 같이 세워 주세요.',
      },
    }
  }

  const plannedEssential = sumCustomUses(profile.customUses, 'essential')
  const plannedFlexible = sumCustomUses(profile.customUses, 'flexible')
  const actualEssential = latestSpending.essentialExpense ?? 0
  const actualFlexible = latestSpending.flexibleExpense ?? 0
  const notableCategories = latestSpending.categoryBreakdown
    .slice()
    .sort((left, right) => right.amount - left.amount)
    .slice(0, 3)
    .map((item) => `${item.category} ${item.amount.toLocaleString()}원`)

  const comparisonLines = [
    createDifferenceLine('필수 생활비', plannedEssential, actualEssential),
    createDifferenceLine('여유 생활비', plannedFlexible, actualFlexible),
  ]
  const categoryLine =
    notableCategories.length > 0
      ? `가장 큰 실제 지출은 ${notableCategories.join(', ')}입니다.`
      : '카테고리별 실제 지출은 아직 충분히 세분화되어 있지 않아요.'

  return {
    reply: [
      `${formatMonthForReply(latestSpending.month)} 카드 내역과 저장된 세부 사용처를 비교했어요.`,
      comparisonLines.join('\n'),
      categoryLine,
      '여유 생활비 쪽을 먼저 조정하면 이번 월급 계획에 더 가깝게 맞출 수 있어요.',
    ].join('\n\n'),
    profilePatch: {},
    monthlySpendingProposal: undefined,
    missingData: [],
    appliedFacts: [],
    nextActionRecommendation: {
      title: '차이가 큰 항목을 조정할까요',
      description:
        '생활비와 여유 지출 중 차이가 큰 항목만 다시 배분할 수 있어요.',
      primaryLabel: '조정안 만들기',
      draft:
        '방금 비교 결과를 기준으로 과하거나 부족한 세부 사용처만 골라 월급 계획 조정안을 만들어 주세요.',
    },
  }
}

function createDeterministicDetailAdjustmentResponse(
  message: string,
  profile: FinancialProfile,
  monthlySpending: Array<z.infer<typeof monthlySpendingSummarySchema>>,
): {
  reply: string
  profilePatch: PaydayProfilePatch
  monthlySpendingProposal: undefined
  missingData: string[]
  appliedFacts: string[]
  nextActionRecommendation: {
    title: string
    description: string
    primaryLabel: string
    draft: string
  }
} | null {
  if (!isDetailAdjustmentRequest(message)) {
    return null
  }

  const latestSpending = getLatestMonthlySpending(monthlySpending)
  if (!latestSpending || profile.customUses.length === 0) {
    return null
  }

  const actualEssential = latestSpending.essentialExpense ?? 0
  const actualFlexible = latestSpending.flexibleExpense ?? 0
  const adjustedCustomUses = adjustCustomUsesToActualSpending(
    profile.customUses,
    actualEssential,
    actualFlexible,
  )
  const plannedEssential = sumCustomUses(profile.customUses, 'essential')
  const plannedFlexible = sumCustomUses(profile.customUses, 'flexible')
  const adjustedEssential = sumCustomUses(adjustedCustomUses, 'essential')
  const adjustedFlexible = sumCustomUses(adjustedCustomUses, 'flexible')
  const hasChangedCustomUses = !areCustomUsesEquivalent(
    profile.customUses,
    adjustedCustomUses,
  )

  return {
    reply: [
      hasChangedCustomUses
        ? `${formatMonthForReply(latestSpending.month)} 지출을 기준으로 세부 사용처를 조정했어요.`
        : `${formatMonthForReply(latestSpending.month)} 지출 기준으로 이미 세부 사용처가 맞춰져 있어요.`,
      [
        createAdjustmentLine('필수 생활비', plannedEssential, adjustedEssential),
        createAdjustmentLine('여유 생활비', plannedFlexible, adjustedFlexible),
      ].join('\n'),
      describeCustomUses(adjustedCustomUses),
      hasChangedCustomUses
        ? '이 금액으로 반영해둘게요. 이제 전체 월급 계획을 확인하면 됩니다.'
        : '더 조정할 금액이 없어 같은 작업을 반복하지 않겠습니다. 이제 전체 월급 계획을 확인해 주세요.',
    ].join('\n\n'),
    profilePatch: hasChangedCustomUses ? { customUses: adjustedCustomUses } : {},
    monthlySpendingProposal: undefined,
    missingData: [],
    appliedFacts: [],
    nextActionRecommendation: {
      title: '이번 월급 계획을 확인할까요',
      description:
        '세부 사용처 조정을 마쳤으니 전체 배분을 확인하면 됩니다.',
      primaryLabel: '계획 보기',
      draft: '지금까지 반영된 월급 계획 전체를 확인해 주세요.',
    },
  }
}

function createDeterministicInvestmentAllocationResponse(
  message: string,
  profile: FinancialProfile,
): {
  reply: string
  profilePatch: PaydayProfilePatch
  monthlySpendingProposal: undefined
  missingData: string[]
  appliedFacts: string[]
  nextActionRecommendation: NextActionRecommendation
} | null {
  const amount = extractInvestmentShiftAmount(message)
  if (amount <= 0) {
    return null
  }

  const currentFlexibleSpending =
    profile.flexibleSpending ??
    (profile.monthlySalary !== null
      ? Math.round(profile.monthlySalary * 0.1)
      : null)
  if (currentFlexibleSpending === null) {
    return {
      reply:
        '투자금으로 옮길 금액은 이해했어요. 다만 여유 생활비 기준이 아직 없어 얼마를 줄일지 확정할 수 없습니다. 먼저 월 실수령액이나 여유 생활비 기준을 알려주시면 바로 반영해 드릴게요.',
      profilePatch: {},
      monthlySpendingProposal: undefined,
      missingData: ['월 실수령액 또는 여유 생활비'],
      appliedFacts: [],
      nextActionRecommendation: {
        title: '월급 기준을 먼저 정할까요',
        description:
          '투자금은 월급 배분에서 남는 금액으로 계산되므로 기준 금액이 먼저 필요해요.',
        primaryLabel: '월급 입력',
        draft: '월 실수령액과 여유 생활비 기준을 먼저 반영해 주세요.',
      },
    }
  }

  const nextFlexibleSpending = Math.max(currentFlexibleSpending - amount, 0)
  const shiftedAmount = currentFlexibleSpending - nextFlexibleSpending
  return {
    reply: [
      `여유 생활비에서 ${formatWonForReply(shiftedAmount)}을 줄여 투자금으로 남기도록 조정했어요.`,
      `여유 생활비는 ${formatWonForReply(currentFlexibleSpending)}에서 ${formatWonForReply(nextFlexibleSpending)}으로 바뀝니다.`,
      '이 금액은 지난 사용내역이나 목표 자금이 아니라, 이번 월급 배분에서 장기 투자 가능 금액으로 계산됩니다. 투자 후보를 더 비교해 보시겠어요?',
    ].join('\n\n'),
    profilePatch: { flexibleSpending: nextFlexibleSpending },
    monthlySpendingProposal: undefined,
    missingData: [],
    appliedFacts: [`여유 생활비 ${formatWonForReply(shiftedAmount)} 투자 여력으로 이동`],
    nextActionRecommendation: {
      title: '투자 후보를 비교할까요',
      description:
        '조정된 투자 가능 금액을 기준으로 ETF와 개별 후보를 역할별로 비교합니다.',
      primaryLabel: '후보 비교',
      draft:
        '조정된 이번 달 투자 가능 금액을 기준으로 ETF와 개별 종목 후보를 역할별로 비교해 주세요. 현재가와 재무 데이터는 출처가 있을 때만 사용해 주세요.',
    },
  }
}

function extractInvestmentShiftAmount(message: string): number {
  const normalizedMessage = normalizeKoreanText(message)
  if (
    !normalizedMessage.includes('투자') ||
    !(
      normalizedMessage.includes('여유생활비') ||
      normalizedMessage.includes('생활비에서') ||
      normalizedMessage.includes('줄여')
    )
  ) {
    return 0
  }

  const amountMatch = message.match(/([\d,]+(?:\.\d+)?)\s*(만원|만 원|원)/)
  if (!amountMatch) {
    return 0
  }
  return parseKoreanMoneyAmount(amountMatch[1], amountMatch[2])
}

function createDefaultNextActionRecommendation(profile: FinancialProfile): {
  title: string
  description: string
  primaryLabel: string
  draft: string
} {
  if (profile.monthlySalary === null) {
    return {
      title: '월 실수령액부터 입력할까요',
      description: '월급 기준이 있어야 생활비, 목표 자금, 투자금 초안을 바로 계산할 수 있어요.',
      primaryLabel: '월급 알려주기',
      draft: '월 실수령액을 입력해서 월급 계획을 시작해 주세요.',
    }
  }

  if (hasOnlyMonthlySalary(profile)) {
    return {
      title: '사용내역을 붙여볼까요',
      description:
        '월급 기준은 잡혔으니 카드 내역이나 고정비를 더해 실제 생활비 기준으로 계획을 맞춰볼 수 있어요.',
      primaryLabel: '사용내역 분석',
      draft:
        '카드 내역을 보고 자료 월을 먼저 판단한 뒤 카테고리별 지출 분포로 분석해 주세요.',
    }
  }

  if (profile.customUses.length === 0) {
    return {
      title: '세부 사용처를 잡아볼까요',
      description: '이미 계산된 큰 범주를 실제 지출 항목으로 나누면 계획을 바로 실행하기 쉬워져요.',
      primaryLabel: '세부 계획하기',
      draft: '이번 월급 계획의 각 범주별로 실제 어디에 얼마를 쓸지 세부 계획을 같이 세워 주세요.',
    }
  }

  if (profile.riskProfile !== null && profile.investmentHorizon !== null) {
    return {
      title: '투자 후보를 조사할까요',
      description:
        '저장된 투자 성향과 기간을 기준으로 후보를 비교하되, 최신 가격과 재무 데이터는 출처가 있을 때만 활용해요.',
      primaryLabel: '종목 조사하기',
      draft:
        '저장된 월급 계획과 투자 성향, 투자 기간을 기준으로 ETF와 종목 후보를 비교해 주세요. 현재가와 재무 데이터는 출처가 있을 때만 사용해 주세요.',
    }
  }

  return {
    title: '실제 소비와 맞춰볼까요',
    description:
      '저장된 세부 사용처가 실제 카드 사용내역과 얼마나 맞는지 비교하면 조정할 곳이 선명해져요.',
    primaryLabel: '사용내역 비교',
    draft:
      '최근 카드 내역을 기준으로 저장된 세부 사용처와 실제 지출이 어떻게 다른지 비교해 주세요.',
  }
}

function hasOnlyMonthlySalary(profile: FinancialProfile): boolean {
  return (
    profile.monthlySalary !== null &&
    profile.essentialExpense === null &&
    profile.debtPayment === null &&
    profile.currentEmergencyFund === null &&
    profile.targetEmergencyFund === null &&
    profile.goalName.trim().length === 0 &&
    profile.goalMonthlyAmount === null &&
    profile.flexibleSpending === null &&
    profile.riskProfile === null &&
    profile.investmentHorizon === null &&
    profile.preferences.length === 0 &&
    profile.customUses.length === 0
  )
}

function createProactiveDetailPlanIfNeeded(
  message: string,
  reply: string,
  profile: FinancialProfile,
  profilePatch: PaydayProfilePatch,
): { reply: string; profilePatch: PaydayProfilePatch } | null {
  if (!isDetailPlanningRequest(message) || !asksForDetailAmounts(reply)) {
    return null
  }
  if (profile.customUses.length > 0) {
    return null
  }

  const customUses = createDetailPlanCustomUses(profile)
  if (customUses.length === 0) {
    return null
  }

  return {
    reply: [
      '먼저 초안으로 세부 사용 계획을 잡아볼게요.',
      describeCustomUses(customUses),
      '원하는 항목만 말해주시면 그 부분만 다시 조정하겠습니다.',
    ].join('\n\n'),
    profilePatch: {
      ...profilePatch,
      customUses,
    },
  }
}

function isDetailPlanningRequest(message: string): boolean {
  if (isDetailComparisonRequest(message)) {
    return false
  }
  const normalizedMessage = normalizeKoreanText(message)
  return (
    normalizedMessage.includes('세부사용처') ||
    normalizedMessage.includes('세부계획') ||
    normalizedMessage.includes('각범주') ||
    normalizedMessage.includes('어디에얼마')
  )
}

function isDetailComparisonRequest(message: string): boolean {
  const normalizedMessage = normalizeKoreanText(message)
  return (
    (
      normalizedMessage.includes('비교') ||
      normalizedMessage.includes('다른지') ||
      normalizedMessage.includes('차이') ||
      normalizedMessage.includes('맞춰')
    ) &&
    (
      normalizedMessage.includes('사용내역') ||
      normalizedMessage.includes('카드내역') ||
      normalizedMessage.includes('실제지출') ||
      normalizedMessage.includes('세부사용처') ||
      normalizedMessage.includes('저장된')
    )
  )
}

function isDetailAdjustmentRequest(message: string): boolean {
  const normalizedMessage = normalizeKoreanText(message)
  return (
    (
      normalizedMessage.includes('조정') ||
      normalizedMessage.includes('보완') ||
      normalizedMessage.includes('과한') ||
      normalizedMessage.includes('부족') ||
      normalizedMessage.includes('다시배분')
    ) &&
    (
      normalizedMessage.includes('세부사용처') ||
      normalizedMessage.includes('사용처') ||
      normalizedMessage.includes('월급계획') ||
      normalizedMessage.includes('항목')
    )
  )
}

function asksForDetailAmounts(reply: string): boolean {
  const normalizedReply = normalizeKoreanText(reply)
  return (
    /알려주|말해주|입력해|정해주|얼마/.test(reply) &&
    (
      normalizedReply.includes('각항목') ||
      normalizedReply.includes('항목별') ||
      normalizedReply.includes('얼마') ||
      normalizedReply.includes('사용할지')
    )
  )
}

function getLatestMonthlySpending(
  monthlySpending: Array<z.infer<typeof monthlySpendingSummarySchema>>,
): z.infer<typeof monthlySpendingSummarySchema> | undefined {
  return monthlySpending
    .slice()
    .sort((left, right) => right.month.localeCompare(left.month))[0]
}

function sumCustomUses(
  customUses: FinancialProfile['customUses'],
  bucket: 'essential' | 'goal' | 'flexible',
): number {
  return customUses
    .filter((use) => use.bucket === bucket)
    .reduce((total, use) => total + use.amount, 0)
}

function adjustCustomUsesToActualSpending(
  customUses: FinancialProfile['customUses'],
  actualEssential: number,
  actualFlexible: number,
): FinancialProfile['customUses'] {
  return [
    ...adjustCustomUseBucket(customUses, 'essential', actualEssential),
    ...customUses.filter(
      (use) => use.bucket === 'goal' && !isInvestmentLikeCustomUse(use.name),
    ),
    ...adjustCustomUseBucket(customUses, 'flexible', actualFlexible),
  ]
}

function areCustomUsesEquivalent(
  left: FinancialProfile['customUses'],
  right: FinancialProfile['customUses'],
): boolean {
  if (left.length !== right.length) {
    return false
  }

  const normalize = (uses: FinancialProfile['customUses']) =>
    uses
      .map((use) =>
        [
          use.bucket,
          use.name.trim(),
          use.amount,
          use.note.trim(),
        ].join('|'),
      )
      .sort()
      .join('\n')

  return normalize(left) === normalize(right)
}

function adjustCustomUseBucket(
  customUses: FinancialProfile['customUses'],
  bucket: 'essential' | 'flexible',
  targetAmount: number,
): FinancialProfile['customUses'] {
  const bucketUses = customUses.filter((use) => use.bucket === bucket)
  if (targetAmount <= 0) {
    return bucketUses
  }
  if (bucketUses.length === 0) {
    return [
      {
        name: bucket === 'essential' ? '필수 생활비 조정분' : '여유 생활비 조정분',
        amount: targetAmount,
        bucket,
        note: '분석한 사용내역을 기준으로 새로 잡은 금액이에요.',
      },
    ]
  }

  const currentTotal = bucketUses.reduce((total, use) => total + use.amount, 0)
  if (currentTotal <= 0) {
    const baseAmount = Math.floor(targetAmount / bucketUses.length)
    return bucketUses.map((use, index) => ({
      ...use,
      amount:
        index === bucketUses.length - 1
          ? targetAmount - baseAmount * (bucketUses.length - 1)
          : baseAmount,
    }))
  }

  let allocatedAmount = 0
  return bucketUses.map((use, index) => {
    const amount =
      index === bucketUses.length - 1
        ? targetAmount - allocatedAmount
        : Math.round((targetAmount * use.amount) / currentTotal)
    allocatedAmount += amount
    return { ...use, amount }
  })
}

function createDifferenceLine(
  label: string,
  plannedAmount: number,
  actualAmount: number,
): string {
  const difference = actualAmount - plannedAmount
  const direction =
    difference > 0
      ? `${difference.toLocaleString()}원 초과`
      : difference < 0
        ? `${Math.abs(difference).toLocaleString()}원 여유`
        : '계획과 거의 일치'

  return `- ${label}: 계획 ${plannedAmount.toLocaleString()}원 · 실제 ${actualAmount.toLocaleString()}원 · ${direction}`
}

function createAdjustmentLine(
  label: string,
  previousAmount: number,
  adjustedAmount: number,
): string {
  if (previousAmount <= 0 && adjustedAmount > 0) {
    return `- ${label}: ${adjustedAmount.toLocaleString()}원으로 새로 반영`
  }

  const difference = adjustedAmount - previousAmount
  const suffix =
    difference > 0
      ? `${difference.toLocaleString()}원 늘림`
      : difference < 0
        ? `${Math.abs(difference).toLocaleString()}원 줄임`
        : '유지'

  return `- ${label}: ${previousAmount.toLocaleString()}원 -> ${adjustedAmount.toLocaleString()}원 (${suffix})`
}

function formatMonthForReply(month: string): string {
  const [year, monthValue] = month.split('-')
  return `${year}년 ${Number(monthValue)}월`
}

function createDetailPlanCustomUses(
  profile: FinancialProfile,
): Array<{ name: string; amount: number; bucket: 'essential' | 'goal' | 'flexible'; note: string }> {
  if (profile.monthlySalary === null) {
    return profile.customUses
  }

  const salary = profile.monthlySalary
  const essentialExpense = profile.essentialExpense ?? Math.round(salary * 0.5)
  const goalMonthlyAmount = profile.goalMonthlyAmount ?? Math.round(salary * 0.1)
  const flexibleSpending = profile.flexibleSpending ?? Math.round(salary * 0.1)
  const existingBuckets = new Set(profile.customUses.map((use) => use.bucket))
  const customUses = [...profile.customUses]

  if (essentialExpense > 0 && !existingBuckets.has('essential')) {
    const fixedAmount = Math.round(essentialExpense * 0.7)
    customUses.push(
      {
        name: '주거·통신 등 고정비',
        amount: fixedAmount,
        bucket: 'essential',
        note: '매달 꼭 나가는 비용을 먼저 묶어 둔 초안이에요.',
      },
      {
        name: '식비·교통 등 생활비',
        amount: essentialExpense - fixedAmount,
        bucket: 'essential',
        note: '일상 생활에 필요한 변동 비용 초안이에요.',
      },
    )
  }

  if (goalMonthlyAmount > 0 && !existingBuckets.has('goal')) {
    customUses.push({
      name: profile.goalName.trim() || '목표 자금',
      amount: goalMonthlyAmount,
      bucket: 'goal',
      note: '투자금과 섞이지 않게 따로 둘 목표 자금이에요.',
    })
  }

  if (flexibleSpending > 0 && !existingBuckets.has('flexible')) {
    const lifestyleAmount = Math.round(flexibleSpending * 0.6)
    customUses.push(
      {
        name: '외식·카페',
        amount: lifestyleAmount,
        bucket: 'flexible',
        note: '줄이고 싶지 않은 생활 만족 지출 초안이에요.',
      },
      {
        name: '취미·여행',
        amount: flexibleSpending - lifestyleAmount,
        bucket: 'flexible',
        note: '이번 달 자유롭게 쓸 수 있는 여유 지출 초안이에요.',
      },
    )
  }

  return customUses
}

function describeCustomUses(
  customUses: Array<{ name: string; amount: number; bucket: 'essential' | 'goal' | 'flexible' }>,
): string {
  return customUses
    .map((use) => `- ${formatCustomUseBucketForReply(use.bucket)}: ${use.name} ${use.amount.toLocaleString()}원`)
    .join('\n')
}

function formatCustomUseBucketForReply(bucket: 'essential' | 'goal' | 'flexible'): string {
  return {
    essential: '필수 생활비',
    goal: '목표 자금',
    flexible: '여유 생활비',
  }[bucket]
}

function sanitizeMissingData(
  missingData: string[],
  profile: FinancialProfile,
  profilePatch: Record<string, unknown>,
): string[] {
  const completedTerms = getCompletedProfileTerms(profile, profilePatch)
  const sanitizedItems = missingData
    .map(replaceInternalFieldNames)
    .filter((item) => {
      const normalizedItem = normalizeKoreanText(item)
      return !completedTerms.some((term) => normalizedItem.includes(term))
    })

  return [...new Set(sanitizedItems)]
}

function sanitizeReply(
  reply: string,
  profile: FinancialProfile,
  profilePatch: Record<string, unknown>,
): string {
  const completedTerms = getCompletedProfileTerms(profile, profilePatch)
  const sentences = reply
    .split(/(?<=[.?!。！？])\s+/)
    .filter((sentence) => {
      const normalizedSentence = normalizeKoreanText(sentence)
      const asksKnownField =
        /[?？]|알려주|확인해주|있으신가요|인가요|어느정도|얼마/.test(sentence) &&
        completedTerms.some((term) => normalizedSentence.includes(term))
      return !asksKnownField
    })

  const sanitizedReply = sentences.join(' ').trim()
  return sanitizedReply || '저장된 정보를 반영해 다음 단계로 이어갈게요.'
}

function sanitizeReplyForConversationIntent(reply: string, message: string): string {
  const currentIntent = getConversationIntent(message)
  let cleanedReply = reply.replace(/\\n/g, '\n')

  if (currentIntent === 'investment_research') {
    cleanedReply = cleanedReply
      .replace(
        /투자에\s*앞서[^.?!。！？]*(비상금|안전망|고정비|카드값)[^.?!。！？]*[.?!。！？]/g,
        '',
      )
      .replace(
        /(현재\s*)?비상금[^.?!。！？]*(부족|목표|확보|점검|권장)[^.?!。！？]*[.?!。！？]/g,
        '',
      )
      .replace(
        /혹시[^.?!。！？]*(비상금|안전망|고정비|고정적으로\s*지출|카드값)[^.?!。！？]*(점검|확인|보시겠어요)[^.\n]*[?？.]/g,
        '',
      )
      .replace(/투자\s*전\s*(?=\|)/g, '')
      .replace(
        /\n?혹시[^\n]*(비상금|안전망|고정비|고정\s*지출|고정적으로\s*지출|카드값)[^\n]*/g,
        '',
      )
      .replace(
        /\n?(이제|다음으로)?[^\n]*(비상금|안전망|고정비|고정\s*지출|고정적으로\s*지출|지출\s*내역|카드값)[^\n]*(점검|확인|확인해\s*볼까요|보시겠어요)[^\n]*/g,
        '',
      )
    if (shouldEnsureInvestmentComparison(message)) {
      cleanedReply = ensureInvestmentReplyHasComparison(cleanedReply)
    }
  }

  return ensureConversationalFollowUp(cleanedReply, message)
    .replace(/\s*(\|[ \t]*역할[^\n]*\|)/, '\n\n$1')
    .replace(/([.?!。！？])\s+(\|[^\n]+\|)/g, '$1\n\n$2')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}

function shouldEnsureInvestmentComparison(message: string): boolean {
  const normalizedMessage = normalizeKoreanText(message)
  if (
    normalizedMessage.includes('방법') ||
    normalizedMessage.includes('어떻게') ||
    normalizedMessage.includes('어떤자료') ||
    normalizedMessage.includes('먼저찾')
  ) {
    return false
  }

  return (
    normalizedMessage.includes('비교') ||
    normalizedMessage.includes('포트폴리오') ||
    normalizedMessage.includes('구성') ||
    (
      normalizedMessage.includes('후보') &&
      (
        normalizedMessage.includes('정리') ||
        normalizedMessage.includes('좁혀') ||
        normalizedMessage.includes('검토')
      )
    ) ||
    (
      normalizedMessage.includes('ETF') &&
      normalizedMessage.includes('종목')
    )
  )
}

function ensureInvestmentReplyHasComparison(reply: string): string {
  if (
    reply.includes('| 역할 |') ||
    reply.includes('| 후보 |') ||
    reply.includes('추가 확인 자료 |') ||
    /^\s*\|[^\n|]*역할[^\n|]*\|[^\n|]*후보[^\n|]*\|/m.test(reply) ||
    reply.includes('역할\n')
  ) {
    return reply
  }

  return [
    reply,
    '| 역할 | 후보(티커) | 비중 초안 | 근거 | 주요 위험 | 추가 확인 자료 |',
    '| --- | --- | --- | --- | --- | --- |',
    '| 시장 중심 ETF | VOO 또는 SPY | 40~50% | 미국 대형주 분산 | 시장 전반 하락 | 현재가·운용보수·추적오차 확인 필요 |',
    '| 성장 ETF | QQQM 또는 QQQ | 20~30% | 나스닥 100 성장주 노출 | 기술주 집중과 변동성 | 구성 종목·금리 민감도 확인 필요 |',
    '| 배당/방어 ETF | SCHD 또는 DGRO | 10~20% | 배당 성장과 방어 역할 | 성장성 제한 | 배당수익률·배당성장률 확인 필요 |',
    '| 개별 성장 후보 | MSFT 또는 AAPL | 0~15% | 대형 우량 기술주 후보 | 개별 기업 리스크 | 최신 실적·현금흐름·밸류에이션 확인 필요 |',
    '| 고변동 성장 후보 | NVDA | 0~10% | AI 반도체 성장 후보 | 고평가와 실적 변동성 | 최신 실적·가이던스·매출 집중도 확인 필요 |',
  ].join('\n')
}

function ensureConversationalFollowUp(reply: string, message: string): string {
  const trimmedReply = reply.trim()
  if (!trimmedReply || /[?？]/.test(trimmedReply)) {
    return trimmedReply
  }

  const currentIntent = getConversationIntent(message)
  const followUp =
    currentIntent === 'investment_research'
      ? '다음으로 비중을 조정할지, 확인할 자료를 더 좁힐지 정해볼까요?'
      : currentIntent === 'detail_adjust'
        ? '이제 전체 월급 배분을 확인해 볼까요?'
        : '다음으로 이어서 조정할 부분이 있을까요?'
  return `${trimmedReply}\n\n${followUp}`
}

function sanitizeMonthlySpendingProposal(
  proposal: MonthlySpendingProposal | undefined,
): MonthlySpendingProposal | undefined {
  if (!proposal) {
    return proposal
  }
  const ordinaryCategoryBreakdown = proposal.categoryBreakdown.filter(
    (item) => !isNonSpendingCategory(item.category),
  )
  const removedOnlyCategories =
    proposal.categoryBreakdown.length > 0 &&
    ordinaryCategoryBreakdown.length === 0
  const sanitizedProposal = {
    ...proposal,
    categoryBreakdown: ordinaryCategoryBreakdown,
    notableCategories: proposal.notableCategories.filter(
      (category) => !isNonSpendingCategory(category),
    ),
  }

  if (
    removedOnlyCategories ||
    !hasReadableMonthlySpendingAmount(sanitizedProposal)
  ) {
    return undefined
  }
  return sanitizedProposal
}

function isNonSpendingCategory(category: string): boolean {
  const normalizedCategory = normalizeKoreanText(category)
  return (
    normalizedCategory.includes('투자') ||
    normalizedCategory.includes('주식') ||
    normalizedCategory.includes('ETF') ||
    normalizedCategory.includes('저축') ||
    normalizedCategory.includes('이체') ||
    normalizedCategory.includes('환급') ||
    normalizedCategory.includes('소득')
  )
}

function sanitizeProfilePatchScope(profilePatch: PaydayProfilePatch): PaydayProfilePatch {
  const proposedCustomUses = profilePatch.customUses
  if (
    !Array.isArray(proposedCustomUses) ||
    !proposedCustomUses.every(isCustomSalaryUsePatch)
  ) {
    return profilePatch
  }

  const customUses = proposedCustomUses.filter(
    (use) => !isInvestmentLikeCustomUse(use.name),
  )
  if (customUses.length === proposedCustomUses.length) {
    return profilePatch
  }
  if (customUses.length === 0) {
    const restProfilePatch = { ...profilePatch }
    delete restProfilePatch.customUses
    return restProfilePatch
  }
  return { ...profilePatch, customUses }
}

function isCustomSalaryUsePatch(
  value: unknown,
): value is FinancialProfile['customUses'][number] {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'name' in value &&
    typeof value.name === 'string' &&
    'amount' in value &&
    typeof value.amount === 'number' &&
    'bucket' in value &&
    ['essential', 'goal', 'flexible'].includes(String(value.bucket)) &&
    'note' in value &&
    typeof value.note === 'string'
  )
}

function isInvestmentLikeCustomUse(name: string): boolean {
  const normalizedName = normalizeKoreanText(name)
  return (
    normalizedName.includes('투자') ||
    normalizedName.includes('주식') ||
    normalizedName.includes('ETF') ||
    normalizedName.includes('종목')
  )
}

function hasReadableMonthlySpendingAmount(
  proposal: MonthlySpendingProposal,
): boolean {
  const amountFields = [
    proposal.totalExpense,
    proposal.essentialExpense,
    proposal.flexibleExpense,
  ]
  const hasPositiveAmount = amountFields.some(
    (amount) => amount !== null && amount > 0,
  )

  return (
    hasPositiveAmount ||
    proposal.categoryBreakdown.some((item) => item.amount > 0)
  )
}

function getCompletedProfileTerms(
  profile: FinancialProfile,
  profilePatch: Record<string, unknown>,
): string[] {
  const profileEntries: Array<[keyof FinancialProfile, string[], unknown]> = [
    ['monthlySalary', ['월실수령액', '월급', '급여'], profile.monthlySalary],
    ['essentialExpense', ['필수생활비', '필수지출'], profile.essentialExpense],
    ['debtPayment', ['대출상환액', '대출금', '상환중인대출', '카드부채'], profile.debtPayment],
    ['currentEmergencyFund', ['현재비상금', '비상자금', '비상금'], profile.currentEmergencyFund],
    ['targetEmergencyFund', ['비상금목표', '목표비상금', '비상자금목표'], profile.targetEmergencyFund],
    ['goalName', ['목표자금', '모으고싶은목표', '저축목표'], profile.goalName.trim()],
    ['goalMonthlyAmount', ['목표저축', '매월저축', '저축금액'], profile.goalMonthlyAmount],
    ['flexibleSpending', ['여유생활비', '선택지출'], profile.flexibleSpending],
    ['riskProfile', ['투자성향', '위험성향', '위험감수'], profile.riskProfile],
    ['investmentHorizon', ['투자기간', '투자기간'], profile.investmentHorizon],
  ]

  return profileEntries
    .filter(([key, , value]) => hasKnownProfileValue(value) || profilePatch[key] !== undefined)
    .flatMap(([, terms]) => terms)
}

function hasKnownProfileValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false
  }
  return typeof value !== 'string' || value.trim().length > 0
}

function replaceInternalFieldNames(value: string): string {
  return value
    .replaceAll('riskProfile', '투자 성향')
    .replaceAll('investmentHorizon', '투자 기간')
    .replaceAll('monthlySalary', '월 실수령액')
    .replaceAll('essentialExpense', '필수 생활비')
    .replaceAll('debtPayment', '대출 상환액')
    .replaceAll('currentEmergencyFund', '현재 비상금')
    .replaceAll('targetEmergencyFund', '비상금 목표')
    .replaceAll('goalName', '목표 자금')
    .replaceAll('goalMonthlyAmount', '목표 저축액')
    .replaceAll('flexibleSpending', '여유 생활비')
    .replaceAll('성장형', '공격형')
}

function normalizeKoreanText(value: string): string {
  return value.replace(/[\s·_\-()/]/g, '')
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
  if (typeof error === 'object' && error !== null) {
    const errorRecord = error as Record<string, unknown>
    for (const key of ['status', 'code', 'statusCode'] as const) {
      if (typeof errorRecord[key] === 'number') {
        return errorRecord[key]
      }
    }
  }
  if (error instanceof Error) {
    const statusMatch = error.message.match(/\b(401|403|404|429|500|502|503|504)\b/)
    return statusMatch ? Number(statusMatch[1]) : undefined
  }
  return undefined
}

function isAllowedOrigin(origin: string, configuredOrigins: string | undefined): boolean {
  if (/^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) {
    return true
  }
  if (!configuredOrigins) {
    return true
  }
  return configuredOrigins
    .split(',')
    .map((configuredOrigin) => configuredOrigin.trim())
    .includes(origin)
}

function isClearlyOutsidePaydayScope(
  message: string,
  hasKnownFinancialContext: boolean,
): boolean {
  const normalizedMessage = message.toLowerCase().replace(/\s+/g, ' ').trim()
  if (!normalizedMessage) {
    return false
  }

  const meaningfulCharacters = normalizedMessage.replace(
    /[ㅋㅎㅠㅜㅡ!?.,~\s]/g,
    '',
  )
  if (meaningfulCharacters.length < 2) {
    return true
  }

  const clearlyUnrelatedTerms = [
    '날씨',
    '기온',
    '코딩해',
    '코드 짜',
    '프로그래밍 문제',
    '번역해',
    '역사 알려',
    '수도가 어디',
    '대통령 누구',
    '요리법',
    '레시피',
    '축구 결과',
    '축구 순위',
    '야구 결과',
    '야구 순위',
    '게임 공략',
    '소설 써',
    '시 써',
    '숙제 풀어',
    'weather forecast',
    'write code',
    'programming problem',
    'translate this',
    'recipe',
    'football score',
    'baseball score',
  ]

  if (
    clearlyUnrelatedTerms.some((term) =>
      normalizedMessage.includes(term),
    )
  ) {
    return true
  }

  if (hasPaydayScopeTerm(normalizedMessage)) {
    return false
  }

  return !hasKnownFinancialContext
}

function hasPaydayScopeTerm(message: string): boolean {
  const normalizedMessage = message.toLowerCase()
  if (/\d[\d,.\s]*(원|만원|억|천만)/.test(normalizedMessage)) {
    return true
  }
  const relevantTerms = [
    '월급',
    '급여',
    '연봉',
    '실수령',
    '소득',
    '수입',
    '지출',
    '소비',
    '생활비',
    '고정비',
    '월세',
    '관리비',
    '통신비',
    '보험',
    '퇴직금',
    '세금',
    '공제',
    '카드',
    '대출',
    '부채',
    '빚',
    '비상금',
    '저축',
    '적금',
    '예금',
    '투자',
    '주식',
    '채권',
    'etf',
    '포트폴리오',
    '목표',
    '예산',
    '용돈',
    '돈',
    '금액',
    '만원',
    '여행',
    '외식',
    '카페',
    '커피',
    '음식',
    '배달',
    '술',
    '쇼핑',
    '취미',
    '게임',
    '운동',
    '데이트',
    '영화',
    '공연',
    '문화',
    '교통',
    'salary',
    'income',
    'expense',
    'spending',
    'budget',
    'saving',
    'investment',
    'debt',
    'loan',
    'money',
    'portfolio',
    'goal',
  ]

  return relevantTerms.some((term) => normalizedMessage.includes(term))
}

function hasFinancialProfileContext(profile: FinancialProfile): boolean {
  return (
    profile.monthlySalary !== null ||
    profile.essentialExpense !== null ||
    profile.debtPayment !== null ||
    profile.currentEmergencyFund !== null ||
    profile.targetEmergencyFund !== null ||
    profile.goalName.trim().length > 0 ||
    profile.goalMonthlyAmount !== null ||
    profile.flexibleSpending !== null ||
    profile.riskProfile !== null ||
    profile.investmentHorizon !== null ||
    profile.preferences.length > 0 ||
    profile.customUses.length > 0
  )
}
