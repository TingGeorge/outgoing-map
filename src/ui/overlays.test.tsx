import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfirmDialog, FilePicker, Toaster, toast } from './index'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

function render(node: React.ReactNode) {
  act(() => root.render(node))
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

describe('toast', () => {
  it('shows at most two, and dismisses after 3.5 s', () => {
    vi.useFakeTimers()
    render(createElement(Toaster))

    act(() => {
      toast('一')
      toast('二')
      toast('三')
    })
    expect(host.textContent).toBe('二三')

    act(() => void vi.advanceTimersByTime(3499))
    expect(host.textContent).toBe('二三')

    act(() => void vi.advanceTimersByTime(2))
    expect(host.textContent).toBe('')
  })
})

describe('FilePicker', () => {
  it('passes files on and clears the input so the same file can be picked again', () => {
    const onFiles = vi.fn()
    render(createElement(FilePicker, { onFiles, children: '選' }))

    const input = host.querySelector('input')!
    const file = new File(['x'], 'a.gpx')
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    const clear = vi.fn()
    Object.defineProperty(input, 'value', { get: () => 'C:\\a.gpx', set: clear, configurable: true })

    act(() => void input.dispatchEvent(new Event('change', { bubbles: true })))

    expect(onFiles).toHaveBeenCalledWith([file])
    expect(clear).toHaveBeenCalledWith('')
  })
})

describe('ConfirmDialog', () => {
  it('calls onConfirm or onCancel from the matching button', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.setAttribute('open', '')
    }
    render(createElement(ConfirmDialog, { open: true, title: 't', message: 'm', confirmLabel: '刪除', onConfirm, onCancel }))

    const buttons = [...host.querySelectorAll('button')]
    act(() => buttons.find((b) => b.textContent === '刪除')!.click())
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()

    act(() => buttons.find((b) => b.textContent === '取消')!.click())
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
