export const spendingCategories = [
  '고정비',
  '생활비',
  '식비/카페',
  '교통',
  '쇼핑',
  '여행',
  '의료/건강',
  '데이트',
  '기타',
] as const

export const transactionNatures = [
  'expense',
  'fixedExpense',
  'saving',
  'investment',
  'transfer',
  'income',
  'unknown',
] as const

export type SpendingCategory = (typeof spendingCategories)[number]
export type TransactionNature = (typeof transactionNatures)[number]
export type ReviewDecision = 'pending' | 'accepted' | 'rejected'

export interface SpendingAnalysisRequest {
  input: string
  userFeedback?: string
}

export interface SpendingProposal {
  id: string
  rawText: string
  date: string
  merchant: string
  amount: number
  nature: TransactionNature
  spendingCategory?: SpendingCategory
  confidence: number
  needReview: boolean
  reason: string
  decision: ReviewDecision
  userNote: string
}

export interface SpendingAnalysis {
  id: string
  createdAt: string
  proposals: SpendingProposal[]
  insight: string
  actionItems: string[]
  appliedFeedback?: string
}

export interface ConfirmedSpendingAnalysis extends SpendingAnalysis {
  confirmedAt: string
}

export interface SpendingAgent {
  analyze(
    request: SpendingAnalysisRequest,
    signal: AbortSignal,
  ): Promise<SpendingAnalysis>
}

export interface SpendingReviewRepository {
  loadLatest(): ConfirmedSpendingAnalysis | null
  save(analysis: ConfirmedSpendingAnalysis): void
}

export function calculateExpenseTotal(proposals: SpendingProposal[]): number {
  return proposals
    .filter(
      (proposal) =>
        proposal.decision === 'accepted' &&
        (proposal.nature === 'expense' || proposal.nature === 'fixedExpense'),
    )
    .reduce((total, proposal) => total + proposal.amount, 0)
}

export function isReviewComplete(proposals: SpendingProposal[]): boolean {
  return proposals.every((proposal) => proposal.decision !== 'pending')
}
