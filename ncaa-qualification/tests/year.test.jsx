import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from '../src/App'

import { fetched, savedSite, serveSite } from './site'

const saved = savedSite()

function serve() {
  serveSite(saved)
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

const menu = () => screen.getByRole('combobox', { name: 'Indoor season' })

describe('the year menu', () => {
  it('lists every saved season and opens a past season’s final list', async () => {
    window.history.replaceState(null, '', '/?s=indoor&g=m&event=mile')
    serve()
    render(<App />)
    await waitFor(() => expect(menu().disabled).toBe(false))
    expect([...menu().options].map(option => option.textContent)).toEqual(['2025–26', '2024–25', '2023–24'])
    expect(menu().value).toBe('2025-2026')

    fireEvent.change(menu(), { target: { value: '2024-2025' } })
    expect(window.location.search).toContain('y=2025')
    expect(await screen.findByText(/16th on the 2024–25 final list: Foster Malleck/)).toBeTruthy()
    expect(document.querySelector('.num').textContent).toBe('3:53.82')
    // No saved days for a past season, so only the past years card.
    expect(screen.queryByRole('link', { name: /^This season/ })).toBeNull()
    expect(screen.getByRole('link', { name: /^Past years/ }).textContent).toMatch(/The 2024–25 cutoff is the/)
    expect(screen.getByRole('link', { name: '2024–2025 NCAA Division I indoor list' }).getAttribute('href'))
      .toBe('https://www.tfrrs.org/lists/4867/2024_2025_NCAA_Division_I_Indoor_Qualifying')

    fireEvent.change(menu(), { target: { value: '2025-2026' } })
    expect(window.location.search).not.toContain('y=')
    expect(await screen.findByText(/16th on the final list: Jaouad Khchina/)).toBeTruthy()
  })

  it('falls back to the latest season for a year with no saved list, and drops it from the link', async () => {
    window.history.replaceState(null, '', '/?s=indoor&g=m&y=1999&event=mile')
    serve()
    render(<App />)
    expect(await screen.findByText(/16th on the final list: Jaouad Khchina/)).toBeTruthy()
    expect(menu().value).toBe('2025-2026')
    await waitFor(() => expect(window.location.search).not.toContain('y='))
  })

  it('keeps the year when switching to outdoor, where the season is one calendar year', async () => {
    window.history.replaceState(null, '', '/?s=indoor&g=m&y=2025&event=mile')
    serve()
    render(<App />)
    await screen.findByText(/2024–25 final list/)
    fireEvent.click(screen.getByRole('link', { name: 'Outdoor' }))
    const outdoor = await screen.findByRole('combobox', { name: 'Outdoor season' })
    await waitFor(() => expect(outdoor.value).toBe('2025'))
    expect([...outdoor.options].map(option => option.textContent)).toEqual(['2026', '2025', '2024'])
    expect(window.location.search).toContain('y=2025')
  })

  it('carries outdoor 2024 to indoor 2023–24, and the latest season leaves the link', async () => {
    window.history.replaceState(null, '', '/?s=outdoor&g=m&r=East&y=2024&event=1500m')
    serve()
    render(<App />)
    await screen.findByText(/2024 final list/)
    fireEvent.click(screen.getByRole('link', { name: 'Indoor' }))
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Indoor season' }).value).toBe('2023-2024'))
    fireEvent.change(screen.getByRole('combobox', { name: 'Indoor season' }), { target: { value: '2025-2026' } })
    await waitFor(() => expect(window.location.search).not.toContain('y='))
  })

  it('loads only the shown list and the ones a tap away, and a past season when it is picked', async () => {
    window.history.replaceState(null, '', '/?s=indoor&g=m&event=mile')
    serve()
    render(<App />)
    await screen.findByText(/16th on the final list: Jaouad Khchina/)
    await waitFor(() => expect(fetched()).toContain('history-indoor-f.json'))
    expect(fetched().sort()).toEqual([
      'history-indoor-f.json', 'history-indoor-m.json', 'index.json',
      'indoor-2025-2026-f-National.json', 'indoor-2025-2026-m-National.json',
    ])
    fireEvent.change(menu(), { target: { value: '2024-2025' } })
    await screen.findByText(/16th on the 2024–25 final list/)
    expect(fetched()).toContain('indoor-2024-2025-m-National.json')
    expect(fetched().filter(name => name.startsWith('outdoor'))).toEqual([])
  })
})
