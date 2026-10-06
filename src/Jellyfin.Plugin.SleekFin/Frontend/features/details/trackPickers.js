import { dom } from '../../shared/runtime.js';
import { createDropdown } from './dropdown.js';

const FIELDS = ['selectSource', 'selectVideo', 'selectAudio', 'selectSubtitles'];

export function createTrackPickers(page, actions, loadDropdownSetting, onSourceChange) {
  const form = page.querySelector('form.trackSelections');
  const metadataNodes = Array.from(page.querySelectorAll('.detailSectionContent, .itemDetailsGroup'));
  if (!form && !metadataNodes.length) return { reconcile() {}, destroy() {} };
  const button = dom.element('<button type="button" class="sleekfin-icon-button sleekfin-control-3d sleekfin-details-track-settings" title="Info"><span class="material-icons info_outline"></span></button>');
  actions.appendChild(button);
  let dialog = null;
  let fields = [];
  let metadata = [];
  let sourceId = '';
  let destroyed = false;
  let timer = 0;

  function destroyFields() {
    fields.forEach(({ dropdown }) => dropdown?.destroy());
    fields = [];
  }

  function restoreMetadata(dlg) {
    metadata.reverse().forEach(({ element, parent, next }) => {
      if (!dlg.contains(element)) return;
      if (page.contains(parent)) parent.insertBefore(element, next?.parentNode === parent ? next : null);
      else element.remove();
    });
    metadata = [];
  }

  async function open() {
    const helper = window.Dashboard?.dialogHelper;
    if (destroyed || dialog || button.disabled || !helper || !dom.isVisible(button)) return;
    button.disabled = true;
    const style = await loadDropdownSetting();
    button.disabled = false;
    if (destroyed || !dom.isVisible(button)) return;
    // No modal history entry: navigation already destroys this page's Info dialog.
    // A hidden or detached owning page cannot emit the exit animation's completion event.
    const dlg = helper.createDialog({ removeOnClose: true, scrollY: false, enableHistory: false, exitAnimation: 'none' });
    dialog = dlg;
    dlg.id = `sleekfin-details-tracks-${Date.now()}`;
    dlg.classList.add('sleekfin-details-track-dialog', 'sleekfin-control-3d');
    dlg.innerHTML = '<div class="sleekfin-details-track-header"><h3>Info</h3><button type="button" class="sleekfin-details-track-close sleekfin-icon-button" title="Close"><span class="material-icons close"></span></button></div><div class="sleekfin-details-track-content smoothScrollY"><hr class="sleekfin-details-info-divider"><div class="sleekfin-details-info-metadata"></div></div>';
    dlg.querySelector('.sleekfin-details-track-close').addEventListener('click', () => helper.close(dlg));
    dlg.addEventListener('closing', () => {
      fields.forEach(({ dropdown }) => dropdown?.close());
      restoreMetadata(dlg);
    });

    dlg.addEventListener('close', () => {
      destroyFields();
      if (dialog === dlg) dialog = null;
    });
    helper.open(dlg);
    dlg.backdrop.classList.add('sleekfin-details-info-backdrop');
    dlg.dialogContainer.classList.add('sleekfin-details-info-container');

    // Native and JE updates still resolve their metadata through the owning page.
    page.appendChild(dlg.backdrop);
    page.appendChild(dlg.dialogContainer);
    const content = dlg.querySelector('.sleekfin-details-track-content');
    const divider = content.querySelector('.sleekfin-details-info-divider');
    const metadataRoot = content.querySelector('.sleekfin-details-info-metadata');
    // Keep native and JE link handlers, metadata render roots, and late streaming results.
    metadata = metadataNodes.filter((element) => page.contains(element)).map((element) => {
      const record = { element, parent: element.parentNode, next: element.nextSibling };
      metadataRoot.appendChild(element);
      return record;
    });
    
    fields = FIELDS.map((className) => {
      const select = form?.querySelector(`.${className}`);
      const container = select?.closest('.selectContainer');
      if (!container) return null;
      const field = dom.element('<div class="selectContainer"><label class="selectLabel"></label></div>');
      const nativeLabel = field.firstElementChild;
      // Jellyfin's playback and version handlers still query the original selectors in the page.
      const control = style === 'Native' ? document.createElement('select') : select.cloneNode(true);
      if (style === 'Native') control.className = 'sleekfin-details-basic-native';
      control.id = `${dlg.id}-${className}`;
      control.classList.remove('detailTrackSelect');
      nativeLabel.htmlFor = control.id;
      field.appendChild(control);
      const arrow = container.querySelector('.selectArrowContainer');
      if (arrow && style !== 'Native') field.appendChild(arrow.cloneNode(true));
      control.addEventListener('change', () => {
        select.value = control.value;
        // Changing media version refreshes detail content, so close its Info dialog first.
        if (className === 'selectSource') helper.close(dlg);
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      let trigger, label, value, dropdown;
      if (style === 'SeerrFin') {
        nativeLabel.classList.add('hide');
        control.classList.add('sleekfin-details-track-native');
        field.classList.add('sleekfin-details-custom-track');
        const root = dom.element('<div class="sleekfin-details-track"><span class="sleekfin-details-track-label"></span><button type="button" class="sleekfin-details-track-trigger"><span class="sleekfin-details-track-value"></span><span class="sleekfin-details-track-chevron"></span></button></div>');
        trigger = root.querySelector('button');
        label = root.querySelector('.sleekfin-details-track-label');
        value = root.querySelector('.sleekfin-details-track-value');
        field.appendChild(root);
        dropdown = createDropdown({ root, trigger, portal: dlg.dialogContainer, onSelect(option) {
          if (select.value === option.value) return;
          control.value = option.value;
          control.dispatchEvent(new Event('change'));
        } });
      }
      content.insertBefore(field, divider);
      return { container, control, dropdown, field, label, nativeLabel, select, trigger, value };
    }).filter(Boolean);
    sync();
  }

  function sync() {
    if (destroyed || !dom.isConnected(page)) return;
    page.querySelectorAll('.streaming-lookup-container #streaming-result-container').forEach((result) => {
      result.parentElement.classList.toggle('sleekfin-details-availability-updated', result.childElementCount > 0);
    });
    const hidden = !form || form.classList.contains('hide');
    button.hidden = !metadataNodes.length && (hidden || !FIELDS.some((className) => {
      const container = form?.querySelector(`.${className}`)?.closest('.selectContainer');
      return container && !container.classList.contains('hide');
    }));
    fields.forEach(({ container, control, dropdown, field, label, nativeLabel, select, trigger, value }) => {
      field.classList.toggle('hide', hidden || container.classList.contains('hide'));
      if (control.innerHTML !== select.innerHTML) control.replaceChildren(...Array.from(select.options, (option) => option.cloneNode(true)));
      control.disabled = select.disabled || select.options.length <= 1;
      control.value = select.value;
      const labelText = container.querySelector('.selectLabel')?.textContent.trim() || '';
      if (nativeLabel.textContent !== labelText) nativeLabel.textContent = labelText;
      if (!dropdown) return;
      trigger.disabled = control.disabled;
      if (label.textContent !== labelText) label.textContent = labelText;
      const valueText = select.options[select.selectedIndex]?.text || '';
      if (value.textContent !== valueText) value.textContent = valueText;
      dropdown.update(Array.from(select.options, (option) => ({ value: option.value, label: option.text })), select.value);
    });
    dialog?.querySelector('.sleekfin-details-info-divider')?.classList.toggle('hide', !fields.some(({ field }) => !field.classList.contains('hide')));
    if (button.hidden && dialog) window.Dashboard.dialogHelper.close(dialog);
    const selectedSource = form?.querySelector('.selectSource')?.value || '';
    if (selectedSource !== sourceId) {
      sourceId = selectedSource;
      if (sourceId) onSourceChange?.(sourceId);
    }
  }

  const observer = new MutationObserver(() => {
    window.clearTimeout(timer);
    timer = window.setTimeout(sync, 60);
  });
  if (form) observer.observe(form, { attributes: true, attributeFilter: ['class', 'disabled'], childList: true, subtree: true });
  metadataNodes.forEach((element) => observer.observe(element, { childList: true, subtree: true }));
  function refreshAvailability(event) {
    if (!event.target.closest?.('#streaming-settings-modal #save-settings') || destroyed || !dom.isVisible(page)) return;
    // JE's target handler updates its private search options before this bubbling listener.
    page.querySelector('.streaming-lookup-container .elsewhere-search-button')?.click();
  }
  document.addEventListener('click', refreshAvailability);
  form?.addEventListener('change', sync);
  button.addEventListener('click', open);
  sync();

  return {
    reconcile: sync,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      observer.disconnect();
      window.clearTimeout(timer);
      form?.removeEventListener('change', sync);
      document.removeEventListener('click', refreshAvailability);
      button.removeEventListener('click', open);
      button.remove();
      destroyFields();
      if (dialog) {
        restoreMetadata(dialog);
        window.Dashboard.dialogHelper.close(dialog);
      }
    },
  };
}
