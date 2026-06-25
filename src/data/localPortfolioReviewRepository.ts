import type {
  ConfirmedPortfolioAnalysis,
  PortfolioReviewRepository,
} from '../domain/portfolio'

const STORAGE_KEY = 'skale.confirmed-portfolio-analysis'

export class LocalPortfolioReviewRepository
  implements PortfolioReviewRepository
{
  public loadLatest(): ConfirmedPortfolioAnalysis | null {
    const serialized = window.localStorage.getItem(STORAGE_KEY)
    if (!serialized) {
      return null
    }
    try {
      return JSON.parse(serialized) as ConfirmedPortfolioAnalysis
    } catch {
      return null
    }
  }

  public save(analysis: ConfirmedPortfolioAnalysis): void {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(analysis))
  }
}
