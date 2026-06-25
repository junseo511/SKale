export type RiskProfile = '안정형' | '중립형' | '공격형'
export type InvestmentPeriod = '1년 미만' | '1~3년' | '3년 이상'
export type PortfolioDecision = 'pending' | 'accepted' | 'rejected'

export interface PortfolioAnalysisRequest {
  riskProfile: RiskProfile
  investmentPeriod: InvestmentPeriod
  monthlyInvestmentAmount: number
  interests: string
  strategy: string
  assetContext: string
  userFeedback?: string
}

export interface PortfolioAllocation {
  id: string
  assetClass: string
  percentage: number
  reason: string
  riskNote: string
}

export interface PortfolioAnalysis {
  id: string
  createdAt: string
  allocations: PortfolioAllocation[]
  strategyFit: string
  priority: string
  riskComment: string
  actionItems: string[]
  missingData: string[]
  disclaimer: string
  decision: PortfolioDecision
  appliedFeedback?: string
}

export interface ConfirmedPortfolioAnalysis extends PortfolioAnalysis {
  confirmedAt: string
}

export interface PortfolioAgent {
  analyze(
    request: PortfolioAnalysisRequest,
    signal: AbortSignal,
  ): Promise<PortfolioAnalysis>
}

export interface PortfolioReviewRepository {
  loadLatest(): ConfirmedPortfolioAnalysis | null
  save(analysis: ConfirmedPortfolioAnalysis): void
}

export function calculateAllocationTotal(
  allocations: PortfolioAllocation[],
): number {
  return allocations.reduce(
    (total, allocation) => total + allocation.percentage,
    0,
  )
}
