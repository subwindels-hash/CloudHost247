import { useEffect, useState } from 'react';
import { apiFetch, ApiRequestError } from './api';

export type ApiResourceState<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string; httpStatus?: number }
  | { status: 'success'; data: T };

/**
 * Shared data-fetching hook for every catalog-driven page. Every page using this hook gets the
 * same three real states for free — loading, error (including a malformed/unparsable response,
 * since `apiFetch`'s JSON parsing failure surfaces as a rejected promise here too), and success —
 * instead of each page re-implementing its own ad hoc fetch/try-catch and risking a silent
 * fallback to blank or fabricated content. "Empty" (a successful response with no items) is left
 * to the calling page to render, since what counts as "empty" and how to word it is
 * content-specific (e.g. "no plans configured yet" vs. "no service categories yet").
 */
export function useApiResource<T>(path: string): ApiResourceState<T> {
  const [state, setState] = useState<ApiResourceState<T>>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });

    apiFetch<T>(path)
      .then((data) => {
        if (!cancelled) setState({ status: 'success', data });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: 'error',
            message: error instanceof Error ? error.message : 'Something went wrong loading this page.',
            httpStatus: error instanceof ApiRequestError ? error.status : undefined,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [path]);

  return state;
}
