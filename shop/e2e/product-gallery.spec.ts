import { expect, test } from '@playwright/test'

test.use({ viewport: { width: 820, height: 1180 }, hasTouch: true })

test('планшетная галерея листается горизонтально и синхронизирует счётчик', async ({ page }) => {
  await page.goto('/product/simfoniya-kamney-2-kub')

  const slider = page.locator('.product-gallery-slider')
  await expect(slider).toBeVisible()
  await expect(page.locator('.product-gallery-counter')).toHaveText('1 / 5')

  await slider.evaluate((element) => {
    element.scrollTo({ left: element.clientWidth, behavior: 'instant' })
  })

  await expect.poll(() => slider.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
  await expect(page.locator('.product-gallery-counter')).toHaveText('2 / 5')
  await expect(page.getByText('Вес изделия', { exact: true })).toBeVisible()
  await expect(page.getByText('Вес чистого воска', { exact: true })).toBeVisible()
})
