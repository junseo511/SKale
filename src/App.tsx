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
  ImagePlus,
  LockKeyhole,
  MessageCircleMore,
  Minus,
  Paperclip,
  PiggyBank,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  UserRound,
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

const MAX_IMAGE_COUNT = 4
const MAX_IMAGE_BYTES = 4 * 1024 * 1024
const PROFILE_FIELD_COUNT = 9
const agent = new HttpPaydayConversationAgent({
  baseUrl: import.meta.env.VITE_API_BASE_URL,
})
const workspaceRepository = new LocalPaydayWorkspaceRepository()
const planRepository = new LocalPaydayPlanRepository()

function App(): ReactNode {
  const savedWorkspace = useMemo(() => workspaceRepository.load(), [])
  const [messages, setMessages] = useState<ConversationMessage[]>(
    savedWorkspace?.messages.length
      ? savedWorkspace.messages
      : [INITIAL_AGENT_MESSAGE],
  )
  const [profile, setProfile] = useState<FinancialProfile>(
    savedWorkspace?.profile ?? EMPTY_FINANCIAL_PROFILE,
  )
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
  const abortControllerReference = useRef<AbortController | null>(null)
  const messageEndReference = useRef<HTMLDivElement | null>(null)

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
  const quickMessages = [
    '월 실수령액은 320만원이야.',
    '나는 여행과 외식은 포기하고 싶지 않아.',
    `${Number(targetMonth.split('-')[1])}월의 사용 내역을 정리하고 싶어.`,
  ]

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
          : 'Agent와 대화하지 못했습니다.',
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

  function applyMonthlySpendingProposal(): void {
    const proposal = pendingResponse?.monthlySpendingProposal
    if (!proposal) {
      return
    }
    setMonthlySpending((currentSummaries) => [
      ...currentSummaries.filter(
        (summary) => summary.month !== proposal.month,
      ),
      { ...proposal, id: crypto.randomUUID() },
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
          : '이미지를 읽지 못했습니다.',
      )
    }
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="SKale 처음으로">
          <span className="brand-symbol">S</span>
          <span>SKale</span>
        </a>
        <div className="header-actions">
          <span className="ai-status">
            <span className="status-dot" />
            명시적 전송에서만 AI 호출
          </span>
          <button
            className="icon-button"
            type="button"
            aria-label="대화와 프로필 초기화"
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
              <MessageCircleMore size={15} />
              Conversational payday agent
            </span>
            <h1>
              월급 계획은
              <br />
              <em>대화로 만들어야 하니까.</em>
            </h1>
            <p>
              지난 소비를 보여주고, 포기하고 싶지 않은 취향을 말해 주세요.
              SKale이 질문하고 사용자가 승인한 정보만 월급 계획에 반영합니다.
            </p>
          </div>
          <div className="intro-principles">
            <Principle
              icon={<FileText />}
              title="과거를 이해하고"
              text="텍스트·사진 사용내역"
            />
            <ChevronRight size={18} />
            <Principle
              icon={<UserRound />}
              title="취향을 기억하고"
              text="지키고 싶은 소비"
            />
            <ChevronRight size={18} />
            <Principle
              icon={<PiggyBank />}
              title="이번 달을 설계해요"
              text="안전망 이후 투자"
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
                  <strong>SKale Agent</strong>
                  <p>재무 프로필을 함께 완성하는 중</p>
                </div>
              </div>
              <span className="completion-badge">
                {completedProfileFields}/{PROFILE_FIELD_COUNT} 확인
              </span>
            </div>

            <div className="message-list" aria-live="polite">
              {messages.map((message) => (
                <MessageBubble message={message} key={message.id} />
              ))}
              {isReplying && (
                <div className="message-row agent">
                  <span className="message-avatar">
                    <Bot size={16} />
                  </span>
                  <div className="typing-bubble">
                    <i />
                    <i />
                    <i />
                    사용자의 말과 자료를 살펴보고 있어요
                  </div>
                </div>
              )}

              {pendingResponse && (
                <ProposalCards
                  response={pendingResponse}
                  onApplyProfile={applyProfileProposal}
                  onApplyMonthlySpending={applyMonthlySpendingProposal}
                />
              )}
              <div ref={messageEndReference} />
            </div>

            <div className="quick-message-list" aria-label="빠른 메시지">
              <button
                className="calculator-quick-button"
                type="button"
                onClick={() => setIsSalaryCalculatorOpen(true)}
              >
                <Calculator size={13} />
                실수령액을 계산하고 싶어요
              </button>
              {quickMessages.map((message) => (
                <button
                  type="button"
                  key={message}
                  onClick={() => setDraft(message)}
                >
                  {message}
                </button>
              ))}
            </div>

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
                aria-label="SKale Agent에게 보낼 메시지"
                value={draft}
                placeholder="예: 월급은 320만원이고, 외식비는 너무 줄이고 싶지 않아."
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
                  Agent에게 보내기
                </button>
              </div>
            </div>

            <p className="privacy-copy">
              <LockKeyhole size={13} />
              사진의 계좌번호·카드번호·이름은 가려 주세요. 첨부 원본은
              localStorage에 저장하지 않습니다.
            </p>
          </section>

          <aside className="context-panel">
            <ProfileCard profile={profile} completed={completedProfileFields} />
            <MonthlyHistoryCard
              summaries={monthlySpending}
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
          profile={profile}
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
                content: `계산한 예상 월 실수령액 ${formatWon(monthlyNetSalary)}을 재무 프로필에 반영했어요.`,
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
        <p>과거 소비와 취향을 듣고 월급의 역할을 함께 정하는 Agent</p>
        <span>결과는 참고용이며 금융 자문이 아닙니다.</span>
      </footer>
    </div>
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
}: {
  response: PaydayConversationResponse
  onApplyProfile: () => void
  onApplyMonthlySpending: () => void
}): ReactNode {
  const profileEntries = getProfilePatchEntries(response.profilePatch)
  const spendingProposal = response.monthlySpendingProposal
  const hasResponseContext =
    response.appliedFacts.length > 0 || response.missingData.length > 0

  if (
    profileEntries.length === 0 &&
    !spendingProposal &&
    !hasResponseContext
  ) {
    return null
  }

  return (
    <div className="proposal-stack">
      {profileEntries.length > 0 && (
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
        </article>
      )}

      {spendingProposal && (
        <article className="agent-proposal spending-proposal">
          <div className="proposal-heading">
            <span>
              <CalendarDays size={15} />
              {formatMonth(spendingProposal.month)} 사용 요약
            </span>
            <button type="button" onClick={onApplyMonthlySpending}>
              <Check size={14} />
              월 기록에 추가
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
            <small>
              <CircleAlert size={13} />
              이미지나 금액이 불확실해 적용 후에도 확인이 필요해요.
            </small>
          )}
        </article>
      )}

      {hasResponseContext && (
        <article className="response-context">
          {response.appliedFacts.length > 0 && (
            <div>
              <strong>Agent가 확인한 내용</strong>
              <ul>
                {response.appliedFacts.map((fact) => (
                  <li key={fact}>{fact}</li>
                ))}
              </ul>
            </div>
          )}
          {response.missingData.length > 0 && (
            <div>
              <strong>계획에 더 필요한 정보</strong>
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
  const items = [
    ['월 실수령액', formatNullableWon(profile.monthlySalary)],
    ['필수 생활비', formatNullableWon(profile.essentialExpense)],
    ['카드·부채', formatNullableWon(profile.debtPayment)],
    ['현재 비상금', formatNullableWon(profile.currentEmergencyFund)],
    ['비상금 목표', formatNullableWon(profile.targetEmergencyFund)],
    ['목표', profile.goalName || '대화로 확인'],
    ['목표 저축', formatNullableWon(profile.goalMonthlyAmount)],
    ['여유 생활비', formatNullableWon(profile.flexibleSpending)],
    [
      '투자 조건',
      profile.riskProfile && profile.investmentHorizon
        ? `${profile.riskProfile} · ${profile.investmentHorizon}`
        : '대화로 확인',
    ],
  ]

  return (
    <section className="context-card profile-card">
      <div className="context-heading">
        <div>
          <span>LIVE PROFILE</span>
          <h2>대화로 확인한 나의 기준</h2>
        </div>
        <strong>{Math.round((completed / PROFILE_FIELD_COUNT) * 100)}%</strong>
      </div>
      <div className="progress-track">
        <i style={{ width: `${(completed / PROFILE_FIELD_COUNT) * 100}%` }} />
      </div>
      <dl>
        {items.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className={value === '대화로 확인' ? 'empty' : ''}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
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
    </section>
  )
}

function MonthlyHistoryCard({
  summaries,
  onDelete,
}: {
  summaries: MonthlySpendingSummary[]
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
          <span>MONTHLY MEMORY</span>
          <h2>과거 월 사용내역</h2>
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
          <strong>아직 기억한 월이 없어요.</strong>
          <p>지난 카드 내역 사진이나 거래 텍스트를 대화로 보내 주세요.</p>
        </div>
      )}
    </section>
  )
}

function NetSalaryCalculator({
  onClose,
  onApply,
}: {
  onClose: () => void
  onApply: (monthlyNetSalary: number) => void
}): ReactNode {
  const [input, setInput] = useState<NetSalaryInput>({
    salaryUnit: 'annual',
    salaryAmount: 40_000_000,
    severanceIncluded: false,
    dependents: 1,
    childrenUnderTwenty: 0,
    monthlyNonTaxableAmount: 200_000,
  })
  const estimate = useMemo(() => estimateNetSalary(input), [input])

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
            <span>2026 예상 계산</span>
            <h2 id="salary-calculator-title">월 실수령액 계산기</h2>
            <p>사람인 연봉계산기의 입력 구조를 참고해 공제액을 나눠 보여줘요.</p>
          </div>
          <button type="button" aria-label="계산기 닫기" onClick={onClose}>
            <X size={19} />
          </button>
        </header>

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

        <div className="calculator-footer">
          <p>
            모의 계산 결과이며 실제 급여명세서, 회사 지급 조건, 국세청
            간이세액표 적용 방식에 따라 차이가 날 수 있어요.
          </p>
          <button
            type="button"
            onClick={() => onApply(estimate.monthlyNetSalary)}
          >
            <Check size={16} />
            {formatWon(estimate.monthlyNetSalary)}을 프로필에 적용
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
  profile,
  isSaved,
  onSave,
}: {
  plan: PaydayPlan | null
  profile: FinancialProfile
  isSaved: boolean
  onSave: () => void
}): ReactNode {
  return (
    <section className="plan-section">
      <div className="section-heading">
        <div>
          <span>PAYDAY PLAN</span>
          <h2>대화가 충분해지면 계획이 완성돼요</h2>
          <p>Agent의 제안을 적용한 정보만 월급 배분 계산에 사용합니다.</p>
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
                  </div>
                  <b>{formatWon(allocation.amount)}</b>
                </article>
              ))}
            </div>
            <aside className="portfolio-summary">
              <span>투자금 배분 예시</span>
              <h3>
                {profile.riskProfile} · {profile.investmentHorizon}
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
                <p>이번 달은 안전망을 먼저 채워 투자 배분이 없어요.</p>
              )}
              <button className="save-button" type="button" onClick={onSave}>
                {isSaved ? <BadgeCheck size={17} /> : <Check size={17} />}
                {isSaved ? '이번 월급 계획 저장됨' : '이번 월급 계획 확정'}
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
            <strong>아직 몇 가지 기준이 더 필요해요.</strong>
            <p>
              월급, 생활비, 비상금, 목표, 투자 조건을 대화로 알려주면 이
              자리에 배분안이 나타납니다.
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
  }

  return (Object.entries(patch) as Array<
    [keyof FinancialProfilePatch, FinancialProfilePatch[keyof FinancialProfilePatch]]
  >).map(([key, value]) => [
    labels[key],
    Array.isArray(value)
      ? value.join(' · ')
      : typeof value === 'number'
        ? formatWon(value)
        : String(value),
  ])
}

async function readAttachment(file: File): Promise<ConversationAttachment> {
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(`${file.name}은 4MB를 초과해 첨부할 수 없습니다.`)
  }
  if (
    !['image/jpeg', 'image/png', 'image/webp', 'image/heic'].includes(
      file.type,
    )
  ) {
    throw new Error(`${file.name}은 지원하지 않는 이미지 형식입니다.`)
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
        reject(new Error('이미지를 읽지 못했습니다.'))
        return
      }
      resolve(result.split(',')[1] ?? '')
    }
    reader.onerror = () => reject(new Error('이미지를 읽지 못했습니다.'))
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
  return value === null ? '확인 필요' : formatWon(value)
}

export default App
