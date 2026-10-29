import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { api } from '../api/client'
import { isOverPromptBudget, usePromptBudget } from './usePromptBudget'

vi.mock('../api/client', () => ({
  api: { promptBudget: vi.fn() },
}))

beforeEach(() => {
  vi.useFakeTimers()
  vi.mocked(api.promptBudget).mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('usePromptBudget', () => {
  it('asks nothing while both fields are empty', async () => {
    const { result } = renderHook(() => usePromptBudget('', null))
    await act(async () => { await vi.runAllTimersAsync() })
    expect(api.promptBudget).not.toHaveBeenCalled()
    expect(result.current).toBeNull()
  })

  it('counts once typing has paused', async () => {
    vi.mocked(api.promptBudget).mockResolvedValue({ tokens: 40, limit: 223 })
    const { result, rerender } = renderHook(
      ({ prompt }) => usePromptBudget(prompt, 'Osnabrück'),
      { initialProps: { prompt: 'Sitz' } },
    )
    rerender({ prompt: 'Sitzung' })
    await act(async () => { await vi.advanceTimersByTimeAsync(299) })
    expect(api.promptBudget).not.toHaveBeenCalled()

    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(api.promptBudget).toHaveBeenCalledTimes(1)
    expect(api.promptBudget).toHaveBeenCalledWith({ initial_prompt: 'Sitzung', hotwords: 'Osnabrück' })
    expect(result.current).toEqual({ tokens: 40, limit: 223 })
  })

  it('gives no budget when the count fails', async () => {
    vi.mocked(api.promptBudget).mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => usePromptBudget('Sitzung', null))
    await act(async () => { await vi.runAllTimersAsync() })
    expect(result.current).toBeNull()
  })
})

describe('isOverPromptBudget', () => {
  it('is over only above the limit', () => {
    expect(isOverPromptBudget(null)).toBe(false)
    expect(isOverPromptBudget({ tokens: 223, limit: 223 })).toBe(false)
    expect(isOverPromptBudget({ tokens: 224, limit: 223 })).toBe(true)
  })
})
