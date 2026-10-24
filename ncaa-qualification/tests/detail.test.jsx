import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from '../src/App'

import { savedSite, serveSite } from './site'

const saved = savedSite()

function serve() {
  serveSite(saved)
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

describe('the season and past-years dialogs', () => {
  it('opens each card as a dialog that the URL holds, and closes back to the event page', async () => {
    window.history.replaceState(null, '', '/?s=indoor&g=m&event=mile')
    serve()
    render(<App />)
    const season = await screen.findByRole('link', { name: /^This season/ })
    expect(season.getAttribute('href')).toContain('detail=season')
    fireEvent.click(season)
    expect(window.location.search).toContain('detail=season')
    expect(await screen.findByRole('dialog', { name: 'Men’s mile This season' })).toBeTruthy()
    expect(document.querySelector('dialog .chart svg')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(document.querySelector('dialog.detail')).toBeNull())

    const history = screen.getByRole('link', { name: /^Past years/ })
    expect(history.textContent).toMatch(/of \d+ seasons/)
    fireEvent.click(history)
    expect(await screen.findByRole('dialog', { name: 'Men’s mile Past years' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Compared with this season' })).toBeTruthy()
    fireEvent.keyDown(document.querySelector('dialog.detail'), { key: 'Escape' })
    await waitFor(() => expect(document.querySelector('dialog.detail')).toBeNull())
  })

  it('opens a linked dialog straight away, and closing it keeps the reader on the site', async () => {
    window.history.replaceState(null, '', '/?s=indoor&g=m&event=mile&detail=history')
    serve()
    render(<App />)
    expect(await screen.findByRole('dialog', { name: 'Men’s mile Past years' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(document.querySelector('dialog.detail')).toBeNull())
    expect(window.location.search).toBe('?g=m&s=indoor&event=mile')
  })

  it('sends the old season page to the season dialog', async () => {
    window.history.replaceState(null, '', '/?s=indoor&g=m&event=mile&view=season')
    serve()
    render(<App />)
    expect(await screen.findByRole('dialog', { name: 'Men’s mile This season' })).toBeTruthy()
    expect(window.location.search).toBe('?g=m&s=indoor&event=mile&detail=season')
    expect(screen.getByRole('table', { name: /around the qualifying line/ })).toBeTruthy()
  })
})
