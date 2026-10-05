import React, { useCallback, useEffect, useState } from 'react';
import { adminApi, describeError } from '../lib/api.js';
import { formatDate } from '../lib/format.js';

const EMPTY = {
  kind: 'kb', slug: '', title: '', category: '', author: '', summary: '', body: '',
  status: 'draft', searchKeywords: '',
};

export default function AdminContentPage() {
  const [articles, setArticles] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await adminApi.articles();
      setArticles(res.articles ?? []);
    } catch (err) {
      setError(describeError(err));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  const startNew = () => { setForm(EMPTY); setEditingId(''); setShowForm(true); setNotice(''); };

  const startEdit = (a) => {
    setForm({
      kind: a.kind, slug: a.slug, title: a.title, category: a.category, author: a.author,
      summary: a.summary ?? '', body: a.body ?? '', status: a.status, searchKeywords: a.searchKeywords ?? '',
    });
    setEditingId(a.id);
    setShowForm(true);
    setNotice('');
  };

  const submit = async (event) => {
    event.preventDefault();
    setError(''); setNotice(''); setBusy(true);
    const payload = { ...form };
    if (!payload.category) delete payload.category;
    if (!payload.author) delete payload.author;
    if (!payload.summary) delete payload.summary;
    if (!payload.searchKeywords) delete payload.searchKeywords;
    try {
      if (editingId) {
        await adminApi.updateArticle(editingId, payload);
        setNotice('Article updated.');
      } else {
        await adminApi.createArticle(payload);
        setNotice('Article created.');
      }
      setShowForm(false);
      setForm(EMPTY);
      setEditingId('');
      await load();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleStatus = async (a) => {
    setError(''); setBusy(true);
    try {
      await adminApi.updateArticle(a.id, { status: a.status === 'published' ? 'draft' : 'published' });
      await load();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (a) => {
    setError(''); setBusy(true);
    try {
      await adminApi.deleteArticle(a.id);
      setNotice('Article deleted.');
      await load();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Website content</h1>
          <p className="muted">Knowledgebase and blog articles published to the live site. Nothing appears publicly until it is published here.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={startNew}>New article</button>
      </div>

      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {notice && <div className="alert alert-success" role="status">{notice}</div>}

      {showForm && (
        <form className="card" onSubmit={submit}>
          <h2>{editingId ? 'Edit article' : 'New article'}</h2>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="a-kind">Type</label>
              <select id="a-kind" value={form.kind} onChange={set('kind')}>
                <option value="kb">Knowledgebase</option>
                <option value="blog">Blog</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="a-status">Status</label>
              <select id="a-status" value={form.status} onChange={set('status')}>
                <option value="draft">Draft</option>
                <option value="published">Published</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="a-title">Title</label>
              <input id="a-title" value={form.title} onChange={set('title')} required />
            </div>
            <div className="field">
              <label htmlFor="a-slug">Slug</label>
              <input id="a-slug" value={form.slug} onChange={set('slug')} required
                placeholder="lowercase-with-hyphens" pattern="[a-z0-9]+(-[a-z0-9]+)*" />
            </div>
            <div className="field">
              <label htmlFor="a-category">Category</label>
              <input id="a-category" value={form.category} onChange={set('category')} placeholder="e.g. Billing" />
            </div>
            <div className="field">
              <label htmlFor="a-author">Author</label>
              <input id="a-author" value={form.author} onChange={set('author')} placeholder="CloudHost247 Team" />
            </div>
          </div>
          <div className="field">
            <label htmlFor="a-summary">Summary</label>
            <input id="a-summary" value={form.summary} onChange={set('summary')} />
          </div>
          <div className="field">
            <label htmlFor="a-keywords">Search keywords</label>
            <input id="a-keywords" value={form.searchKeywords} onChange={set('searchKeywords')} placeholder="comma, separated, terms" />
          </div>
          <div className="field">
            <label htmlFor="a-body">Body (markdown-lite: ## headings, - lists)</label>
            <textarea id="a-body" rows="12" value={form.body} onChange={set('body')} required />
          </div>
          <div className="row row-wrap">
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save article'}</button>
            <button type="button" className="btn btn-ghost" onClick={() => { setShowForm(false); setEditingId(''); }}>Cancel</button>
          </div>
        </form>
      )}

      <div className="card">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Title</th><th scope="col">Type</th><th scope="col">Category</th>
                <th scope="col">Status</th><th scope="col">Updated</th><th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {articles === null ? (
                <tr><td colSpan="6" className="muted">Loading…</td></tr>
              ) : articles.length === 0 ? (
                <tr><td colSpan="6" className="muted">No articles yet. Create the first one.</td></tr>
              ) : articles.map((a) => (
                <tr key={a.id}>
                  <td>
                    <strong>{a.title}</strong>
                    <span className="muted small"> /{a.kind === 'blog' ? 'blog' : 'kb'}/{a.slug}</span>
                  </td>
                  <td>{a.kind === 'blog' ? 'Blog' : 'KB'}</td>
                  <td>{a.category}</td>
                  <td><span className={`status status-${a.status === 'published' ? 'paid' : 'pending'}`}>{a.status}</span></td>
                  <td>{formatDate(a.updatedAt)}</td>
                  <td>
                    <div className="row row-wrap" style={{ width: 'auto' }}>
                      <button type="button" className="linklike" onClick={() => startEdit(a)}>Edit</button>
                      <button type="button" className="linklike" onClick={() => toggleStatus(a)} disabled={busy}>
                        {a.status === 'published' ? 'Unpublish' : 'Publish'}
                      </button>
                      <button type="button" className="linklike" onClick={() => remove(a)} disabled={busy}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
