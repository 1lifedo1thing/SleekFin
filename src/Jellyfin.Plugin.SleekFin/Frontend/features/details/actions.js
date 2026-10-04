import { decorateNativeButton, restoreNativeButton } from '../../shared/runtime.js';

export function createActions(container) {
  const decorated = new Set();

  function reconcile() {
    const buttons = container.querySelectorAll('.btnPlay, .btnDownload, .btnUserRating');

    buttons.forEach((element) => {
      const isFavorite = element.classList.contains('btnUserRating');
      const isDownload = element.classList.contains('btnDownload');
      const icon = isFavorite ? (element.dataset.isfavorite === 'true' ? 'bookmarkCheck' : 'bookmark') : isDownload ? 'download' : 'play';
      const label = isFavorite ? (element.dataset.isfavorite === 'true' ? 'In watchlist' : 'Add to watchlist') : isDownload ? 'Download' : element.title || 'Play';

      decorateNativeButton(element, {
        content: element.querySelector('.detailButton-content') || element,
        icon,
        label,
        variant: icon === 'play' ? 'primary' : 'control',
      });
      decorated.add(element);
    });
  }

  const observer = new MutationObserver(reconcile);
  observer.observe(container, {
    attributes: true,
    subtree: true,
    attributeFilter: ['data-isfavorite', 'title'],
  });

  return {
    destroy() {
      observer.disconnect();
      decorated.forEach((element) => {
        restoreNativeButton(element);
      });
      decorated.clear();
    },
    reconcile,
  };
}
