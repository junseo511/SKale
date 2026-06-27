import type {
  InvestmentHorizon,
  PaydayInput,
  RiskProfile,
  CustomSalaryUse,
} from './paydayPlan'
import { z } from 'zod'

export type ConversationRole = 'agent' | 'user'
export type ConversationMessageStatus = 'sent' | 'pending' | 'failed'

export interface ConversationAttachment {
  id: string
  name: string
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic'
  data: string
  previewUrl: string
}

export interface ConversationMessage {
  id: string
  role: ConversationRole
  content: string
  createdAt: string
  status: ConversationMessageStatus
  attachments: ConversationAttachment[]
}

export interface MonthlySpendingSummary {
  id: string
  month: string
  source: 'text' | 'image' | 'mixed'
  totalExpense: number | null
  essentialExpense: number | null
  flexibleExpense: number | null
  categoryBreakdown: SpendingCategoryAmount[]
  notableCategories: string[]
  insight: string
  needReview: boolean
}

export interface SpendingCategoryAmount {
  category: string
  amount: number
}

export interface FinancialProfile {
  monthlySalary: number | null
  essentialExpense: number | null
  debtPayment: number | null
  currentEmergencyFund: number | null
  targetEmergencyFund: number | null
  goalName: string
  goalMonthlyAmount: number | null
  flexibleSpending: number | null
  riskProfile: RiskProfile | null
  investmentHorizon: InvestmentHorizon | null
  preferences: string[]
  customUses: CustomSalaryUse[]
}

export interface FinancialProfilePatch {
  monthlySalary?: number
  essentialExpense?: number
  debtPayment?: number
  currentEmergencyFund?: number
  targetEmergencyFund?: number
  goalName?: string
  goalMonthlyAmount?: number
  flexibleSpending?: number
  riskProfile?: RiskProfile
  investmentHorizon?: InvestmentHorizon
  preferences?: string[]
  customUses?: CustomSalaryUse[]
}

export interface PaydayConversationRequest {
  message: string
  targetMonth?: string
  attachments: Array<
    Pick<ConversationAttachment, 'name' | 'mimeType' | 'data'>
  >
  profile: FinancialProfile
  monthlySpending: MonthlySpendingSummary[]
  appContext: PaydayConversationAppContext
  recentMessages: Array<Pick<ConversationMessage, 'role' | 'content'>>
}

export interface PaydayConversationAppContext {
  stage:
    | 'empty'
    | 'salary_only'
    | 'spending_ready'
    | 'budget_detail_ready'
    | 'investment_ready'
  completedActions: string[]
  confirmedFacts: string[]
  planSnapshot: {
    monthlySalary: number | null
    availableInvestmentAmount: number | null
    safetyStatus: string | null
    allocationSummary: Array<{
      label: string
      amount: number
    }>
  }
  recommendationPolicy: {
    priority: string[]
    avoid: string[]
  }
}

export interface NextActionRecommendation {
  title: string
  description: string
  primaryLabel: string
  draft: string
}

const financialProfilePatchSchema = z
  .object({
    monthlySalary: z.number().nonnegative().optional(),
    essentialExpense: z.number().nonnegative().optional(),
    debtPayment: z.number().nonnegative().optional(),
    currentEmergencyFund: z.number().nonnegative().optional(),
    targetEmergencyFund: z.number().nonnegative().optional(),
    goalName: z.string().max(200).optional(),
    goalMonthlyAmount: z.number().nonnegative().optional(),
    flexibleSpending: z.number().nonnegative().optional(),
    riskProfile: z
      .enum(['안정형', '균형형', '공격형', '성장형'])
      .transform((value) => (value === '성장형' ? '공격형' : value))
      .optional(),
    investmentHorizon: z
      .enum(['1년 미만', '1~3년', '3년 이상'])
      .optional(),
    preferences: z.array(z.string().trim().min(1).max(300)).max(8).optional(),
    customUses: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(80),
            amount: z.number().nonnegative(),
            bucket: z.enum(['essential', 'goal', 'flexible']),
            note: z.string().trim().max(200),
          })
          .strict(),
      )
      .max(20)
      .optional(),
  })
  .strict()

const monthlySpendingProposalSchema = z
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
      .max(12)
      .default([]),
    notableCategories: z.array(z.string().trim().min(1)).max(8),
    insight: z.string(),
    needReview: z.boolean(),
  })
  .strict()

export const paydayConversationResponseSchema = z
  .object({
    reply: z.string().min(1),
    profilePatch: financialProfilePatchSchema,
    monthlySpendingProposal: monthlySpendingProposalSchema.optional(),
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
  })
  .strict()

export type PaydayConversationResponse = z.infer<
  typeof paydayConversationResponseSchema
>

export interface PaydayConversationAgent {
  reply(
    request: PaydayConversationRequest,
    signal: AbortSignal,
  ): Promise<PaydayConversationResponse>
}

export interface PaydayWorkspace {
  messages: ConversationMessage[]
  profile: FinancialProfile
  monthlySpending: MonthlySpendingSummary[]
}

export const EMPTY_FINANCIAL_PROFILE: FinancialProfile = {
  monthlySalary: null,
  essentialExpense: null,
  debtPayment: null,
  currentEmergencyFund: null,
  targetEmergencyFund: null,
  goalName: '',
  goalMonthlyAmount: null,
  flexibleSpending: null,
  riskProfile: null,
  investmentHorizon: null,
  preferences: [],
  customUses: [],
}

const DEFAULT_ESSENTIAL_EXPENSE_RATIO = 0.5
const DEFAULT_GOAL_MONTHLY_AMOUNT_RATIO = 0.1
const DEFAULT_FLEXIBLE_SPENDING_RATIO = 0.1
const DEFAULT_EMERGENCY_FUND_MONTHS = 3

export const INITIAL_AGENT_MESSAGE: ConversationMessage = {
  id: 'initial-agent-message',
  role: 'agent',
  content:
    '월급 계획을 같이 만들어볼게요. 아래 카드에서 지금 필요한 것부터 시작해 보세요.',
  createdAt: new Date(0).toISOString(),
  status: 'sent',
  attachments: [],
}

export function applyFinancialProfilePatch(
  profile: FinancialProfile,
  patch: FinancialProfilePatch,
): FinancialProfile {
  const nextProfile = {
    ...profile,
    ...patch,
    preferences: patch.preferences
      ? [...new Set([...profile.preferences, ...patch.preferences])]
      : profile.preferences,
    customUses: patch.customUses ?? profile.customUses,
  }

  if (patch.customUses) {
    const totals = calculateCustomUseTotals(patch.customUses)
    if (
      patch.essentialExpense === undefined &&
      hasCustomUseInBucket(patch.customUses, 'essential')
    ) {
      nextProfile.essentialExpense = totals.essential
    }
    if (
      patch.goalMonthlyAmount === undefined &&
      hasCustomUseInBucket(patch.customUses, 'goal')
    ) {
      nextProfile.goalMonthlyAmount = totals.goal
    }
    if (
      patch.flexibleSpending === undefined &&
      hasCustomUseInBucket(patch.customUses, 'flexible')
    ) {
      nextProfile.flexibleSpending = totals.flexible
    }
    const goalUse = patch.customUses.find((use) => use.bucket === 'goal')
    if (goalUse && !patch.goalName) {
      nextProfile.goalName = goalUse.name
    }
  }

  return nextProfile
}

export function toPaydayInput(profile: FinancialProfile): PaydayInput | null {
  if (profile.monthlySalary === null) {
    return null
  }

  const monthlySalary = profile.monthlySalary
  const essentialExpense =
    profile.essentialExpense ??
    Math.round(monthlySalary * DEFAULT_ESSENTIAL_EXPENSE_RATIO)
  const targetEmergencyFund =
    profile.targetEmergencyFund ??
    Math.round(essentialExpense * DEFAULT_EMERGENCY_FUND_MONTHS)

  return {
    monthlySalary,
    essentialExpense,
    debtPayment: profile.debtPayment ?? 0,
    currentEmergencyFund: profile.currentEmergencyFund ?? 0,
    targetEmergencyFund,
    goalName: profile.goalName || '목표 자금',
    goalMonthlyAmount:
      profile.goalMonthlyAmount ??
      Math.round(monthlySalary * DEFAULT_GOAL_MONTHLY_AMOUNT_RATIO),
    flexibleSpending:
      profile.flexibleSpending ??
      Math.round(monthlySalary * DEFAULT_FLEXIBLE_SPENDING_RATIO),
    riskProfile: profile.riskProfile ?? '균형형',
    investmentHorizon: profile.investmentHorizon ?? '3년 이상',
    customUses: profile.customUses,
  }
}

function hasCustomUseInBucket(
  customUses: CustomSalaryUse[],
  bucket: CustomSalaryUse['bucket'],
): boolean {
  return customUses.some((use) => use.bucket === bucket)
}

function calculateCustomUseTotals(
  customUses: CustomSalaryUse[],
): Record<CustomSalaryUse['bucket'], number> {
  return customUses.reduce(
    (totals, use) => ({
      ...totals,
      [use.bucket]: totals[use.bucket] + use.amount,
    }),
    { essential: 0, goal: 0, flexible: 0 },
  )
}

export function countCompletedProfileFields(
  profile: FinancialProfile,
): number {
  return profile.monthlySalary === null ? 0 : 1
}
