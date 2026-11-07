import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Deliberately synthetic browser fixtures: backend ownership and price validation are tested
// separately against PGlite in tests/integration/commerce-api.test.ts.
const user = { id: 'test-user', email: 'audit@example.test', fullName: 'Audit User', role: 'customer' };
const product = { slug: 'audit-hosting', name: 'Audit Hosting', description: 'Test fixture', productType: 'hosting', displayOrder: 0, available: true };
const plan = { slug: 'starter', name: 'Audit Starter', description: 'Test fixture', billingModel: 'recurring', displayOrder: 0,
  pricing: [{ billingPeriod: 'monthly', currency: 'USD', amount: 19.99, setupFee: null }], features: [] };
const emptyCart = { items: [], serviceItems: [], currency: 'USD', subtotalAmount: '0.00', itemCount: 0, hasUnavailableItems: false };
const filledCart = { ...emptyCart, subtotalAmount: '19.99', itemCount: 1, items: [{ id: 'cart-line', planId: 'plan-id', productId: 'product-id', productSlug: product.slug, productName: product.name, planSlug: plan.slug, planName: plan.name, billingPeriod: 'monthly', quantity: 1, unitPriceAmount: '19.99', lineTotalAmount: '19.99', currency: 'USD', priceUnavailable: false }] };

async function evidence(page: Page, name: string) {
  const dir = process.env.CH247_AUDIT_EVIDENCE_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, name), fullPage: false, animations: 'disabled' });
}

test('selected catalogue plan survives login and uses the cart and order APIs', async ({ page }) => {
  let cart: typeof emptyCart | typeof filledCart = emptyCart;
  let addCalls = 0;
  let orderCalls = 0;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let body: unknown = {};
    if (path === '/api/v1/catalog') body = { products: [product] };
    else if (path === `/api/v1/catalog/products/${product.slug}/plans`) body = { product, plans: [plan] };
    else if (path === '/api/auth/login') body = { token: 'test-token', user };
    else if (path === '/api/auth/me') body = { user };
    else if (path === '/api/v1/cart' && request.method() === 'GET') body = { cart };
    else if (path === '/api/v1/cart/catalog-items' && request.method() === 'POST') {
      expect(request.postDataJSON()).toEqual({ productSlug: product.slug, planSlug: plan.slug, billingPeriod: 'monthly' });
      addCalls += 1;
      cart = filledCart;
      body = { cart };
    } else if (path === '/api/v1/orders' && request.method() === 'POST') {
      orderCalls += 1;
      cart = emptyCart;
      body = { order: { orderNumber: 'TEST-ORDER', totalAmount: '19.99', currency: 'USD', invoiceId: 'test-invoice', invoiceNumber: 'TEST-INVOICE' } };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });

  await page.goto('/pricing');
  const card = page.locator('article').filter({ hasText: 'Audit Hosting' }).first();
  await card.getByRole('button', { name: 'View plans' }).click();
  await card.getByRole('link', { name: 'Add to cart' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Email address').fill(user.email);
  await page.getByLabel('Password').fill('fixture-password');
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await expect(page.getByText('The selected plan was added to your cart.')).toBeVisible();
  await expect(page.getByText('Audit Starter')).toBeVisible();
  expect(addCalls).toBe(1);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(50);
  await evidence(page, 'catalog-cart-fixture.png');
  await page.reload();
  await expect(page.getByText('Audit Starter')).toBeVisible();
  expect(addCalls).toBe(1);
  await page.getByRole('button', { name: 'Place order' }).click();
  await expect(page.getByText('TEST-ORDER')).toBeVisible();
  await evidence(page, 'order-fixture.png');
  await expect(page.getByRole('link', { name: 'pay it here' })).toHaveAttribute('href', '/invoices/test-invoice');
  expect(orderCalls).toBe(1);
  expect(errors).toEqual([]);
});

test('mobile navigation links lead to their labelled pages', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const quickLinks = page.getByRole('navigation', { name: 'Quick links' });
  await expect(quickLinks.getByRole('link', { name: 'Pricing' })).toBeVisible();
  await evidence(page, 'mobile-navigation.png');
  await quickLinks.getByRole('link', { name: 'Pricing' }).click();
  await expect(page).toHaveURL(/\/pricing$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Pricing');
});


test('in-page plan link scrolls to the pricing section', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'See plans', exact: true }).click();
  await expect(page).toHaveURL(/#pricing$/);
  await expect.poll(() => page.locator('#pricing').evaluate((el) => el.getBoundingClientRect().top)).toBeLessThan(250);
});

test('homepage plan button preserves product, plan and billing period', async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = path === '/api/v1/catalog/products/web-hosting/plans' ? { product, plans: [plan] } : {};
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto('/');
  const planCard = page.locator('article').filter({ hasText: 'Audit Starter' }).first();
  await expect(planCard).toBeVisible();
  await expect(planCard.getByRole('link', { name: 'Choose plan' })).toHaveAttribute('href', '/cart?product=web-hosting&plan=starter&period=monthly');
});

test('expert request keeps the selected offering and submits it to the API', async ({ page }) => {
  const offerings = [
    { id: 'a', code: 'design', name: 'Design', summary: '', description: '', deliverables: [] },
    { id: 'b', code: 'migration', name: 'Migration', summary: '', description: '', deliverables: [] },
  ];
  let submitted: unknown;
  await page.addInitScript(({ customer }) => {
    localStorage.setItem('ch247_token', 'test-token');
    localStorage.setItem('ch247_user', JSON.stringify(customer));
  }, { customer: user });
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let body: unknown = {};
    if (path === '/api/v1/experts/offerings') body = { offerings };
    else if (path === '/api/v1/experts/requests' && request.method() === 'POST') {
      submitted = request.postDataJSON();
      body = { request: { id: 'request-1' } };
    } else if (path === '/api/v1/experts/requests/request-1') body = { request: { id: 'request-1', reference: 'TEST-REQUEST', status: 'submitted' }, messages: [], quotes: [] };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto('/websites/experts/new?offering=migration');
  await expect(page.getByRole('combobox', { name: 'Service' })).toHaveValue('migration');
  await evidence(page, 'expert-request-fixture.png');
  await page.getByLabel('Project title').fill('Migration test');
  await page.getByLabel(/What do you need/).fill('Please migrate our existing website to a new server.');
  await page.getByRole('button', { name: 'Send request' }).click();
  await expect(page).toHaveURL(/\/websites\/experts\/request-1$/);
  expect(submitted).toMatchObject({ offeringCode: 'migration', title: 'Migration test' });
});

test('support widget starts a conversation and sends the message to support API', async ({ page }) => {
  let message: unknown;
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let body: unknown = {};
    if (path === '/api/v1/ai-support/conversations' && request.method() === 'POST') body = { conversationId: 'fixture', accessToken: 'fixture-token', message: { author_type: 'AI', body: 'How can I help?' } };
    else if (path === '/api/v1/ai-support/conversations/fixture/messages') {
      message = request.postDataJSON();
      body = { response: { author_type: 'AI', body: 'Fixture response from support.' } };
    } else if (path === '/api/v1/ai-support/conversations/fixture') body = { messages: [{ author_type: 'AI', body: 'How can I help?' }], conversation: { status: 'AI_ACTIVE' } };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto('/contact');
  await page.getByRole('button', { name: 'AI Support' }).click();
  await page.getByRole('button', { name: 'Start conversation' }).click();
  await page.getByLabel('Support message').fill('I need help with hosting');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Fixture response from support.')).toBeVisible();
  expect(message).toEqual({ message: 'I need help with hosting' });
  await evidence(page, 'support-conversation-fixture.png');
  await page.getByRole('button', { name: 'Close support' }).click();
  await expect(page.getByRole('region', { name: 'CloudHost247 AI Support' })).toHaveCount(0);
});

test('unavailable expert offering is not silently replaced with a different service', async ({ page }) => {
  await page.addInitScript(({ customer }) => {
    localStorage.setItem('ch247_token', 'test-token');
    localStorage.setItem('ch247_user', JSON.stringify(customer));
  }, { customer: user });
  await page.route('**/api/**', async (route) => {
    const body = new URL(route.request().url()).pathname === '/api/v1/experts/offerings'
      ? { offerings: [{ id: 'a', code: 'design', name: 'Design', summary: '', description: '', deliverables: [] }] } : {};
    await route.fulfill({ json: body });
  });
  await page.goto('/websites/experts/new?offering=removed-service');
  await expect(page.getByText('That service is no longer available. Please select another service.')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Service' })).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Send request' })).toBeDisabled();
});

test('published builder link opens the published site route, not the JSON API', async ({ page }) => {
  await page.addInitScript(({ customer }) => {
    localStorage.setItem('ch247_token', 'test-token');
    localStorage.setItem('ch247_user', JSON.stringify(customer));
  }, { customer: user });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = {};
    if (path === '/api/v1/builder/sites') body = { sites: [{ id: 'site-1', slug: 'my-published-site', name: 'My Site', status: 'published', updated_at: '2026-01-01T00:00:00Z' }] };
    if (path === '/api/v1/builder/templates') body = { templates: [] };
    if (path === '/api/v1/platform-services/plans') body = { plans: [] };
    await route.fulfill({ json: body });
  });
  await page.goto('/websites/builder');
  await expect(page.getByRole('link', { name: 'View published', exact: true })).toHaveAttribute('href', '/sites/my-published-site');
});

test('cart removal button is legible and sends a delete request', async ({ page }) => {
  let deleted = false;
  await page.addInitScript(({ customer }) => {
    localStorage.setItem('ch247_token', 'test-token');
    localStorage.setItem('ch247_user', JSON.stringify(customer));
  }, { customer: user });
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let body: unknown = {};
    if (path === '/api/v1/cart') body = { cart: filledCart };
    if (path === '/api/v1/cart/items/cart-line' && request.method() === 'DELETE') {
      deleted = true;
      body = { cart: emptyCart };
    }
    await route.fulfill({ json: body });
  });
  await page.goto('/cart');
  const remove = page.getByRole('button', { name: 'Remove' });
  await expect(remove).toHaveCSS('color', 'rgb(95, 69, 10)');
  await remove.click();
  await expect(page.getByText('Your cart is empty.')).toBeVisible();
  expect(deleted).toBe(true);
});


test('failed catalogue additions display the error without retrying on reload', async ({ page }) => {
  let calls = 0;
  await page.addInitScript(({ customer }) => {
    localStorage.setItem('ch247_token', 'test-token');
    localStorage.setItem('ch247_user', JSON.stringify(customer));
  }, { customer: user });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/cart/catalog-items') {
      calls++;
      return route.fulfill({ status: 400, json: { message: 'Plan unavailable' } });
    }
    return route.fulfill({ json: path === '/api/v1/cart' ? { cart: emptyCart } : {} });
  });
  await page.goto('/cart?product=a&plan=b&period=monthly&source=pricing');
  await expect(page.getByText('Plan unavailable')).toBeVisible();
  await expect(page).toHaveURL(/\?source=pricing$/);
  await page.reload();
  await expect(page.getByText('Your cart is empty.')).toBeVisible();
  expect(calls).toBe(1);
});

test('new platform plan intents are handled while the cart remains mounted', async ({ page }) => {
  const selected: string[] = [];
  await page.addInitScript(({ customer }) => {
    localStorage.setItem('ch247_token', 'test-token');
    localStorage.setItem('ch247_user', JSON.stringify(customer));
  }, { customer: user });
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let body: unknown = {};
    if (path === '/api/v1/cart') body = { cart: emptyCart };
    else if (path === '/api/v1/platform-services/plans') body = { plans: [{ id: 'plan-one', code: 'one', name: 'One' }, { id: 'plan-two', code: 'two', name: 'Two' }] };
    else if (path === '/api/v1/cart/service-items' && request.method() === 'POST') {
      selected.push(request.postDataJSON().serviceRef);
      body = { cart: emptyCart };
    }
    await route.fulfill({ json: body });
  });
  await page.goto('/cart?add=website_builder:one&source=plans');
  await expect.poll(() => selected.length).toBe(1);
  await expect(page).toHaveURL(/\?source=plans$/);
  await page.evaluate(() => {
    history.pushState({}, '', '/cart?add=website_builder:two&source=plans');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect.poll(() => selected.length).toBe(2);
  expect(selected).toEqual(['plan-one', 'plan-two']);
  await expect(page).toHaveURL(/\?source=plans$/);
  await page.reload();
  await expect(page.getByText('Your cart is empty.')).toBeVisible();
  expect(selected).toHaveLength(2);
});

test('failed support message remains editable and is not shown as delivered', async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/v1/ai-support/conversations' && request.method() === 'POST') return route.fulfill({ json: { conversationId: 'fixture', accessToken: 'fixture-token', message: { author_type: 'AI', body: 'How can I help?' } } });
    if (path === '/api/v1/ai-support/conversations/fixture/messages') return route.fulfill({ status: 503, json: { message: 'Support is unavailable' } });
    if (path === '/api/v1/ai-support/conversations/fixture') return route.fulfill({ json: { messages: [], conversation: { status: 'AI_ACTIVE' } } });
    return route.fulfill({ json: {} });
  });
  await page.goto('/contact');
  await page.getByRole('button', { name: 'AI Support' }).click();
  await page.getByRole('button', { name: 'Start conversation' }).click();
  await page.getByLabel('Support message').fill('Please help');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Support is unavailable');
  await expect(page.getByLabel('Support message')).toHaveValue('Please help');
  await expect(page.getByText('Please help', { exact: true })).toHaveCount(0);
});
