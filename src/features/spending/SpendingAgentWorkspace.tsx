import {
  Bot,
  Check,
  CheckCheck,
  ChevronDown,
  CircleAlert,
  LoaderCircle,
  MessageSquareText,
  Pencil,
  RotateCcw,
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
  calculateExpenseTotal,
  isReviewComplete,
  spendingCategories,
  transactionNatures,
  type ConfirmedSpendingAnalysis,
  type SpendingAgent,
  type SpendingAnalysis,
  type SpendingProposal,
  type SpendingReviewRepository,
} from '../../domain/spending'

const EXAMPLE_INPUT =
  '6/25 스타벅스 6,300원\n6/25 월세 500,000원\n6/25 미래에셋증권 300,000원\n6/26 쿠팡 42,000원'

interface SpendingAgentWorkspaceProps {
  agent: SpendingAgent
  reviewRepository: SpendingReviewRepository
}

type AnalysisStatus = 'idle' | 'analyzing' | 'reviewing' | 'confirmed' | 'error'

export function SpendingAgentWorkspace({
  agent,
  reviewRepository,
}: SpendingAgentWorkspaceProps): ReactNode {
  const [input, setInput] = useState(EXAMPLE_INPUT)
  const [feedback, setFeedback] = useState('')
  const [analysis, setAnalysis] = useState<SpendingAnalysis | null>(null)
  const [confirmedAnalysis, setConfirmedAnalysis] =
    useState<ConfirmedSpendingAnalysis | null>(() => reviewRepository.loadLatest())
  const [status, setStatus] = useState<AnalysisStatus>('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const abortControllerReference = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => abortControllerReference.current?.abort()
  }, [])

  const acceptedCount = useMemo(
    () =>
      analysis?.proposals.filter((proposal) => proposal.decision === 'accepted')
        .length ?? 0,
    [analysis],
  )
  const rejectedCount = useMemo(
    () =>
      analysis?.proposals.filter((proposal) => proposal.decision === 'rejected')
        .length ?? 0,
    [analysis],
  )
  const expenseTotal = useMemo(
    () => calculateExpenseTotal(analysis?.proposals ?? []),
    [analysis],
  )

  async function requestAnalysis(userFeedback?: string): Promise<void> {
    if (!input.trim()) {
      setErrorMessage('분석할 소비 내역을 입력해 주세요.')
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
          : '분석 중 문제가 발생했습니다. 입력 내용을 확인하고 다시 시도해 주세요.',
      )
      setStatus('error')
    }
  }

  function updateProposal(
    proposalId: string,
    update: (proposal: SpendingProposal) => SpendingProposal,
  ): void {
    setAnalysis((currentAnalysis) => {
      if (!currentAnalysis) {
        return currentAnalysis
      }

      return {
        ...currentAnalysis,
        proposals: currentAnalysis.proposals.map((proposal) =>
          proposal.id === proposalId ? update(proposal) : proposal,
        ),
      }
    })
  }

  function decideProposal(
    proposalId: string,
    decision: SpendingProposal['decision'],
  ): void {
    updateProposal(proposalId, (proposal) => ({ ...proposal, decision }))
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
          }
        : currentAnalysis,
    )
  }

  function confirmReview(): void {
    if (!analysis || !isReviewComplete(analysis.proposals)) {
      setErrorMessage('모든 제안을 수락하거나 거절한 뒤 확정해 주세요.')
      return
    }

    const confirmed: ConfirmedSpendingAnalysis = {
      ...analysis,
      confirmedAt: new Date().toISOString(),
    }
    reviewRepository.save(confirmed)
    setConfirmedAnalysis(confirmed)
    setStatus('confirmed')
    setErrorMessage('')
  }

  function reviseWithFeedback(): void {
    const normalizedFeedback = feedback.trim()

    if (!normalizedFeedback) {
      setErrorMessage('AI에게 반영할 수정 요청을 입력해 주세요.')
      return
    }

    void requestAnalysis(normalizedFeedback)
  }

  return (
    <div className="agent-workspace">
      <section className="agent-intro-card">
        <div className="agent-avatar" aria-hidden="true">
          <Bot size={24} />
        </div>
        <div>
          <span>SKale 소비 코치</span>
          <h2>제가 먼저 분류하고, 최종 판단은 함께 결정해요.</h2>
          <p>
            분석 결과를 그대로 저장하지 않습니다. 근거를 확인하고 수정·수락·거절한
            내용만 확정 기록에 반영해요.
          </p>
        </div>
        <div className="agent-principle">
          <ShieldCheck size={17} />
          Human in the loop
        </div>
      </section>

      <div className="two-column-layout agent-input-layout">
        <section className="input-card">
          <SectionTitle
            title="소비 내역 전달하기"
            description="한 줄에 거래 하나씩 자유롭게 입력하세요."
          />
          <textarea
            aria-label="소비 내역"
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
              <strong>AI에게 추가 맥락 알려주기</strong>
              <span>분류 기준이나 거래 목적을 설명해 주세요.</span>
            </div>
          </div>
          <textarea
            aria-label="AI 수정 요청"
            value={feedback}
            placeholder="예: 쿠팡 결제는 생필품 구매라서 생활비로 분류해줘."
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

      {status === 'analyzing' && <AnalyzingState />}

      {analysis && status !== 'analyzing' && (
        <section className="review-section">
          <div className="review-heading">
            <div>
              <span className="section-kicker">AI PROPOSAL</span>
              <h2>AI 제안을 검토해 주세요</h2>
              <p>{analysis.insight}</p>
            </div>
            <button className="button secondary compact" type="button" onClick={acceptAll}>
              <CheckCheck size={16} />
              모두 수락
            </button>
          </div>

          <div className="review-summary" aria-label="검토 현황">
            <SummaryItem label="전체 제안" value={`${analysis.proposals.length}건`} />
            <SummaryItem label="수락" value={`${acceptedCount}건`} tone="accepted" />
            <SummaryItem label="거절" value={`${rejectedCount}건`} tone="rejected" />
            <SummaryItem
              label="확정 소비"
              value={`${expenseTotal.toLocaleString()}원`}
              tone="primary"
            />
          </div>

          <div className="proposal-list">
            {analysis.proposals.map((proposal) => (
              <ProposalCard
                key={proposal.id}
                proposal={proposal}
                onChange={(nextProposal) =>
                  updateProposal(proposal.id, () => nextProposal)
                }
                onDecision={(decision) => decideProposal(proposal.id, decision)}
              />
            ))}
          </div>

          <div className="review-footer">
            <div>
              <strong>
                {isReviewComplete(analysis.proposals)
                  ? '모든 항목을 검토했어요.'
                  : '아직 판단하지 않은 항목이 있어요.'}
              </strong>
              <span>수락한 항목만 소비 합계와 대시보드에 반영됩니다.</span>
            </div>
            <button
              className="button primary"
              type="button"
              disabled={!isReviewComplete(analysis.proposals)}
              onClick={confirmReview}
            >
              <CheckCheck size={17} />
              검토 결과 확정
            </button>
          </div>
        </section>
      )}

      {confirmedAnalysis && (
        <section className="confirmed-card" aria-live="polite">
          <div className="confirmed-icon">
            <CheckCheck size={22} />
          </div>
          <div>
            <span>최근 확정 기록</span>
            <h2>
              사용자 검토를 통과한{' '}
              {
                confirmedAnalysis.proposals.filter(
                  (proposal) => proposal.decision === 'accepted',
                ).length
              }
              건을 저장했어요.
            </h2>
            <p>
              AI의 원본 제안과 사용자의 수정·거절 판단을 함께 보존해 다음 분석의
              맥락으로 활용할 수 있어요.
            </p>
          </div>
        </section>
      )}
    </div>
  )
}

interface ProposalCardProps {
  proposal: SpendingProposal
  onChange: (proposal: SpendingProposal) => void
  onDecision: (decision: SpendingProposal['decision']) => void
}

function ProposalCard({
  proposal,
  onChange,
  onDecision,
}: ProposalCardProps): ReactNode {
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
            <span className="proposal-date">{proposal.date}</span>
            <h3>{proposal.merchant}</h3>
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
            사용처
            <input
              value={proposal.merchant}
              onChange={(event) =>
                onChange({ ...proposal, merchant: event.target.value })
              }
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
            거래 성격
            <select
              value={proposal.nature}
              onChange={(event) =>
                onChange({
                  ...proposal,
                  nature: event.target.value as SpendingProposal['nature'],
                })
              }
            >
              {transactionNatures.map((nature) => (
                <option key={nature} value={nature}>
                  {nature}
                </option>
              ))}
            </select>
          </label>
          <label>
            소비 카테고리
            <select
              value={proposal.spendingCategory ?? '기타'}
              onChange={(event) =>
                onChange({
                  ...proposal,
                  spendingCategory: event.target
                    .value as SpendingProposal['spendingCategory'],
                })
              }
            >
              {spendingCategories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>
          <label className="proposal-note-field">
            수정 이유 또는 메모
            <input
              value={proposal.userNote}
              placeholder="예: 개인 쇼핑이 아니라 회사 비용 정산"
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

function AnalyzingState(): ReactNode {
  return (
    <section className="analyzing-card" aria-live="polite">
      <div className="analysis-pulse">
        <Sparkles size={21} />
      </div>
      <div>
        <h2>거래의 성격과 맥락을 살펴보고 있어요.</h2>
        <p>소비·저축·투자·이체를 구분하고 각 판단의 근거를 정리합니다.</p>
      </div>
    </section>
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
