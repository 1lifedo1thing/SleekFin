export function loadSettings(client) {
  return client.ajax({
    type: 'GET',
    url: client.getUrl('SleekFin/Details/Settings'),
    dataType: 'json',
  }).then((settings) => ({
    dropdownStyle: ['Jellyfin', 'SeerrFin', 'Native'].includes(settings?.dropdownStyle) ? settings.dropdownStyle : 'Jellyfin',
    seasonPostersEnabled: settings?.seasonPostersEnabled === true,
  }));
}
