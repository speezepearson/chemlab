import { useEffect, useState } from 'react';
import { savedAgo, stored } from '../game/save';

/**
 * How long ago the lab was last saved to local storage, by the header's Export button. It's saved every couple of
 * seconds, so this nearly always says just now; it's there to show when saving has stopped working (storage full or
 * blocked), when it falls behind and turns a warning color, and its tooltip says why.
 */
export function SaveStatus() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const ago = stored.at === null ? null : Math.max(0, now - stored.at);
  const stale = stored.error !== null || ago === null || ago >= 10_000;
  return (
    <span
      className={stale ? 'saved stale' : 'saved'}
      title={stored.error ? `Saving failed: ${stored.error}` : 'The lab is saved in this browser every 2 s'}
    >
      {savedAgo(ago)}
    </span>
  );
}
