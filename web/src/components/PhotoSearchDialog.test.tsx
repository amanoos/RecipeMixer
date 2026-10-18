import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PhotoChoice } from '@/lib/types';
import { apiResponse, findCall, stubFetch } from '@/test-utils';
import { PhotoSearchDialog } from './PhotoSearchDialog';

afterEach(() => {
  vi.unstubAllGlobals();
});

const photo = (n: number, overrides: Partial<PhotoChoice> = {}): PhotoChoice => ({
  token: `token-${n}`,
  thumbnail: 'data:image/webp;base64,AAAA',
  title: `Soup photo ${n}`,
  creator: `Author ${n}`,
  licence: 'CC BY 2.0',
  licenceUrl: 'https://creativecommons.org/licenses/by/2.0',
  landingUrl: `https://www.flickr.com/photos/1/${n}`,
  provider: 'Openverse',
  ...overrides,
});

const SEARCH = 'GET /api/image-search?q=Tomato+Soup';

function renderDialog(props: Partial<Parameters<typeof PhotoSearchDialog>[0]> = {}) {
  const onChoose = vi.fn();
  const onClose = vi.fn();
  const view = render(<PhotoSearchDialog initialQuery="Tomato Soup" onChoose={onChoose} onClose={onClose} {...props} />);
  return { onChoose, onClose, ...view };
}

describe('PhotoSearchDialog', () => {
  it('searches for the title at once and lists the photos with their credit', async () => {
    const mock = stubFetch({ [SEARCH]: () => apiResponse({ items: [photo(1), photo(2, { creator: null })] }) });
    renderDialog();

    expect(await screen.findByText('Soup photo 1')).toBeInTheDocument();
    expect(screen.getByText('by Author 1 · CC BY 2.0 · Openverse')).toBeInTheDocument();
    expect(screen.getByText('CC BY 2.0 · Openverse')).toBeInTheDocument();
    expect(findCall(mock, SEARCH)).toBeDefined();
    expect(screen.getByLabelText('Search for')).toHaveValue('Tomato Soup');
  });

  it('says what is sent and where', () => {
    stubFetch({ [SEARCH]: () => apiResponse({ items: [] }) });
    renderDialog();
    expect(screen.getByText(/sent to Wikimedia Commons and Openverse/)).toBeInTheDocument();
    expect(screen.getByText(/saved with credit to its author/)).toBeInTheDocument();
  });

  it('shows the pictures from inline data and links each photo page safely', async () => {
    stubFetch({ [SEARCH]: () => apiResponse({ items: [photo(1)] }) });
    const { container } = renderDialog();
    await screen.findByText('Soup photo 1');
    expect(container.querySelector('img')).toHaveAttribute('src', 'data:image/webp;base64,AAAA');
    const link = screen.getByRole('link', { name: 'Open the page of Soup photo 1' });
    expect(link).toHaveAttribute('href', 'https://www.flickr.com/photos/1/1');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('hands the chosen photo to the caller', async () => {
    const user = userEvent.setup();
    stubFetch({ [SEARCH]: () => apiResponse({ items: [photo(1), photo(2)] }) });
    const { onChoose } = renderDialog();
    await user.click(await screen.findByRole('button', { name: 'Use the photo Soup photo 2' }));
    expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({ token: 'token-2' }));
  });

  it('stays open and shows the problem when the choice cannot be saved, then lets the user try again', async () => {
    const user = userEvent.setup();
    stubFetch({ [SEARCH]: () => apiResponse({ items: [photo(1)] }) });
    const onChoose = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(undefined);
    renderDialog({ onChoose });

    await user.click(await screen.findByRole('button', { name: 'Use the photo Soup photo 1' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server');
    await user.click(screen.getByRole('button', { name: 'Use the photo Soup photo 1' }));
    expect(onChoose).toHaveBeenCalledTimes(2);
  });

  it('says so when no photos are found, and suggests the alternatives', async () => {
    stubFetch({ [SEARCH]: () => apiResponse({ items: [] }) });
    renderDialog();
    expect(await screen.findByText(/No photos found for/)).toHaveTextContent('Tomato Soup');
    expect(screen.getByText(/upload a photo or paste a link/)).toBeInTheDocument();
  });

  it('searches again with other words', async () => {
    const user = userEvent.setup();
    const mock = stubFetch({
      [SEARCH]: () => apiResponse({ items: [photo(1)] }),
      'GET /api/image-search?q=tomato+basil+soup': () => apiResponse({ items: [photo(7)] }),
    });
    renderDialog();
    await screen.findByText('Soup photo 1');

    const box = screen.getByLabelText('Search for');
    await user.clear(box);
    await user.type(box, 'tomato basil soup');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText('Soup photo 7')).toBeInTheDocument();
    expect(screen.queryByText('Soup photo 1')).not.toBeInTheDocument();
    expect(findCall(mock, 'GET /api/image-search?q=tomato+basil+soup')).toBeDefined();
  });

  it.each([
    [502, 'Could not search for photos right now', 'Could not search for photos right now'],
    [429, 'Too Many Requests', 'Too many searches just now'],
    [404, 'Not Found', 'turned off on this server'],
  ])('explains a %i answer', async (status, error, shown) => {
    stubFetch({ [SEARCH]: () => apiResponse({ error }, status) });
    renderDialog();
    expect(await screen.findByRole('alert')).toHaveTextContent(shown);
  });

  it('does not search for fewer than two letters', async () => {
    const user = userEvent.setup();
    const mock = stubFetch({});
    renderDialog({ initialQuery: 'a' });
    expect(mock).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('at least two letters');
    expect(mock).not.toHaveBeenCalled();
  });

  it('closes from the Close button', async () => {
    const user = userEvent.setup();
    stubFetch({ [SEARCH]: () => apiResponse({ items: [] }) });
    const { onClose } = renderDialog();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('PhotoSearchDialog links', () => {
  it('shows a photo page link only when it is https', async () => {
    stubFetch({
      [SEARCH]: () => apiResponse({ items: [photo(1, { landingUrl: 'http://example.org/1' }), photo(2, { landingUrl: 'javascript:alert(1)' }), photo(3)] }),
    });
    renderDialog();
    await screen.findByText('Soup photo 1');
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Open the page of Soup photo 3' })).toBeInTheDocument();
  });

  it('says that the previews are downloaded from Wikimedia and Flickr', () => {
    stubFetch({ [SEARCH]: () => apiResponse({ items: [] }) });
    renderDialog();
    expect(screen.getByText(/downloads the previews from Wikimedia and Flickr/)).toBeInTheDocument();
  });
});
