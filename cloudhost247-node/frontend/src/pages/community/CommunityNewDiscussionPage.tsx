import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { usePageMeta } from '../../lib/usePageMeta';
import { communityApi, type CommunityCategory } from '../../lib/community-api';
import { Markdown } from '../../lib/markdown';
import { useAuthState } from '../../layout/useAuthState';
import { CommunityBreadcrumb, LoadError, Loading } from '../../components/community/CommunityUI';

/**
 * `/community/new-discussion` — the composer.
 *
 * Signed-out visitors are told to sign in rather than shown a form that would 401 on submit, and the
 * server re-checks everything anyway. Categories the signed-in member may not post in (Announcements
 * is staff-only) are still listed, with the reason stated, instead of silently missing.
 */
export default function CommunityNewDiscussionPage() {
  usePageMeta('Start a discussion', 'Ask the CloudHost247 community a question or share what you have built.');
  const { token, user } = useAuthState();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [categories, setCategories] = useState<CommunityCategory[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState({ categoryId: params.get('category') ?? '', title: '', body: '', tags: '' });
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restricted, setRestricted] = useState<string | null>(null);

  useEffect(() => {
    communityApi
      .categories()
      .then((result) => {
        setCategories(result.categories);
        setForm((current) => {
          if (current.categoryId || result.categories.length === 0) return current;
          const firstPostable = result.categories.find((category) => !category.staffOnlyPosting) ?? result.categories[0]!;
          return { ...current, categoryId: firstPostable.id };
        });
      })
      .catch((loadFailure: unknown) => setLoadError(loadFailure instanceof Error ? loadFailure.message : 'Categories could not be loaded.'));
  }, []);

  useEffect(() => {
    if (!token) return;
    communityApi
      .me()
      .then((identity) => setRestricted(identity.restrictedUntil ? identity.restrictionReason || 'Posting is restricted.' : null))
      .catch(() => undefined);
  }, [token]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await communityApi.createDiscussion({
        categoryId: form.categoryId,
        title: form.title.trim(),
        body: form.body,
        tags: form.tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean)
          .slice(0, 5),
      });
      navigate(`/community/discussion/${created.slug}`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Your discussion could not be published.');
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <div className="community-page">
        <div className="community-wrap">
          <CommunityBreadcrumb trail={[{ label: 'New discussion' }]} />
          <div className="community-composer">
            <h1>Sign in to start a discussion</h1>
            <p className="community-composer__hint">
              Posting uses your existing CloudHost247 account — no second registration, no separate forum password.
            </p>
            <div className="community-form__actions">
              <Link className="community-button" to="/login">Sign in</Link>
              <Link className="community-button community-button--quiet" to="/register">Create an account</Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="community-page">
      <div className="community-wrap">
        <CommunityBreadcrumb trail={[{ label: 'New discussion' }]} />
        <header>
          <p className="community-eyebrow">Community</p>
          <h1>Start a discussion</h1>
          <p className="community-form__hint">
            Posting as {user?.fullName ?? 'your CloudHost247 account'}. Be specific: the exact error, the versions and
            what you have already tried. Code belongs in fenced blocks.
          </p>
        </header>

        {restricted && <LoadError message={`Your community posting is restricted: ${restricted}. You can still read and search.`} />}
        {loadError && <LoadError message={loadError} />}
        {!categories && !loadError && <Loading label="Loading categories…" />}

        {categories && (
          <form className="community-form community-section" onSubmit={submit}>
            <fieldset>
              <legend>Discussion</legend>
              <div className="community-form__row">
                <label>
                  Category
                  <select
                    value={form.categoryId}
                    onChange={(event) => setForm({ ...form, categoryId: event.target.value })}
                    required
                  >
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                        {category.staffOnlyPosting ? ' (staff only)' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Tags (up to five, comma separated)
                  <input
                    type="text"
                    value={form.tags}
                    maxLength={160}
                    onChange={(event) => setForm({ ...form, tags: event.target.value })}
                    placeholder="dns, cpanel, ssl"
                  />
                </label>
              </div>
              {categories
                .filter((category) => category.id === form.categoryId)
                .map((category) => (
                  <p key={category.id} className="community-form__hint">
                    {category.description}
                    {category.acceptsSolutions ? ' Accepted solutions are enabled in this category.' : ''}
                    {category.staffOnlyPosting ? ' Only CloudHost247 staff can post here — choose another category to ask a question.' : ''}
                  </p>
                ))}
              <label>
                Title
                <input
                  type="text"
                  value={form.title}
                  minLength={8}
                  maxLength={200}
                  onChange={(event) => setForm({ ...form, title: event.target.value })}
                  placeholder="e.g. cPanel redirects to HTTPS but the padlock still shows a warning"
                  required
                />
              </label>
              <label>
                Question or description
                <textarea
                  value={form.body}
                  maxLength={20_000}
                  onChange={(event) => setForm({ ...form, body: event.target.value })}
                  placeholder={'What are you trying to do?\n\nWhat have you already tried?\n\n```\nserver error text\n```'}
                  required
                />
              </label>
              <p className="community-form__hint">
                Markdown is supported. HTML is displayed as text and never executed. Mention a member with @username.
              </p>
              {preview && (
                <div className="community-composer__preview">
                  <Markdown source={form.body || '_Nothing to preview yet._'} />
                </div>
              )}
            </fieldset>
            {error && <p className="community-error" role="alert">{error}</p>}
            <div className="community-form__actions">
              <button type="submit" className="community-button" disabled={busy || Boolean(restricted)}>
                {busy ? 'Publishing…' : 'Publish discussion'}
              </button>
              <button
                type="button"
                className="community-button community-button--quiet"
                onClick={() => setPreview((current) => !current)}
              >
                {preview ? 'Hide preview' : 'Preview'}
              </button>
              <Link className="community-button community-button--quiet" to="/community">Cancel</Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
