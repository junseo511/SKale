import {
  Check,
  CheckCheck,
  CircleAlert,
  LoaderCircle,
  MessageSquareText,
  PieChart,
  ShieldCheck,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  calculateAllocationTotal,
  type ConfirmedPortfolioAnalysis,
  type InvestmentPeriod,
  type PortfolioAgent,
  type PortfolioAnalysis,
  type PortfolioReviewRepository,
  type RiskProfile,
} from '../../domain/portfolio'

interface PortfolioAgentWorkspaceProps {
  agent: PortfolioAgent
  reviewRepository: PortfolioReviewRepository
  assetContext: string
  suggestedMonthlyAmount: number
}

export function PortfolioAgentWorkspace({
  agent,
  reviewRepository,
  assetContext,
  suggestedMonthlyAmount,
}: PortfolioAgentWorkspaceProps): ReactNode {
  const [riskProfile, setRiskProfile] = useState<RiskProfile>('중립형')
  const [investmentPeriod, setInvestmentPeriod] =
    useState<InvestmentPeriod>('3년 이상')
  const [monthlyAmount, setMonthlyAmount] = useState(suggestedMonthlyAmount)
  const [interests, setInterests] = useState('AI, 반도체, 전력 인프라')
  const [strategy, setStrategy] = useState(
    '코어 자산을 중심으로 구조적으로 성장하는 산업을 일부 검토하고 싶습니다.',
  )
  const [feedback, setFeedback] = useState('')
  const [analysis, setAnalysis] = useState<PortfolioAnalysis | null>(null)
  const [confirmed, setConfirmed] =
    useState<ConfirmedPortfolioAnalysis | null>(() =>
      reviewRepository.loadLatest(),
    )
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const abortControllerReference = useRef<AbortController | null>(null)

  useEffect(() => () => abortControllerReference.current?.abort(), [])

  const allocationTotal = useMemo(
    () => calculateAllocationTotal(analysis?.allocations ?? []),
    [analysis],
  )

  async function requestAnalysis(userFeedback?: string): Promise<void> {
    abortControllerReference.current?.abort()
    const abortController = new AbortController()
    abortControllerReference.current = abortController
    setIsAnalyzing(true)
    setErrorMessage('')

    try {
      const result = await agent.analyze(
        {
          riskProfile,
          investmentPeriod,
          monthlyInvestmentAmount: monthlyAmount,
          interests,
          strategy,
          assetContext,
          userFeedback,
        },
        abortController.signal,
      )
      setAnalysis(result)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return
      }
      setErrorMessage(
        error instanceof Error ? error.message : '포트폴리오 분석에 실패했습니다.',
      )
    } finally {
      setIsAnalyzing(false)
    }
  }

  function confirmAnalysis(): void {
    if (!analysis || analysis.decision !== 'accepted') {
      setErrorMessage('AI 제안을 수락한 뒤 확정해 주세요.')
      return
    }
    if (Math.abs(allocationTotal - 100) > 0.01) {
      setErrorMessage('자산 배분 합계가 100%가 되도록 수정해 주세요.')
      return
    }

    const nextConfirmed = {
      ...analysis,
      confirmedAt: new Date().toISOString(),
    }
    reviewRepository.save(nextConfirmed)
    setConfirmed(nextConfirmed)
    setErrorMessage('')
  }

  return (
    <div className="agent-workspace">
      <section className="agent-intro-card">
        <div className="agent-avatar"><PieChart size={24} /></div>
        <div>
          <span>SKale 배분 코치</span>
          <h2>AI의 배분안은 초안이고, 결정권은 사용자에게 있어요.</h2>
          <p>현재 자산 상태와 투자 조건을 연결하되 매수·매도 지시는 하지 않습니다.</p>
        </div>
        <div className="agent-principle"><ShieldCheck size={17} />Advisory only</div>
      </section>

      <section className="input-card">
        <div className="form-grid">
          <label>투자 성향
            <select value={riskProfile} onChange={(event) => setRiskProfile(event.target.value as RiskProfile)}>
              <option>안정형</option><option>중립형</option><option>공격형</option>
            </select>
          </label>
          <label>투자 기간
            <select value={investmentPeriod} onChange={(event) => setInvestmentPeriod(event.target.value as InvestmentPeriod)}>
              <option>1년 미만</option><option>1~3년</option><option>3년 이상</option>
            </select>
          </label>
          <label>월 투자 가능 금액
            <input inputMode="numeric" value={monthlyAmount} onChange={(event) => setMonthlyAmount(Number(event.target.value.replaceAll(',', '')) || 0)} />
          </label>
          <label>관심 산업
            <input value={interests} onChange={(event) => setInterests(event.target.value)} />
          </label>
        </div>
        <label className="full-field">나의 투자 전략
          <textarea value={strategy} onChange={(event) => setStrategy(event.target.value)} />
        </label>
        <div className="button-row right">
          <button className="button primary" type="button" disabled={isAnalyzing} onClick={() => void requestAnalysis()}>
            {isAnalyzing ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />}
            {isAnalyzing ? 'AI가 분석 중...' : 'AI에게 배분안 요청'}
          </button>
        </div>
      </section>

      {errorMessage && <div className="agent-error" role="alert"><CircleAlert size={18} />{errorMessage}</div>}

      {analysis && (
        <section className="review-section">
          <div className="review-heading">
            <div><span className="section-kicker">AI PORTFOLIO PROPOSAL</span><h2>배분안을 검토하고 수정하세요</h2><p>{analysis.strategyFit}</p></div>
            <strong className={`allocation-total ${Math.abs(allocationTotal - 100) < 0.01 ? 'valid' : ''}`}>{allocationTotal}%</strong>
          </div>

          <div className="allocation-list">
            {analysis.allocations.map((allocation) => (
              <article className="allocation-item" key={allocation.id}>
                <div><strong>{allocation.assetClass}</strong><p>{allocation.reason}</p><small>{allocation.riskNote}</small></div>
                <label>비중
                  <input
                    inputMode="decimal"
                    value={allocation.percentage}
                    onChange={(event) =>
                      setAnalysis((current) => current ? {
                        ...current,
                        decision: 'pending',
                        allocations: current.allocations.map((item) =>
                          item.id === allocation.id
                            ? { ...item, percentage: Number(event.target.value) || 0 }
                            : item,
                        ),
                      } : current)
                    }
                  />
                </label>
              </article>
            ))}
          </div>

          <div className="portfolio-decision-row">
            <button className={`proposal-action accept${analysis.decision === 'accepted' ? ' selected' : ''}`} type="button" onClick={() => setAnalysis({ ...analysis, decision: 'accepted' })}><ThumbsUp size={15} />제안 수락</button>
            <button className={`proposal-action reject${analysis.decision === 'rejected' ? ' selected' : ''}`} type="button" onClick={() => setAnalysis({ ...analysis, decision: 'rejected' })}><ThumbsDown size={15} />제안 거절</button>
          </div>

          <aside className="agent-conversation-card compact-conversation">
            <div className="conversation-heading"><MessageSquareText size={19} /><div><strong>배분 방향 수정 요청</strong><span>예: 개별 종목 비중을 줄이고 현금 비중을 높여줘.</span></div></div>
            <textarea aria-label="포트폴리오 AI 수정 요청" value={feedback} onChange={(event) => setFeedback(event.target.value)} />
            <button className="button agent-feedback-button" type="button" disabled={!feedback.trim() || isAnalyzing} onClick={() => void requestAnalysis(feedback.trim())}><Sparkles size={16} />의견 반영해 다시 분석</button>
            {analysis.appliedFeedback && <p className="applied-feedback"><Check size={14} />반영한 요청: {analysis.appliedFeedback}</p>}
          </aside>

          <div className="review-footer">
            <div><strong>{analysis.priority}</strong><span>{analysis.disclaimer}</span></div>
            <button className="button primary" type="button" disabled={analysis.decision !== 'accepted' || Math.abs(allocationTotal - 100) > 0.01} onClick={confirmAnalysis}><CheckCheck size={17} />배분안 확정</button>
          </div>
        </section>
      )}

      {confirmed && (
        <section className="confirmed-card">
          <div className="confirmed-icon"><CheckCheck size={22} /></div>
          <div><span>최근 확정 배분안</span><h2>사용자가 승인한 포트폴리오를 저장했어요.</h2><p>{confirmed.riskComment}</p></div>
        </section>
      )}
    </div>
  )
}
