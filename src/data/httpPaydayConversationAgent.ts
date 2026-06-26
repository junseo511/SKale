import type {
  PaydayConversationAgent,
  PaydayConversationRequest,
  PaydayConversationResponse,
} from '../domain/paydayConversation'
import { paydayConversationResponseSchema } from '../domain/paydayConversation'

interface HttpPaydayConversationAgentOptions {
  baseUrl?: string
}

export class HttpPaydayConversationAgent
  implements PaydayConversationAgent
{
  private readonly baseUrl: string

  public constructor(options: HttpPaydayConversationAgentOptions = {}) {
    this.baseUrl = options.baseUrl?.replace(/\/$/, '') ?? ''
  }

  public async reply(
    request: PaydayConversationRequest,
    signal: AbortSignal,
  ): Promise<PaydayConversationResponse> {
    const response = await fetch(`${this.baseUrl}/api/payday/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    })

    if (!response.ok) {
      const errorResponse = await readJsonResponse<{ message?: string }>(
        response,
      )
      throw new Error(
        errorResponse?.message ??
          `월급 Agent 요청을 처리하지 못했습니다: ${response.status}`,
      )
    }

    const responseBody: unknown = await readJsonResponse<unknown>(response)
    if (!responseBody) {
      throw new Error('Agent 응답이 비어 있습니다. API 서버 연결을 확인해 주세요.')
    }
    const parsedResponse =
      paydayConversationResponseSchema.safeParse(responseBody)
    if (!parsedResponse.success) {
      throw new Error('Agent 응답 형식이 웹 계약과 일치하지 않습니다.')
    }
    return parsedResponse.data
  }
}

async function readJsonResponse<T>(response: Response): Promise<T | null> {
  const responseText = await response.text()
  if (!responseText.trim()) {
    return null
  }

  try {
    return JSON.parse(responseText) as T
  } catch {
    throw new Error('API 서버가 JSON이 아닌 응답을 보냈습니다. 서버 상태를 확인해 주세요.')
  }
}
