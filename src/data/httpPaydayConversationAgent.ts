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
      const errorResponse = (await response.json().catch(() => null)) as {
        message?: string
      } | null
      throw new Error(
        errorResponse?.message ??
          `월급 Agent 요청을 처리하지 못했습니다: ${response.status}`,
      )
    }

    const responseBody: unknown = await response.json()
    const parsedResponse =
      paydayConversationResponseSchema.safeParse(responseBody)
    if (!parsedResponse.success) {
      throw new Error('Agent 응답 형식이 웹 계약과 일치하지 않습니다.')
    }
    return parsedResponse.data
  }
}
