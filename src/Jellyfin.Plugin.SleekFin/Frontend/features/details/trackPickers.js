import { dom } from '../../shared/runtime.js';
import { createDropdown } from './dropdown.js';

const FIELDS = ['selectSource', 'selectVideo', 'selectAudio', 'selectSubtitles'];

export function createTrackPickers(page, actions, loadDropdownSetting, onSourceChange) {
  const form = page.querySelector('form.trackSelections');
  if (!form) return { reconcile() {}, destroy() {} };
  const spacer = dom.element('<div class="sleekfin-details-action-spacer"></div>');
  const button = dom.element('<button type="button" class="sleekfin-icon-button sleekfin-control-3d sleekfin-details-track-settings" title="Media settings"><span class="material-icons more_vert"></span></button>');
  actions.appendChild(spacer);
  actions.appendChild(button);
  let dialog = null;
  let fields = [];
  let sourceId = '';
  let destroyed = false;
  let timer = 0;

  function destroyFields() {
    fields.forEach(({ dropdown }) => dropdown?.destroy());
    fields = [];
  }

  async function open() {
    const helper = window.Dashboard?.dialogHelper;
    if (destroyed || dialog || button.disabled || !helper || !dom.isVisible(button)) return;
    button.disabled = true;
    const custom = await loadDropdownSetting();
    button.disabled = false;
    if (destroyed || !dom.isVisible(button)) return;
    // No modal history entry: navigation already destroys this page's settings dialog.
    const dlg = helper.createDialog({ removeOnClose: true, scrollY: false, enableHistory: false });
    dialog = dlg;
    dlg.id = `sleekfin-details-tracks-${Date.now()}`;
    dlg.classList.add('sleekfin-details-track-dialog', 'sleekfin-control-3d');
    dlg.innerHTML = '<div class="sleekfin-details-track-header"><h3>Media settings</h3><button type="button" class="sleekfin-details-track-close sleekfin-icon-button" title="Close"><span class="material-icons close"></span></button></div><div class="sleekfin-details-track-content smoothScrollY"></div>';
    dlg.querySelector('.sleekfin-details-track-close').addEventListener('click', () => helper.close(dlg));
    dlg.addEventListener('closing', () => fields.forEach(({ dropdown }) => dropdown?.close()));
    dlg.addEventListener('close', () => {
      destroyFields();
      if (dialog === dlg) dialog = null;
    });
    helper.open(dlg);
    dlg.backdrop.classList.add('sleekfin-details-track-backdrop');
    const content = dlg.querySelector('.sleekfin-details-track-content');
    fields = FIELDS.map((className) => {
      const select = form.querySelector(`.${className}`);
      const container = select?.closest('.selectContainer');
      if (!container) return null;
      const field = dom.element('<div class="selectContainer"><label class="selectLabel"></label></div>');
      const nativeLabel = field.firstElementChild;
      // Jellyfin's playback and version handlers still query the original selectors in the page.
      const control = select.cloneNode(true);
      control.id = `${dlg.id}-${className}`;
      control.classList.remove('detailTrackSelect');
      nativeLabel.htmlFor = control.id;
      field.appendChild(control);
      const arrow = container.querySelector('.selectArrowContainer');
      if (arrow) field.appendChild(arrow.cloneNode(true));
      control.addEventListener('change', () => {
        select.value = control.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      let trigger, label, value, dropdown;
      if (custom) {
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
      content.appendChild(field);
      return { container, control, dropdown, field, label, nativeLabel, select, trigger, value };
    }).filter(Boolean);
    sync();
  }

  function sync() {
    if (destroyed || !dom.isConnected(page)) return;
    const hidden = form.classList.contains('hide');
    button.hidden = hidden || !FIELDS.some((className) => {
      const container = form.querySelector(`.${className}`)?.closest('.selectContainer');
      return container && !container.classList.contains('hide');
    });
    spacer.hidden = button.hidden;
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
    if (button.hidden && dialog) window.Dashboard.dialogHelper.close(dialog);
    const selectedSource = form.querySelector('.selectSource')?.value || '';
    if (selectedSource !== sourceId) {
      sourceId = selectedSource;
      if (sourceId) onSourceChange?.(sourceId);
    }
  }

  const observer = new MutationObserver(() => {
    window.clearTimeout(timer);
    timer = window.setTimeout(sync, 60);
  });
  observer.observe(form, { attributes: true, attributeFilter: ['class', 'disabled'], childList: true, subtree: true });
  form.addEventListener('change', sync);
  button.addEventListener('click', open);
  sync();

  return {
    reconcile: sync,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      observer.disconnect();
      window.clearTimeout(timer);
      form.removeEventListener('change', sync);
      button.removeEventListener('click', open);
      spacer.remove();
      button.remove();
      destroyFields();
      if (dialog) window.Dashboard.dialogHelper.close(dialog);
    },
  };
}
