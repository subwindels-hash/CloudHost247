import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiFetch } from '../../lib/api';
import { getToken } from '../../lib/auth';
import { usePageMeta } from '../../lib/usePageMeta';
import { CatalogErrorBanner, CatalogLoadingBanner } from '../../components/CatalogStateBanner';
import { EmptyState, Feedback, Pill, statusTone, useAction } from '../../components/platform/ui';
import { formatDate, money, type StoreOrderLine, type StoreOrderRow, type StoreProduct, type StoreRow } from '../../lib/platform-api';

/**
 * Online Store (merchant side).
 *
 * Products are created as drafts and only go on sale when the merchant activates them. Digital
 * products must carry a real file (uploaded here as base64 and validated by magic bytes on the
 * server), physical products need a weight before they can be sold, and service products never
 * require shipping. Orders show payment state and per-line fulfilment, including the tracking a
 * physical line actually needs.
 *
 * Payment: `order_intake` collects the order and the merchant arranges payment directly;
 * `provider` means a connected gateway settles it through the verified webhook, which is also what
 * releases digital download links to the buyer.
 */
export default function StorePage() {
  const { storeId } = useParams<{ storeId: string }>();
  const token = getToken();

  if (storeId) return <StoreDetail storeId={storeId} token={token} />;
  return <StoreList token={token} />;
}

function StoreList({ token }: { token: string | null }) {
  usePageMeta('Online Store', 'Sell physical, digital and service products on CloudHost247.');
  const [stores, setStores] = useState<StoreRow[] | null>(null);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const action = useAction();

  const load = useCallback(() => {
    if (!token) return;
    apiFetch<{ stores: StoreRow[] }>('/api/v1/store/stores')
      .then((response) => setStores(response.stores))
      .catch((err: Error) => setError(err.message));
  }, [token]);

  useEffect(() => load(), [load]);

  if (!token) {
    return (
      <div className="ch247-page">
        <h1>Online Store</h1>
        <div className="ch247-state-banner">
          <p>Sell physical products, digital downloads and services with a CloudHost247 storefront. Sign in to open a store.</p>
          <Link className="ch247-button" to="/login?next=/websites/store">
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="ch247-page">
      <h1>Online Store</h1>
      <p className="ch247-page__hint">
        One storefront per brand. Inventory is decremented atomically at checkout, digital downloads are delivered by
        expiring token, and shipping is only ever required for physical products.
      </p>
      <Feedback error={action.error} message={action.message} />
      {error ? <CatalogErrorBanner message={error} /> : null}

      <section className="ch247-card">
        <h2>Open a store</h2>
        <div className="ch247-inlineform">
          <label className="ch247-field">
            <span className="ch247-field-label">Store name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={160} placeholder="Northwind Supplies" />
          </label>
          <button
            type="button"
            className="ch247-button"
            disabled={action.busy || name.trim().length < 2}
            onClick={() =>
              void action.run(async () => {
                const response = await apiFetch<{ store: StoreRow }>('/api/v1/store/stores', {
                  method: 'POST',
                  body: JSON.stringify({ name: name.trim() }),
                });
                setName('');
                load();
                return `${response.store.name} created as a draft. Activate it when you are ready to sell.`;
              })
            }
          >
            Create store
          </button>
        </div>
      </section>

      {stores === null ? (
        <CatalogLoadingBanner />
      ) : stores.length === 0 ? (
        <EmptyState>No stores yet.</EmptyState>
      ) : (
        <div className="ch247-service-grid">
          {stores.map((store) => (
            <article key={store.id} className="ch247-service-card">
              <h3>
                {store.name} <Pill tone={statusTone(store.status)}>{store.status}</Pill>
              </h3>
              <p>{store.description || 'No description yet.'}</p>
              <p className="ch247-page__hint">
                Currency {store.currency} · {store.payment_mode === 'provider' ? 'connected payment provider' : 'order intake (payment arranged directly)'}
              </p>
              <div className="ch247-service-card__footer">
                <Link className="ch247-button ch247-button--small" to={`/websites/store/${store.id}`}>
                  Manage
                </Link>
                {store.status === 'active' ? (
                  <a className="ch247-button ch247-button--ghost ch247-button--small" href={`/store/${store.slug}`} target="_blank" rel="noreferrer">
                    View storefront
                  </a>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

type Tab = 'products' | 'orders' | 'setup';

function StoreDetail({ storeId, token }: { storeId: string; token: string | null }) {
  usePageMeta('Store management', 'Products, orders, shipping, tax and payments.');
  const [store, setStore] = useState<StoreRow | null>(null);
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [orders, setOrders] = useState<StoreOrderRow[]>([]);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('products');
  const [draft, setDraft] = useState({ name: '', kind: 'digital' as StoreProduct['kind'], price: '', description: '', weight: '', sku: '' });
  const [file, setFile] = useState<{ filename: string; base64: string; contentType: string } | null>(null);
  const [openOrder, setOpenOrder] = useState<{ order: StoreOrderRow; items: StoreOrderLine[] } | null>(null);
  const [shipping, setShipping] = useState({ name: '', price: '', countries: '' });
  const [tax, setTax] = useState({ name: '', countryCode: '', ratePercent: '' });
  const action = useAction();

  const load = useCallback(() => {
    if (!token) return;
    apiFetch<{ store: StoreRow; products: StoreProduct[] }>(`/api/v1/store/stores/${storeId}`)
      .then((response) => {
        setStore(response.store);
        setProducts(response.products);
      })
      .catch((err: Error) => setError(err.message));
    apiFetch<{ orders: StoreOrderRow[] }>(`/api/v1/store/stores/${storeId}/orders`)
      .then((response) => setOrders(response.orders))
      .catch(() => undefined);
  }, [storeId, token]);

  useEffect(() => load(), [load]);

  if (!token) {
    return (
      <div className="ch247-page">
        <h1>Store</h1>
        <Link className="ch247-button" to="/login?next=/websites/store">
          Sign in
        </Link>
      </div>
    );
  }
  if (error) return <CatalogErrorBanner message={error} />;
  if (!store) return <CatalogLoadingBanner label="Loading your store…" />;

  return (
    <div className="ch247-page ch247-page--wide">
      <p className="ch247-page__hint">
        <Link to="/websites/store">← All stores</Link>
      </p>
      <h1>
        {store.name} <Pill tone={statusTone(store.status)}>{store.status}</Pill>
      </h1>
      <Feedback error={action.error} message={action.message} />

      <div className="ch247-inline-actions">
        <button
          type="button"
          className="ch247-button"
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              const next = store.status === 'active' ? 'draft' : 'active';
              await apiFetch(`/api/v1/store/stores/${store.id}`, { method: 'PATCH', body: JSON.stringify({ status: next }) });
              load();
              return next === 'active' ? 'Your storefront is live.' : 'Your storefront is no longer public.';
            })
          }
        >
          {store.status === 'active' ? 'Deactivate store' : 'Activate store'}
        </button>
        <button
          type="button"
          className="ch247-button ch247-button--ghost"
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              const next = store.payment_mode === 'provider' ? 'order_intake' : 'provider';
              await apiFetch(`/api/v1/store/stores/${store.id}`, { method: 'PATCH', body: JSON.stringify({ paymentMode: next }) });
              load();
              return next === 'provider'
                ? 'Provider mode selected. Payments settle when the gateway webhook verifies them.'
                : 'Order intake selected: orders are recorded and you arrange payment directly.';
            })
          }
        >
          Payments: {store.payment_mode === 'provider' ? 'connected provider' : 'order intake'}
        </button>
        {store.status === 'active' ? (
          <a className="ch247-button ch247-button--ghost" href={`/store/${store.slug}`} target="_blank" rel="noreferrer">
            View storefront
          </a>
        ) : null}
      </div>

      <div className="ch247-tabs" role="tablist" aria-label="Store sections">
        {(['products', 'orders', 'setup'] as Tab[]).map((entry) => (
          <button key={entry} type="button" role="tab" aria-selected={tab === entry} className={tab === entry ? 'is-active' : ''} onClick={() => setTab(entry)}>
            {entry === 'setup' ? 'Shipping, tax & discounts' : entry.charAt(0).toUpperCase() + entry.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'products' ? (
        <section className="ch247-card">
          <h2>Add a product</h2>
          <div className="ch247-form">
            <label className="ch247-field">
              <span className="ch247-field-label">Name</span>
              <input value={draft.name} maxLength={200} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </label>
            <label className="ch247-field">
              <span className="ch247-field-label">Type</span>
              <select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as StoreProduct['kind'] })}>
                <option value="digital">Digital download</option>
                <option value="physical">Physical product</option>
                <option value="service">Service</option>
              </select>
            </label>
            <label className="ch247-field">
              <span className="ch247-field-label">Price ({store.currency})</span>
              <input value={draft.price} inputMode="decimal" placeholder="19.00" onChange={(event) => setDraft({ ...draft, price: event.target.value })} />
            </label>
            <label className="ch247-field">
              <span className="ch247-field-label">Description</span>
              <textarea rows={3} maxLength={8000} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
            </label>
            {draft.kind === 'physical' ? (
              <label className="ch247-field">
                <span className="ch247-field-label">Weight (grams)</span>
                <input value={draft.weight} inputMode="numeric" onChange={(event) => setDraft({ ...draft, weight: event.target.value })} />
              </label>
            ) : null}
            {draft.kind === 'digital' ? (
              <label className="ch247-field">
                <span className="ch247-field-label">Downloadable file (required for a digital product)</span>
                <input
                  type="file"
                  onChange={async (event) => {
                    const selected = event.target.files?.[0];
                    if (!selected) {
                      setFile(null);
                      return;
                    }
                    const buffer = await selected.arrayBuffer();
                    const bytes = new Uint8Array(buffer);
                    let binary = '';
                    for (const byte of bytes) binary += String.fromCharCode(byte);
                    setFile({ filename: selected.name, base64: btoa(binary), contentType: selected.type || 'application/octet-stream' });
                  }}
                />
              </label>
            ) : null}
            <button
              type="button"
              className="ch247-button"
              disabled={action.busy || draft.name.trim().length < 1 || Number(draft.price) < 0 || draft.price === ''}
              onClick={() =>
                void action.run(async () => {
                  const payload: Record<string, unknown> = {
                    kind: draft.kind,
                    name: draft.name.trim(),
                    priceAmount: Number(draft.price),
                    description: draft.description.trim() || undefined,
                    sku: draft.sku.trim() || undefined,
                  };
                  if (draft.kind === 'physical') payload.weightGrams = Number(draft.weight) || undefined;
                  if (draft.kind === 'digital') {
                    if (!file) throw new Error('Attach the file customers will download.');
                    payload.download = file;
                  }
                  await apiFetch(`/api/v1/store/stores/${store.id}/products`, { method: 'POST', body: JSON.stringify(payload) });
                  setDraft({ name: '', kind: 'digital', price: '', description: '', weight: '', sku: '' });
                  setFile(null);
                  load();
                  return 'Product created as a draft. Activate it to sell it.';
                })
              }
            >
              Create product
            </button>
          </div>

          <h2>Products</h2>
          {products.length === 0 ? (
            <EmptyState>No products yet.</EmptyState>
          ) : (
            <div className="ch247-table-scroll">
              <table className="ch247-table">
                <thead>
                  <tr>
                    <th scope="col">Product</th>
                    <th scope="col">Type</th>
                    <th scope="col">Price</th>
                    <th scope="col">Stock</th>
                    <th scope="col">Status</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((product) => (
                    <tr key={product.id}>
                      <td>
                        <strong>{product.name}</strong>
                        {product.download_filename ? <div className="ch247-page__hint">File: {product.download_filename}</div> : null}
                      </td>
                      <td>{product.kind}</td>
                      <td>{money(product.price_amount, product.currency)}</td>
                      <td>
                        {product.track_inventory ? (
                          <span>
                            {product.inventory_quantity}{' '}
                            <button
                              type="button"
                              className="ch247-button ch247-button--ghost ch247-button--small"
                              onClick={() =>
                                void action.run(async () => {
                                  await apiFetch(`/api/v1/store/products/${product.id}/inventory`, {
                                    method: 'POST',
                                    body: JSON.stringify({ delta: 10, reason: 'restock' }),
                                  });
                                  load();
                                  return `Recorded a restock of 10 for ${product.name}.`;
                                })
                              }
                            >
                              +10
                            </button>
                          </span>
                        ) : (
                          'Not tracked'
                        )}
                      </td>
                      <td>
                        <Pill tone={statusTone(product.status)}>{product.status}</Pill>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="ch247-button ch247-button--ghost ch247-button--small"
                          disabled={action.busy}
                          onClick={() =>
                            void action.run(async () => {
                              const next = product.status === 'active' ? 'draft' : 'active';
                              await apiFetch(`/api/v1/store/products/${product.id}`, { method: 'PATCH', body: JSON.stringify({ status: next }) });
                              load();
                              return next === 'active' ? `${product.name} is on sale.` : `${product.name} is hidden from the storefront.`;
                            })
                          }
                        >
                          {product.status === 'active' ? 'Unpublish' : 'Publish'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {tab === 'orders' ? (
        <section className="ch247-card">
          <h2>Orders</h2>
          {orders.length === 0 ? (
            <EmptyState>No orders yet. Share your storefront link to start selling.</EmptyState>
          ) : (
            <div className="ch247-table-scroll">
              <table className="ch247-table">
                <thead>
                  <tr>
                    <th scope="col">Order</th>
                    <th scope="col">Customer</th>
                    <th scope="col">Total</th>
                    <th scope="col">Payment</th>
                    <th scope="col">Status</th>
                    <th scope="col">Placed</th>
                    <th scope="col" />
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr key={order.id}>
                      <td>{order.order_number}</td>
                      <td>
                        {order.customer_name}
                        <div className="ch247-page__hint">{order.customer_email}</div>
                      </td>
                      <td>{money(order.total_amount, order.currency)}</td>
                      <td>
                        <Pill tone={statusTone(order.payment_status)}>{order.payment_status}</Pill>
                      </td>
                      <td>
                        {order.status}
                        {order.pending_fulfilments ? <div className="ch247-page__hint">{order.pending_fulfilments} to fulfil</div> : null}
                      </td>
                      <td>{formatDate(order.created_at)}</td>
                      <td>
                        <button
                          type="button"
                          className="ch247-button ch247-button--ghost ch247-button--small"
                          onClick={() =>
                            void action.run(async () => {
                              const response = await apiFetch<{ order: StoreOrderRow; items: StoreOrderLine[] }>(
                                `/api/v1/store/stores/${store.id}/orders/${order.id}`
                              );
                              setOpenOrder({ order: response.order, items: response.items });
                            })
                          }
                        >
                          Open
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {openOrder ? (
            <div className="ch247-card">
              <h3>Order {openOrder.order.order_number}</h3>
              <ul className="ch247-plainlist">
                {openOrder.items.map((item) => (
                  <li key={item.id}>
                    {item.product_name_snapshot} <span className="ch247-page__hint">({item.kind})</span> — {item.fulfilment_status ?? 'pending'}{' '}
                    <button
                      type="button"
                      className="ch247-button ch247-button--ghost ch247-button--small"
                      disabled={action.busy}
                      onClick={() =>
                        void action.run(async () => {
                          const carrier = window.prompt('Carrier (for physical items)') ?? undefined;
                          const trackingNumber = carrier ? window.prompt('Tracking number') ?? undefined : undefined;
                          await apiFetch(`/api/v1/store/stores/${store.id}/orders/${openOrder.order.id}/items/${item.id}/fulfil`, {
                            method: 'POST',
                            body: JSON.stringify({ status: item.kind === 'physical' ? 'shipped' : 'delivered', carrier, trackingNumber }),
                          });
                          load();
                          return 'Fulfilment recorded.';
                        })
                      }
                    >
                      Mark fulfilled
                    </button>
                  </li>
                ))}
              </ul>
              <p className="ch247-page__hint">
                Digital lines are delivered automatically when the order is paid — they never need marking as shipped.
              </p>
            </div>
          ) : null}
        </section>
      ) : null}

      {tab === 'setup' ? (
        <section className="ch247-card">
          <h2>Shipping methods</h2>
          <div className="ch247-form">
            <label className="ch247-field">
              <span className="ch247-field-label">Name</span>
              <input value={shipping.name} onChange={(event) => setShipping({ ...shipping, name: event.target.value })} maxLength={120} />
            </label>
            <label className="ch247-field">
              <span className="ch247-field-label">Price ({store.currency})</span>
              <input value={shipping.price} inputMode="decimal" onChange={(event) => setShipping({ ...shipping, price: event.target.value })} />
            </label>
            <label className="ch247-field">
              <span className="ch247-field-label">Countries (comma separated ISO codes; empty = everywhere)</span>
              <input value={shipping.countries} onChange={(event) => setShipping({ ...shipping, countries: event.target.value })} placeholder="NG, GB, US" />
            </label>
            <button
              type="button"
              className="ch247-button"
              disabled={action.busy || shipping.name.trim().length < 1 || shipping.price === ''}
              onClick={() =>
                void action.run(async () => {
                  await apiFetch(`/api/v1/store/stores/${store.id}/shipping-methods`, {
                    method: 'POST',
                    body: JSON.stringify({
                      name: shipping.name.trim(),
                      priceAmount: Number(shipping.price),
                      countries: shipping.countries
                        .split(',')
                        .map((code) => code.trim().toUpperCase())
                        .filter(Boolean),
                    }),
                  });
                  setShipping({ name: '', price: '', countries: '' });
                  return 'Shipping method added.';
                })
              }
            >
              Add shipping method
            </button>
          </div>

          <h2>Tax rates</h2>
          <div className="ch247-form">
            <label className="ch247-field">
              <span className="ch247-field-label">Name</span>
              <input value={tax.name} onChange={(event) => setTax({ ...tax, name: event.target.value })} maxLength={120} />
            </label>
            <label className="ch247-field">
              <span className="ch247-field-label">Country (ISO code or * for store-wide)</span>
              <input value={tax.countryCode} onChange={(event) => setTax({ ...tax, countryCode: event.target.value.toUpperCase() })} maxLength={2} />
            </label>
            <label className="ch247-field">
              <span className="ch247-field-label">Rate %</span>
              <input value={tax.ratePercent} inputMode="decimal" onChange={(event) => setTax({ ...tax, ratePercent: event.target.value })} />
            </label>
            <button
              type="button"
              className="ch247-button"
              disabled={action.busy || tax.name.trim().length < 1 || tax.ratePercent === ''}
              onClick={() =>
                void action.run(async () => {
                  await apiFetch(`/api/v1/store/stores/${store.id}/tax-rates`, {
                    method: 'POST',
                    body: JSON.stringify({ name: tax.name.trim(), countryCode: tax.countryCode || '*', ratePercent: Number(tax.ratePercent) }),
                  });
                  setTax({ name: '', countryCode: '', ratePercent: '' });
                  return 'Tax rate added. A destination with no configured rate charges no tax.';
                })
              }
            >
              Add tax rate
            </button>
          </div>

          <p className="ch247-page__hint">
            Connecting a live payment gateway is an infrastructure step: the webhook endpoint
            <code> /api/v1/webhooks/store-payment</code> is already live and only applies an event whose signature the
            gateway adapter has verified.
          </p>
        </section>
      ) : null}
    </div>
  );
}
