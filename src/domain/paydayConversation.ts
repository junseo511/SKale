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
  notableCategories: string[]
  insight: string
  needReview: boolean
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
  recentMessages: Array<Pick<ConversationMessage, 'role' | 'content'>>
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
    riskProfile: z.enum(['안정형', '균형형', '성장형']).optional(),
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

export const INITIAL_AGENT_MESSAGE: ConversationMessage = {
  id: 'initial-agent-message',
  role: 'agent',
  content:
    '먼저 월 실수령액을 알려주세요. 정확한 금액을 모르시면 아래 계산기로 확인할 수 있어요.',
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
  if (
    profile.monthlySalary === null ||
    profile.essentialExpense === null ||
    profile.debtPayment === null ||
    profile.currentEmergencyFund === null ||
    profile.targetEmergencyFund === null ||
    profile.goalMonthlyAmount === null ||
    profile.flexibleSpending === null ||
    profile.riskProfile === null ||
    profile.investmentHorizon === null
  ) {
    return null
  }

  return {
    monthlySalary: profile.monthlySalary,
    essentialExpense: profile.essentialExpense,
    debtPayment: profile.debtPayment,
    currentEmergencyFund: profile.currentEmergencyFund,
    targetEmergencyFund: profile.targetEmergencyFund,
    goalName: profile.goalName,
    goalMonthlyAmount: profile.goalMonthlyAmount,
    flexibleSpending: profile.flexibleSpending,
    riskProfile: profile.riskProfile,
    investmentHorizon: profile.investmentHorizon,
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
  return [
    profile.monthlySalary,
    profile.essentialExpense,
    profile.debtPayment,
    profile.currentEmergencyFund,
    profile.targetEmergencyFund,
    profile.goalMonthlyAmount,
    profile.flexibleSpending,
    profile.riskProfile,
    profile.investmentHorizon,
  ].filter((value) => value !== null).length
}
