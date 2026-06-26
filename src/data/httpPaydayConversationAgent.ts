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
          `답변을 가져오지 못했어요. 잠시 후 다시 시도해 주세요. (${response.status})`,
      )
    }

    const responseBody: unknown = await readJsonResponse<unknown>(response)
    if (!responseBody) {
      throw new Error('답변이 비어 있어요. 잠시 후 다시 보내주세요.')
    }
    const parsedResponse =
      paydayConversationResponseSchema.safeParse(responseBody)
    if (!parsedResponse.success) {
      throw new Error('답변을 화면에 표시하지 못했어요. 다시 시도해 주세요.')
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
    throw new Error('답변을 읽지 못했어요. 잠시 후 다시 시도해 주세요.')
  }
}
