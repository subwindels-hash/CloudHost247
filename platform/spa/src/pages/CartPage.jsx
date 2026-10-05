import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { cartApi, describeError } from '../lib/api.js';
import { formatMoney } from '../lib/format.js';

/**
 * The cart and checkout step.
 *
 * Checkout is a single server-side transaction (cart -> order + invoice + ledger charge), so this
 * page never computes a total of its own: prices come from the server's cart, and after checkout it
 * sends the customer straight to the invoice that was created.
 */
export default function CartPage() {
  const navigate = useNavigate();
  const [cart, setCart] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [checkingOut, setCheckingOut] = useState(false);

  const load = useCallback(async () => {
    try {
      setCart(await cartApi.get());
    } catch (err) {
      setError(describeError(err));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const changeQuantity = async (item, quantity) => {
    setError('');
    setBusy(item.id);
    try {
      setCart(await cartApi.updateItem(item.id, quantity));
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy('');
    }
  };

  const remove = async (item) => {
    setError('');
    setBusy(item.id);
    try {
      await cartApi.removeItem(item.id);
      await load();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy('');
    }
  };

  const checkout = async () => {
    setError('');
    setCheckingOut(true);
    try {
      const order = await cartApi.checkout();
      // The invoice is what the customer can pay; the order itself is the receipt trail.
      if (order?.invoiceId) navigate(`/billing/${encodeURIComponent(order.invoiceId)}`);
      else navigate('/billing');
    } catch (err) {
      setError(describeError(err));
      await load(); // a failed checkout can mean the cart changed underneath us
    } finally {
      setCheckingOut(false);
    }
  };

  const items = cart?.items ?? [];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Cart</h1>
          <p className="muted">Items are priced from the published catalog when they are added.</p>
        </div>
      </div>

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      {cart === null && !error ? <p className="muted">Loading cart…</p> : items.length === 0 ? (
        <div className="card">
          <p className="muted">Your cart is empty.</p>
          <Link className="btn btn-primary" to="/catalog">Browse products</Link>
        </div>
      ) : (
        <div className="grid-2">
          <section className="card">
            <h2>Items</h2>
            <ul className="list">
              {items.map((item) => (
                <li key={item.id} className="cart-item">
                  <div>
                    <strong>{item.planName ?? item.productName ?? 'Plan'}</strong>
                    <p className="muted">
                      {[item.productName, item.billingCycle, item.domain].filter(Boolean).join(' · ')}
                    </p>
                    <p className="muted">
                      {formatMoney(item.unitPrice, cart.currency)}
                      {item.setupFee > 0 ? ` + ${formatMoney(item.setupFee, cart.currency)} setup` : ''}
                    </p>
                  </div>
                  <div className="cart-item-actions">
                    <label className="muted" htmlFor={`qty-${item.id}`}>Qty</label>
                    <input
                      id={`qty-${item.id}`}
                      type="number"
                      min="1"
                      max="20"
                      value={item.quantity}
                      disabled={busy === item.id}
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        if (Number.isInteger(next) && next >= 1 && next <= 20) changeQuantity(item, next);
                      }}
                    />
                    <button
                      type="button"
                      className="linklike"
                      disabled={busy === item.id}
                      onClick={() => remove(item)}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="card">
            <h2>Summary</h2>
            <dl className="detail">
              <div><dt>Subtotal</dt><dd>{formatMoney(cart.subtotal, cart.currency)}</dd></div>
              <div><dt>Items</dt><dd>{items.length}</dd></div>
            </dl>
            <p className="muted">
              Totals are recalculated by the server at checkout; nothing here is trusted for billing.
            </p>
            <button type="button" className="btn btn-primary" onClick={checkout} disabled={checkingOut}>
              {checkingOut ? 'Creating your order…' : 'Checkout'}
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
