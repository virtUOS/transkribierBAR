import type {
  FileInfo, TranscriptionSettings, TranscriptionStatus, PromptBudget,
  TranscriptionResult, TranscriptionListItem, ConfigResponse,
  OriginalTranscription, SaveTranscriptionResponse,
  RefinementResult,
  AnalysisTemplate, AnalysisGenerateRequest, AnalysisListItem,
  TranscriptionPreset, TranscriptionPresetCreate,
  AnalysisPreset, AnalysisPresetCreate,
  RefinementPreset, RefinementPresetCreate,
  PresetBundle, PresetBundleCreate, PresetBundleExpanded,
  ApiToken, ApiTokenCreated,
  Invitation, InvitationCreated, InvitationAcceptResponse,
  TranslationResult, UtteranceSource,
} from './types'

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '')

/**
 * A non-2xx API response. `message` is the server's `detail`; `status` lets callers branch on it.
 * `code`, when the server sends one, names the failure where the status alone cannot — a 502 also
 * comes from the proxy when the app is down.
 */
export class ApiError extends Error {
  readonly status: number
  readonly code?: string

  constructor(status: number, detail: string, code?: string) {
    super(detail)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${BASE}${url}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    })
  } catch (err) {
    // Fetch threw — most likely a cross-origin redirect to the auth provider
    // was blocked by CORS. Force a top-level navigation so the browser can
    // complete the auth flow without CORS restrictions.
    window.location.href = `${BASE}/`
    throw err
  }
  if (response.redirected) {
    window.location.href = response.url
    throw new Error('Redirected to auth')
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      window.location.reload()
      throw new Error('Authentication required')
    }
    const error = await response.json().catch(() => ({ detail: response.statusText }))
    throw new ApiError(response.status, error.detail || response.statusText, error.code)
  }
  return response.json()
}

export const api = {
  getConfig: () => request<ConfigResponse>('/api/config'),

  uploadFile: async (file: File, signal?: AbortSignal): Promise<FileInfo> => {
    const formData = new FormData()
    formData.append('file', file)
    const response = await fetch(`${BASE}/api/upload`, { method: 'POST', body: formData, signal })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }))
      throw new ApiError(response.status, error.detail || response.statusText)
    }
    return response.json()
  },

  uploadRecording: async (file: File, hasVideo: boolean): Promise<FileInfo> => {
    const formData = new FormData()
    formData.append('file', file)
    const response = await fetch(`${BASE}/api/upload?has_video=${hasVideo}`, { method: 'POST', body: formData })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }))
      throw new Error(error.detail || response.statusText)
    }
    return response.json()
  },

  startTranscription: (settings: TranscriptionSettings) =>
    request<{ id: string; status: string }>('/api/transcribe', {
      method: 'POST',
      body: JSON.stringify(settings),
    }),

  promptBudget: (fields: { initial_prompt: string | null; hotwords: string | null }) =>
    request<PromptBudget>('/api/prompt-budget', { method: 'POST', body: JSON.stringify(fields) }),

  getStatus: (id: string) => request<TranscriptionStatus>(`/api/status/${id}`),
  getTranscription: (id: string) => request<TranscriptionResult>(`/api/transcription/${id}`),
  getOriginalTranscription: (id: string) => request<OriginalTranscription>(`/api/transcription/${id}/original`),

  exportTranscription: async (id: string, format: string): Promise<string> => {
    const response = await fetch(`${BASE}/api/transcription/${id}/export/${format}`)
    if (!response.ok) throw new Error('Export failed')
    return response.text()
  },

  saveTranscription: (id: string, utterances: import('./types').Utterance[]) =>
    request<SaveTranscriptionResponse>(`/api/transcription/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ utterances }),
    }),

  updateSpeakers: (id: string, mappings: Record<string, string>) =>
    request<{ status: string }>(`/api/transcription/${id}/speakers`, {
      method: 'PUT',
      body: JSON.stringify({ mappings }),
    }),

  deleteTranscription: (id: string) =>
    request<{ status: string }>(`/api/transcription/${id}`, { method: 'DELETE' }),

  archiveTranscription: (id: string) =>
    request<{ status: string; expires_at: string }>(`/api/transcription/${id}/archive`, { method: 'POST' }),

  listTranscriptions: () => request<TranscriptionListItem[]>('/api/transcriptions'),

  renameFile: (fileId: string, filename: string) =>
    request<FileInfo>(`/api/files/${fileId}/rename`, {
      method: 'PATCH',
      body: JSON.stringify({ filename }),
    }),

  renameTitle: (id: string, title: string) =>
    request<{ status: string }>(`/api/transcription/${id}/title`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    }),

  generateRefinement: (id: string, context?: string) =>
    request<RefinementResult>(`/api/refine/${id}`, {
      method: 'POST',
      ...(context ? { body: JSON.stringify({ context }) } : {}),
    }),

  getRefinement: (id: string) =>
    request<RefinementResult>(`/api/refine/${id}`),

  retryRefinement: (id: string) =>
    request<RefinementResult>(`/api/refine/${id}/retry`, { method: 'POST' }),

  deleteRefinement: (id: string) =>
    request<{ status: string }>(`/api/refine/${id}`, { method: 'DELETE' }),

  getAnalysisTemplates: () => request<AnalysisTemplate[]>('/api/analysis/templates'),

  listAnalyses: (transcriptionId: string) =>
    request<AnalysisListItem[]>(`/api/analysis/${transcriptionId}`),

  getAnalysis: (transcriptionId: string, analysisId: string) =>
    request<unknown>(`/api/analysis/${transcriptionId}/${analysisId}`),

  generateAnalysis: (transcriptionId: string, req: AnalysisGenerateRequest) =>
    request<unknown>(`/api/analysis/${transcriptionId}`, {
      method: 'POST',
      body: JSON.stringify(req),
    }),

  deleteAnalysis: (transcriptionId: string, analysisId: string) =>
    request<void>(`/api/analysis/${transcriptionId}/${analysisId}`, { method: 'DELETE' }),

  deleteAnalysisItem: (transcriptionId: string, analysisId: string, field: string, index: number) =>
    request<unknown>(`/api/analysis/${transcriptionId}/${analysisId}/items/${field}/${index}`, { method: 'DELETE' }),

  translateTranscription: (id: string, targetLanguage: string, source?: UtteranceSource, force?: boolean) =>
    request<TranslationResult>(`/api/translate/${id}`, {
      method: 'POST',
      body: JSON.stringify({
        target_language: targetLanguage,
        ...(source ? { source } : {}),
        ...(force ? { force } : {}),
      }),
    }),

  getTranslation: (id: string) =>
    request<TranslationResult>(`/api/translate/${id}`),

  deleteTranslation: (id: string) =>
    request<{ status: string }>(`/api/translate/${id}`, { method: 'DELETE' }),

  getMediaUrl: (fileId: string) => `${BASE}/api/media/${fileId}`,
  getMediaFallbackUrl: (fileId: string) => `${BASE}/api/media/${fileId}/fallback`,

  connectWebSocket: (transcriptionId: string): WebSocket => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return new WebSocket(`${protocol}//${window.location.host}${BASE}/api/ws/status/${transcriptionId}`)
  },

  // --- Presets ---

  getTranscriptionPresets: () => request<TranscriptionPreset[]>('/api/presets/transcription'),
  createTranscriptionPreset: (data: TranscriptionPresetCreate) =>
    request<TranscriptionPreset>('/api/presets/transcription', { method: 'POST', body: JSON.stringify(data) }),
  updateTranscriptionPreset: (id: string, data: TranscriptionPresetCreate) =>
    request<TranscriptionPreset>(`/api/presets/transcription/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteTranscriptionPreset: (id: string) =>
    request<{ status: string }>(`/api/presets/transcription/${id}`, { method: 'DELETE' }),

  getAnalysisPresets: () => request<AnalysisPreset[]>('/api/presets/analysis'),
  createAnalysisPreset: (data: AnalysisPresetCreate) =>
    request<AnalysisPreset>('/api/presets/analysis', { method: 'POST', body: JSON.stringify(data) }),
  updateAnalysisPreset: (id: string, data: AnalysisPresetCreate) =>
    request<AnalysisPreset>(`/api/presets/analysis/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteAnalysisPreset: (id: string) =>
    request<{ status: string }>(`/api/presets/analysis/${id}`, { method: 'DELETE' }),

  getRefinementPresets: () => request<RefinementPreset[]>('/api/presets/refinement'),
  createRefinementPreset: (data: RefinementPresetCreate) =>
    request<RefinementPreset>('/api/presets/refinement', { method: 'POST', body: JSON.stringify(data) }),
  updateRefinementPreset: (id: string, data: RefinementPresetCreate) =>
    request<RefinementPreset>(`/api/presets/refinement/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteRefinementPreset: (id: string) =>
    request<{ status: string }>(`/api/presets/refinement/${id}`, { method: 'DELETE' }),

  getBundles: () => request<PresetBundle[]>('/api/presets/bundles'),
  createBundle: (data: PresetBundleCreate) =>
    request<PresetBundle>('/api/presets/bundles', { method: 'POST', body: JSON.stringify(data) }),
  updateBundle: (id: string, data: PresetBundleCreate) =>
    request<PresetBundle>(`/api/presets/bundles/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteBundle: (id: string) =>
    request<{ status: string }>(`/api/presets/bundles/${id}`, { method: 'DELETE' }),
  setDefaultBundle: (id: string) =>
    request<{ status: string }>(`/api/presets/bundles/${id}/default`, { method: 'PUT' }),
  clearDefaultBundle: () =>
    request<{ status: string }>('/api/presets/default', { method: 'DELETE' }),
  getDefaultBundle: () => request<PresetBundleExpanded | null>('/api/presets/default'),

  // --- API Tokens ---

  listApiTokens: () => request<ApiToken[]>('/api/tokens'),

  createApiToken: (name: string, expiresInDays: number) =>
    request<ApiTokenCreated>('/api/tokens', {
      method: 'POST',
      body: JSON.stringify({ name, expires_in_days: expiresInDays }),
    }),

  revokeApiToken: async (id: string): Promise<void> => {
    const response = await fetch(`${BASE}/api/tokens/${id}`, { method: 'DELETE' })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }))
      throw new ApiError(response.status, error.detail || response.statusText, error.code)
    }
  },

  // --- Invitations ---

  listInvitations: () => request<Invitation[]>('/api/invitations'),

  createInvitation: (email: string) =>
    request<InvitationCreated>('/api/invitations', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  revokeInvitation: async (id: string): Promise<void> => {
    const response = await fetch(`${BASE}/api/invitations/${id}`, { method: 'DELETE' })
    if (!response.ok) {
      throw new Error(response.statusText)
    }
  },

  acceptInvitation: (token: string) =>
    request<InvitationAcceptResponse>('/api/invitations/accept', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),
}
