// src/mapas/google-maps-loader.js
// Cargador único y robusto para Google Maps.
// Evita cargar el script más de una vez y asegura que el callback sea global.

let googleMapsPromise = null;

export function loadGoogleMaps() {
  if (window.google && window.google.maps) {
    window.onGoogleMapsReady?.();
    return Promise.resolve();
  }

  if (googleMapsPromise) return googleMapsPromise;

  googleMapsPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById('drive-mx-google-maps-script');

    window.initDriveMxGoogleMaps = () => {
      try {
        window.onGoogleMapsReady?.();
        resolve();
      } catch (error) {
        console.error('Error inicializando Google Maps:', error);
        reject(error);
      }
    };

    window.gm_authFailure = () => {
      const error = new Error('Google Maps rechazó la API key. Revisa restricciones, facturación y APIs habilitadas.');
      console.error(error);
      document.dispatchEvent(new CustomEvent('drive_mx_google_maps_error', { detail: error }));
      reject(error);
    };

    if (existing) return;

    const s = document.createElement('script');
    s.id = 'drive-mx-google-maps-script';
    s.async = true;
    s.defer = true;
    s.src = 'https://maps.googleapis.com/maps/api/js?key=AIzaSyDIE4zI4nIoNtMY-VUGvm0mtDSm5r6cMMo&libraries=places&callback=initDriveMxGoogleMaps&loading=async&v=weekly';
    s.onerror = () => {
      const error = new Error('No se pudo cargar el script de Google Maps.');
      console.error(error);
      document.dispatchEvent(new CustomEvent('drive_mx_google_maps_error', { detail: error }));
      reject(error);
    };
    document.head.appendChild(s);
  });

  return googleMapsPromise;
}
