export function loadSettings(client) {
  return client.ajax({
    type: 'GET',
    url: client.getUrl('SleekFin/Details/Settings'),
    dataType: 'json',
  }).then((settings) => settings?.customDropdownEnabled === true);
}
