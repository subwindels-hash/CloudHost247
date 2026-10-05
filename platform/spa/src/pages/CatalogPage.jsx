import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { cartApi, catalogApi, describeError } from '../lib/api.js';
import { formatMoney } from '../lib/format.js';

const CYCLES = ['monthly', 'quarterly', 'semiannual', 'annual', 'biennial'];

/**
 * ?product=<slug> deep-links from the marketing site's "Choose Plan" buttons, pre-selecting that
 * product so the order flow starts at the right place.
 */
export default function CatalogPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const focusProduct = searchParams.get('product') || '';
  const [catalog, setCatalog] = useState(null);
  const [error, setError] = useState(false);
  const [cycles, setCycles] = useState({});
  const [adding, setAdding] = useState('');
  const [added, setAdded] = useState('');
  const [cartError, setCartError] = useState('');

  useEffect(() => {
    catalogApi.all()
      .then(setCatalog)
      .catch(() => setError(true));
  }, []);

  const cycleFor = (plan) => cycles[plan.slug]
    ?? (plan.pricing.some((p) => p.billingCycle === 'monthly') ? 'monthly' : plan.pricing[0]?.billingCycle);

  const priceFor = (plan) => plan.pricing.find((p) => p.billingCycle === cycleFor(plan));

  const addToCart = async (plan) => {
    setCartError('');
    setAdded('');
    setAdding(plan.slug);
    try {
      const cart = await cartApi.addItem(plan.slug, { billingCycle: cycleFor(plan) });
      setAdded(`${plan.name} added — ${cart.items.length} item(s) in your cart.`);
    } catch (err) {
      setCartError(describeError(err));
    } finally {
      setAdding('');
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Products</h1><p className="muted">Live from the published catalog.</p></div>
      </div>

      {error && <div className="alert alert-error" role="alert">Could not load the catalog.</div>}
      {focusProduct && catalog && (
        <div className="alert alert-success" role="status">
          Showing plans for <strong>{catalog.products.find((p) => p.slug === focusProduct)?.name ?? focusProduct}</strong>.{' '}
          <button type="button" className="linklike" onClick={() => setSearchParams({})}>Show all products</button>
        </div>
      )}
      {cartError && (
        <div className="alert alert-error" role="alert">
          {cartError} {/sign in/i.test(cartError) && <Link to="/account">Sign in</Link>}
        </div>
      )}
      {added && <div className="alert alert-success" role="status">{added} <Link to="/cart">Go to cart</Link></div>}

      {catalog === null && !error ? <p className="muted">Loading catalog…</p>
        : catalog.products.length === 0 ? (
          <div className="card"><p className="muted">No products are published yet. Add some from the admin catalog to see them here.</p></div>
        ) : catalog.products
          .filter((product) => !focusProduct || product.slug === focusProduct)
          .map((product) => (
          <section className="card" key={product.slug}>
            <h2>{product.name}</h2>
            <p className="muted">{product.description}</p>
            {product.plans.length === 0 ? <p className="muted">No plans published.</p> : (
              <div className="plans">
                {product.plans.map((plan) => {
                  const price = priceFor(plan);
                  const ready = plan.pricing.length > 0;
                  return (
                    <div className="plan-card" key={plan.slug}>
                      <h3>{plan.name}</h3>
                      {price && (
                        <p className="plan-price">
                          {formatMoney(price.price, price.currency)}
                          <span>/{cycleFor(plan)}</span>
                        </p>
                      )}
                      <ul>
                        {plan.features.slice(0, 5).map((f) => (
                          <li key={f.label}>{f.value ? `${f.label}: ${f.value}` : f.label}</li>
                        ))}
                      </ul>
                      {ready ? (
                        <>
                          <div className="field">
                            <label htmlFor={`cycle-${plan.slug}`}>Billing cycle</label>
                            <select
                              id={`cycle-${plan.slug}`}
                              value={cycleFor(plan)}
                              onChange={(event) => setCycles((c) => ({ ...c, [plan.slug]: event.target.value }))}
                            >
                              {plan.pricing.map((p) => (
                                <option key={p.billingCycle} value={p.billingCycle}>
                                  {p.billingCycle} — {formatMoney(p.price, p.currency)}
                                </option>
                              ))}
                            </select>
                          </div>
                          <button
                            type="button"
                            className="btn btn-primary"
                            disabled={adding === plan.slug}
                            onClick={() => addToCart(plan)}
                          >
                            {adding === plan.slug ? 'Adding…' : 'Add to cart'}
                          </button>
                        </>
                      ) : (
                        <p className="muted">No published pricing for this plan yet.</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        ))}
    </div>
  );
}
