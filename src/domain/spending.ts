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
  images: SpendingImageAttachment[]
}

export interface SpendingImageAttachment {
  name: string
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic'
  data: string
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
  duplicateCount: number
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

export function deduplicateSpendingProposals(
  proposals: SpendingProposal[],
): { proposals: SpendingProposal[]; duplicateCount: number } {
  const uniqueProposals: SpendingProposal[] = []
  let duplicateCount = 0

  for (const proposal of proposals) {
    const duplicateIndex = uniqueProposals.findIndex(
      (existing) =>
        existing.date === proposal.date &&
        existing.amount === proposal.amount &&
        merchantsAreEquivalent(existing.merchant, proposal.merchant),
    )

    if (duplicateIndex < 0) {
      uniqueProposals.push(proposal)
      continue
    }

    duplicateCount += 1
    if (proposal.confidence > uniqueProposals[duplicateIndex].confidence) {
      uniqueProposals[duplicateIndex] = proposal
    }
  }

  return { proposals: uniqueProposals, duplicateCount }
}

function merchantsAreEquivalent(left: string, right: string): boolean {
  const normalizedLeft = normalizeMerchant(left)
  const normalizedRight = normalizeMerchant(right)

  return (
    normalizedLeft === normalizedRight ||
    (normalizedLeft.length >= 3 &&
      normalizedRight.length >= 3 &&
      (normalizedLeft.includes(normalizedRight) ||
        normalizedRight.includes(normalizedLeft)))
  )
}

function normalizeMerchant(value: string): string {
  return value.toLowerCase().replace(/[^0-9a-z가-힣]/g, '')
}
