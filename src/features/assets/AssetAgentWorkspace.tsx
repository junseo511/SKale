import {
  Bot,
  Check,
  CheckCheck,
  ChevronDown,
  CircleAlert,
  CircleDollarSign,
  LoaderCircle,
  MessageSquareText,
  Pencil,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  WalletCards,
} from 'lucide-react'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  assetCategories,
  calculateAssetSummary,
  calculateSalaryAllocationTotal,
  isAssetReviewComplete,
  type AssetAgent,
  type AssetAnalysis,
  type AssetProposal,
  type AssetReviewRepository,
  type ConfirmedAssetAnalysis,
} from '../../domain/assets'

const EXAMPLE_INPUT =
  '월 실수령액 3,200,000원\n월급일 매월 25일\n토스뱅크 1,200,000원\n주식계좌 3,500,000원\n신용카드 미결제 420,000원\n월세 500,000원\n통신비 70,000원\n다음 달 여행비 800,000원'

interface AssetAgentWorkspaceProps {
  agent: AssetAgent
  reviewRepository: AssetReviewRepository
}

type AnalysisStatus = 'idle' | 'analyzing' | 'reviewing' | 'confirmed' | 'error'

export function AssetAgentWorkspace({
  agent,
  reviewRepository,
}: AssetAgentWorkspaceProps): ReactNode {
  const [input, setInput] = useState(EXAMPLE_INPUT)
  const [feedback, setFeedback] = useState('')
  const [analysis, setAnalysis] = useState<AssetAnalysis | null>(null)
  const [confirmedAnalysis, setConfirmedAnalysis] =
    useState<ConfirmedAssetAnalysis | null>(() => reviewRepository.loadLatest())
  const [status, setStatus] = useState<AnalysisStatus>('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const abortControllerReference = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => abortControllerReference.current?.abort()
  }, [])

  const summary = useMemo(
    () => calculateAssetSummary(analysis?.proposals ?? []),
    [analysis],
  )
  const salaryAllocationTotal = useMemo(
    () => calculateSalaryAllocationTotal(analysis?.salaryAllocations ?? []),
    [analysis],
  )
  async function requestAnalysis(userFeedback?: string): Promise<void> {
    if (!input.trim()) {
      setErrorMessage('분석할 자산 현황을 입력해 주세요.')
      setStatus('error')
      return
    }

    abortControllerReference.current?.abort()
    const abortController = new AbortController()
    abortControllerReference.current = abortController
    setStatus('analyzing')
    setErrorMessage('')

    try {
      const nextAnalysis = await agent.analyze(
        { input, userFeedback },
        abortController.signal,
      )
      setAnalysis(nextAnalysis)
      setStatus('reviewing')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return
      }
      setErrorMessage(
        error instanceof Error
          ? error.message
          : '자산 분석 중 문제가 발생했습니다.',
      )
      setStatus('error')
    }
  }

  function updateProposal(
    proposalId: string,
    update: (proposal: AssetProposal) => AssetProposal,
  ): void {
    setAnalysis((currentAnalysis) =>
      currentAnalysis
        ? {
            ...currentAnalysis,
            proposals: currentAnalysis.proposals.map((proposal) =>
              proposal.id === proposalId ? update(proposal) : proposal,
            ),
          }
        : currentAnalysis,
    )
  }

  function acceptAll(): void {
    setAnalysis((currentAnalysis) =>
      currentAnalysis
        ? {
            ...currentAnalysis,
            proposals: currentAnalysis.proposals.map((proposal) => ({
              ...proposal,
              decision: 'accepted',
            })),
            allocationDecision:
              currentAnalysis.salaryAllocations.length > 0
                ? 'accepted'
                : currentAnalysis.allocationDecision,
          }
        : currentAnalysis,
    )
  }

  function confirmReview(): void {
    if (!analysis || !isAssetReviewComplete(analysis.proposals)) {
      setErrorMessage('모든 자산 제안을 수락하거나 거절한 뒤 확정해 주세요.')
      return
    }
    if (
      analysis.salaryAllocations.length > 0 &&
      analysis.allocationDecision !== 'accepted'
    ) {
      setErrorMessage('월급 배분안을 수락하거나 수정 후 수락해 주세요.')
      return
    }
    if (
      analysis.salaryAllocations.length > 0 &&
      salaryAllocationTotal !== summary.monthlyIncome
    ) {
      setErrorMessage('월급 배분 합계가 월 실수령액과 같아야 합니다.')
      return
    }

    const confirmed: ConfirmedAssetAnalysis = {
      ...analysis,
      confirmedAt: new Date().toISOString(),
    }
    reviewRepository.save(confirmed)
    setConfirmedAnalysis(confirmed)
    setStatus('confirmed')
    setErrorMessage('')
  }

  function reviseWithFeedback(): void {
    if (!feedback.trim()) {
      setErrorMessage('AI에게 반영할 수정 요청을 입력해 주세요.')
      return
    }
    void requestAnalysis(feedback.trim())
  }

  const confirmedSummary = confirmedAnalysis
    ? calculateAssetSummary(confirmedAnalysis.proposals)
    : null

  return (
    <div className="agent-workspace">
      <section className="agent-intro-card">
        <div className="agent-avatar" aria-hidden="true">
          <WalletCards size={24} />
        </div>
        <div>
          <span>SKale 월급·자산 코치</span>
          <h2>월급부터 자산과 부채까지 한 번에 정리해요.</h2>
          <p>
            월급은 반복 수입으로, 통장 잔액은 자산으로 구분합니다. 승인된 정보로
            순자산과 이번 달 월급 배분안을 함께 완성해요.
          </p>
        </div>
        <div className="agent-principle">
          <ShieldCheck size={17} />
          Verified by user
        </div>
      </section>

      <div className="two-column-layout agent-input-layout">
        <section className="input-card">
          <SectionTitle
            title="월급과 자산 전달하기"
            description="월급, 월급일, 자산, 부채, 고정비, 목적 자금을 자유롭게 입력하세요."
          />
          <textarea
            aria-label="자산 현황"
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
          <div className="button-row">
            <button
              className="button secondary"
              type="button"
              onClick={() => setInput(EXAMPLE_INPUT)}
            >
              <RotateCcw size={16} />
              예시 다시 넣기
            </button>
            <button
              className="button primary"
              type="button"
              disabled={status === 'analyzing'}
              onClick={() => void requestAnalysis()}
            >
              {status === 'analyzing' ? (
                <LoaderCircle className="spin" size={17} />
              ) : (
                <Sparkles size={17} />
              )}
              {status === 'analyzing' ? 'AI가 분석 중...' : 'AI에게 분석 요청'}
            </button>
          </div>
        </section>

        <aside className="agent-conversation-card">
          <div className="conversation-heading">
            <MessageSquareText size={19} />
            <div>
              <strong>월급 운용 목표를 AI에게 알려주세요</strong>
              <span>비상금, 여행, 저축, 투자 우선순위를 설명하면 배분이 정확해져요.</span>
            </div>
          </div>
          <textarea
            aria-label="자산 AI 수정 요청"
            value={feedback}
            placeholder="예: 비상금을 먼저 500만원까지 만들고 투자는 월급의 10%만 배분해줘."
            onChange={(event) => setFeedback(event.target.value)}
          />
          <button
            className="button agent-feedback-button"
            type="button"
            disabled={!analysis || status === 'analyzing'}
            onClick={reviseWithFeedback}
          >
            <Sparkles size={16} />
            이 의견으로 다시 분석
          </button>
          {analysis?.appliedFeedback && (
            <p className="applied-feedback">
              <Check size={14} />
              반영한 요청: {analysis.appliedFeedback}
            </p>
          )}
        </aside>
      </div>

      {errorMessage && (
        <div className="agent-error" role="alert">
          <CircleAlert size={18} />
          {errorMessage}
        </div>
      )}

      {status === 'analyzing' && (
        <section className="analyzing-card" aria-live="polite">
          <div className="analysis-pulse">
            <Sparkles size={21} />
          </div>
          <div>
            <h2>월급의 흐름과 현재 재무 상태를 함께 살펴보고 있어요.</h2>
            <p>수입·필수 지출·자산·부채를 구분하고 월급 배분 초안을 만듭니다.</p>
          </div>
        </section>
      )}

      {analysis && status !== 'analyzing' && (
        <section className="review-section">
          <div className="review-heading">
            <div>
              <span className="section-kicker">AI ASSET PROPOSAL</span>
              <h2>월급과 자산 분류를 검토해 주세요</h2>
              <p>{analysis.insight}</p>
            </div>
            <button className="button secondary compact" type="button" onClick={acceptAll}>
              <CheckCheck size={16} />
              모두 수락
            </button>
          </div>

          <div className="review-summary asset-review-summary">
            <SummaryItem label="월 실수령액" value={`${summary.monthlyIncome.toLocaleString()}원`} tone="accepted" />
            <SummaryItem label="필수 지출" value={`${summary.essentialExpense.toLocaleString()}원`} tone="rejected" />
            <SummaryItem label="순자산" value={`${summary.netWorth.toLocaleString()}원`} tone="primary" />
            <SummaryItem label="월급일" value={analysis.payday ?? '확인 필요'} />
          </div>

          <div className="asset-health-panel">
            <div>
              <span>AI 건강 상태</span>
              <strong>{analysis.healthStatus}</strong>
            </div>
            <ul>
              {analysis.actionItems.map((actionItem) => (
                <li key={actionItem}>{actionItem}</li>
              ))}
            </ul>
          </div>

          {analysis.missingData.length > 0 && (
            <div className="missing-data-panel">
              <CircleAlert size={18} />
              <div>
                <strong>정확한 판단을 위해 더 필요한 정보</strong>
                <p>{analysis.missingData.join(' · ')}</p>
              </div>
            </div>
          )}

          <div className="proposal-list">
            {analysis.proposals.map((proposal) => (
              <AssetProposalCard
                key={proposal.id}
                proposal={proposal}
                onChange={(nextProposal) =>
                  updateProposal(proposal.id, () => nextProposal)
                }
                onDecision={(decision) =>
                  updateProposal(proposal.id, (currentProposal) => ({
                    ...currentProposal,
                    decision,
                  }))
                }
              />
            ))}
          </div>

          {analysis.salaryAllocations.length > 0 && (
            <section className="salary-allocation-section">
              <div className="review-heading">
                <div>
                  <span className="section-kicker">SALARY ALLOCATION</span>
                  <h2>이번 월급 배분안을 조정해 보세요</h2>
                  <p>{analysis.allocationInsight}</p>
                </div>
                <strong
                  className={`allocation-total ${
                    salaryAllocationTotal === summary.monthlyIncome ? 'valid' : ''
                  }`}
                >
                  {salaryAllocationTotal.toLocaleString()}원
                </strong>
              </div>

              <div className="allocation-list">
                {analysis.salaryAllocations.map((allocation) => (
                  <article className="allocation-item" key={allocation.id}>
                    <div>
                      <strong>{allocation.category}</strong>
                      <p>{allocation.reason}</p>
                    </div>
                    <label>
                      배분 금액
                      <input
                        inputMode="numeric"
                        value={allocation.amount}
                        onChange={(event) =>
                          setAnalysis((current) =>
                            current
                              ? {
                                  ...current,
                                  allocationDecision: 'pending',
                                  salaryAllocations:
                                    current.salaryAllocations.map((item) =>
                                      item.id === allocation.id
                                        ? {
                                            ...item,
                                            amount:
                                              Number(
                                                event.target.value.replaceAll(
                                                  ',',
                                                  '',
                                                ),
                                              ) || 0,
                                          }
                                        : item,
                                    ),
                                }
                              : current,
                          )
                        }
                      />
                    </label>
                  </article>
                ))}
              </div>

              <div className="portfolio-decision-row">
                <button
                  className={`proposal-action accept${
                    analysis.allocationDecision === 'accepted'
                      ? ' selected'
                      : ''
                  }`}
                  type="button"
                  onClick={() =>
                    setAnalysis({ ...analysis, allocationDecision: 'accepted' })
                  }
                >
                  <ThumbsUp size={15} />
                  배분안 수락
                </button>
                <button
                  className={`proposal-action reject${
                    analysis.allocationDecision === 'rejected'
                      ? ' selected'
                      : ''
                  }`}
                  type="button"
                  onClick={() =>
                    setAnalysis({ ...analysis, allocationDecision: 'rejected' })
                  }
                >
                  <ThumbsDown size={15} />
                  배분안 거절
                </button>
              </div>
            </section>
          )}

          <div className="review-footer">
            <div>
              <strong>
                {isAssetReviewComplete(analysis.proposals)
                  ? '월급과 자산 항목을 모두 검토했어요.'
                  : '아직 판단하지 않은 항목이 있어요.'}
              </strong>
              <span>수입은 배분에, 자산과 부채는 순자산 계산에 각각 반영됩니다.</span>
            </div>
            <button
              className="button primary"
              type="button"
              disabled={
                !isAssetReviewComplete(analysis.proposals) ||
                (analysis.salaryAllocations.length > 0 &&
                  (analysis.allocationDecision !== 'accepted' ||
                    salaryAllocationTotal !== summary.monthlyIncome))
              }
              onClick={confirmReview}
            >
              <CheckCheck size={17} />
              월급·자산 계획 확정
            </button>
          </div>
        </section>
      )}

      {confirmedAnalysis && confirmedSummary && (
        <section className="confirmed-card" aria-live="polite">
          <div className="confirmed-icon">
            <CircleDollarSign size={22} />
          </div>
          <div>
            <span>최근 확정 월급·자산 계획</span>
            <h2>
              월급 {confirmedSummary.monthlyIncome.toLocaleString()}원과 순자산{' '}
              {confirmedSummary.netWorth.toLocaleString()}원을 저장했어요.
            </h2>
            <p>확정된 월급 배분안은 다음 포트폴리오 분석의 투자 가능 금액으로 연결할 수 있어요.</p>
          </div>
        </section>
      )}
    </div>
  )
}

interface AssetProposalCardProps {
  proposal: AssetProposal
  onChange: (proposal: AssetProposal) => void
  onDecision: (decision: AssetProposal['decision']) => void
}

function AssetProposalCard({
  proposal,
  onChange,
  onDecision,
}: AssetProposalCardProps): ReactNode {
  const [isEditing, setIsEditing] = useState(false)
  const decisionLabel =
    proposal.decision === 'accepted'
      ? '수락됨'
      : proposal.decision === 'rejected'
        ? '거절됨'
        : '검토 대기'

  return (
    <article className={`proposal-card ${proposal.decision}`}>
      <div className="proposal-main">
        <div className="proposal-title-row">
          <div>
            <span className="proposal-date">{proposal.category}</span>
            <h3>{proposal.name}</h3>
          </div>
          <strong>{proposal.amount.toLocaleString()}원</strong>
        </div>
        <div className="proposal-meta">
          <span className={`decision-badge ${proposal.decision}`}>{decisionLabel}</span>
          <span>신뢰도 {Math.round(proposal.confidence * 100)}%</span>
          {proposal.needReview && (
            <span className="review-needed">
              <CircleAlert size={13} />
              확인 필요
            </span>
          )}
        </div>
        <p className="proposal-reason">
          <Bot size={15} />
          {proposal.reason}
        </p>
      </div>

      {isEditing && (
        <div className="proposal-edit-panel">
          <label>
            항목명
            <input
              value={proposal.name}
              onChange={(event) => onChange({ ...proposal, name: event.target.value })}
            />
          </label>
          <label>
            금액
            <input
              inputMode="numeric"
              value={proposal.amount}
              onChange={(event) =>
                onChange({
                  ...proposal,
                  amount: Number(event.target.value.replaceAll(',', '')) || 0,
                })
              }
            />
          </label>
          <label>
            자산 분류
            <select
              value={proposal.category}
              onChange={(event) =>
                onChange({
                  ...proposal,
                  category: event.target.value as AssetProposal['category'],
                })
              }
            >
              {assetCategories.map((category) => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
          </label>
          <label>
            수정 이유 또는 메모
            <input
              value={proposal.userNote}
              placeholder="예: 다음 달 여행에 사용할 단기 목적 자금"
              onChange={(event) =>
                onChange({ ...proposal, userNote: event.target.value })
              }
            />
          </label>
        </div>
      )}

      <div className="proposal-actions">
        <button
          className={`proposal-action accept${proposal.decision === 'accepted' ? ' selected' : ''}`}
          type="button"
          onClick={() => onDecision('accepted')}
        >
          <ThumbsUp size={15} />
          수락
        </button>
        <button
          className="proposal-action edit"
          type="button"
          aria-expanded={isEditing}
          onClick={() => setIsEditing((current) => !current)}
        >
          <Pencil size={15} />
          수정
          <ChevronDown className={isEditing ? 'rotate' : ''} size={14} />
        </button>
        <button
          className={`proposal-action reject${proposal.decision === 'rejected' ? ' selected' : ''}`}
          type="button"
          onClick={() => onDecision('rejected')}
        >
          <ThumbsDown size={15} />
          거절
        </button>
      </div>
    </article>
  )
}

function SummaryItem({
  label,
  value,
  tone = '',
}: {
  label: string
  value: string
  tone?: string
}): ReactNode {
  return (
    <div className={`review-summary-item ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function SectionTitle({
  title,
  description,
}: {
  title: string
  description: string
}): ReactNode {
  return (
    <div className="section-heading">
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </div>
  )
}
