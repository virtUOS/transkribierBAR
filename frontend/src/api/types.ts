export type UtteranceSource = 'original' | 'refined'

export interface FileInfo {
  id: string
  original_filename: string
  media_type: string
  file_size: number
  has_video: boolean
}

export interface TranscriptionSettings {
  file_id: string
  language: string | null
  model: string
  min_speakers: number
  max_speakers: number
  initial_prompt: string | null
  hotwords: string | null
}

export interface TranscriptionStatus {
  id: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  progress: number | null
  error: string | null
  error_code: string | null
}

export interface Utterance {
  start: number
  end: number
  text: string
  speaker: string | null
}

export interface TranscriptionResult {
  id: string
  status: string
  utterances: Utterance[]
  text: string
  /** The requested language; null means Auto-detect. */
  language: string | null
  /** The language the speech recognition reported; missing or null for older transcriptions. */
  detected_language?: string | null
  speaker_mappings: Record<string, string>
  summary: SummaryResult | null
  protocol: ProtocolResult | null
  /** The saved utterances differ from the stored original; missing means no. */
  edited?: boolean
}

export interface OriginalTranscription {
  utterances: Utterance[]
}

export interface SaveTranscriptionResponse {
  status: string
  edited: boolean
}

export interface TranscriptionListItem {
  id: string
  file_id: string
  original_filename: string
  status: string
  language: string | null
  model: string | null
  created_at: string
  file_size: number
  expires_at: string
  archived: boolean
  title: string | null
  has_video: boolean
}

export interface ChapterHint {
  title?: string
  description?: string
}

export interface SummaryChapter {
  title: string
  start_time: number
  end_time: number
  summary: string
}

export interface SummaryResult {
  summary: string
  chapters: SummaryChapter[]
  chapter_hints?: ChapterHint[]
  language?: string | null
  llm_provider: string | null
  llm_model: string | null
}

export interface ProtocolKeyPoint {
  topic: string
  speaker: string
  timestamp: number | null
  content: string
}

export interface ProtocolDecision {
  decision: string
  timestamp: number | null
}

export interface ProtocolActionItem {
  task: string
  assignee: string
  timestamp: number | null
}

export interface ProtocolResult {
  title: string
  participants: string[]
  key_points: ProtocolKeyPoint[]
  decisions: ProtocolDecision[]
  action_items: ProtocolActionItem[]
  language?: string | null
  llm_provider: string | null
  llm_model: string | null
}

export interface RefinementMetadata {
  changed_indices: number[]
  changes_summary: string
  context: string | null
  llm_provider: string | null
  llm_model: string | null
  created_at: string | null
  /** Half-open, 0-based ranges still holding original text because their chunk failed. */
  failed_ranges: [number, number][]
  /** sha256 of the original texts when refined; null on rows from before this existed. */
  source_hash: string | null
}

export interface RefinementResult {
  utterances: Utterance[]
  metadata: RefinementMetadata
  /** The original's texts changed since this refinement was made. */
  stale: boolean
}

export interface ConfigResponse {
  asr_backend: string
  whisper_models: string[]
  default_model: string
  llm_available: boolean
  logout_url: string
  popular_languages: string[]
  enabled_languages: string[]
  api_tokens_enabled?: boolean
  support_assistant_enabled?: boolean
  api_token_default_expiry_days?: number
  contact_email?: string
  is_admin?: boolean
  invitation_mode?: boolean
  default_expiry_hours?: number
  archive_expiry_hours?: number
  privacy_notice?: boolean
}

export interface AnalysisTemplate {
  id: string
  name: string
  description: string
  default_prompt: string
}

export interface AnalysisGenerateRequest {
  template?: string | null
  custom_prompt?: string | null
  language?: string | null
  chapter_hints?: ChapterHint[] | null
  agenda?: string | null
  source?: UtteranceSource | null
}

export interface AnalysisListItem {
  id: string
  template: string | null
  language: string | null
  llm_provider: string | null
  llm_model: string | null
  created_at: string | null
  source: UtteranceSource | null
}

export interface TranslationResult {
  utterances: Utterance[]
  language: string
  source: UtteranceSource
  source_hash: string | null
  stale: boolean
  source_available: boolean
}

export interface ErrorResponse {
  error: string
  detail: string
}

// --- Presets ---

export interface TranscriptionPreset {
  id: string
  name: string
  language: string | null
  model: string
  min_speakers: number
  max_speakers: number
  initial_prompt: string | null
  hotwords: string | null
  created_at: string | null
  updated_at: string | null
}

/** Tokens the initial prompt and hotwords take together, and how many Whisper allows. */
export interface PromptBudget {
  tokens: number
  limit: number
}

export interface TranscriptionPresetCreate {
  name: string
  language?: string | null
  model?: string
  min_speakers?: number
  max_speakers?: number
  initial_prompt?: string | null
  hotwords?: string | null
}

export interface AnalysisPreset {
  id: string
  name: string
  template: string | null
  custom_prompt: string | null
  language: string | null
  chapter_hints: ChapterHint[] | null
  agenda: string | null
  created_at: string | null
  updated_at: string | null
}

export interface AnalysisPresetCreate {
  name: string
  template?: string | null
  custom_prompt?: string | null
  language?: string | null
  chapter_hints?: ChapterHint[] | null
  agenda?: string | null
}

export interface RefinementPreset {
  id: string
  name: string
  context: string | null
  created_at: string | null
  updated_at: string | null
}

export interface RefinementPresetCreate {
  name: string
  context?: string | null
}

export interface PresetBundle {
  id: string
  name: string
  transcription_preset_id: string | null
  analysis_preset_id: string | null
  refinement_preset_id: string | null
  translate_language: string | null
  is_default: boolean
  created_at: string | null
  updated_at: string | null
}

export interface PresetBundleCreate {
  name: string
  transcription_preset_id?: string | null
  analysis_preset_id?: string | null
  refinement_preset_id?: string | null
  translate_language?: string | null
}

export interface PresetBundleExpanded extends PresetBundle {
  transcription_preset: TranscriptionPreset | null
  analysis_preset: AnalysisPreset | null
  refinement_preset: RefinementPreset | null
}

export interface ApiToken {
  id: string
  name: string
  prefix: string
  created_at: string
  expires_at: string | null
  last_used_at: string | null
  revoked_at: string | null
  expiry_warning?: 'soon' | 'expired' | null
}

export interface ApiTokenCreateRequest {
  name: string
  expires_in_days: number
}

export interface ApiTokenCreated extends ApiToken {
  token: string
}

// --- Invitations ---

export interface Invitation {
  id: string
  email: string
  status: 'pending' | 'accepted' | 'expired' | 'revoked'
  created_at: string
  expires_at: string
  created_by: string
  accepted_at: string | null
}

export interface InvitationCreated extends Invitation {
  token: string
}

export interface InvitationCreateRequest {
  email: string
}

export interface InvitationAcceptResponse {
  redirect_url: string
}

export interface AssistantMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AssistantChatRequest {
  messages: AssistantMessage[]
  lang: 'de' | 'en'
  view: 'archive' | 'upload' | 'record' | 'detail' | 'presets' | 'settings'
  transcription_id?: string | null
}
