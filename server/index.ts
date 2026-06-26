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
  riskProfile: z.enum(['안정형', '균형형', '성장형']).nullable(),
  investmentHorizon: z
    .enum(['1년 미만', '1~3년', '3년 이상'])
    .nullable(),
  preferences: z.array(z.string().trim().min(1).max(300)).max(20),
  customUses: z.array(customSalaryUseSchema).max(20).default([]),
})

type FinancialProfile = z.infer<typeof financialProfileSchema>

const monthlySpendingSummarySchema = z.object({
  id: z.string(),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  source: z.enum(['text', 'image', 'mixed']),
  totalExpense: z.number().nonnegative().nullable(),
  essentialExpense: z.number().nonnegative().nullable(),
  flexibleExpense: z.number().nonnegative().nullable(),
  notableCategories: z.array(z.string().trim().min(1)).max(8),
  insight: z.string(),
  needReview: z.boolean(),
})

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
          .enum(['안정형', '균형형', '성장형'])
          .nullable(),
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
        notableCategories: z.array(z.string().trim().min(1)).max(8),
        insight: z.string(),
        needReview: z.boolean(),
      })
      .strict()
      .nullable(),
    missingData: z.array(z.string().trim().min(1)).max(8),
    appliedFacts: z.array(z.string().trim().min(1)).max(10),
  })
  .strict()

const paydayConversationRequestSchema = z
  .object({
    message: z.string().trim().max(10_000),
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
    recentMessages: z
      .array(
        z.object({
          role: z.enum(['agent', 'user']),
          content: z.string().max(5_000),
        }),
      )
      .max(12),
  })
  .refine(
    (request) =>
      request.message.length > 0 || request.attachments.length > 0,
    { message: '대화 내용 또는 사용내역 이미지가 필요합니다.' },
  )

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
          enum: ['안정형', '균형형', '성장형', null],
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
  },
  required: [
    'reply',
    'profilePatch',
    'monthlySpendingProposal',
    'missingData',
    'appliedFacts',
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
      recentMessages,
    } = parsedRequest.data
    fallbackMessage = message
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
      })
      return
    }

    const { client, model } = createModelClient()
    const modelResponse = await client.models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: [
                `Current financial profile:\n${JSON.stringify(profile)}`,
                `\nConfirmed monthly spending summaries:\n${JSON.stringify(monthlySpending)}`,
                `\nRecent conversation:\n${JSON.stringify(recentMessages)}`,
                `\nCurrent user message:\n${message || '(no text)'}`,
                `\nTarget month for the submitted spending data:\n${targetMonth ?? '(not specified)'}`,
              ].join(''),
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
        systemInstruction: [
          'You are SKale, a conversational payday planning agent.',
          'The user may write in Korean or English. Always write every user-facing natural-language field in Korean, including reply, insight, missingData, appliedFacts, preferences, and category descriptions.',
          'Keep the Korean conversation concise and natural. Confirm one financial-profile item or preference at a time.',
          'The assistant may answer general money-related questions, including questions about salary, spending habits, budgeting, saving, emergency funds, debt, retirement accounts, asset allocation, investing principles, risk, diversification, valuation, and portfolio construction.',
          'When answering a money-related question that is not just data extraction, briefly add a Korean section titled "기준으로 보면" when useful. Cite well-known institutions or investors by name only for broadly established principles, such as OECD/financial literacy guidance, SEC investor education, FINRA investor education, Vanguard diversification and long-term investing principles, Bogleheads/John Bogle low-cost diversified indexing, Warren Buffett long-term business-quality and margin-of-safety thinking, Benjamin Graham margin of safety, Howard Marks risk awareness and cycles, Ray Dalio diversification, or Morgan Housel behavior-first personal finance.',
          'Do not fabricate exact quotes, dates, reports, recent market views, current rankings, current prices, financial results, tax rules, or legal/regulatory details. If the user asks for latest/current information or exact citations that were not provided, say in Korean that live verification is needed and give only a general framework.',
          'Make clear that cited views are reference perspectives, not personalized investment advice. Do not imply endorsement from any institution or investor.',
          'Only place facts that the user stated clearly or that are directly visible in the submitted data into profilePatch. Never infer or invent a value.',
          'Return null for every profilePatch field that should not change.',
          'Only monthlySalary is required before the application can create a first salary plan. Essential expense, debt, emergency fund, goals, flexible spending, risk profile, and investment horizon can stay null unless the user explicitly provides or changes them; the application will fill a clearly labeled default draft for those fields.',
          'Record only budget-relevant lifestyle preferences as short Korean sentences in preferences.',
          'When the user names recurring payday destinations with explicit monthly amounts, structure them in customUses.',
          'Classify unavoidable recurring obligations as essential, named future savings as goal, and protected lifestyle spending as flexible.',
          'customUses are subdivisions of the three budget buckets, not additional spending outside the salary plan.',
          'When adding, changing, or removing a custom use, return the complete desired customUses list and preserve existing items unless the user clearly asks to change or remove them.',
          'Only change an aggregate bucket amount when the user explicitly changes that whole bucket; otherwise the application will synchronize a bucket from the custom uses listed for that bucket without clearing unrelated buckets.',
          'Never invent a custom-use amount. If the amount is missing or ambiguous, ask one concise clarification question and return null for customUses.',
          'When the user submits prior-month spending data as text or images, create a monthly summary proposal using targetMonth.',
          'If targetMonth is missing or any number in an image is unclear, set needReview to true and ask a concise clarification question in Korean.',
          'Add only verifiable expense transactions. Exclude transfers, savings, investments, refunds, and income from expense totals.',
          'Treat rent, maintenance fees, telecommunications, insurance, and recurring transportation needed for daily life as essential expenses.',
          'Create monthlySpendingProposal only when the current message or attachments actually contain prior spending data. Otherwise return null.',
          'Do not overwrite an already confirmed profile value unless the user clearly asks to change it.',
          'The application code calculates salary allocation and investable cash. Do not claim that you finalized those amounts.',
          'When the user asks you to construct a stock portfolio, treat Korea, the United States, or both as a user-selected market constraint rather than the main recommendation.',
          'Construct a Korean-language reference portfolio for the selected market using the provided investable amount, risk profile, investment horizon, and preferences. Show allocations and amounts by diversified ETF or stock-candidate role, explain why each position exists, and list major risks.',
          'If the user asks for latest/current stock candidates or individual securities, do not present them as buy recommendations. Frame the output as a research checklist or candidate comparison only.',
          'For latest/current candidates, exact prices, recent earnings, valuation multiples, news, rankings, or market data, use only data the user provided with a source and date. If live verification is needed but no source is available in the request, clearly say in Korean that the app needs source-backed current data and list the specific sources or fields to check.',
          'Do not invent current prices, financial results, or valuation data. If exact share counts or individual stock selection require current data that was not provided, state that limitation in Korean and give a reviewable candidate framework instead.',
          'When the user asks to review a stock, ask for the company name and the financial or business information needed by the existing long-term stock-review framework. Do not invent current prices, earnings, or valuation data.',
          'After addressing the user request, ask about at most one useful adjustment. Do not frame non-salary fields as mandatory missing data when monthlySalary is already known.',
          'Do not give instructions to buy, sell, or hold a specific financial product.',
          'If the message is unrelated to salary, spending, saving, debt, financial goals, or investment planning, or if its meaning cannot be understood with reasonable confidence, do not guess.',
          'For an unrelated, nonsensical, or unintelligible message, reply in Korean with a gentle "잘 모르겠어요" tone and ask the user to discuss salary, spending, saving, debt, goals, or investment planning. Return null for every profilePatch field, return null for monthlySpendingProposal, and return empty arrays for missingData and appliedFacts.',
        ].join('\n'),
        responseMimeType: 'application/json',
        responseJsonSchema: paydayConversationResponseSchema,
        temperature: 0.2,
        maxOutputTokens: 4_000,
      },
    })
    const modelJson = parseModelJson<unknown>(
      readGenerateContentText(modelResponse),
    )
    const result =
      paydayConversationModelResponseValidationSchema.parse(modelJson)
    const profilePatch = Object.fromEntries(
      Object.entries(result.profilePatch).filter(
        ([key, value]) =>
          value !== null &&
          !(key === 'preferences' && Array.isArray(value) && value.length === 0),
      ),
    )

    response.json({
      ...result,
      profilePatch,
      monthlySpendingProposal:
        result.monthlySpendingProposal ?? undefined,
    })
  } catch (error) {
    if (isEmptyModelTextError(error)) {
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
    const { client, model } = createModelClient()
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
    const modelResponse = await client.models.generateContent({
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
    })
    const analysis = parseModelJson<SpendingOutput>(
      readGenerateContentText(modelResponse),
    )
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
    }>(readGenerateContentText(modelResponse))

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
    })
    const analysis = parseModelJson<Record<string, unknown>>(
      readGenerateContentText(modelResponse),
    )
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
    })
    const analysis = parseModelJson<{
      ticker: string | null
      [key: string]: unknown
    }>(readGenerateContentText(modelResponse))

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

function createFallbackPaydayResponse(message: string): {
  reply: string
  profilePatch: Record<string, never>
  monthlySpendingProposal: undefined
  missingData: string[]
  appliedFacts: string[]
} {
  const hasSpendingSummaryRequest =
    message.includes('카드') ||
    message.includes('사용내역') ||
    message.includes('소비') ||
    message.includes('지출')

  if (hasSpendingSummaryRequest) {
    return {
      reply:
        '카드 내역 텍스트나 사진을 보내주시면 필수지출과 선택지출로 나눠볼게요.',
      profilePatch: {},
      monthlySpendingProposal: undefined,
      missingData: ['카드 내역 텍스트 또는 사진'],
      appliedFacts: [],
    }
  }

  return {
    reply:
      '방금 답변을 완성하지 못했어요. 월급, 소비, 목표 중 하나를 조금 더 구체적으로 적어주시면 바로 이어서 정리할게요.',
    profilePatch: {},
    monthlySpendingProposal: undefined,
    missingData: [],
    appliedFacts: [],
  }
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
