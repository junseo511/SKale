import type { PaydayWorkspace } from '../domain/paydayConversation'

const STORAGE_KEY = 'skale.payday-workspace.v1'

export interface PaydayWorkspaceRepository {
  load(): PaydayWorkspace | null
  save(workspace: PaydayWorkspace): void
}

export class LocalPaydayWorkspaceRepository
  implements PaydayWorkspaceRepository
{
  public load(): PaydayWorkspace | null {
    const serializedWorkspace = window.localStorage.getItem(STORAGE_KEY)
    if (!serializedWorkspace) {
      return null
    }

    try {
      return JSON.parse(serializedWorkspace) as PaydayWorkspace
    } catch {
      return null
    }
  }

  public save(workspace: PaydayWorkspace): void {
    const workspaceWithoutImageData: PaydayWorkspace = {
      ...workspace,
      messages: workspace.messages.map((message) => ({
        ...message,
        attachments: message.attachments.map((attachment) => ({
          ...attachment,
          data: '',
          previewUrl: '',
        })),
      })),
    }
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(workspaceWithoutImageData),
    )
  }
}
