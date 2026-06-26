import {
  ArrowUp,
  BadgeCheck,
  Bot,
  Calculator,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  FileText,
  Globe2,
  ImagePlus,
  LockKeyhole,
  MessageCircleMore,
  Minus,
  Paperclip,
  PiggyBank,
  Plus,
  RotateCcw,
  Sparkles,
  TrendingUp,
  Trash2,
  UserRound,
  WalletCards,
  X,
} from 'lucide-react'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { HttpPaydayConversationAgent } from './data/httpPaydayConversationAgent'
import { LocalPaydayPlanRepository } from './data/localPaydayPlanRepository'
import { LocalPaydayWorkspaceRepository } from './data/localPaydayWorkspaceRepository'
import {
  applyFinancialProfilePatch,
  countCompletedProfileFields,
  EMPTY_FINANCIAL_PROFILE,
  INITIAL_AGENT_MESSAGE,
  toPaydayInput,
  type ConversationAttachment,
  type ConversationMessage,
  type FinancialProfile,
  type FinancialProfilePatch,
  type MonthlySpendingSummary,
  type PaydayConversationResponse,
} from './domain/paydayConversation'
import {
  estimateNetSalary,
  type NetSalaryEstimate,
  type NetSalaryInput,
  type SalaryUnit,
} from './domain/netSalary'
import { createPaydayPlan, type PaydayPlan } from './domain/paydayPlan'
import './App.css'

type PortfolioMarket = '한국' | '미국' | '한국·미국'
type NextActionKind = 'salary' | 'message' | 'plan'

interface FinancialProfileItem {
  label: string
  value: string
  isComplete: boolean
  isDefault: boolean
}

interface NextAction {
  kind: NextActionKind
  title: string
  description: string
  primaryLabel: string
  draft?: string
}

const MAX_IMAGE_COUNT = 4
const MAX_IMAGE_BYTES = 4 * 1024 * 1024
const PROFILE_FIELD_COUNT = 1
const agent = new HttpPaydayConversationAgent({
  baseUrl: import.meta.env.VITE_API_BASE_URL,
})
const workspaceRepository = new LocalPaydayWorkspaceRepository()
const planRepository = new LocalPaydayPlanRepository()

function App(): ReactNode {
  const savedWorkspace = useMemo(() => workspaceRepository.load(), [])
  const [messages, setMessages] = useState<ConversationMessage[]>(
    savedWorkspace?.messages.length
      ? normalizeConversationMessages(savedWorkspace.messages)
      : [INITIAL_AGENT_MESSAGE],
  )
  const [profile, setProfile] = useState<FinancialProfile>(() => {
    const savedProfile = savedWorkspace?.profile
    return {
      ...EMPTY_FINANCIAL_PROFILE,
      ...savedProfile,
      goalName: savedProfile?.goalName ?? EMPTY_FINANCIAL_PROFILE.goalName,
      preferences: savedProfile?.preferences ?? [],
      customUses: savedProfile?.customUses ?? [],
    }
  })
  const [monthlySpending, setMonthlySpending] = useState<
    MonthlySpendingSummary[]
  >(savedWorkspace?.monthlySpending ?? [])
  const [draft, setDraft] = useState('')
  const [targetMonth, setTargetMonth] = useState(previousMonth())
  const [attachments, setAttachments] = useState<ConversationAttachment[]>([])
  const [pendingResponse, setPendingResponse] =
    useState<PaydayConversationResponse | null>(null)
  const [isReplying, setIsReplying] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [isPlanSaved, setIsPlanSaved] = useState(false)
  const [isSalaryCalculatorOpen, setIsSalaryCalculatorOpen] =
    useState(false)
  const [portfolioMarket, setPortfolioMarket] =
    useState<PortfolioMarket>('미국')
  const abortControllerReference = useRef<AbortController | null>(null)
  const messageEndReference = useRef<HTMLDivElement | null>(null)
  const composerTextAreaReference = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    workspaceRepository.save({ messages, profile, monthlySpending })
  }, [messages, profile, monthlySpending])

  useEffect(() => {
    messageEndReference.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isReplying, pendingResponse])

  useEffect(() => () => abortControllerReference.current?.abort(), [])

  const paydayInput = useMemo(() => toPaydayInput(profile), [profile])
  const plan = useMemo(
    () => (paydayInput ? createPaydayPlan(paydayInput) : null),
    [paydayInput],
  )
  const completedProfileFields = countCompletedProfileFields(profile)
  const nextAction = getNextAction(profile)
  const shouldShowQuickMessages =
    completedProfileFields > 0 ||
    pendingResponse !== null ||
    messages.some((message) => message.role === 'user')
  const quickMessages = [
    `${Number(targetMonth.split('-')[1])}월의 사용 내역을 정리하고 싶어.`,
    '월세 70만원, 부모님 용돈 20만원, 운동비 10만원을 매달 먼저 빼줘.',
    '외식과 여행 예산은 너무 줄이고 싶지 않아.',
    '비상금과 투자는 어떤 기준으로 나누면 좋을까?',
  ]
  const portfolioRequest =
    plan && plan.availableInvestmentAmount > 0
      ? `${formatWon(plan.availableInvestmentAmount)}으로 ${portfolioMarket} 주식 포트폴리오를 구성해줘. 종목이나 ETF별 금액과 비중, 구성 이유, 주요 위험을 함께 알려줘.`
      : `${portfolioMarket} 주식 포트폴리오를 구성하고 싶어. 내 상황에서 투자할 수 있는 금액과 투자 성향부터 확인해줘.`

  async function sendMessage(): Promise<void> {
    const normalizedDraft = draft.trim()
    if (!normalizedDraft && attachments.length === 0) {
      setErrorMessage('메시지를 입력하거나 사용내역 사진을 첨부해 주세요.')
      return
    }
    if (attachments.length > 0 && !targetMonth) {
      setErrorMessage('사용내역 사진이 어느 달의 자료인지 선택해 주세요.')
      return
    }

    const userMessage: ConversationMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content:
        normalizedDraft ||
        `${targetMonth} 사용내역 이미지 ${attachments.length}장을 보냈어요.`,
      createdAt: new Date().toISOString(),
      status: 'sent',
      attachments,
    }
    const nextMessages = [...messages, userMessage]
    setMessages(nextMessages)
    setDraft('')
    setAttachments([])
    setPendingResponse(null)
    setErrorMessage('')
    setIsReplying(true)
    setIsPlanSaved(false)

    abortControllerReference.current?.abort()
    const abortController = new AbortController()
    abortControllerReference.current = abortController

    try {
      const response = await agent.reply(
        {
          message: normalizedDraft,
          targetMonth: targetMonth || undefined,
          attachments: attachments.map(({ name, mimeType, data }) => ({
            name,
            mimeType,
            data,
          })),
          profile,
          monthlySpending,
          recentMessages: nextMessages.slice(-10).map((message) => ({
            role: message.role,
            content: message.content,
          })),
        },
        abortController.signal,
      )
      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: crypto.randomUUID(),
          role: 'agent',
          content: response.reply,
          createdAt: new Date().toISOString(),
          status: 'sent',
          attachments: [],
        },
      ])
      setPendingResponse(response)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return
      }
      setMessages((currentMessages) =>
        currentMessages.map((message) =>
          message.id === userMessage.id
            ? { ...message, status: 'failed' }
            : message,
        ),
      )
      setErrorMessage(
        error instanceof Error
          ? error.message
          : '답변을 가져오지 못했어요. 다시 시도해 주세요.',
      )
    } finally {
      setIsReplying(false)
    }
  }

  function applyProfileProposal(): void {
    if (!pendingResponse) {
      return
    }
    setProfile((currentProfile) =>
      applyFinancialProfilePatch(
        currentProfile,
        pendingResponse.profilePatch,
      ),
    )
    setPendingResponse((currentResponse) =>
      currentResponse
        ? { ...currentResponse, profilePatch: {} }
        : currentResponse,
    )
    setIsPlanSaved(false)
  }

  function applyMonthlySpendingProposal(isReviewed = false): void {
    const proposal = pendingResponse?.monthlySpendingProposal
    if (!proposal) {
      return
    }
    setMonthlySpending((currentSummaries) => [
      ...currentSummaries.filter(
        (summary) => summary.month !== proposal.month,
      ),
      {
        ...proposal,
        id: crypto.randomUUID(),
        needReview: proposal.needReview && !isReviewed,
      },
    ])
    setPendingResponse((currentResponse) =>
      currentResponse
        ? { ...currentResponse, monthlySpendingProposal: undefined }
        : currentResponse,
    )
  }

  function savePlan(): void {
    if (!plan) {
      return
    }
    planRepository.save(plan)
    setIsPlanSaved(true)
  }

  function updateMonthlySpendingSummary(
    summaryId: string,
    patch: Partial<MonthlySpendingSummary>,
  ): void {
    setMonthlySpending((currentSummaries) =>
      currentSummaries.map((summary) =>
        summary.id === summaryId ? { ...summary, ...patch } : summary,
      ),
    )
  }

  function markMonthlySpendingReviewed(summaryId: string): void {
    updateMonthlySpendingSummary(summaryId, { needReview: false })
  }

  function startMonthlySpendingClarification(
    summary: Omit<MonthlySpendingSummary, 'id'>,
  ): void {
    setDraft(createMonthlySpendingClarification(summary))
    requestAnimationFrame(() => composerTextAreaReference.current?.focus())
  }

  function resetWorkspace(): void {
    abortControllerReference.current?.abort()
    attachments.forEach((attachment) => {
      if (attachment.previewUrl) {
        URL.revokeObjectURL(attachment.previewUrl)
      }
    })
    setMessages([INITIAL_AGENT_MESSAGE])
    setProfile(EMPTY_FINANCIAL_PROFILE)
    setMonthlySpending([])
    setDraft('')
    setAttachments([])
    setPendingResponse(null)
    setErrorMessage('')
    setIsPlanSaved(false)
  }

  async function addAttachments(files: FileList | null): Promise<void> {
    if (!files) {
      return
    }
    const availableCount = Math.max(
      MAX_IMAGE_COUNT - attachments.length,
      0,
    )
    const selectedFiles = [...files].slice(0, availableCount)

    try {
      const nextAttachments = await Promise.all(
        selectedFiles.map(readAttachment),
      )
      setAttachments((currentAttachments) => [
        ...currentAttachments,
        ...nextAttachments,
      ])
      setErrorMessage('')
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : '이미지를 읽지 못했어요. 글자가 잘 보이는 사진으로 다시 올려주세요.',
      )
    }
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="SKale 홈으로">
          <span className="brand-symbol">S</span>
          <span>SKale</span>
        </a>
        <div className="header-actions">
          <button
            className="icon-button"
            type="button"
            aria-label="대화와 입력 내용 초기화"
            onClick={resetWorkspace}
          >
            <RotateCcw size={17} />
          </button>
        </div>
      </header>

      <main id="top">
        <section className="intro-section">
          <div>
            <span className="eyebrow">
              <WalletCards size={15} />
              월급 관리, 한 번에
            </span>
            <h1>
              이번 월급,
              <br />
              <em>어떻게 나눌까요?</em>
            </h1>
            <p>
              월급과 지난 소비를 알려주세요. 생활비부터 저축, 투자까지
              지금 상황에 맞게 정리해 드릴게요.
            </p>
          </div>
          <div className="intro-principles">
            <Principle
              icon={<FileText />}
              title="지난 소비 보기"
              text="내역만 가볍게 등록해요"
            />
            <ChevronRight size={18} />
            <Principle
              icon={<UserRound />}
              title="내 기준 정하기"
              text="줄이고 싶지 않은 지출을 남겨요"
            />
            <ChevronRight size={18} />
            <Principle
              icon={<PiggyBank />}
              title="월급 나누기"
              text="생활비부터 투자금까지 정리해요"
            />
          </div>
        </section>

        <section className="workspace">
          <section className="conversation-panel">
            <div className="panel-heading">
              <div>
                <span className="agent-avatar">
                  <Bot size={19} />
                </span>
                <div>
                  <strong>월급 플래너</strong>
                  <p>한 가지씩 알려주시면 돼요</p>
                </div>
              </div>
              <span className="completion-badge">
                {completedProfileFields}/{PROFILE_FIELD_COUNT} 입력
              </span>
            </div>

            <div className="message-list" aria-live="polite">
              {messages.map((message) => (
                <MessageBubble message={message} key={message.id} />
              ))}
              {!pendingResponse && !isReplying && (
                <NextActionPanel
                  action={nextAction}
                  targetMonth={targetMonth}
                  onOpenSalaryCalculator={() => setIsSalaryCalculatorOpen(true)}
                  onUseDraft={(message) => {
                    setDraft(message)
                    requestAnimationFrame(() =>
                      composerTextAreaReference.current?.focus(),
                    )
                  }}
                />
              )}
              {isReplying && (
                <div className="message-row agent">
                  <span className="message-avatar">
                    <Bot size={16} />
                  </span>
                  <div className="typing-bubble">
                    <i />
                    <i />
                    <i />
                    내용을 정리하고 있어요
                  </div>
                </div>
              )}

              {pendingResponse && (
                <ProposalCards
                  response={pendingResponse}
                  onApplyProfile={applyProfileProposal}
                  onApplyMonthlySpending={applyMonthlySpendingProposal}
                  onStartMonthlySpendingReview={
                    startMonthlySpendingClarification
                  }
                />
              )}
              <div ref={messageEndReference} />
            </div>

            {shouldShowQuickMessages && (
              <div className="suggestion-section">
                <span>바로 입력하기</span>
                <div className="quick-message-list" aria-label="추천 질문">
                  <button
                    className="calculator-quick-button"
                    type="button"
                    onClick={() => setIsSalaryCalculatorOpen(true)}
                  >
                    <Calculator size={16} />
                    실수령액 입력하기
                  </button>
                  {quickMessages.map((message, index) => (
                    <button
                      type="button"
                      key={message}
                      onClick={() => setDraft(message)}
                    >
                      {index === 3 ? (
                        <TrendingUp size={16} />
                      ) : index === 1 ? (
                        <WalletCards size={16} />
                      ) : (
                        <MessageCircleMore size={16} />
                      )}
                      {message}
                    </button>
                  ))}
                  <div className="portfolio-suggestion-card">
                    <div>
                      <Globe2 size={17} />
                      <span>주식 포트폴리오 만들기</span>
                    </div>
                    <div className="market-selector" aria-label="투자 시장 선택">
                      {(['한국', '미국', '한국·미국'] as PortfolioMarket[]).map(
                        (market) => (
                          <button
                            className={
                              portfolioMarket === market ? 'selected' : ''
                            }
                            type="button"
                            key={market}
                            onClick={() => setPortfolioMarket(market)}
                          >
                            {market === '한국·미국' ? '둘 다' : market}
                          </button>
                        ),
                      )}
                    </div>
                    <button
                      className="portfolio-request-button"
                      type="button"
                      onClick={() => setDraft(portfolioRequest)}
                    >
                      {plan && plan.availableInvestmentAmount > 0
                        ? `${formatWon(plan.availableInvestmentAmount)}으로 구성 요청`
                        : '구성 요청하기'}
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {attachments.length > 0 && (
              <div className="attachment-preview-list">
                {attachments.map((attachment) => (
                  <div className="attachment-preview" key={attachment.id}>
                    <img src={attachment.previewUrl} alt="" />
                    <span>{attachment.name}</span>
                    <button
                      type="button"
                      aria-label={`${attachment.name} 첨부 취소`}
                      onClick={() => {
                        if (attachment.previewUrl) {
                          URL.revokeObjectURL(attachment.previewUrl)
                        }
                        setAttachments((currentAttachments) =>
                          currentAttachments.filter(
                            (item) => item.id !== attachment.id,
                          ),
                        )
                      }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {errorMessage && (
              <div className="conversation-error" role="alert">
                <CircleAlert size={16} />
                {errorMessage}
              </div>
            )}

            <div className="composer">
              <textarea
                ref={composerTextAreaReference}
                aria-label="SKale Agent에게 보낼 메시지"
                value={draft}
                placeholder="궁금한 점이나 내 상황을 편하게 적어주세요"
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === 'Enter' &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault()
                    void sendMessage()
                  }
                }}
              />
              <div className="composer-footer">
                <div className="attachment-actions">
                  <label className="attach-button">
                    <ImagePlus size={17} />
                    사용내역 사진
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/heic"
                      multiple
                      onChange={(event) => {
                        void addAttachments(event.target.files)
                        event.target.value = ''
                      }}
                    />
                  </label>
                  <label className="month-field">
                    사용내역 자료 월
                    <input
                      type="month"
                      value={targetMonth}
                      onChange={(event) =>
                        setTargetMonth(event.target.value)
                      }
                    />
                  </label>
                </div>
                <button
                  className="send-button"
                  type="button"
                  disabled={
                    isReplying ||
                    (!draft.trim() && attachments.length === 0)
                  }
                  onClick={() => void sendMessage()}
                >
                  <ArrowUp size={18} />
                  보내기
                </button>
              </div>
            </div>

            <p className="privacy-copy">
              <LockKeyhole size={13} />
              돈 관련 질문은 참고 관점과 함께 답해요. 사진을 올릴 땐 민감한 개인정보를 가려주세요.
            </p>
          </section>

          <aside className="context-panel">
            <ProfileCard profile={profile} completed={completedProfileFields} />
            <MonthlyHistoryCard
              summaries={monthlySpending}
              onUpdate={updateMonthlySpendingSummary}
              onMarkReviewed={markMonthlySpendingReviewed}
              onRequestClarification={startMonthlySpendingClarification}
              onDelete={(summaryId) =>
                setMonthlySpending((currentSummaries) =>
                  currentSummaries.filter(
                    (summary) => summary.id !== summaryId,
                  ),
                )
              }
            />
          </aside>
        </section>

        <PlanSection
          plan={plan}
          isSaved={isPlanSaved}
          onSave={savePlan}
        />
      </main>

      {isSalaryCalculatorOpen && (
        <NetSalaryCalculator
          onClose={() => setIsSalaryCalculatorOpen(false)}
          onApply={(monthlyNetSalary) => {
            setProfile((currentProfile) => ({
              ...currentProfile,
              monthlySalary: monthlyNetSalary,
            }))
            setMessages((currentMessages) => [
              ...currentMessages,
              {
                id: crypto.randomUUID(),
                role: 'agent',
                content: `계산한 예상 월 실수령액 ${formatWon(monthlyNetSalary)}을 내 정보에 반영했어요.`,
                createdAt: new Date().toISOString(),
                status: 'sent',
                attachments: [],
              },
            ])
            setIsSalaryCalculatorOpen(false)
            setIsPlanSaved(false)
          }}
        />
      )}

      <footer>
        <div className="brand footer-brand">
          <span className="brand-symbol">S</span>
          <span>SKale</span>
        </div>
        <p>내 상황에 맞게 월급을 나눠보세요.</p>
        <span>본 자료의 정보는 참고용이며, 투자에 대한 책임은 본인에게 있습니다.</span>
      </footer>
    </div>
  )
}

function NextActionPanel({
  action,
  targetMonth,
  onOpenSalaryCalculator,
  onUseDraft,
}: {
  action: NextAction
  targetMonth: string
  onOpenSalaryCalculator: () => void
  onUseDraft: (message: string) => void
}): ReactNode {
  const secondaryActions = [
    {
      label: `${Number(targetMonth.split('-')[1])}월 사용내역`,
      message: `${Number(targetMonth.split('-')[1])}월의 사용 내역을 정리하고 싶어.`,
      icon: <CalendarDays size={15} />,
    },
    {
      label: '고정비 알려주기',
      message: '월세 70만원, 부모님 용돈 20만원, 운동비 10만원을 매달 먼저 빼줘.',
      icon: <WalletCards size={15} />,
    },
    {
      label: '취향 남기기',
      message: '외식과 여행 예산은 너무 줄이고 싶지 않아.',
      icon: <MessageCircleMore size={15} />,
    },
  ]

  function runPrimaryAction(): void {
    if (action.kind === 'salary') {
      onOpenSalaryCalculator()
      return
    }
    if (action.kind === 'plan') {
      document.getElementById('payday-plan')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
      return
    }
    if (action.draft) {
      onUseDraft(action.draft)
    }
  }

  return (
    <section className="next-action-panel" aria-label="다음 입력">
      <div className="next-action-copy">
        <span>다음 한 가지</span>
        <h2>{action.title}</h2>
        <p>{action.description}</p>
      </div>
      <div className="next-action-buttons">
        <button className="primary-next-action" type="button" onClick={runPrimaryAction}>
          {action.kind === 'salary' ? <Calculator size={16} /> : <ArrowUp size={16} />}
          {action.primaryLabel}
        </button>
        {secondaryActions.map((item) => (
          <button
            className="secondary-next-action"
            type="button"
            key={item.label}
            onClick={() => onUseDraft(item.message)}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </div>
    </section>
  )
}

function MessageBubble({
  message,
}: {
  message: ConversationMessage
}): ReactNode {
  return (
    <div className={`message-row ${message.role}`}>
      <span className="message-avatar">
        {message.role === 'agent' ? <Bot size={16} /> : <UserRound size={16} />}
      </span>
      <div>
        {message.attachments.length > 0 && (
          <div className="message-attachments">
            {message.attachments.map((attachment) =>
              attachment.previewUrl ? (
                <img
                  src={attachment.previewUrl}
                  alt={attachment.name}
                  key={attachment.id}
                />
              ) : (
                <span key={attachment.id}>
                  <Paperclip size={13} />
                  {attachment.name}
                </span>
              ),
            )}
          </div>
        )}
        <p className="message-bubble">{message.content}</p>
        {message.status === 'failed' && (
          <small className="failed-message">전송 결과를 받지 못했어요.</small>
        )}
      </div>
    </div>
  )
}

function ProposalCards({
  response,
  onApplyProfile,
  onApplyMonthlySpending,
  onStartMonthlySpendingReview,
}: {
  response: PaydayConversationResponse
  onApplyProfile: () => void
  onApplyMonthlySpending: (isReviewed?: boolean) => void
  onStartMonthlySpendingReview: (
    summary: Omit<MonthlySpendingSummary, 'id'>,
  ) => void
}): ReactNode {
  const profileEntries = getProfilePatchEntries(response.profilePatch)
  const customUses = response.profilePatch.customUses
  const spendingProposal = response.monthlySpendingProposal
  const hasResponseContext =
    response.appliedFacts.length > 0 || response.missingData.length > 0

  if (
    profileEntries.length === 0 &&
    customUses === undefined &&
    !spendingProposal &&
    !hasResponseContext
  ) {
    return null
  }

  return (
    <div className="proposal-stack">
      {(profileEntries.length > 0 || customUses !== undefined) && (
        <article className="agent-proposal">
          <div className="proposal-heading">
            <span>
              <Sparkles size={15} />
              프로필 반영 제안
            </span>
            <button type="button" onClick={onApplyProfile}>
              <Check size={14} />
              적용
            </button>
          </div>
          <ul>
            {profileEntries.map(([label, value]) => (
              <li key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </li>
            ))}
          </ul>
          {customUses !== undefined && (
            <div className="custom-use-proposal">
              <strong>매달 먼저 나눠둘 사용처</strong>
              {customUses.length > 0 ? (
                <div>
                  {customUses.map((use) => (
                    <article key={`${use.bucket}-${use.name}`}>
                      <span>
                        <b>{use.name}</b>
                        <small>{formatCustomUseBucket(use.bucket)}</small>
                      </span>
                      <strong>{formatWon(use.amount)}</strong>
                      {use.note && <p>{use.note}</p>}
                    </article>
                  ))}
                </div>
              ) : (
                <p>등록된 사용처를 모두 비우는 제안이에요.</p>
              )}
            </div>
          )}
        </article>
      )}

      {spendingProposal && (
        <article className="agent-proposal spending-proposal">
          <div className="proposal-heading">
            <span>
              <CalendarDays size={15} />
              {formatMonth(spendingProposal.month)} 사용 요약
            </span>
            <button type="button" onClick={() => onApplyMonthlySpending()}>
              <Check size={14} />
              {spendingProposal.needReview ? '임시 추가' : '기록 추가'}
            </button>
          </div>
          <div className="spending-proposal-grid">
            <SummaryValue
              label="총소비"
              value={formatNullableWon(spendingProposal.totalExpense)}
            />
            <SummaryValue
              label="필수지출"
              value={formatNullableWon(spendingProposal.essentialExpense)}
            />
            <SummaryValue
              label="선택지출"
              value={formatNullableWon(spendingProposal.flexibleExpense)}
            />
          </div>
          <p>{spendingProposal.insight}</p>
          {spendingProposal.notableCategories.length > 0 && (
            <div className="proposal-tags">
              {spendingProposal.notableCategories.map((category) => (
                <span key={category}>{category}</span>
              ))}
            </div>
          )}
          {spendingProposal.needReview && (
            <div className="proposal-review-assist">
              <div>
                <CircleAlert size={14} />
                <span>읽은 금액이 맞는지만 확인해 주세요.</span>
              </div>
              <button type="button" onClick={() => onApplyMonthlySpending(true)}>
                <Check size={13} />
                맞아요
              </button>
              <button
                type="button"
                onClick={() => onStartMonthlySpendingReview(spendingProposal)}
              >
                <MessageCircleMore size={13} />
                고쳐서 보내기
              </button>
            </div>
          )}
        </article>
      )}

      {hasResponseContext && (
        <article className="response-context">
          {response.appliedFacts.length > 0 && (
            <div>
              <strong>확인한 내용</strong>
              <ul>
                {response.appliedFacts.map((fact) => (
                  <li key={fact}>{fact}</li>
                ))}
              </ul>
            </div>
          )}
          {response.missingData.length > 0 && (
            <div>
              <strong>다음에 필요한 정보</strong>
              <ul>
                {response.missingData.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </article>
      )}
    </div>
  )
}

function ProfileCard({
  profile,
  completed,
}: {
  profile: FinancialProfile
  completed: number
}): ReactNode {
  const estimatedInput = toPaydayInput(profile)
  const items = getFinancialProfileItems(profile, estimatedInput)
  const progressPercent = Math.round((completed / PROFILE_FIELD_COUNT) * 100)

  return (
    <section className="context-card profile-card">
      <div className="context-heading">
        <div>
          <span>내 정보</span>
          <h2>지금까지 입력한 내용</h2>
        </div>
        <strong>{progressPercent}%</strong>
      </div>
      <div className="progress-track">
        <i style={{ width: `${progressPercent}%` }} />
      </div>
      <div className="profile-next-summary">
        <span>{profile.monthlySalary === null ? '입력 현황' : '기본 배분 준비'}</span>
        <strong>
          {profile.monthlySalary === null
            ? '월급만 알려주세요'
            : '나머지는 자동 초안이에요'}
        </strong>
        <p>
          {profile.monthlySalary === null
            ? '월 실수령액을 입력하면 기본 배분안을 먼저 만들어드려요.'
            : '생활비, 목표, 투자 조건은 채팅으로 언제든 조정할 수 있어요.'}
        </p>
      </div>
      <div className="profile-check-list">
        {items.map((item) => (
          <div
            className={
              item.isComplete
                ? item.isDefault
                  ? 'complete defaulted'
                  : 'complete'
                : 'missing'
            }
            key={item.label}
          >
            <i aria-hidden="true" />
            <span>{item.label}</span>
            <strong aria-label={item.isComplete ? undefined : '미입력'}>
              {item.isComplete ? item.value : ''}
            </strong>
            {item.isDefault && <em>자동</em>}
          </div>
        ))}
      </div>
      {profile.preferences.length > 0 && (
        <div className="preference-section">
          <span>지키고 싶은 취향</span>
          <div>
            {profile.preferences.map((preference) => (
              <i key={preference}>{preference}</i>
            ))}
          </div>
        </div>
      )}
      {profile.customUses.length > 0 && (
        <div className="profile-custom-uses">
          <div>
            <span>매달 먼저 나눠둘 사용처</span>
            <small>대화로 추가하거나 금액을 바꿀 수 있어요.</small>
          </div>
          <ul>
            {profile.customUses.map((use) => (
              <li key={`${use.bucket}-${use.name}`}>
                <span>
                  <strong>{use.name}</strong>
                  <small>{formatCustomUseBucket(use.bucket)}</small>
                </span>
                <b>{formatWon(use.amount)}</b>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function MonthlyHistoryCard({
  summaries,
  onUpdate,
  onMarkReviewed,
  onRequestClarification,
  onDelete,
}: {
  summaries: MonthlySpendingSummary[]
  onUpdate: (
    summaryId: string,
    patch: Partial<MonthlySpendingSummary>,
  ) => void
  onMarkReviewed: (summaryId: string) => void
  onRequestClarification: (summary: MonthlySpendingSummary) => void
  onDelete: (summaryId: string) => void
}): ReactNode {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const sortedSummaries = useMemo(
    () =>
      [...summaries].sort((left, right) =>
        right.month.localeCompare(left.month),
      ),
    [summaries],
  )
  const safeSelectedIndex = Math.min(
    selectedIndex,
    Math.max(sortedSummaries.length - 1, 0),
  )
  const selectedSummary = sortedSummaries[safeSelectedIndex]

  return (
    <section className="context-card history-card">
      <div className="context-heading">
        <div>
          <span>월별 소비</span>
          <h2>지난 사용 내역</h2>
        </div>
        <strong>{summaries.length}개월</strong>
      </div>
      {selectedSummary ? (
        <div className="history-carousel">
          <div className="history-navigation">
            <button
              type="button"
              aria-label="더 최근 월 보기"
              disabled={safeSelectedIndex === 0}
              onClick={() =>
                setSelectedIndex((currentIndex) =>
                  Math.max(currentIndex - 1, 0),
                )
              }
            >
              <ChevronLeft size={16} />
            </button>
            <div>
              <strong>{formatMonth(selectedSummary.month)}</strong>
              <span>
                {safeSelectedIndex + 1} / {sortedSummaries.length}
              </span>
            </div>
            <button
              type="button"
              aria-label="더 이전 월 보기"
              disabled={
                safeSelectedIndex === sortedSummaries.length - 1
              }
              onClick={() =>
                setSelectedIndex((currentIndex) =>
                  Math.min(
                    currentIndex + 1,
                    sortedSummaries.length - 1,
                  ),
                )
              }
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <article className="history-slide">
            <div className="history-amounts">
              <SummaryValue
                label="총소비"
                value={formatNullableWon(selectedSummary.totalExpense)}
              />
              <SummaryValue
                label="필수지출"
                value={formatNullableWon(
                  selectedSummary.essentialExpense,
                )}
              />
              <SummaryValue
                label="선택지출"
                value={formatNullableWon(
                  selectedSummary.flexibleExpense,
                )}
              />
            </div>
            <p>{selectedSummary.insight}</p>
            {selectedSummary.notableCategories.length > 0 && (
              <div className="history-categories">
                {selectedSummary.notableCategories.map((category) => (
                  <span key={category}>{category}</span>
                ))}
              </div>
            )}
            {selectedSummary.needReview && (
              <div className="history-review-panel">
                <div className="history-review-heading">
                  <CircleAlert size={15} />
                  <div>
                    <strong>읽은 금액을 확인해 주세요</strong>
                    <p>맞으면 완료하고, 다르면 금액을 바로 고치거나 이어서 물어볼 수 있어요.</p>
                  </div>
                </div>
                <div className="history-review-fields">
                  <MoneyReviewField
                    label="총소비"
                    value={selectedSummary.totalExpense}
                    onChange={(totalExpense) =>
                      onUpdate(selectedSummary.id, { totalExpense })
                    }
                  />
                  <MoneyReviewField
                    label="필수지출"
                    value={selectedSummary.essentialExpense}
                    onChange={(essentialExpense) =>
                      onUpdate(selectedSummary.id, { essentialExpense })
                    }
                  />
                  <MoneyReviewField
                    label="선택지출"
                    value={selectedSummary.flexibleExpense}
                    onChange={(flexibleExpense) =>
                      onUpdate(selectedSummary.id, { flexibleExpense })
                    }
                  />
                </div>
                <div className="history-review-actions">
                  <button
                    type="button"
                    onClick={() => onMarkReviewed(selectedSummary.id)}
                  >
                    <Check size={14} />
                    맞아요
                  </button>
                  <button
                    type="button"
                    onClick={() => onRequestClarification(selectedSummary)}
                  >
                    <MessageCircleMore size={14} />
                    고쳐서 보내기
                  </button>
                </div>
              </div>
            )}
            <div className="history-meta">
              <span>
                {selectedSummary.source === 'text'
                  ? '텍스트'
                  : selectedSummary.source === 'image'
                    ? '사진'
                    : '텍스트+사진'}
              </span>
              {selectedSummary.needReview && <span>확인 필요</span>}
              <button
                type="button"
                aria-label={`${formatMonth(selectedSummary.month)} 기록 삭제`}
                onClick={() => {
                  onDelete(selectedSummary.id)
                  setSelectedIndex((currentIndex) =>
                    Math.max(currentIndex - 1, 0),
                  )
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          </article>
        </div>
      ) : (
        <div className="history-empty">
          <ImagePlus size={23} />
          <strong>아직 불러온 내역이 없어요</strong>
          <p>확인할 달을 고르고 카드 내역 사진이나 텍스트를 보내주세요.</p>
        </div>
      )}
    </section>
  )
}

function MoneyReviewField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number | null
  onChange: (value: number | null) => void
}): ReactNode {
  return (
    <label>
      <span>{label}</span>
      <div>
        <input
          inputMode="numeric"
          value={value === null ? '' : value.toLocaleString()}
          placeholder="모름"
          onChange={(event) => {
            const normalizedValue = event.target.value.trim()
            onChange(normalizedValue ? parseMoney(normalizedValue) : null)
          }}
        />
        <small>원</small>
      </div>
    </label>
  )
}

function NetSalaryCalculator({
  onClose,
  onApply,
}: {
  onClose: () => void
  onApply: (monthlyNetSalary: number) => void
}): ReactNode {
  const [inputMethod, setInputMethod] = useState<'direct' | 'estimate'>(
    'direct',
  )
  const [directMonthlySalary, setDirectMonthlySalary] = useState(3_200_000)
  const [input, setInput] = useState<NetSalaryInput>({
    salaryUnit: 'annual',
    salaryAmount: 40_000_000,
    severanceIncluded: false,
    dependents: 1,
    childrenUnderTwenty: 0,
    monthlyNonTaxableAmount: 200_000,
  })
  const estimate = useMemo(() => estimateNetSalary(input), [input])
  const amountToApply =
    inputMethod === 'direct'
      ? directMonthlySalary
      : estimate.monthlyNetSalary

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="salary-calculator-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="salary-calculator-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>월급 입력</span>
            <h2 id="salary-calculator-title">실수령액을 알려주세요</h2>
            <p>알고 있는 금액을 바로 입력하거나 연봉으로 계산할 수 있어요.</p>
          </div>
          <button type="button" aria-label="계산기 닫기" onClick={onClose}>
            <X size={19} />
          </button>
        </header>

        <div className="salary-method-tabs">
          <button
            className={inputMethod === 'direct' ? 'selected' : ''}
            type="button"
            onClick={() => setInputMethod('direct')}
          >
            실수령액 직접 입력
          </button>
          <button
            className={inputMethod === 'estimate' ? 'selected' : ''}
            type="button"
            onClick={() => setInputMethod('estimate')}
          >
            연봉으로 계산
          </button>
        </div>

        {inputMethod === 'direct' ? (
          <div className="direct-salary-panel">
            <MoneyCalculatorField
              label="한 달 실수령액"
              value={directMonthlySalary}
              onChange={setDirectMonthlySalary}
            />
            <p>
              급여명세서나 통장에 들어온 금액을 적어주세요. 이 금액을 기준으로
              월급 계획을 만들어요.
            </p>
          </div>
        ) : (
          <div className="salary-calculator-layout">
            <div className="salary-input-panel">
            <div className="salary-unit-control">
              {(['annual', 'monthly'] as SalaryUnit[]).map((unit) => (
                <button
                  className={input.salaryUnit === unit ? 'selected' : ''}
                  type="button"
                  key={unit}
                  onClick={() => setInput({ ...input, salaryUnit: unit })}
                >
                  {unit === 'annual' ? '연봉' : '월급'}
                </button>
              ))}
            </div>

            {input.salaryUnit === 'annual' && (
              <label className="calculator-field">
                퇴직금
                <div className="salary-unit-control compact">
                  <button
                    className={!input.severanceIncluded ? 'selected' : ''}
                    type="button"
                    onClick={() =>
                      setInput({ ...input, severanceIncluded: false })
                    }
                  >
                    별도
                  </button>
                  <button
                    className={input.severanceIncluded ? 'selected' : ''}
                    type="button"
                    onClick={() =>
                      setInput({ ...input, severanceIncluded: true })
                    }
                  >
                    포함
                  </button>
                </div>
              </label>
            )}

            <MoneyCalculatorField
              label={input.salaryUnit === 'annual' ? '연봉' : '월 급여액'}
              value={input.salaryAmount}
              onChange={(salaryAmount) =>
                setInput({ ...input, salaryAmount })
              }
            />

            <div className="amount-shortcuts">
              {[10_000_000, 1_000_000, 100_000].map((amount) => (
                <button
                  type="button"
                  key={amount}
                  onClick={() =>
                    setInput({
                      ...input,
                      salaryAmount: input.salaryAmount + amount,
                    })
                  }
                >
                  +{amount / 10_000}만
                </button>
              ))}
            </div>

            <div className="people-fields">
              <CountField
                label="부양 가족 수 (본인 포함)"
                value={input.dependents}
                minimum={1}
                onChange={(dependents) =>
                  setInput({
                    ...input,
                    dependents,
                    childrenUnderTwenty: Math.min(
                      input.childrenUnderTwenty,
                      dependents - 1,
                    ),
                  })
                }
              />
              <CountField
                label="20세 이하 자녀 수"
                value={input.childrenUnderTwenty}
                minimum={0}
                maximum={Math.max(input.dependents - 1, 0)}
                onChange={(childrenUnderTwenty) =>
                  setInput({ ...input, childrenUnderTwenty })
                }
              />
            </div>

            <MoneyCalculatorField
              label="월 비과세액"
              value={input.monthlyNonTaxableAmount}
              onChange={(monthlyNonTaxableAmount) =>
                setInput({ ...input, monthlyNonTaxableAmount })
              }
            />
            </div>

            <SalaryEstimatePanel estimate={estimate} />
          </div>
        )}

        <div className="calculator-footer">
          <p>
            {inputMethod === 'direct'
              ? '입력한 금액은 언제든 다시 바꿀 수 있어요.'
              : '예상 금액이에요. 실제 급여명세서와 다를 수 있어요.'}
          </p>
          <button
            type="button"
            disabled={amountToApply <= 0}
            onClick={() => onApply(amountToApply)}
          >
            <Check size={16} />
            {formatWon(amountToApply)} 입력하기
          </button>
        </div>
      </section>
    </div>
  )
}

function SalaryEstimatePanel({
  estimate,
}: {
  estimate: NetSalaryEstimate
}): ReactNode {
  const deductions = [
    ['국민연금', estimate.deductions.nationalPension],
    ['건강보험', estimate.deductions.healthInsurance],
    ['장기요양', estimate.deductions.longTermCareInsurance],
    ['고용보험', estimate.deductions.employmentInsurance],
    ['소득세', estimate.deductions.incomeTax],
    ['지방소득세', estimate.deductions.localIncomeTax],
  ] as const

  return (
    <aside className="salary-result-panel">
      <span>예상 월 실수령액</span>
      <strong>{formatWon(estimate.monthlyNetSalary)}</strong>
      <small>월 급여 {formatWon(estimate.monthlyGrossSalary)} 기준</small>
      <div>
        {deductions.map(([label, amount]) => (
          <p key={label}>
            <span>{label}</span>
            <b>{formatWon(amount)}</b>
          </p>
        ))}
        <p className="deduction-total">
          <span>공제액 합계</span>
          <b>{formatWon(estimate.totalDeductions)}</b>
        </p>
      </div>
    </aside>
  )
}

function MoneyCalculatorField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (value: number) => void
}): ReactNode {
  return (
    <label className="calculator-field">
      {label}
      <div className="calculator-money-input">
        <input
          inputMode="numeric"
          value={value === 0 ? '' : Math.round(value).toLocaleString()}
          placeholder="0"
          onChange={(event) => onChange(parseMoney(event.target.value))}
        />
        <span>원</span>
      </div>
    </label>
  )
}

function CountField({
  label,
  value,
  minimum,
  maximum = 10,
  onChange,
}: {
  label: string
  value: number
  minimum: number
  maximum?: number
  onChange: (value: number) => void
}): ReactNode {
  return (
    <div className="count-field">
      <span>{label}</span>
      <div>
        <button
          type="button"
          disabled={value <= minimum}
          onClick={() => onChange(Math.max(value - 1, minimum))}
        >
          <Minus size={15} />
        </button>
        <strong>{value}</strong>
        <button
          type="button"
          disabled={value >= maximum}
          onClick={() => onChange(Math.min(value + 1, maximum))}
        >
          <Plus size={15} />
        </button>
        <small>명</small>
      </div>
    </div>
  )
}

function PlanSection({
  plan,
  isSaved,
  onSave,
}: {
  plan: PaydayPlan | null
  isSaved: boolean
  onSave: () => void
}): ReactNode {
  return (
    <section className="plan-section" id="payday-plan">
      <div className="section-heading">
        <div>
          <span>PAYDAY PLAN</span>
          <h2>입력한 내용으로 월급을 나눠드려요</h2>
          <p>월급만 있으면 기본 비율로 먼저 계산하고, 대화로 세부 금액을 바꿀 수 있어요.</p>
        </div>
      </div>

      {plan ? (
        <div className="plan-card">
          <div className="plan-hero">
            <div>
              <span>{plan.safetyStatus}</span>
              <h3>{plan.headline}</h3>
            </div>
            <div>
              <small>이번 달 투자 가능 금액</small>
              <strong>{formatWon(plan.availableInvestmentAmount)}</strong>
            </div>
          </div>
          <div className="plan-content">
            <div className="allocation-summary">
              {plan.allocations.map((allocation) => (
                <article key={allocation.role}>
                  <span>{String(allocation.priority).padStart(2, '0')}</span>
                  <div>
                    <strong>{allocation.label}</strong>
                    <p>{allocation.reason}</p>
                    {allocation.details.length > 0 && (
                      <ul className="allocation-detail-list">
                        {allocation.details.map((detail) => (
                          <li key={`${detail.bucket}-${detail.name}`}>
                            <span>{detail.name}</span>
                            <b>{formatWon(detail.amount)}</b>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <b>{formatWon(allocation.amount)}</b>
                </article>
              ))}
            </div>
            <aside className="portfolio-summary">
              <span>투자금 나누기</span>
              <h3>
                {plan.input.riskProfile} · {plan.input.investmentHorizon}
              </h3>
              {plan.portfolio.length > 0 ? (
                <div>
                  {plan.portfolio.map((allocation, index) => (
                    <article key={allocation.label}>
                      <i className={`portfolio-color color-${index + 1}`} />
                      <span>{allocation.label}</span>
                      <strong>{allocation.percentage}%</strong>
                      <b>{formatWon(allocation.amount)}</b>
                    </article>
                  ))}
                </div>
              ) : (
                <p>이번 달은 비상금을 먼저 채우는 편이 좋아요.</p>
              )}
              <button className="save-button" type="button" onClick={onSave}>
                {isSaved ? <BadgeCheck size={17} /> : <Check size={17} />}
                {isSaved ? '저장했어요' : '이 계획 저장하기'}
              </button>
            </aside>
          </div>
        </div>
      ) : (
        <div className="plan-waiting">
          <span>
            <Sparkles size={22} />
          </span>
          <div>
            <strong>조금만 더 알려주세요</strong>
            <p>
              월급만 알려주시면 기본 배분안을 먼저 만들고, 생활비와 투자 기준은
              대화로 조정할 수 있어요.
            </p>
          </div>
        </div>
      )}
    </section>
  )
}

function Principle({
  icon,
  title,
  text,
}: {
  icon: ReactNode
  title: string
  text: string
}): ReactNode {
  return (
    <article>
      <span>{icon}</span>
      <div>
        <strong>{title}</strong>
        <p>{text}</p>
      </div>
    </article>
  )
}

function SummaryValue({
  label,
  value,
}: {
  label: string
  value: string
}): ReactNode {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function getProfilePatchEntries(
  patch: FinancialProfilePatch,
): Array<[string, string]> {
  const labels: Record<keyof FinancialProfilePatch, string> = {
    monthlySalary: '월 실수령액',
    essentialExpense: '필수 생활비',
    debtPayment: '카드·부채 결제',
    currentEmergencyFund: '현재 비상금',
    targetEmergencyFund: '비상금 목표',
    goalName: '목표',
    goalMonthlyAmount: '목표 저축',
    flexibleSpending: '여유 생활비',
    riskProfile: '투자 성향',
    investmentHorizon: '투자 기간',
    preferences: '지키고 싶은 취향',
    customUses: '월급 사용처',
  }

  return (Object.entries(patch) as Array<
    [keyof FinancialProfilePatch, FinancialProfilePatch[keyof FinancialProfilePatch]]
  >)
    .filter(([key]) => key !== 'customUses')
    .map(([key, value]) => [
      labels[key],
      Array.isArray(value)
        ? value.join(' · ')
        : typeof value === 'number'
          ? formatWon(value)
          : String(value),
    ])
}

function getFinancialProfileItems(
  profile: FinancialProfile,
  estimatedInput: ReturnType<typeof toPaydayInput>,
): FinancialProfileItem[] {
  return [
    {
      label: '월 실수령액',
      value: formatNullableWon(profile.monthlySalary),
      isComplete: profile.monthlySalary !== null,
      isDefault: false,
    },
    {
      label: '필수 생활비',
      value: estimatedInput
        ? formatWon(estimatedInput.essentialExpense)
        : formatNullableWon(profile.essentialExpense),
      isComplete:
        profile.essentialExpense !== null || estimatedInput !== null,
      isDefault: profile.essentialExpense === null && estimatedInput !== null,
    },
    {
      label: '카드·부채',
      value: estimatedInput
        ? formatWon(estimatedInput.debtPayment)
        : formatNullableWon(profile.debtPayment),
      isComplete: profile.debtPayment !== null || estimatedInput !== null,
      isDefault: profile.debtPayment === null && estimatedInput !== null,
    },
    {
      label: '현재 비상금',
      value: estimatedInput
        ? formatWon(estimatedInput.currentEmergencyFund)
        : formatNullableWon(profile.currentEmergencyFund),
      isComplete:
        profile.currentEmergencyFund !== null || estimatedInput !== null,
      isDefault:
        profile.currentEmergencyFund === null && estimatedInput !== null,
    },
    {
      label: '비상금 목표',
      value: estimatedInput
        ? formatWon(estimatedInput.targetEmergencyFund)
        : formatNullableWon(profile.targetEmergencyFund),
      isComplete:
        profile.targetEmergencyFund !== null || estimatedInput !== null,
      isDefault:
        profile.targetEmergencyFund === null && estimatedInput !== null,
    },
    {
      label: '목표',
      value: estimatedInput?.goalName ?? profile.goalName,
      isComplete:
        profile.goalName.trim().length > 0 || estimatedInput !== null,
      isDefault:
        profile.goalName.trim().length === 0 && estimatedInput !== null,
    },
    {
      label: '목표 저축',
      value: estimatedInput
        ? formatWon(estimatedInput.goalMonthlyAmount)
        : formatNullableWon(profile.goalMonthlyAmount),
      isComplete:
        profile.goalMonthlyAmount !== null || estimatedInput !== null,
      isDefault:
        profile.goalMonthlyAmount === null && estimatedInput !== null,
    },
    {
      label: '여유 생활비',
      value: estimatedInput
        ? formatWon(estimatedInput.flexibleSpending)
        : formatNullableWon(profile.flexibleSpending),
      isComplete:
        profile.flexibleSpending !== null || estimatedInput !== null,
      isDefault:
        profile.flexibleSpending === null && estimatedInput !== null,
    },
    {
      label: '투자 조건',
      value:
        estimatedInput
          ? `${estimatedInput.riskProfile} · ${estimatedInput.investmentHorizon}`
          : profile.riskProfile && profile.investmentHorizon
          ? `${profile.riskProfile} · ${profile.investmentHorizon}`
          : '미정',
      isComplete:
        (profile.riskProfile !== null && profile.investmentHorizon !== null) ||
        estimatedInput !== null,
      isDefault:
        (profile.riskProfile === null || profile.investmentHorizon === null) &&
        estimatedInput !== null,
    },
  ]
}

function getNextAction(profile: FinancialProfile): NextAction {
  if (profile.monthlySalary === null) {
    return {
      kind: 'salary',
      title: '월 실수령액을 알려주세요',
      description:
        '월급만 입력해도 생활비, 비상금, 목표 자금, 투자금 초안을 먼저 만들어드려요.',
      primaryLabel: '실수령액 입력하기',
    }
  }

  return {
    kind: 'plan',
    title: '기본 배분안을 확인해 보세요',
    description:
      '자주 쓰는 월급 배분 기준으로 먼저 채웠어요. 생활비, 목표, 투자는 대화로 언제든 조정할 수 있어요.',
    primaryLabel: '계획 보기',
  }
}

function formatCustomUseBucket(
  bucket: 'essential' | 'goal' | 'flexible',
): string {
  return {
    essential: '필수 생활비',
    goal: '목표 자금',
    flexible: '여유 생활비',
  }[bucket]
}

async function readAttachment(file: File): Promise<ConversationAttachment> {
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(`${file.name}은 4MB를 넘어 첨부할 수 없어요.`)
  }
  if (
    !['image/jpeg', 'image/png', 'image/webp', 'image/heic'].includes(
      file.type,
    )
  ) {
    throw new Error(`${file.name}은 지원하지 않는 이미지 형식이에요.`)
  }

  return {
    id: crypto.randomUUID(),
    name: file.name,
    mimeType: file.type as ConversationAttachment['mimeType'],
    data: await fileToBase64(file),
    previewUrl: URL.createObjectURL(file),
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('이미지를 읽지 못했어요. 다른 사진으로 다시 올려주세요.'))
        return
      }
      resolve(result.split(',')[1] ?? '')
    }
    reader.onerror = () =>
      reject(new Error('이미지를 읽지 못했어요. 다른 사진으로 다시 올려주세요.'))
    reader.readAsDataURL(file)
  })
}

function previousMonth(): string {
  const date = new Date()
  date.setDate(1)
  date.setMonth(date.getMonth() - 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function formatMonth(value: string): string {
  const [year, month] = value.split('-')
  return `${year}년 ${Number(month)}월`
}

function formatWon(value: number): string {
  return `${Math.round(value).toLocaleString()}원`
}

function parseMoney(value: string): number {
  return Number(value.replaceAll(',', '').replace(/\D/g, '')) || 0
}

function formatNullableWon(value: number | null): string {
  return value === null ? '모름' : formatWon(value)
}

function createMonthlySpendingClarification(
  summary: Omit<MonthlySpendingSummary, 'id'>,
): string {
  const amounts = [
    `총소비 ${formatNullableWon(summary.totalExpense)}`,
    `필수지출 ${formatNullableWon(summary.essentialExpense)}`,
    `선택지출 ${formatNullableWon(summary.flexibleExpense)}`,
  ].join(', ')

  return `${formatMonth(summary.month)} 사용 요약을 확인했어요. 지금 읽은 금액은 ${amounts}입니다. 틀린 부분만 이렇게 고쳐주세요: `
}

function normalizeConversationMessages(
  messages: ConversationMessage[],
): ConversationMessage[] {
  return messages.map((message) =>
    message.id === INITIAL_AGENT_MESSAGE.id
      ? { ...message, content: INITIAL_AGENT_MESSAGE.content }
      : message,
  )
}

export default App
