import type {
  AssetReviewRepository,
  ConfirmedAssetAnalysis,
} from '../domain/assets'

export const ASSET_STORAGE_KEY = 'skale.confirmed-asset-analysis'

export class LocalAssetReviewRepository implements AssetReviewRepository {
  public loadLatest(): ConfirmedAssetAnalysis | null {
    const serializedAnalysis = window.localStorage.getItem(ASSET_STORAGE_KEY)

    if (!serializedAnalysis) {
      return null
    }

    try {
      return JSON.parse(serializedAnalysis) as ConfirmedAssetAnalysis
    } catch {
      return null
    }
  }

  public save(analysis: ConfirmedAssetAnalysis): void {
    window.localStorage.setItem(ASSET_STORAGE_KEY, JSON.stringify(analysis))
  }
}
