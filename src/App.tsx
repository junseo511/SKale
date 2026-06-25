import {
  ArrowRight,
  BarChart3,
  BriefcaseBusiness,
  CircleDollarSign,
  LayoutDashboard,
  Menu,
  PieChart,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  WalletCards,
  X,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart as RechartsPieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  BrowserRouter,
  NavLink,
  Navigate,
  Route,
  Routes,
} from 'react-router-dom'
import { LocalSpendingReviewRepository } from './data/localSpendingReviewRepository'
import { MockSpendingAgent } from './data/mockSpendingAgent'
import { SpendingAgentWorkspace } from './features/spending/SpendingAgentWorkspace'
import './App.css'

const spendingAgent = new MockSpendingAgent()
const spendingReviewRepository = new LocalSpendingReviewRepository()

const navigationItems = [
  { to: '/', label: '대시보드', icon: LayoutDashboard },
  { to: '/spending', label: '소비 분석', icon: ReceiptText },
  { to: '/assets', label: '자산 분석', icon: WalletCards },
  { to: '/portfolio', label: '포트폴리오', icon: PieChart },
  { to: '/stocks', label: '종목 분석', icon: TrendingUp },
]

const spendingData = [
  { name: '고정비', value: 500_000, color: '#6c5ce7' },
  { name: '식비·카페', value: 189_850, color: '#00a896' },
  { name: '생활비', value: 158_000, color: '#f4a261' },
  { name: '여행', value: 250_000, color: '#e76f51' },
]

const assetData = [
  { name: '현금', value: 2_000_000 },
  { name: '저축', value: 1_000_000 },
  { name: '투자', value: 3_500_000 },
]

function App() {
  return (
    <BrowserRouter>
      <AppLayout>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/spending" element={<SpendingPage />} />
          <Route path="/assets" element={<AssetsPage />} />
          <Route path="/portfolio" element={<PortfolioPage />} />
          <Route path="/stocks" element={<StocksPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppLayout>
    </BrowserRouter>
  )
}

function AppLayout({ children }: { children: ReactNode }) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="header-inner">
          <NavLink className="brand" to="/" onClick={() => setIsMenuOpen(false)}>
            <span className="brand-mark" aria-hidden="true">
              S
            </span>
            <span>SKale</span>
          </NavLink>

          <nav className="desktop-navigation" aria-label="주요 메뉴">
            {navigationItems.map((item) => (
              <NavLink
                key={item.to}
                className={({ isActive }) => `navigation-link${isActive ? ' active' : ''}`}
                to={item.to}
                end={item.to === '/'}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <button
            className="menu-button"
            type="button"
            aria-label={isMenuOpen ? '메뉴 닫기' : '메뉴 열기'}
            aria-expanded={isMenuOpen}
            onClick={() => setIsMenuOpen((current) => !current)}
          >
            {isMenuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>

        {isMenuOpen && (
          <nav className="mobile-navigation" aria-label="모바일 주요 메뉴">
            {navigationItems.map((item) => {
              const Icon = item.icon
              return (
                <NavLink
                  key={item.to}
                  className={({ isActive }) => `mobile-navigation-link${isActive ? ' active' : ''}`}
                  to={item.to}
                  end={item.to === '/'}
                  onClick={() => setIsMenuOpen(false)}
                >
                  <Icon size={19} aria-hidden="true" />
                  {item.label}
                </NavLink>
              )
            })}
          </nav>
        )}
      </header>

      <main>{children}</main>

      <footer className="site-footer">
        <p>SKale은 과제 시연용 AI Agent입니다.</p>
        <p>분석 결과는 참고용이며 실제 투자 판단은 사용자의 책임입니다.</p>
      </footer>
    </div>
  )
}

function DashboardPage() {
  return (
    <PageContainer>
      <section className="hero-section">
        <div>
          <span className="eyebrow">
            <Sparkles size={15} aria-hidden="true" />
            Personal finance agent
          </span>
          <h1>AI로 소비를 읽고,<br />자산을 키우다.</h1>
          <p>흩어진 돈의 흐름을 한눈에 이해하고 다음 행동까지 발견하세요.</p>
        </div>
        <div className="hero-orbit" aria-hidden="true">
          <div className="orbit-core">
            <TrendingUp size={36} />
          </div>
        </div>
      </section>

      <section className="metric-grid" aria-label="자산 요약">
        <MetricCard icon={<ReceiptText />} label="이번 달 지출" value="1,097,850원" detail="지난달보다 8.2% 증가" tone="coral" />
        <MetricCard icon={<WalletCards />} label="순자산" value="6,080,000원" detail="이전 기록보다 330,000원 증가" tone="violet" />
        <MetricCard icon={<CircleDollarSign />} label="월 투자 여력" value="300,000원" detail="미결제 금액 반영 전" tone="teal" />
      </section>

      <section className="dashboard-grid">
        <ChartCard title="카테고리별 지출" description="일반 소비만 집계했어요.">
          <div className="chart-with-legend">
            <div className="donut-chart">
              <ResponsiveContainer width="100%" height="100%">
                <RechartsPieChart>
                  <Pie data={spendingData} dataKey="value" innerRadius={55} outerRadius={78} paddingAngle={3} stroke="none">
                    {spendingData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                  </Pie>
                  <Tooltip formatter={(value) => `${Number(value).toLocaleString()}원`} />
                </RechartsPieChart>
              </ResponsiveContainer>
              <div className="donut-center"><strong>109만</strong><span>총지출</span></div>
            </div>
            <ul className="chart-legend">
              {spendingData.map((item) => (
                <li key={item.name}>
                  <span className="legend-label"><i style={{ background: item.color }} />{item.name}</span>
                  <strong>{Math.round((item.value / 1_097_850) * 100)}%</strong>
                </li>
              ))}
            </ul>
          </div>
        </ChartCard>

        <ChartCard title="자산 구성" description="부채를 제외한 총자산 기준이에요.">
          <div className="bar-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={assetData} margin={{ top: 18, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#eceaf3" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} />
                <YAxis axisLine={false} tickLine={false} tickFormatter={(value) => `${value / 1_000_000}M`} />
                <Tooltip formatter={(value) => `${Number(value).toLocaleString()}원`} cursor={{ fill: '#f7f6fb' }} />
                <Bar dataKey="value" fill="#6c5ce7" radius={[8, 8, 0, 0]} barSize={42} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </section>

      <section className="insight-card">
        <div className="insight-icon"><Sparkles size={22} /></div>
        <div>
          <span className="section-kicker">SKale AI 코멘트</span>
          <h2>순자산은 늘었지만 여행 지출도 함께 커졌어요.</h2>
          <p>카드 미결제 금액을 먼저 반영한 후 이번 달 투자 가능 금액을 확정하는 게 안전합니다.</p>
        </div>
      </section>

      <section>
        <SectionHeading title="지금 하면 좋은 일" description="현재 돈의 흐름을 바탕으로 우선순위를 정리했어요." />
        <div className="action-grid">
          <ActionCard number="01" title="미결제 금액 확인" description="카드 결제 예정 금액을 반영해 실제 가용 현금을 계산하세요." to="/assets" />
          <ActionCard number="02" title="목적 자금 분리" description="여행 지출을 생활비와 분리하면 예산 흐름이 더 선명해져요." to="/spending" />
          <ActionCard number="03" title="관심 종목 점검" description="현금흐름과 밸류에이션 데이터를 준비해 전략 적합도를 확인하세요." to="/stocks" />
        </div>
      </section>
    </PageContainer>
  )
}

function SpendingPage() {
  return (
    <PageContainer>
      <PageHeader
        icon={<ReceiptText />}
        title="소비 분석"
        description="AI가 먼저 제안하고, 사용자가 수정·수락·거절해 함께 소비 기록을 완성해요."
      />
      <SpendingAgentWorkspace
        agent={spendingAgent}
        reviewRepository={spendingReviewRepository}
      />
    </PageContainer>
  )
}

function AssetsPage() {
  return (
    <PageContainer>
      <PageHeader icon={<WalletCards />} title="자산 분석" description="은행과 증권 앱에 흩어진 자산을 정리하고 순자산 변화를 확인하세요." />
      <InputCard title="현재 자산 입력" description="자산과 부채를 함께 입력하면 순자산을 계산해요.">
        <textarea defaultValue={'토스뱅크 1,200,000원\n카카오뱅크 800,000원\n주식계좌 3,500,000원\n신용카드 미결제 420,000원'} aria-label="자산 현황" />
        <div className="button-row">
          <button className="button secondary" type="button">예시 불러오기</button>
          <button className="button primary" type="button"><Sparkles size={17} />AI 분석하기</button>
        </div>
      </InputCard>
      <div className="metric-grid">
        <MetricCard icon={<BriefcaseBusiness />} label="총자산" value="6,500,000원" detail="현금·저축·투자 합계" tone="violet" />
        <MetricCard icon={<ReceiptText />} label="부채·미결제" value="420,000원" detail="결제 예정 금액 포함" tone="coral" />
        <MetricCard icon={<TrendingUp />} label="순자산" value="6,080,000원" detail="+330,000원 · 5.74%" tone="teal" />
      </div>
    </PageContainer>
  )
}

function PortfolioPage() {
  return (
    <PageContainer>
      <PageHeader icon={<PieChart />} title="포트폴리오 추천" description="투자 성향과 기간, 현재 자산 상태를 바탕으로 자산 배분 방향을 제안해요." />
      <InputCard title="투자 조건" description="추천이 아닌 참고용 자산 배분 분석입니다.">
        <div className="form-grid">
          <label>투자 성향<select defaultValue="neutral"><option value="stable">안정형</option><option value="neutral">중립형</option><option value="growth">공격형</option></select></label>
          <label>투자 기간<select defaultValue="long"><option value="short">1년 미만</option><option value="medium">1~3년</option><option value="long">3년 이상</option></select></label>
          <label>월 투자 가능 금액<input defaultValue="300,000원" /></label>
          <label>관심 산업<input defaultValue="AI, 반도체, 전력 인프라" /></label>
        </div>
        <div className="button-row right"><button className="button primary" type="button"><Sparkles size={17} />포트폴리오 분석하기</button></div>
      </InputCard>
      <NoticeCard icon={<BarChart3 />} title="기본 중립형 배분" description="현금성 자산 20% · 광범위 ETF 40% · 성장 산업 후보 25% · 개별 종목 검토 10% · 대기자금 5%" />
    </PageContainer>
  )
}

function StocksPage() {
  return (
    <PageContainer>
      <PageHeader icon={<TrendingUp />} title="종목 분석" description="내 투자 전략을 기준으로 관심 종목의 산업·경쟁우위·재무·가격을 점검해요." />
      <InputCard title="종목 정보 입력" description="제공되지 않은 최신 재무정보는 추정하지 않아요.">
        <div className="form-grid">
          <label>종목명<input placeholder="예: 예시반도체장비" /></label>
          <label>티커<input placeholder="예: 000000" /></label>
        </div>
        <label className="full-field">사업 및 산업 설명<textarea placeholder="기업이 어떤 산업에서 어떻게 돈을 버는지 입력하세요." /></label>
        <label className="full-field">최근 재무 데이터<textarea placeholder="매출, 마진, 영업현금흐름, 부채, 밸류에이션 등을 입력하세요." /></label>
        <div className="button-row">
          <button className="button secondary" type="button">예시 불러오기</button>
          <button className="button primary" type="button"><Sparkles size={17} />전략 기준으로 분석하기</button>
        </div>
      </InputCard>
      <NoticeCard icon={<ShieldCheck />} title="데이터가 부족하면 분석을 보류합니다" description="SKale은 확인되지 않은 실적이나 가격을 만들어내지 않고, 추가로 필요한 데이터를 먼저 안내해요." />
    </PageContainer>
  )
}

function PageContainer({ children }: { children: ReactNode }) {
  return <div className="page-container">{children}</div>
}

function PageHeader({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return <header className="page-header"><div className="page-icon">{icon}</div><div><h1>{title}</h1><p>{description}</p></div></header>
}

function SectionHeading({ title, description }: { title: string; description: string }) {
  return <div className="section-heading"><div><h2>{title}</h2><p>{description}</p></div></div>
}

function MetricCard({ icon, label, value, detail, tone }: { icon: ReactNode; label: string; value: string; detail: string; tone: string }) {
  return <article className="metric-card"><div className={`metric-icon ${tone}`}>{icon}</div><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>
}

function ChartCard({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <article className="chart-card"><SectionHeading title={title} description={description} />{children}</article>
}

function ActionCard({ number, title, description, to }: { number: string; title: string; description: string; to: string }) {
  return <NavLink className="action-card" to={to}><span>{number}</span><h3>{title}</h3><p>{description}</p><ArrowRight size={19} aria-hidden="true" /></NavLink>
}

function InputCard({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <section className="input-card"><SectionHeading title={title} description={description} />{children}</section>
}

function NoticeCard({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return <aside className="notice-card"><div className="notice-icon">{icon}</div><div><h2>{title}</h2><p>{description}</p></div></aside>
}

export default App
