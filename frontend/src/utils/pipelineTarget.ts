export interface PipelineTarget {
  transcriptionId: string
  bundleId: string
}

/**
 * Bundle steps run only for a transcription that was submitted with a bundle.
 * `targets` maps transcription id to bundle id, so several submissions can be pending at once.
 * The caller deletes the entry before running, so the steps cannot run twice.
 */
export function pipelineTargetToRun(
  targets: ReadonlyMap<string, string>,
  transcriptionId: string | null,
  status: string | null,
  hasResult: boolean,
): PipelineTarget | null {
  if (!transcriptionId || status !== 'completed' || !hasResult) return null
  const bundleId = targets.get(transcriptionId)
  return bundleId ? { transcriptionId, bundleId } : null
}

/**
 * The bundle steps run for one transcription while the user may open another.
 * Returns a function that runs a store write only while `transcriptionId` is still
 * the open transcription, so a result never lands under a different one.
 */
export function whileTranscriptionOpen(
  transcriptionId: string,
  getOpenId: () => string | null,
): (write: () => void) => boolean {
  return (write) => {
    if (getOpenId() !== transcriptionId) return false
    write()
    return true
  }
}

/**
 * Status line shared by all bundle runs: a run may clear it only if it is still the
 * status that run set, never one set by another transcription's run.
 */
export function releaseStatus<T>(current: T | null, mine: T | null): T | null {
  return current === mine ? null : current
}
