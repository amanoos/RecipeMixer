import { useEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router';

/**
 * After the user goes to another page, moves keyboard and screen-reader focus to the main region (and
 * to the top of the page, unless they used Back or Forward). It compares only the path, so typing in
 * a search box or changing a filter, which only change the query string, never moves focus.
 */
export function RouteFocus({ targetId }: { targetId: string }) {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();
  const shownPath = useRef(pathname);

  useEffect(() => {
    if (shownPath.current === pathname) return;
    shownPath.current = pathname;
    if (navigationType !== 'POP') window.scrollTo(0, 0);
    document.getElementById(targetId)?.focus({ preventScroll: true });
  }, [pathname, navigationType, targetId]);

  return null;
}
