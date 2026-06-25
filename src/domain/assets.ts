export const assetCategories = [
  '현금성 자산',
  '저축성 자산',
  '투자 자산',
  '목적 자금',
  '부채/미결제',
  '기타',
] as const

export type AssetCategory = (typeof assetCategories)[number]
export type AssetReviewDecision = 'pending' | 'accepted' | 'rejected'

export interface AssetAnalysisRequest {
  input: string
  userFeedback?: string
}

export interface AssetProposal {
  id: string
  rawText: string
  name: string
  amount: number
  category: AssetCategory
  confidence: number
  needReview: boolean
  reason: string
  decision: AssetReviewDecision
  userNote: string
}

export interface AssetAnalysis {
  id: string
  createdAt: string
  proposals: AssetProposal[]
  healthStatus: '양호' | '주의' | '확인 필요'
  insight: string
  actionItems: string[]
  missingData: string[]
  appliedFeedback?: string
}

export interface ConfirmedAssetAnalysis extends AssetAnalysis {
  confirmedAt: string
}

export interface AssetAgent {
  analyze(
    request: AssetAnalysisRequest,
    signal: AbortSignal,
  ): Promise<AssetAnalysis>
}

export interface AssetReviewRepository {
  loadLatest(): ConfirmedAssetAnalysis | null
  save(analysis: ConfirmedAssetAnalysis): void
}

export interface AssetSummary {
  totalAsset: number
  totalDebt: number
  netWorth: number
  liquidAsset: number
  investmentAsset: number
}

export function calculateAssetSummary(
  proposals: AssetProposal[],
): AssetSummary {
  return proposals
    .filter((proposal) => proposal.decision === 'accepted')
    .reduce<AssetSummary>(
      (summary, proposal) => {
        if (proposal.category === '부채/미결제') {
          summary.totalDebt += proposal.amount
        } else {
          summary.totalAsset += proposal.amount
        }

        if (proposal.category === '현금성 자산') {
          summary.liquidAsset += proposal.amount
        }
        if (proposal.category === '투자 자산') {
          summary.investmentAsset += proposal.amount
        }

        summary.netWorth = summary.totalAsset - summary.totalDebt
        return summary
      },
      {
        totalAsset: 0,
        totalDebt: 0,
        netWorth: 0,
        liquidAsset: 0,
        investmentAsset: 0,
      },
    )
}

export function isAssetReviewComplete(proposals: AssetProposal[]): boolean {
  return proposals.every((proposal) => proposal.decision !== 'pending')
}
