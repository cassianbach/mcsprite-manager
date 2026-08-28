import { useCallback, useEffect, useState } from 'react';

/**
 * Loads/saves a studio's persisted data (stored on disk via the main process).
 * `data` is the raw JSON object previously saved with `set`.
 */
export function useStudio<T = unknown>(projectId: string, key: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    window.api.studio
      .get(projectId, key)
      .then((d) => {
        if (active) {
          setData(d as T);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [projectId, key]);

  const set = useCallback(
    async (value: unknown) => {
      await window.api.studio.set(projectId, key, value);
      setData(value as T);
      return { ok: true } as const;
    },
    [projectId, key],
  );

  return { data, set, loading };
}
