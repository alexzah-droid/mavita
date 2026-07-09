import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('home page layout contract', () => {
  it('orders about, elements and catalog before the optional ritual', async () => {
    const css = await readFile(path.join(process.cwd(), 'app/globals.css'), 'utf8')
    expect(css).toContain('.home-sections .atmosphere { order: 1; }')
    expect(css).toContain('.home-sections .stihii { order: 2; }')
    expect(css).toContain('.home-sections .catalog { order: 3; }')
  })

  it('places Mountains, Sea and Forest tiles in that order', async () => {
    const source = await readFile(path.join(process.cwd(), 'app/HomeClient.tsx'), 'utf8')
    const elements = source.slice(source.indexOf('{/* ── Three Stihii ── */'))
    expect(elements.indexOf("name: 'Горы'")).toBeLessThan(elements.indexOf("name: 'Море'"))
    expect(elements.indexOf("name: 'Море'")).toBeLessThan(elements.indexOf("name: 'Лес'"))
  })
})
