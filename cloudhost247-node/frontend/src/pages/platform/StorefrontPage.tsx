import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiFetch, ApiRequestError } from '../../lib/api';
import { usePageMeta } from '../../lib/usePageMeta';
import { CatalogErrorBanner, CatalogLoadingBanner } from '../../components/CatalogStateBanner';
import { money, type PublicStore, type PublicStoreProduct, type ShopperOrderResult, type ShopperOrderStatus } from '../../lib/platform-api';

/**
 * Public storefront + shopper checkout.
 *
 * Real rules are enforced server-side and surfaced honestly here:
 *   - a digital or service line never asks for a shipping address, and a physical line always does;
 *   - shipping is only offered from the methods this store actually configured for the destination;
 *   - totals are computed by the server from the products, never from anything the browser sent;
 *   - a store with no connected payment provider says so and records the order for payment to be
 *     arranged directly, instead of pretending a card was charged.
 */
export default function StorefrontPage() {
  const { slug } = useParams<{ slug: string }>();
  const storeSlug = slug ?? '';
  const [store, setStore] = useState<PublicStore | null>(null);
  const [error, setError] = useState<{ message: string; status?: number } | null>(null);
  const [cart, setCart] = useState<Record<string, { product: PublicStoreProduct; quantity: number }>>({});
  const [form, setForm] = useState({ name: '', email: '', phone: '', notes: '', discountCode: '', shippingMethodId: '', address: { line1: '', line2: '', city: '', region: '', postalCode: '', country: '' } });
  const [busy, setBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  const [placed, setPlaced] = useState<ShopperOrderResult | null>(null);

  useEffect(() => {
    setStore(null);
    setError(null);
    apiFetch<PublicStore>(`/api/v1/public/stores/${encodeURIComponent(storeSlug)}`)
      .then(setStore)
      .catch((err: Error) => setError({ message: err.message, status: err instanceof ApiRequestError ? err.status : undefined }));
  }, [storeSlug]);

  const lines = Object.values(cart);
  const requiresShipping = lines.some((line) => line.product.requires_shipping);
  const subtotal = lines.reduce((total, line) => total + Number(line.product.price_amount) * line.quantity, 0);
  const shippingMethods = (store?.shippingMethods ?? []).filter((method) => {
    if (!requiresShipping) return false;
    if (!method.countries?.length) return true;
    return form.address.country ? method.countries.includes(form.address.country.toUpperCase()) : false;
  });

  usePageMeta(store ? `${store.store.name} — online store` : 'Online store', store?.store.description || 'Shop on CloudHost247.', {
    canonical: `/store/${storeSlug}`,
    jsonLd: store
      ? {
          '@context': 'https://schema.org',
          '@type': 'Store',
          name: store.store.name,
          description: store.store.description,
          url: `${window.location.origin}/store/${storeSlug}`,
        }
      : undefined,
  });

  const add = (product: PublicStoreProduct) =>
    setCart((current) => ({
      ...current,
      [product.id]: { product, quantity: (current[product.id]?.quantity ?? 0) + 1 },
    }));

  if (error) {
    return (
      <div className="ch247-page">
        <CatalogErrorBanner
          message={
            error.status === 404
              ? 'No active store is served at this address. A store must be activated by its owner before shoppers can see it.'
              : error.message
          }
        />
        <p>
          <Link to="/websites/store">Sell with CloudHost247</Link>
        </p>
      </div>
    );
  }
  if (!store) return <CatalogLoadingBanner label="Loading the store…" />;

  if (placed) return <OrderConfirmation store={store} result={placed} email={form.email} />;

  return (
    <div className="ch247-page ch247-page--wide">
      <h1>{store.store.name}</h1>
      {store.store.description ? <p className="ch247-page__hint">{store.store.description}</p> : null}
      <p className="ch247-page__hint">
        Prices in {store.store.currency}.{' '}
        {store.store.paymentMode === 'provider'
          ? 'Payment is settled by the store’s connected payment provider; fulfilment starts once it is verified.'
          : 'This store collects orders and arranges payment directly — nothing is charged here.'}
      </p>

      {store.products.length === 0 ? (
        <p>This store has no products on sale yet.</p>
      ) : (
        <div className="ch247-service-grid">
          {store.products.map((product) => (
            <article key={product.id} className="ch247-service-card">
              <h3>{product.name}</h3>
              <p>{product.description}</p>
              <p className="ch247-price">
                {money(product.price_amount, product.currency)}
                {product.compare_at_amount ? <s className="ch247-page__hint"> {money(product.compare_at_amount, product.currency)}</s> : null}
              </p>
              <p className="ch247-page__hint">
                {product.kind === 'digital' ? 'Digital download — delivered after payment, no shipping.' : null}
                {product.kind === 'service' ? 'Service — no shipping.' : null}
                {product.kind === 'physical' ? 'Physical product — shipping calculated at checkout.' : null}
                {product.track_inventory && product.inventory_quantity <= 0 ? ' Out of stock.' : null}
              </p>
              <div className="ch247-service-card__footer">
                <button
                  type="button"
                  className="ch247-button ch247-button--small"
                  disabled={product.track_inventory && product.inventory_quantity <= 0}
                  onClick={() => add(product)}
                >
                  Add to cart
                </button>
                {cart[product.id] ? <span className="ch247-page__hint">In cart: {cart[product.id]!.quantity}</span> : null}
              </div>
            </article>
          ))}
        </div>
      )}

      <section className="ch247-card">
        <h2>Checkout</h2>
        {lines.length === 0 ? (
          <p>Your cart is empty.</p>
        ) : (
          <div className="ch247-form">
            <ul className="ch247-plainlist">
              {lines.map((line) => (
                <li key={line.product.id}>
                  {line.product.name} × {line.quantity} — {money(String(Number(line.product.price_amount) * line.quantity), store.store.currency)}{' '}
                  <button
                    type="button"
                    className="ch247-button ch247-button--ghost ch247-button--small"
                    onClick={() =>
                      setCart((current) => {
                        const next = { ...current };
                        const existing = next[line.product.id];
                        if (!existing) return next;
                        if (existing.quantity <= 1) delete next[line.product.id];
                        else next[line.product.id] = { ...existing, quantity: existing.quantity - 1 };
                        return next;
                      })
                    }
                  >
                    Remove one
                  </button>
                </li>
              ))}
            </ul>
            <p className="ch247-page__hint">Subtotal {money(subtotal.toFixed(2), store.store.currency)} — the server recalculates the total, including any tax and shipping.</p>

            <label className="ch247-field">
              <span className="ch247-field-label">Your name</span>
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} maxLength={200} />
            </label>
            <label className="ch247-field">
              <span className="ch247-field-label">Email</span>
              <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} maxLength={255} />
            </label>
            <label className="ch247-field">
              <span className="ch247-field-label">Phone (optional)</span>
              <input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} maxLength={40} />
            </label>

            {requiresShipping ? (
              <>
                <p className="ch247-note">This order contains a physical item, so a delivery address and a shipping method are required.</p>
                {(['line1', 'line2', 'city', 'region', 'postalCode', 'country'] as const).map((field) => (
                  <label key={field} className="ch247-field">
                    <span className="ch247-field-label">
                      {field === 'line1' ? 'Address line 1' : field === 'line2' ? 'Address line 2' : field === 'postalCode' ? 'Postal code' : field === 'country' ? 'Country (ISO code, e.g. NG)' : field.charAt(0).toUpperCase() + field.slice(1)}
                    </span>
                    <input
                      value={form.address[field]}
                      maxLength={200}
                      onChange={(event) => setForm({ ...form, address: { ...form.address, [field]: event.target.value } })}
                    />
                  </label>
                ))}
                <label className="ch247-field">
                  <span className="ch247-field-label">Shipping method</span>
                  <select value={form.shippingMethodId} onChange={(event) => setForm({ ...form, shippingMethodId: event.target.value })}>
                    <option value="">Choose a shipping method…</option>
                    {shippingMethods.map((method) => (
                      <option key={method.id} value={method.id}>
                        {method.name} — {money(method.priceAmount, method.currency)}
                      </option>
                    ))}
                  </select>
                </label>
                {shippingMethods.length === 0 ? (
                  <p className="ch247-note">
                    No shipping method this store configured matches that destination, so the order cannot be completed
                    yet. Choose another country or contact the store.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="ch247-note">Nothing in this order ships, so no delivery address is requested.</p>
            )}

            <label className="ch247-field">
              <span className="ch247-field-label">Discount code (optional)</span>
              <input value={form.discountCode} onChange={(event) => setForm({ ...form, discountCode: event.target.value })} maxLength={40} />
            </label>
            <label className="ch247-field">
              <span className="ch247-field-label">Order notes (optional)</span>
              <textarea rows={3} maxLength={2000} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
            </label>

            {checkoutError ? <p className="ch247-status-error" role="alert">{checkoutError}</p> : null}

            <button
              type="button"
              className="ch247-button"
              disabled={busy || form.name.trim().length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email) || (requiresShipping && (!form.shippingMethodId || !form.address.line1 || !form.address.country))}
              onClick={async () => {
                setBusy(true);
                setCheckoutError('');
                try {
                  const result = await apiFetch<ShopperOrderResult>(`/api/v1/public/stores/${storeSlug}/orders`, {
                    method: 'POST',
                    body: JSON.stringify({
                      items: lines.map((line) => ({ productId: line.product.id, quantity: line.quantity })),
                      customerName: form.name.trim(),
                      customerEmail: form.email.trim(),
                      customerPhone: form.phone.trim() || null,
                      shippingMethodId: requiresShipping ? form.shippingMethodId : null,
                      shippingAddress: requiresShipping
                        ? Object.fromEntries(Object.entries(form.address).filter(([, value]) => value.trim()).map(([key, value]) => [key, value.trim()]))
                        : null,
                      discountCode: form.discountCode.trim() || null,
                      notes: form.notes.trim() || null,
                    }),
                  });
                  setPlaced(result);
                } catch (err) {
                  setCheckoutError(err instanceof Error ? err.message : 'The order could not be placed.');
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? 'Placing order…' : 'Place order'}
            </button>
          </div>
        )}
      </section>

      <OrderLookup storeSlug={storeSlug} />
    </div>
  );
}

function OrderConfirmation({ store, result, email }: { store: PublicStore; result: ShopperOrderResult; email: string }) {
  const [status, setStatus] = useState<ShopperOrderStatus | null>(null);

  useEffect(() => {
    apiFetch<{ order: ShopperOrderStatus }>(`/api/v1/public/stores/${store.store.slug}/orders/${result.orderNumber}?email=${encodeURIComponent(email)}`)
      .then((response) => setStatus(response.order))
      .catch(() => setStatus(null));
  }, [email, result.orderNumber, store.store.slug]);

  return (
    <div className="ch247-page">
      <h1>Order {result.orderNumber} received</h1>
      <p>
        Total {money(result.totalAmount, result.currency)}.{' '}
        {store.store.paymentMode === 'provider'
          ? 'The store’s payment provider settles this order; fulfilment begins once the payment is verified.'
          : 'This store has no connected payment provider, so it will contact you to arrange payment.'}
      </p>
      <p className="ch247-page__hint">Keep your order number and the email you used — both are needed to track it later.</p>
      {status ? <OrderStatusBlock order={status} /> : null}
    </div>
  );
}

function OrderStatusBlock({ order }: { order: ShopperOrderStatus }) {
  return (
    <section className="ch247-card">
      <h2>Order status</h2>
      <p className="ch247-page__hint">
        Payment: <strong>{order.payment_status}</strong> · Status: <strong>{order.status}</strong>
        {order.paid_at ? ` · paid ${new Date(order.paid_at).toLocaleDateString()}` : ''}
      </p>
      <ul className="ch247-plainlist">
        {order.items.map((item) => (
          <li key={`${item.product_name}-${item.quantity}`}>
            {item.product_name} × {item.quantity} — {money(item.line_total_amount, order.currency)} ·{' '}
            {item.fulfilment_status ?? 'pending'}
            {item.carrier ? ` · ${item.carrier}` : ''}
            {item.tracking_number ? ` · ${item.tracking_number}` : ''}
          </li>
        ))}
      </ul>
      {order.downloads?.length ? (
        <>
          <h3>Your downloads</h3>
          <ul className="ch247-plainlist">
            {order.downloads.map((download) => (
              <li key={download.token}>
                <a href={`/api/v1/public/downloads/${download.token}`}>{download.product_name}</a>{' '}
                <span className="ch247-page__hint">
                  expires {new Date(download.expires_at).toLocaleDateString()} · {download.download_count}/{download.max_downloads} downloads used
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : order.payment_status === 'paid' ? null : (
        <p className="ch247-page__hint">Download links appear here once the payment is verified.</p>
      )}
      {order.downloadDelivery ? <p className="ch247-page__hint">Delivery email: {order.downloadDelivery.status} — {order.downloadDelivery.note}</p> : null}
    </section>
  );
}

function OrderLookup({ storeSlug }: { storeSlug: string }) {
  const [lookup, setLookup] = useState({ orderNumber: '', email: '' });
  const [order, setOrder] = useState<ShopperOrderStatus | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <section className="ch247-card">
      <h2>Track an order</h2>
      <p className="ch247-page__hint">An order number alone is not enough — the email used for the order must match.</p>
      <div className="ch247-inlineform">
        <label className="ch247-field">
          <span className="ch247-field-label">Order number</span>
          <input value={lookup.orderNumber} onChange={(event) => setLookup({ ...lookup, orderNumber: event.target.value })} maxLength={40} />
        </label>
        <label className="ch247-field">
          <span className="ch247-field-label">Email</span>
          <input type="email" value={lookup.email} onChange={(event) => setLookup({ ...lookup, email: event.target.value })} maxLength={255} />
        </label>
        <button
          type="button"
          className="ch247-button"
          disabled={busy || !lookup.orderNumber.trim() || !lookup.email.trim()}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              const response = await apiFetch<{ order: ShopperOrderStatus }>(
                `/api/v1/public/stores/${storeSlug}/orders/${encodeURIComponent(lookup.orderNumber.trim())}?email=${encodeURIComponent(lookup.email.trim())}`
              );
              setOrder(response.order);
            } catch (err) {
              setOrder(null);
              setError(err instanceof Error ? err.message : 'That order could not be found.');
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Looking…' : 'Find order'}
        </button>
      </div>
      {error ? <p className="ch247-status-error" role="alert">{error}</p> : null}
      {order ? <OrderStatusBlock order={order} /> : null}
    </section>
  );
}
