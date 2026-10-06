import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiFetch, ApiRequestError } from '../../lib/api';
import { getToken } from '../../lib/auth';
import { usePageMeta } from '../../lib/usePageMeta';
import { CatalogErrorBanner, CatalogLoadingBanner } from '../../components/CatalogStateBanner';
import { Feedback, useAction } from '../../components/platform/ui';
import { fetchPublishedPlans, money, type CartSummary, type OrderSummary } from '../../lib/platform-api';

/**
 * One cart and one checkout for every CloudHost247 service.
 *
 * Catalogue services (hosting plans, apps) and platform services (a domain being registered, a
 * builder/store/marketing plan, an approved expert quote) appear together because they share the
 * platform's single cart (`carts` + `cart_items` + `cart_service_items`). Every price shown here was
 * resolved by the server, and checkout re-resolves each one inside the transaction that creates the
 * order — so the amount on the invoice is the amount that was true at the moment of purchase.
 *
 * A line whose price or availability cannot be resolved is rendered as exactly that, and checkout
 * refuses while such a line is present rather than quietly dropping or re-pricing it.
 */
export default function CartPage() {
  usePageMeta('Cart & checkout', 'Review everything in your CloudHost247 cart and place one order.');
  const token = getToken();
  const navigate = useNavigate();
  const [cart, setCart] = useState<CartSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [order, setOrder] = useState<OrderSummary | null>(null);
  const action = useAction();

  const load = useCallback(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    apiFetch<{ cart: CartSummary }>('/api/v1/cart')
      .then((response) => {
        setCart(response.cart);
        setLoadError('');
      })
      .catch((err: Error) => setLoadError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => load(), [load]);

  /**
   * Deep link support: `/cart?add=<serviceKind>:<planCode>` (used by the plan cards and service
   * pages) adds that published plan as a cart service line. The plan is looked up through the public
   * plans endpoint — the client never sends a price — and the parameter is removed afterwards so a
   * refresh cannot add the same plan twice. A code that resolves to nothing says so instead of
   * silently doing nothing.
   */
  const consumedAdd = useRef(false);
  useEffect(() => {
    if (consumedAdd.current || !token) return;
    const raw = new URLSearchParams(window.location.search).get('add');
    if (!raw) return;
    consumedAdd.current = true;
    const [serviceKind, code] = raw.includes(':') ? (raw.split(':') as [string, string]) : ['website_builder', raw];
    window.history.replaceState({}, '', window.location.pathname);
    fetchPublishedPlans(serviceKind)
      .then(async (response) => {
        const plan = response.plans.find((entry) => entry.code === code);
        if (!plan) throw new Error(`No published ${serviceKind.replace(/_/g, ' ')} plan matches “${code}”.`);
        await apiFetch('/api/v1/cart/service-items', {
          method: 'POST',
          body: JSON.stringify({ serviceKind: 'platform_plan', serviceRef: plan.id }),
        });
        load();
        return `${plan.name} was added to your cart.`;
      })
      .catch((err: Error) => {
        void action.run(async () => {
          throw err;
        });
      });
  }, [action, load, token]);

  async function patchQuantity(kind: 'item' | 'service', id: string, quantity: number) {
    const path = kind === 'item' ? `/api/v1/cart/items/${id}` : `/api/v1/cart/service-items/${id}`;
    await action.run(async () => {
      const response = await apiFetch<{ cart: CartSummary }>(path, { method: 'PATCH', body: JSON.stringify({ quantity }) });
      setCart(response.cart);
    });
  }

  async function remove(kind: 'item' | 'service', id: string) {
    const path = kind === 'item' ? `/api/v1/cart/items/${id}` : `/api/v1/cart/service-items/${id}`;
    await action.run(async () => {
      const response = await apiFetch<{ cart: CartSummary }>(path, { method: 'DELETE' });
      setCart(response.cart);
    });
  }

  async function checkout() {
    await action.run(async () => {
      try {
        const response = await apiFetch<{ order: OrderSummary }>('/api/v1/orders', { method: 'POST', body: JSON.stringify({}) });
        setOrder(response.order);
        load();
      } catch (err) {
        if (err instanceof ApiRequestError && err.status === 401) {
          navigate('/login?next=/cart');
          return;
        }
        throw err;
      }
    });
  }

  if (!token) {
    return (
      <div className="ch247-page">
        <h1>Your cart</h1>
        <div className="ch247-state-banner">
          <p>Sign in to add services to your cart and check out.</p>
          <Link className="ch247-button" to="/login?next=/cart">
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  if (loading) return <CatalogLoadingBanner label="Loading your cart…" />;
  if (loadError) return <CatalogErrorBanner message={loadError} />;
  if (!cart) return null;

  const empty = cart.items.length === 0 && cart.serviceItems.length === 0;

  return (
    <div className="ch247-page">
      <h1>Your cart</h1>
      <p className="ch247-page__hint">
        Every CloudHost247 service — hosting, domains, websites, stores and marketing — is checked out here on one order
        and one invoice.
      </p>
      <Feedback error={action.error} message={action.message} />

      {order ? (
        <div className="ch247-banner ch247-banner--info" role="status">
          <p>
            Order <strong>{order.orderNumber}</strong> created for {money(order.totalAmount, order.currency)}.
          </p>
          {order.invoiceId ? (
            <p>
              Invoice <strong>{order.invoiceNumber}</strong> is ready — <Link to={`/invoices/${order.invoiceId}`}>pay it here</Link>{' '}
              to start fulfilment.
            </p>
          ) : null}
        </div>
      ) : null}

      {empty ? (
        <div className="ch247-state-banner">
          <p>Your cart is empty.</p>
          <p>
            <Link to="/hosting">Browse hosting</Link> · <Link to="/domains/search">Find a domain</Link> ·{' '}
            <Link to="/websites/builder">Build a website</Link>
          </p>
        </div>
      ) : (
        <>
          <div className="ch247-table-scroll">
            <table className="ch247-table">
              <caption className="ch247-visually-hidden">Items in your cart</caption>
              <thead>
                <tr>
                  <th scope="col">Service</th>
                  <th scope="col">Billing</th>
                  <th scope="col">Quantity</th>
                  <th scope="col">Line total</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {cart.items.map((line) => (
                  <tr key={line.id}>
                    <td>
                      <strong>{line.planName}</strong>
                      <div className="ch247-page__hint">{line.productName}</div>
                      {line.priceUnavailable ? <p className="ch247-status-error">{line.unavailableReason}</p> : null}
                    </td>
                    <td>{line.billingPeriod.replace('_', ' ')}</td>
                    <td>
                      <input
                        type="number"
                        min={1}
                        value={line.quantity}
                        aria-label={`Quantity for ${line.planName}`}
                        onChange={(event) => void patchQuantity('item', line.id, Math.max(1, Number(event.target.value) || 1))}
                        style={{ width: '5rem' }}
                      />
                    </td>
                    <td>{money(line.lineTotalAmount ?? line.unitPriceAmount, line.currency)}</td>
                    <td>
                      <button type="button" className="ch247-button ch247-button--ghost ch247-button--small" onClick={() => void remove('item', line.id)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
                {cart.serviceItems.map((line) => (
                  <tr key={line.id}>
                    <td>
                      <strong>{line.serviceName}</strong>
                      <div className="ch247-page__hint">{line.serviceKind.replace(/_/g, ' ')}</div>
                      {line.priceUnavailable ? <p className="ch247-status-error">{line.unavailableReason}</p> : null}
                    </td>
                    <td>{line.billingPeriod ? line.billingPeriod.replace('_', ' ') : 'one time'}</td>
                    <td>
                      <input
                        type="number"
                        min={1}
                        value={line.quantity}
                        aria-label={`Quantity for ${line.serviceName}`}
                        onChange={(event) => void patchQuantity('service', line.id, Math.max(1, Number(event.target.value) || 1))}
                        style={{ width: '5rem' }}
                      />
                    </td>
                    <td>{money(line.lineTotalAmount ?? line.unitPriceAmount, line.currency)}</td>
                    <td>
                      <button type="button" className="ch247-button ch247-button--ghost ch247-button--small" onClick={() => void remove('service', line.id)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="ch247-card">
            <div className="ch247-kv">
              <span>Subtotal</span>
              <span>{money(cart.subtotalAmount, cart.currency)}</span>
            </div>
            <div className="ch247-kv">
              <span>Items</span>
              <span>{cart.itemCount}</span>
            </div>
            <p className="ch247-page__hint">
              Taxes and discounts are not configured for platform orders on this deployment, so both are genuinely zero
              on the invoice.
            </p>
            {cart.hasUnavailableItems ? (
              <p className="ch247-status-error" role="alert">
                One or more lines cannot be priced or are no longer available, so checkout is disabled. Remove or refresh
                those lines and try again.
              </p>
            ) : null}
            <button
              type="button"
              className="ch247-button"
              disabled={action.busy || cart.hasUnavailableItems}
              onClick={() => void checkout()}
            >
              {action.busy ? 'Placing your order…' : 'Place order'}
            </button>
          </div>
        </>
      )}

      <p className="ch247-page__hint">
        Looking for something else? <Link to="/services">All your services</Link> · <Link to="/billing">Billing</Link>
      </p>
    </div>
  );
}
