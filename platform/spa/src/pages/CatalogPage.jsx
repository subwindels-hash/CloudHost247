import React, { useEffect, useState } from 'react';
import { catalogApi } from '../lib/api.js';

export default function CatalogPage() {
  const [catalog, setCatalog] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    catalogApi.all()
      .then(setCatalog)
      .catch(() => setError(true));
  }, []);

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Products</h1><p className="muted">Live from the published catalog.</p></div>
      </div>

      {error && <div className="alert alert-error" role="alert">Could not load the catalog.</div>}

      {catalog === null && !error ? <p className="muted">Loading catalog…</p>
        : catalog.products.length === 0 ? (
          <div className="card"><p className="muted">No products are published yet. Add some from the admin catalog to see them here.</p></div>
        ) : catalog.products.map((product) => (
          <section className="card" key={product.slug}>
            <h2>{product.name}</h2>
            <p className="muted">{product.description}</p>
            {product.plans.length === 0 ? <p className="muted">No plans published.</p> : (
              <div className="plans">
                {product.plans.map((plan) => {
                  const monthly = plan.pricing.find((p) => p.billingCycle === 'monthly');
                  return (
                    <div className="plan-card" key={plan.slug}>
                      <h3>{plan.name}</h3>
                      {monthly && <p className="plan-price">{monthly.currency} {monthly.price.toFixed(2)}<span>/mo</span></p>}
                      <ul>
                        {plan.features.slice(0, 5).map((f) => (
                          <li key={f.label}>{f.value ? `${f.label}: ${f.value}` : f.label}</li>
                        ))}
                      </ul>
                      <a className="btn btn-primary" href="/register.html">Order</a>
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
