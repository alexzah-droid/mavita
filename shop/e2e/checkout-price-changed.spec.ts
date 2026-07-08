import { expect, test } from '@playwright/test'

test('PRICE_CHANGED replaces the displayed sums and retries with the authoritative total', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('mavita.cart.v1', JSON.stringify({ lines: [{ slug: 'candle', name: 'Свеча', priceKopecks: 100000, image: '', quantity: 1 }] })))
  await page.route('**/api/checkout/delivery', (route) => route.fulfill({
    json: { mode: 'pickup_required', carriers: [{ carrier: 'cdek', label: 'СДЭК', deliveryKopecks: 50000 }] },
  }))
  await page.route('**/api/checkout/city', (route) => route.fulfill({ json: { city: { code: 44, city: 'Москва', region: 'Москва' } } }))
  await page.route('**/api/cdek?cityCode=*', (route) => route.fulfill({ json: { pickupPoints: [{ code: 'MSK1', city: 'Москва', name: 'ПВЗ СДЭК', address: 'ул. Тестовая, 1' }] } }))
  const payloads: unknown[] = []
  await page.route('**/api/robokassa/init', async (route) => {
    payloads.push(route.request().postDataJSON())
    await route.fulfill({ status: 409, json: { error: { code: 'PRICE_CHANGED', messages: ['Цена изменилась'] }, itemsKopecks: 120000, deliveryKopecks: 50000, totalKopecks: 170000 } })
  })

  await page.goto('/checkout')
  await page.getByLabel('ФИО получателя').fill('Иван Иванов')
  await page.getByLabel('Email').fill('ivan@example.com')
  await page.getByLabel('Телефон получателя').fill('+79991234567')
  await page.locator('select').selectOption('MSK1')
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Оплатить заказ с доставкой' }).click()

  await expect(page.getByText('Цена изменилась. Итог обновлён — повторите оплату.')).toBeVisible()
  await expect(page.getByText(/1[\s ]200 ₽/)).toBeVisible()
  await expect(page.getByText(/1[\s ]700 ₽/)).toBeVisible()
  await page.getByRole('button', { name: 'Оплатить заказ с доставкой' }).click()
  await expect.poll(() => payloads).toHaveLength(2)
  expect(payloads[1]).toMatchObject({ expectedTotalKopecks: 170000, delivery: { expectedDeliveryKopecks: 50000 } })
})
