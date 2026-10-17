import { useEffect } from 'react';

export const APP_NAME = 'RecipeMixer';

/** Sets the browser tab and screen-reader title to "Page - RecipeMixer" while the page is shown. */
export function useDocumentTitle(title: string | null): void {
  useEffect(() => {
    if (!title) return;
    const previous = document.title;
    document.title = `${title} - ${APP_NAME}`;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
