import { useEffect, useState } from 'react';
import apiClient from '../api/client';

/**
 * Fetch the logged-in user's net-worth snapshots (last 30 days, ascending)
 * from `GET /snapshots` and shape them for charting.
 *
 * Each snapshot is augmented with a short `label` (e.g. "14 Jun") derived
 * from its date, suitable for an X axis.
 *
 * A module-level cache holds the result for the session so multiple pages
 * mounting this hook (Dashboard, Portfolio, Investments) share a single
 * network request rather than each re-fetching.
 *
 * @returns {{ snapshots: Array, loading: boolean, error: string|null }}
 */

let cache = null; // { snapshots } once resolved
let inflight = null; // shared promise while the first fetch is pending

function shape(raw) {
  const list = Array.isArray(raw?.snapshots) ? raw.snapshots : [];
  return list.map((item) => ({
    ...item,
    label: new Date(item.date).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
    }),
  }));
}

async function fetchSnapshots() {
  if (cache) return cache;
  if (!inflight) {
    inflight = apiClient
      .get('/snapshots')
      .then(({ data }) => {
        cache = { snapshots: shape(data) };
        return cache;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** Clear the module cache (used by tests / after data mutations if needed). */
export function clearSnapshotCache() {
  cache = null;
  inflight = null;
}

export default function useSnapshots() {
  const [snapshots, setSnapshots] = useState(cache ? cache.snapshots : []);
  const [loading, setLoading] = useState(!cache);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    if (cache) {
      setSnapshots(cache.snapshots);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    fetchSnapshots()
      .then((result) => {
        if (!cancelled) {
          setSnapshots(result.snapshots);
          setError(null);
        }
      })
      .catch(() => {
        // Snapshots are decorative; on failure render nothing rather than
        // surfacing an error across pages.
        if (!cancelled) {
          setSnapshots([]);
          setError('Unable to load history');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { snapshots, loading, error };
}
