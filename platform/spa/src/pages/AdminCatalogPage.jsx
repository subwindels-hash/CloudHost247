import React, { useCallback, useEffect, useState } from 'react';
import { adminApi, describeError } from '../lib/api.js';

const EMPTY_PRODUCT = { slug: '', name: '', category: '', description: '', status: 'draft', sortOrder: 0 };
const EMPTY_PLAN = { slug: '', name: '', description: '', status: 'draft', sortOrder: 0 };
const EMPTY_PRICE = { currency: 'USD', billingCycle: 'monthly', price: '', setupFee: '0', isActive: true };
const EMPTY_FEATURE = { label: '', value: '', icon: '', sortOrder: 0 };

export default function AdminCatalogPage() {
  const [products, setProducts] = useState(null);
  const [selected, setSelected] = useState(null);
  const [productForm, setProductForm] = useState(EMPTY_PRODUCT);
  const [planForm, setPlanForm] = useState(EMPTY_PLAN);
  const [priceForm, setPriceForm] = useState(EMPTY_PRICE);
  const [featureForm, setFeatureForm] = useState(EMPTY_FEATURE);
  const [editingProduct, setEditingProduct] = useState(false);
  const [editingPlan, setEditingPlan] = useState(null);
  const [showPriceForm, setShowPriceForm] = useState(false);
  const [showFeatureForm, setShowFeatureForm] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const loadProducts = useCallback(async (selectId) => {
    const res = await adminApi.catalogProducts();
    const rows = res.products ?? [];
    setProducts(rows);
    const id = selectId ?? selected?.id;
    if (id) {
      const detail = await adminApi.catalogProduct(id).catch(() => null);
      setSelected(detail ? { ...detail.product, plans: detail.plans ?? [] } : null);
    }
  }, [selected?.id]);

  useEffect(() => { loadProducts().catch((err) => setError(describeError(err))); }, [loadProducts]);

  const run = async (action, message) => {
    setError(''); setNotice(''); setBusy(true);
    try { await action(); setNotice(message); } catch (err) { setError(describeError(err)); } finally { setBusy(false); }
  };

  const selectProduct = async (id) => {
    setError('');
    try {
      const res = await adminApi.catalogProduct(id);
      setSelected({ ...res.product, plans: res.plans ?? [] });
      setEditingProduct(false);
      setProductForm({ slug: res.product.slug, name: res.product.name, category: res.product.category ?? '', description: res.product.description ?? '', status: res.product.status, sortOrder: res.product.sort_order ?? 0 });
    } catch (err) { setError(describeError(err)); }
  };

  const saveProduct = (event) => {
    event.preventDefault();
    const payload = { ...productForm, sortOrder: Number(productForm.sortOrder) };
    run(async () => {
      const res = editingProduct ? await adminApi.updateCatalogProduct(selected.id, payload) : await adminApi.createCatalogProduct(payload);
      setEditingProduct(false); setProductForm(EMPTY_PRODUCT);
      await loadProducts(res.product.id);
    }, editingProduct ? 'Product updated.' : 'Product created.');
  };

  const savePlan = (event) => {
    event.preventDefault();
    const payload = { ...planForm, sortOrder: Number(planForm.sortOrder) };
    run(async () => {
      if (editingPlan) await adminApi.updateCatalogPlan(editingPlan.id, payload);
      else await adminApi.createCatalogPlan(selected.id, payload);
      setEditingPlan(null); setPlanForm(EMPTY_PLAN); await loadProducts(selected.id);
    }, editingPlan ? 'Plan updated.' : 'Plan created.');
  };

  const savePrice = (event, plan) => {
    event.preventDefault();
    run(async () => {
      await adminApi.createCatalogPricing(plan.id, { ...priceForm, price: Number(priceForm.price), setupFee: Number(priceForm.setupFee) });
      setShowPriceForm(false); setPriceForm(EMPTY_PRICE); await loadProducts(selected.id);
    }, 'Pricing added.');
  };

  const saveFeature = (event, plan) => {
    event.preventDefault();
    run(async () => {
      const features = [...(plan.features ?? []), { ...featureForm, sortOrder: Number(featureForm.sortOrder) }];
      await adminApi.replaceCatalogFeatures(plan.id, features);
      setShowFeatureForm(false); setFeatureForm(EMPTY_FEATURE); await loadProducts(selected.id);
    }, 'Feature added.');
  };

  const productField = (key) => (event) => setProductForm((form) => ({ ...form, [key]: event.target.value }));
  const planField = (key) => (event) => setPlanForm((form) => ({ ...form, [key]: event.target.value }));

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Product catalogue</h1><p className="muted">Create and maintain products, plans, prices and plan features. Draft items never appear in the public catalogue.</p></div>
        <button type="button" className="btn btn-primary" onClick={() => { setSelected(null); setEditingProduct(true); setProductForm(EMPTY_PRODUCT); }}>New product</button>
      </div>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {notice && <div className="alert alert-success" role="status">{notice}</div>}

      <div className="admin-catalog-grid">
        <section className="card">
          <h2>Products</h2>
          {products === null ? <p className="muted">Loading…</p> : products.length === 0 ? <p className="muted">No products yet.</p> : (
            <div className="catalog-list">
              {products.map((product) => <button type="button" key={product.id} className={`catalog-list-item ${selected?.id === product.id ? 'selected' : ''}`} onClick={() => selectProduct(product.id)}><strong>{product.name}</strong><span className="muted small">{product.slug} · {product.status}</span></button>)}
            </div>
          )}
        </section>

        <section className="card">
          {!selected && !editingProduct ? <p className="muted">Select a product to edit it, or choose “New product”.</p> : (
            <form onSubmit={saveProduct}>
              <h2>{editingProduct ? 'New product' : `Edit ${selected?.name ?? 'product'}`}</h2>
              <div className="grid-2">
                <div className="field"><label htmlFor="product-name">Name</label><input id="product-name" value={productForm.name} onChange={productField('name')} required /></div>
                <div className="field"><label htmlFor="product-slug">Slug</label><input id="product-slug" value={productForm.slug} onChange={productField('slug')} pattern="[a-z0-9]+(-[a-z0-9]+)*" required /></div>
                <div className="field"><label htmlFor="product-category">Category</label><input id="product-category" value={productForm.category} onChange={productField('category')} /></div>
                <div className="field"><label htmlFor="product-status">Status</label><select id="product-status" value={productForm.status} onChange={productField('status')}><option value="draft">Draft</option><option value="active">Active</option><option value="archived">Archived</option></select></div>
              </div>
              <div className="field"><label htmlFor="product-description">Description</label><textarea id="product-description" rows="3" value={productForm.description} onChange={productField('description')} /></div>
              <div className="row row-wrap"><button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save product'}</button>{!editingProduct && <button type="button" className="btn btn-ghost" onClick={() => { setEditingProduct(false); setProductForm(EMPTY_PRODUCT); }}>Reset</button>}</div>
            </form>
          )}
        </section>
      </div>

      {selected && <section className="card">
        <div className="page-head"><div><h2>Plans for {selected.name}</h2><p className="muted">Each plan can have multiple billing cycles and customer-facing features.</p></div><button type="button" className="btn btn-primary" onClick={() => { setEditingPlan(null); setPlanForm(EMPTY_PLAN); }}>New plan</button></div>
        {(selected.plans ?? []).map((plan) => <article className="catalog-plan" key={plan.id}>
          <div className="catalog-plan-head"><div><h3>{plan.name} <span className={`status status-${plan.status === 'active' ? 'paid' : 'pending'}`}>{plan.status}</span></h3><p className="muted small">{plan.slug} · {plan.description || 'No description'}</p></div><button type="button" className="linklike" onClick={() => { setEditingPlan(plan); setPlanForm({ slug: plan.slug, name: plan.name, description: plan.description ?? '', status: plan.status, sortOrder: plan.sort_order ?? 0 }); }}>Edit</button></div>
          <div className="table-wrap"><table className="table"><thead><tr><th>Currency</th><th>Cycle</th><th>Price</th><th>Setup fee</th><th>Feature</th></tr></thead><tbody>{(plan.pricing ?? []).map((price) => <tr key={price.id}><td>{price.currency}</td><td>{price.billing_cycle}</td><td>{price.price}</td><td>{price.setup_fee}</td><td>—</td></tr>)}{(plan.features ?? []).map((feature) => <tr key={feature.id}><td colSpan="4">{feature.label}{feature.value ? `: ${feature.value}` : ''}</td><td>Feature</td></tr>)}{!(plan.pricing?.length || plan.features?.length) && <tr><td colSpan="5" className="muted">No pricing or features yet.</td></tr>}</tbody></table></div>
          <div className="row row-wrap"><button type="button" className="btn btn-ghost" onClick={() => { setShowPriceForm(plan.id); setPriceForm(EMPTY_PRICE); }}>Add pricing</button><button type="button" className="btn btn-ghost" onClick={() => { setShowFeatureForm(plan.id); setFeatureForm(EMPTY_FEATURE); }}>Add feature</button></div>
          {showPriceForm === plan.id && <form className="inline-form" onSubmit={(event) => savePrice(event, plan)}><select aria-label="Currency" value={priceForm.currency} onChange={(e) => setPriceForm({ ...priceForm, currency: e.target.value })}><option>USD</option><option>NGN</option><option>EUR</option><option>GBP</option></select><select aria-label="Billing cycle" value={priceForm.billingCycle} onChange={(e) => setPriceForm({ ...priceForm, billingCycle: e.target.value })}><option>monthly</option><option>quarterly</option><option>semiannual</option><option>annual</option><option>biennial</option><option>once</option></select><input aria-label="Price" type="number" min="0" step="0.01" placeholder="Price" value={priceForm.price} onChange={(e) => setPriceForm({ ...priceForm, price: e.target.value })} required /><input aria-label="Setup fee" type="number" min="0" step="0.01" placeholder="Setup fee" value={priceForm.setupFee} onChange={(e) => setPriceForm({ ...priceForm, setupFee: e.target.value })} /><button className="btn btn-primary" disabled={busy}>Add</button></form>}
          {showFeatureForm === plan.id && <form className="inline-form" onSubmit={(event) => saveFeature(event, plan)}><input aria-label="Feature label" placeholder="Feature label" value={featureForm.label} onChange={(e) => setFeatureForm({ ...featureForm, label: e.target.value })} required /><input aria-label="Feature value" placeholder="Value (optional)" value={featureForm.value} onChange={(e) => setFeatureForm({ ...featureForm, value: e.target.value })} /><button className="btn btn-primary" disabled={busy}>Add</button></form>}
        </article>)}
        {(selected.plans ?? []).length === 0 && <p className="muted">No plans yet.</p>}
        {editingPlan && <form className="card nested-form" onSubmit={savePlan}><h3>{editingPlan.id ? 'Edit plan' : 'New plan'}</h3><div className="grid-2"><div className="field"><label htmlFor="plan-name">Name</label><input id="plan-name" value={planForm.name} onChange={planField('name')} required /></div><div className="field"><label htmlFor="plan-slug">Slug</label><input id="plan-slug" value={planForm.slug} onChange={planField('slug')} pattern="[a-z0-9]+(-[a-z0-9]+)*" required /></div><div className="field"><label htmlFor="plan-status">Status</label><select id="plan-status" value={planForm.status} onChange={planField('status')}><option>draft</option><option>active</option><option>archived</option></select></div></div><div className="field"><label htmlFor="plan-description">Description</label><textarea id="plan-description" rows="3" value={planForm.description} onChange={planField('description')} /></div><button className="btn btn-primary" disabled={busy}>Save plan</button></form>}
      </section>}
    </div>
  );
}
