import type { PresetBundle, TranscriptionPreset } from '../../api/types'
import type { SettingsPanelValues } from './SettingsPanel'

/** The upload settings that loading a transcription preset sets. */
export function presetSettings(
  presetId: string | null,
  presets: TranscriptionPreset[],
): Partial<SettingsPanelValues> {
  const preset = presetId ? presets.find((p) => p.id === presetId) : undefined
  if (!preset) return { selectedPresetId: presetId }
  return {
    selectedPresetId: presetId,
    language: preset.language || 'auto',
    model: preset.model,
    detectSpeakers: preset.min_speakers > 0 || preset.max_speakers > 0,
    minSpeakers: preset.min_speakers || 1,
    maxSpeakers: preset.max_speakers || 2,
    initialPrompt: preset.initial_prompt || '',
    hotwords: preset.hotwords || '',
  }
}

/**
 * The upload settings that choosing a bundle sets: those of its transcription
 * preset, or null when it has none and the settings stay as they are.
 */
export function bundleSettings(
  bundle: PresetBundle | undefined,
  presets: TranscriptionPreset[],
): Partial<SettingsPanelValues> | null {
  if (!bundle?.transcription_preset_id) return null
  return presetSettings(bundle.transcription_preset_id, presets)
}
