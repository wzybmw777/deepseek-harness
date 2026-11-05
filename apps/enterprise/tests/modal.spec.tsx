// @vitest-environment jsdom
import { useState, type ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Input, Modal } from '../src/components/ui.tsx'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function ControlledModal(): ReactNode {
  const [value, setValue] = useState('')
  return (
    <Modal onClose={() => {}} open title="编辑团队">
      <Input
        aria-label="团队标识"
        onChange={(event) => { setValue(event.target.value) }}
        value={value}
      />
    </Modal>
  )
}

describe('Modal focus', () => {
  it('keeps the active input focused while its parent re-renders on each keystroke', () => {
    vi.useFakeTimers()
    render(<ControlledModal />)
    act(() => { vi.runAllTimers() })

    const input = screen.getByRole('textbox', { name: '团队标识' })
    input.focus()
    fireEvent.change(input, { target: { value: 'a' } })
    act(() => { vi.runAllTimers() })
    expect(document.activeElement).toBe(input)

    fireEvent.change(input, { target: { value: 'ab' } })
    act(() => { vi.runAllTimers() })
    expect((input as HTMLInputElement).value).toBe('ab')
    expect(document.activeElement).toBe(input)
  })
})
