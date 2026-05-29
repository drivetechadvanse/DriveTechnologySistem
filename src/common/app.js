 lucide.createIcons();
    let currentStep = 1;
    let registrationMode = 'driver'; 
    let currentAdminView = 'requests'; 
    let selectedIds = [];
    let taximeterSelectedUrbanServiceId = null;
    let selectedTaximeterScheduleId = null;
    let currentTaximeterConfigContext = null;
    let currentUser = null;
    let activePassengerUser = null;
    let activeDriverUser = null;
    let activePanel = null;
    let isAvailable = false; // Estado del conductor
    let appState = {
        selectedPayment: 'efectivo',
        selectedServiceId: 'taxi-expres',
        precioViaje: 0.00,
        routeDistanceKm: 0,
        routeDurationMinutes: 0,
        passengerLocation: null,
        destinationLocation: null,
        passengerAddress: '',
        destinationAddress: '',
        routeSummary: ''
    };

    let passengerMap = null;
    let passengerMapMarker = null;
    let passengerDestinationMarker = null;
    let passengerDirectionsService = null;
    let passengerDirectionsRenderer = null;
    let passengerRoutePolyline = null;
    let passengerRouteAnimationFrame = null;
    let passengerRouteAnimationToken = 0;
    let activeTripDriverMarker = null;
    let activeTripDirectionsRenderer = null;
    let activeTripTrackingTimer = null;
    let activeTripDriverPosition = null;
    let activeTripArrived = false;
    let passengerGeocoder = null;
    let passengerAutocomplete = null;
    let passengerLocationWatchId = null;
    let passengerRealtimeFareTimer = null;
    let googleMapsReady = false;
    let passengerDestinationSearchActive = false;
    let passengerDestinationLastValidValue = '';
    let driverRealtimeTripRequests = [];
    let rejectedTripIdsForCurrentDriver = new Set();
    let driverPendingTripsUnsubscribe = null;
    let passengerTripUnsubscribe = null;

    function onGoogleMapsReady() {
        googleMapsReady = true;
        if (activePanel === 'passenger' || activePanel === 'passenger-trip') {
            initPassengerMap();
            if (activePanel === 'passenger-trip') startActiveTripDriverTracking();
        }
    }
    // El script de Google Maps necesita encontrar este callback en window.
    window.onGoogleMapsReady = onGoogleMapsReady;

    document.addEventListener('drive_mx_google_maps_error', () => {
        updatePassengerCurrentAddressText('No se pudo cargar Google Maps. Revisa la API key.');
        const mapContainer = document.getElementById('passenger-map');
        if (mapContainer) mapContainer.classList.add('passenger-map-error');
    });

    function initPassengerMap() {
        const mapContainer = document.getElementById('passenger-map');
        if (!mapContainer || typeof google === 'undefined' || !google.maps) return;

        const defaultCenter = { lat: 19.432608, lng: -99.133209 };
        const currentCenter = appState.passengerLocation || defaultCenter;

        if (!passengerMap) {
            passengerMap = new google.maps.Map(mapContainer, {
                center: currentCenter,
                zoom: 16,
                disableDefaultUI: true,
                clickableIcons: false,
                gestureHandling: 'greedy',
                mapTypeControl: false,
                streetViewControl: false,
                fullscreenControl: false
            });

            passengerMapMarker = new google.maps.Marker({
                position: currentCenter,
                map: passengerMap,
                title: 'Tu ubicación actual'
            });

            passengerDestinationMarker = new google.maps.Marker({
                map: passengerMap,
                title: 'Destino',
                visible: false
            });

            passengerDirectionsService = new google.maps.DirectionsService();
            passengerDirectionsRenderer = new google.maps.DirectionsRenderer({
                map: passengerMap,
                suppressMarkers: true,
                preserveViewport: true,
                polylineOptions: { strokeColor: '#f97316', strokeWeight: 5, strokeOpacity: 0 }
            });
            passengerGeocoder = new google.maps.Geocoder();
        }

        // Google Maps puede inicializarse cuando el contenedor acaba de salir de display:none.
        // Forzamos resize/recenter para evitar mapa gris/blanco en la vista de pasajero.
        setTimeout(() => {
            if (!passengerMap || typeof google === 'undefined' || !google.maps) return;
            google.maps.event.trigger(passengerMap, 'resize');
            passengerMap.setCenter(appState.passengerLocation || currentCenter);
        }, 250);

        initPassengerDestinationAutocomplete();
        startPassengerLiveLocationWatch();
        startPassengerFareRealtimeSync();
    }

    function startPassengerLiveLocationWatch() {
        if (!navigator.geolocation) {
            updatePassengerCurrentAddressText('Permiso GPS no disponible');
            return;
        }

        if (passengerLocationWatchId !== null) navigator.geolocation.clearWatch(passengerLocationWatchId);

        passengerLocationWatchId = navigator.geolocation.watchPosition(
            (position) => {
                const center = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude
                };
                appState.passengerLocation = center;
                localStorage.setItem('drive_mx_passenger_location', JSON.stringify({
                    ...center,
                    accuracy: position.coords.accuracy,
                    updatedAt: new Date().toISOString()
                }));

                if (passengerMap && !appState.destinationLocation) passengerMap.setCenter(center);
                if (passengerMapMarker) passengerMapMarker.setPosition(center);
                reverseGeocodePassengerLocation(center);
                calculatePassengerRouteAndRefreshFares();
            },
            () => updatePassengerCurrentAddressText('Activa el GPS para detectar tu ubicación'),
            { enableHighAccuracy: true, maximumAge: 10000, timeout: 12000 }
        );
    }

    function updatePassengerCurrentAddressText(text) {
        const addressEl = document.getElementById('passenger-current-address');
        if (addressEl) addressEl.innerText = text || 'Ubicación actual del pasajero';
        const pickupEl = document.getElementById('trip-pickup');
        if (pickupEl && text) pickupEl.innerText = text;
    }

    function reverseGeocodePassengerLocation(position) {
        if (!passengerGeocoder || !position) return;
        passengerGeocoder.geocode({ location: position }, (results, status) => {
            if (status === 'OK' && results && results[0]) {
                appState.passengerAddress = results[0].formatted_address;
                updatePassengerCurrentAddressText(appState.passengerAddress);
            }
        });
    }

    function beginPassengerDestinationSearch() {
        const passengerView = document.getElementById('passenger-view');
        const costSheet = document.getElementById('cost-sheet');
        const overlay = document.getElementById('overlay');

        passengerDestinationSearchActive = true;
        if (passengerView) passengerView.classList.add('passenger-destination-searching');
        if (costSheet) {
            costSheet.classList.remove('active', 'minimized', 'sheet-dragging');
            costSheet.style.transform = '';
        }
        if (overlay) overlay.classList.remove('opacity-100', 'pointer-events-auto');
    }

    function hidePassengerCostsDuringDestinationSearch() {
        const passengerView = document.getElementById('passenger-view');
        const costSheet = document.getElementById('cost-sheet');
        const overlay = document.getElementById('overlay');

        if (passengerView) passengerView.classList.add('passenger-destination-searching');
        if (costSheet) {
            costSheet.classList.remove('active', 'minimized', 'sheet-dragging');
            costSheet.style.transform = '';
        }
        if (overlay) overlay.classList.remove('opacity-100', 'pointer-events-auto');
    }

    function restorePassengerDestinationSearchState(showCosts = false) {
        const passengerView = document.getElementById('passenger-view');
        const costSheet = document.getElementById('cost-sheet');
        const overlay = document.getElementById('overlay');

        passengerDestinationSearchActive = false;
        if (passengerView) passengerView.classList.remove('passenger-destination-searching');
        if (!showCosts && costSheet) {
            costSheet.classList.remove('active', 'minimized', 'sheet-dragging');
            costSheet.style.transform = '';
        }
        if (overlay) overlay.classList.remove('opacity-100', 'pointer-events-auto');
    }

    function clearPassengerDestinationSelection(message = 'Selecciona destino para calcular tarifas') {
        appState.destinationLocation = null;
        appState.destinationAddress = '';
        passengerDestinationLastValidValue = '';
        if (passengerDestinationMarker) passengerDestinationMarker.setVisible(false);
        const destinationEl = document.getElementById('trip-destination');
        if (destinationEl) destinationEl.innerText = 'Destino del pasajero';
        resetPassengerRoutePricing(message);
    }

    function handlePassengerDestinationTyping() {
        const input = document.getElementById('passenger-destination-input');
        beginPassengerDestinationSearch();

        if (!input) return;
        const currentValue = input.value.trim();
        if (!currentValue) {
            clearPassengerDestinationSelection('Selecciona destino para calcular tarifas');
            return;
        }

        if (passengerDestinationLastValidValue && currentValue !== passengerDestinationLastValidValue) {
            clearPassengerDestinationSelection('Selecciona una sugerencia válida para calcular tarifas');
        }
    }

    function handlePassengerDestinationKeydown(event) {
        if (!event) return;
        if (event.key === 'Escape') {
            const input = document.getElementById('passenger-destination-input');
            if (input) input.blur();
            if (!appState.destinationLocation) restorePassengerDestinationSearchState(false);
        }
    }

    function restorePassengerSearchIfNoValidDestination() {
        window.setTimeout(() => {
            const input = document.getElementById('passenger-destination-input');
            if (document.activeElement === input) return;

            if (!appState.destinationLocation) {
                restorePassengerDestinationSearchState(false);
                return;
            }

            if (input && passengerDestinationLastValidValue && input.value.trim() !== passengerDestinationLastValidValue) {
                clearPassengerDestinationSelection('Selecciona destino para calcular tarifas');
                restorePassengerDestinationSearchState(false);
            }
        }, 250);
    }

    function initPassengerDestinationAutocomplete() {
        const input = document.getElementById('passenger-destination-input');
        if (!input || passengerAutocomplete || typeof google === 'undefined' || !google.maps || !google.maps.places) return;

        passengerAutocomplete = new google.maps.places.Autocomplete(input, {
            fields: ['formatted_address', 'geometry', 'name'],
            componentRestrictions: { country: 'mx' }
        });

        passengerAutocomplete.addListener('place_changed', () => {
            const place = passengerAutocomplete.getPlace();
            if (!place || !place.geometry || !place.geometry.location) return;

            const destination = {
                lat: place.geometry.location.lat(),
                lng: place.geometry.location.lng()
            };
            appState.destinationLocation = destination;
            appState.destinationAddress = place.formatted_address || place.name || input.value;

            if (passengerDestinationMarker) {
                passengerDestinationMarker.setPosition(destination);
                passengerDestinationMarker.setVisible(true);
            }
            const destinationEl = document.getElementById('trip-destination');
            if (destinationEl) destinationEl.innerText = appState.destinationAddress;
            passengerDestinationLastValidValue = (appState.destinationAddress || input.value || '').trim();
            if (input) input.value = passengerDestinationLastValidValue;
            calculatePassengerRouteAndRefreshFares(true);
            restorePassengerDestinationSearchState(true);
            openCosts();
        });
    }

    function hasPassengerActiveRoute() {
        return !!(appState.destinationLocation && Number(appState.routeDistanceKm || 0) > 0 && Number(appState.routeDurationMinutes || 0) > 0 && appState.routeSummary);
    }

    function resetPassengerRoutePricing(message = 'Selecciona destino para calcular tarifas') {
        appState.routeDistanceKm = 0;
        appState.routeDurationMinutes = 0;
        appState.routeSummary = '';
        appState.precioViaje = 0;
        const routeSummaryEl = document.getElementById('passenger-route-summary');
        if (routeSummaryEl) routeSummaryEl.innerText = message;
        clearPassengerAnimatedRoute();
        if (passengerDirectionsRenderer) passengerDirectionsRenderer.set('directions', null);
        refreshPassengerServicePricesAndEta();
    }

    function clearPassengerAnimatedRoute() {
        passengerRouteAnimationToken++;
        if (passengerRouteAnimationFrame) {
            cancelAnimationFrame(passengerRouteAnimationFrame);
            passengerRouteAnimationFrame = null;
        }
        if (passengerRoutePolyline) {
            passengerRoutePolyline.setMap(null);
            passengerRoutePolyline = null;
        }
    }

    function createPassengerRoutePolyline() {
        clearPassengerAnimatedRoute();
        passengerRoutePolyline = new google.maps.Polyline({
            map: passengerMap,
            path: [],
            geodesic: true,
            strokeColor: '#f97316',
            strokeOpacity: 0.95,
            strokeWeight: 6,
            zIndex: 25,
            icons: [{
                icon: { path: google.maps.SymbolPath.CIRCLE, scale: 3, fillColor: '#f97316', fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 1 },
                offset: '100%'
            }]
        });
        return passengerRoutePolyline;
    }

    function interpolateLatLngPoint(start, end, progress) {
        return new google.maps.LatLng(
            start.lat() + ((end.lat() - start.lat()) * progress),
            start.lng() + ((end.lng() - start.lng()) * progress)
        );
    }

    function buildProgressiveRoutePath(points, progress) {
        if (!points || points.length < 2) return points || [];
        const totalSegments = points.length - 1;
        const exactIndex = Math.min(totalSegments, Math.max(0, progress * totalSegments));
        const completedSegments = Math.floor(exactIndex);
        const segmentProgress = exactIndex - completedSegments;
        const path = points.slice(0, completedSegments + 1);

        if (completedSegments < totalSegments) {
            path.push(interpolateLatLngPoint(points[completedSegments], points[completedSegments + 1], segmentProgress));
        }

        return path;
    }

    function animatePassengerRouteLine(route) {
        if (!passengerMap || !route || !route.overview_path || route.overview_path.length < 2) return;

        const polyline = createPassengerRoutePolyline();
        const routePoints = route.overview_path;
        const animationToken = passengerRouteAnimationToken;
        const duration = Math.min(2600, Math.max(1200, routePoints.length * 18));
        const startedAt = performance.now();

        const drawFrame = (now) => {
            if (animationToken !== passengerRouteAnimationToken || !passengerRoutePolyline) return;

            const elapsed = now - startedAt;
            const progress = Math.min(1, elapsed / duration);
            const easedProgress = 1 - Math.pow(1 - progress, 3);
            polyline.setPath(buildProgressiveRoutePath(routePoints, easedProgress));
            polyline.set('icons', [{
                icon: { path: google.maps.SymbolPath.CIRCLE, scale: 3, fillColor: '#f97316', fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 1 },
                offset: '100%'
            }]);

            if (progress < 1) {
                passengerRouteAnimationFrame = requestAnimationFrame(drawFrame);
            } else {
                polyline.setPath(routePoints);
                passengerRouteAnimationFrame = null;
            }
        };

        passengerRouteAnimationFrame = requestAnimationFrame(drawFrame);
    }

    function calculatePassengerRouteAndRefreshFares(fitRoute = false) {
        if (!appState.passengerLocation || !appState.destinationLocation || !passengerDirectionsService) {
            resetPassengerRoutePricing('Selecciona destino para calcular tarifas');
            return;
        }

        passengerDirectionsService.route({
            origin: appState.passengerLocation,
            destination: appState.destinationLocation,
            travelMode: google.maps.TravelMode.DRIVING,
            drivingOptions: {
                departureTime: new Date(),
                trafficModel: google.maps.TrafficModel.BEST_GUESS
            }
        }, (result, status) => {
            if (status === 'OK' && result.routes && result.routes[0] && result.routes[0].legs && result.routes[0].legs[0]) {
                const leg = result.routes[0].legs[0];
                const km = (leg.distance?.value || 0) / 1000;
                const seconds = (leg.duration_in_traffic?.value || leg.duration?.value || 0);
                appState.routeDistanceKm = km;
                appState.routeDurationMinutes = Math.max(1, Math.ceil(seconds / 60));
                appState.routeSummary = `${km.toFixed(1)} km • ${appState.routeDurationMinutes} min`;

                const routeSummaryEl = document.getElementById('passenger-route-summary');
                if (routeSummaryEl) routeSummaryEl.innerText = appState.routeSummary;

                if (passengerDirectionsRenderer) passengerDirectionsRenderer.set('directions', null);
                animatePassengerRouteLine(result.routes[0]);
                refreshPassengerServicePricesAndEta();
            } else {
                resetPassengerRoutePricing('No se pudo calcular la ruta');
            }
        });
    }

    function startPassengerFareRealtimeSync() {
        if (passengerRealtimeFareTimer) clearInterval(passengerRealtimeFareTimer);
        passengerRealtimeFareTimer = setInterval(() => {
            if (activePanel === 'passenger') calculatePassengerRouteAndRefreshFares();
        }, 15000);
    }


    setTimeout(() => { 
        const splash = document.getElementById('splash');
        if(splash) splash.style.opacity = '0'; 
        setTimeout(() => { 
            if(splash) splash.style.display = 'none'; 
            document.getElementById('login-screen').classList.remove('hidden'); 
        }, 500); 
    }, 1500);

    // --- SISTEMA DE CARTERA / SALDOS ---
    function normalizeWalletData(data = {}) {
        const saldo = Number(data.saldo || 0);
        const historial = Array.isArray(data.historial) ? data.historial : [];
        const trips = Number(data.trips || 0);
        return { ...data, saldo, historial, trips };
    }

    function getWalletKey(userId) {
        return `wallet_${userId}`;
    }

    function getWalletData(userId) {
        if (!userId) return { saldo: 0.00, historial: [], trips: 0 };
        try {
            return normalizeWalletData(JSON.parse(localStorage.getItem(getWalletKey(userId)) || '{}'));
        } catch (error) {
            console.warn('Cartera dañada, se restauró una cartera limpia:', error);
            return { saldo: 0.00, historial: [], trips: 0 };
        }
    }

    function notifyWalletUpdated(userId, wallet) {
        window.dispatchEvent(new CustomEvent('drive_mx_wallet_updated', {
            detail: { userId: String(userId), wallet }
        }));
    }

    function saveWalletData(userId, data) {
        if (!userId) return { saldo: 0.00, historial: [], trips: 0 };
        const wallet = normalizeWalletData(data);
        localStorage.setItem(getWalletKey(userId), JSON.stringify(wallet));
        notifyWalletUpdated(userId, wallet);
        return wallet;
    }

    function addMovement(userId, tipo, monto, descripcion, extra = {}) {
        const amount = Number(monto || 0);
        if (!userId || !Number.isFinite(amount) || amount <= 0) return getWalletData(userId);

        const wallet = getWalletData(userId);
        wallet.saldo = tipo === 'sumar'
            ? Number((wallet.saldo + amount).toFixed(2))
            : Number((wallet.saldo - amount).toFixed(2));

        wallet.historial.unshift({
            id: `MOV_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            fecha: new Date().toLocaleString('es-MX'),
            tipo,
            monto: amount,
            desc: descripcion,
            saldoFinal: wallet.saldo,
            ...extra
        });

        return saveWalletData(userId, wallet);
    }

    function incrementWalletTrips(userId) {
        const wallet = getWalletData(userId);
        wallet.trips = Number(wallet.trips || 0) + 1;
        return saveWalletData(userId, wallet);
    }

    function formatWalletBalance(saldo) {
        const value = Number(saldo || 0);
        const sign = value < 0 ? '-' : '';
        return `${sign}$${Math.abs(value).toFixed(2)} MXN`;
    }

    function refreshWalletViews(userId = null) {
        if (currentUser && (!userId || String(currentUser.id) === String(userId))) {
            updateWalletDisplay();
            const sideTrips = document.getElementById('side-user-trips');
            if (sideTrips) sideTrips.innerText = getWalletData(currentUser.id).trips || 0;
        }
        if (userTargetAdmin && (!userId || String(userTargetAdmin.id) === String(userId))) {
            const wallet = getWalletData(userTargetAdmin.id);
            const adminSaldo = document.getElementById('admin-view-saldo');
            if (adminSaldo) adminSaldo.innerText = formatWalletBalance(wallet.saldo);
            renderHistorial(wallet.historial, document.getElementById('admin-movimientos-list'));
        }
    }


    function getUsersDb() {
        return JSON.parse(localStorage.getItem('db_usuarios_permanente') || '[]');
    }

    function getUserUniqueKeys(user) {
        const keys = [];
        if (!user) return keys;

        const role = user.role || '';
        const id = String(user.id || '').trim();
        const usuario = String(user.usuario || '').toLowerCase().trim();
        const correo = String(user.correo || '').toLowerCase().trim();
        const phone = String(user.phone || user.telefono || '').replace(/\D/g, '');
        const placa = String(user.vehiculo?.placa || user.plate || '').toLowerCase().replace(/\s/g, '').trim();

        if (id) keys.push(`${role}_id_${id}`);
        if (usuario) keys.push(`${role}_usuario_${usuario}`);
        if (correo) keys.push(`${role}_correo_${correo}`);
        // Conductores: NO usar teléfono ni placa como llave única.
        // Esto evita sobrescribir/bloquear registros cuando se crean varios conductores.

        return keys;
    }

    function saveUsersDb(db) {
        const cleanDb = [];
        const keyToIndex = new Map();

        db.forEach(user => {
            if (!user || !user.id) return;

            const keys = getUserUniqueKeys(user);
            let existingIndex = keys.find(key => keyToIndex.has(key));
            existingIndex = existingIndex ? keyToIndex.get(existingIndex) : -1;

            if (existingIndex > -1) {
                cleanDb[existingIndex] = { ...cleanDb[existingIndex], ...user };
                getUserUniqueKeys(cleanDb[existingIndex]).forEach(key => keyToIndex.set(key, existingIndex));
                return;
            }

            const newIndex = cleanDb.length;
            cleanDb.push(user);
            keys.forEach(key => keyToIndex.set(key, newIndex));
        });

        localStorage.setItem('db_usuarios_permanente', JSON.stringify(cleanDb));
        return cleanDb;
    }

    function upsertUser(userData) {
        let db = getUsersDb();
        const newKeys = getUserUniqueKeys(userData);

        db = db.filter(user => {
            const currentKeys = getUserUniqueKeys(user);
            const isSameUser = newKeys.some(key => currentKeys.includes(key));
            return !isSameUser;
        });

        db.push(userData);
        return saveUsersDb(db);
    }

    function hideAllMainPanels() {
        ['login-screen', 'admin-view', 'passenger-view', 'driver-view-active', 'driver-selection-view', 'driver-registration-view'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.add('hidden');
        });
        closeAll();
        closeDriverSidebar();
    }

    function resetPassengerTransientState() {
        ['p-header', 'p-banners', 'p-wallet'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.remove('hidden-view');
        });
        const radar = document.getElementById('radar');
        const searchMsg = document.getElementById('search-msg');
        const activeTrip = document.getElementById('active-trip-passenger');
        if (radar) radar.classList.add('hidden');
        if (searchMsg) searchMsg.classList.add('hidden');
        if (activeTrip) activeTrip.classList.add('hidden');
        const fixedCancel = document.getElementById('fixed-cancel-trip-btn');
        if (fixedCancel) fixedCancel.classList.add('hidden');
        const tripSheet = document.getElementById('active-trip-sheet');
        if (tripSheet) tripSheet.classList.add('minimized');
        const msgModal = document.getElementById('passenger-message-modal');
        if (msgModal) msgModal.classList.add('hidden');
        hideDriverArrivedPassengerBox();
    }

    function resetDriverTransientState() {
        isAvailable = false;
        const pulse = document.getElementById('search-pulse-driver');
        const mainMsg = document.getElementById('driver-main-msg');
        const statusBadge = document.getElementById('status-badge');
        const statusDot = document.getElementById('status-dot');
        const statusText = document.getElementById('status-text');
        if (pulse) pulse.classList.add('hidden');
        if (mainMsg) mainMsg.innerText = 'Buscando viajes cercanos';
        if (statusBadge) {
            statusBadge.classList.remove('bg-green-600/20','border-green-600/30');
            statusBadge.classList.add('bg-red-600/20','border-red-600/30');
        }
        if (statusDot) {
            statusDot.classList.remove('bg-green-500');
            statusDot.classList.add('bg-red-600');
        }
        if (statusText) {
            statusText.classList.remove('text-green-500');
            statusText.classList.add('text-red-600');
            statusText.innerText = 'No Disponible';
        }
        renderDriverTripRequestCard();
    }

    function configureSharedSidebarFor(panel) {
        document.getElementById('nav-admin').classList.toggle('hidden', panel !== 'admin');
        document.getElementById('side-header-admin').classList.toggle('hidden', panel !== 'admin');
        document.getElementById('nav-passenger').classList.toggle('hidden', panel !== 'passenger');
        document.getElementById('user-profile-header').classList.toggle('hidden', panel !== 'passenger');
    }

    function showAdminPanel() {
        activePanel = 'admin';
        hideAllMainPanels();
        configureSharedSidebarFor('admin');
        document.getElementById('admin-view').classList.remove('hidden');
        renderAdminRequests();
        lucide.createIcons();
    }

    function updateCurrentDriverLocation() {
        if (!currentUser || currentUser.role !== 'conductor' || !navigator.geolocation) return;
        navigator.geolocation.getCurrentPosition(pos => {
            const db = getUsersDb();
            const idx = db.findIndex(u => String(u.id) === String(currentUser.id) && u.role === 'conductor');
            const ubicacion = {
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                accuracy: pos.coords.accuracy,
                updatedAt: new Date().toISOString()
            };
            currentUser.ubicacion = ubicacion;
            localStorage.setItem('drive_mx_driver_location_' + currentUser.id, JSON.stringify(ubicacion));
            localStorage.setItem('drive_mx_last_driver_location', JSON.stringify({ ...ubicacion, driverId: currentUser.id }));
            if (idx > -1) {
                db[idx].ubicacion = ubicacion;
                saveUsersDb(db);
            }
        }, () => {}, { enableHighAccuracy: true, maximumAge: 60000, timeout: 5000 });
    }


    function persistPanelSession(user) {
        if (!user || !user.role) return;
        const session = JSON.stringify({ id: user.id, role: user.role });
        localStorage.setItem('drive_mx_active_session', session);
        if (user.role === 'pasajero') {
            activePassengerUser = user;
            localStorage.setItem('drive_mx_passenger_session', session);
        }
        if (user.role === 'conductor') {
            activeDriverUser = user;
            localStorage.setItem('drive_mx_driver_session', session);
        }
    }

    function getStoredPanelUser(role) {
        const sessionKey = role === 'conductor' ? 'drive_mx_driver_session' : 'drive_mx_passenger_session';
        const cachedUser = role === 'conductor' ? activeDriverUser : activePassengerUser;
        const db = getUsersDb();

        if (cachedUser && cachedUser.role === role) {
            return db.find(user => String(user.id) === String(cachedUser.id) && user.role === role) || cachedUser;
        }

        try {
            const saved = JSON.parse(localStorage.getItem(sessionKey) || 'null');
            if (saved && saved.role === role) {
                return db.find(user => String(user.id) === String(saved.id) && user.role === role) || null;
            }
        } catch (error) {}

        return null;
    }

    function getPassengerForDriver(driver) {
        if (!driver || driver.role !== 'conductor') return null;
        const db = getUsersDb();
        const parentId = String(driver.parentPassengerId || '');
        if (parentId) {
            const parentPassenger = db.find(user => user.role === 'pasajero' && String(user.id) === parentId);
            if (parentPassenger) return parentPassenger;
        }

        const driverCorreo = String(driver.correo || '').toLowerCase().trim();
        const driverUsuario = String(driver.usuario || '').toLowerCase().trim();
        const driverPhone = String(driver.phone || driver.telefono || '').replace(/\D/g, '');
        return db.find(user => {
            if (!user || user.role !== 'pasajero') return false;
            const passengerCorreo = String(user.correo || '').toLowerCase().trim();
            const passengerUsuario = String(user.usuario || '').toLowerCase().trim();
            const passengerPhone = String(user.phone || user.telefono || '').replace(/\D/g, '');
            return (driverCorreo && passengerCorreo && driverCorreo === passengerCorreo) ||
                   (driverUsuario && passengerUsuario && driverUsuario === passengerUsuario) ||
                   (driverPhone && passengerPhone && driverPhone === passengerPhone);
        }) || null;
    }

    function setPassengerProfilePhoto(passenger) {
        const sidePhoto = document.getElementById('side-user-photo');
        const topPhoto = document.getElementById('top-user-photo');
        const topIcon = document.getElementById('top-user-icon');
        const passengerPhoto = getUserPhotoSource(passenger);

        if (sidePhoto) {
            sidePhoto.onerror = function() { this.src = ''; };
            sidePhoto.src = passengerPhoto || '';
        }
        if (topPhoto && topIcon) {
            if (isValidImageSource(passengerPhoto)) {
                topPhoto.onerror = function() { topPhoto.src = ''; topPhoto.classList.add('hidden'); topIcon.classList.remove('hidden'); };
                topPhoto.src = passengerPhoto;
                topPhoto.classList.remove('hidden');
                topIcon.classList.add('hidden');
            } else {
                topPhoto.src = '';
                topPhoto.classList.add('hidden');
                topIcon.classList.remove('hidden');
            }
        }
    }

    function showDriverPanel() {
        if (currentUser && currentUser.role === 'conductor') persistPanelSession(currentUser);
        activePanel = 'driver';
        hideAllMainPanels();
        configureSharedSidebarFor('driver');
        resetPassengerTransientState();
        document.getElementById('driver-view-active').classList.remove('hidden');
        updateDriverSidebarProfile();
        updateCurrentDriverLocation();
        if (window.driveMxDriverLocationInterval) clearInterval(window.driveMxDriverLocationInterval);
        window.driveMxDriverLocationInterval = setInterval(updateCurrentDriverLocation, 5000);
        startDriverPendingTripsRealtime();
        renderDriverTripRequestCard();
        refreshDriverPassengerNotifications();
        lucide.createIcons();
    }

    function showPassengerPanel() {
        let passengerUser = currentUser && currentUser.role === 'pasajero' ? currentUser : null;
        if (!passengerUser && currentUser && currentUser.role === 'conductor') passengerUser = getPassengerForDriver(currentUser);
        if (!passengerUser) passengerUser = getStoredPanelUser('pasajero');
        if (passengerUser) {
            currentUser = passengerUser;
            persistPanelSession(passengerUser);
        }

        activePanel = 'passenger';
        hideAllMainPanels();
        configureSharedSidebarFor('passenger');
        resetDriverTransientState();
        resetPassengerTransientState();
        document.getElementById('passenger-view').classList.remove('hidden');
        updateProfileUI();
        renderPassengerUrbanServices();
        setTimeout(() => { initPassengerMap(); refreshPassengerServicePricesAndEta(); }, 150);
        lucide.createIcons();
    }

    function startPassengerRegistration() {
        activePanel = 'registration';
        registrationMode = 'passenger';
        tempBase64Photo = '';
        tempIneFrontPhoto = '';
        tempIneBackPhoto = '';
        tempCirculationPhoto = '';
        tempVehiclePhoto = '';
        window.tempBase64Photo = '';
        window.tempIneFrontPhoto = '';
        window.tempIneBackPhoto = '';
        window.tempCirculationPhoto = '';
        window.tempVehiclePhoto = '';
        const stepsToHide = ['step-ine-front', 'step-ine-back', 'step-vehicle', 'step-circ', 'step-v-photo'];
        stepsToHide.forEach(s => document.getElementById(s).classList.add('hidden'));
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('driver-registration-view').classList.remove('hidden');
        document.getElementById('reg-main-title').innerHTML = 'REGISTRO <span class="text-red-600 uppercase">USER</span>';
        document.getElementById('fields-account').classList.remove('hidden');
        goToStep(1);
        lucide.createIcons();
    }

    let tempBase64Photo = "";
    let tempIneFrontPhoto = "";
    let tempIneBackPhoto = "";
    let tempCirculationPhoto = "";
    let tempVehiclePhoto = "";
    let isSavingDriverRequest = false;

    function setButtonEnabled(buttonId, enabled = true) {
        const btn = document.getElementById(buttonId);
        if (!btn) return;
        btn.disabled = !enabled;
        btn.classList.toggle('bg-gray-300', !enabled);
        btn.classList.toggle('bg-red-600', enabled);
        btn.classList.toggle('bg-green-600', enabled && buttonId.includes('passenger'));
    }

    function getFileFromInput(input) {
        return input && input.files && input.files.length ? input.files[0] : null;
    }

    function compressImageFile(file, maxWidth = 1280, quality = 0.78) {
        return new Promise((resolve, reject) => {
            if (!file || !file.type || !file.type.startsWith('image/')) {
                reject(new Error('Selecciona una imagen válida.'));
                return;
            }

            const reader = new FileReader();
            reader.onerror = () => reject(new Error('No se pudo leer la imagen.'));
            reader.onload = () => {
                const img = new Image();
                img.onerror = () => resolve(reader.result);
                img.onload = () => {
                    try {
                        const scale = Math.min(1, maxWidth / Math.max(img.width, img.height));
                        const canvas = document.createElement('canvas');
                        canvas.width = Math.max(1, Math.round(img.width * scale));
                        canvas.height = Math.max(1, Math.round(img.height * scale));
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                        resolve(canvas.toDataURL('image/jpeg', quality));
                    } catch (err) {
                        resolve(reader.result);
                    }
                };
                img.src = reader.result;
            };
            reader.readAsDataURL(file);
        });
    }

    function saveTempDocument(inputId, base64) {
        if (inputId === 'ine-f-input') {
            tempIneFrontPhoto = base64;
            window.tempIneFrontPhoto = base64;
        }
        if (inputId === 'ine-b-input') {
            tempIneBackPhoto = base64;
            window.tempIneBackPhoto = base64;
        }
        if (inputId === 'circ-input') {
            tempCirculationPhoto = base64;
            window.tempCirculationPhoto = base64;
        }
        if (inputId === 'v-photo-input') {
            tempVehiclePhoto = base64;
            window.tempVehiclePhoto = base64;
        }
    }

    async function processImage(input) {
        const file = getFileFromInput(input);
        if (!file) return;
        try {
            tempBase64Photo = await compressImageFile(file, 900, 0.82);
            window.tempBase64Photo = tempBase64Photo;
            const preview = document.getElementById('driver-photo-preview');
            const placeholder = document.getElementById('placeholder-icon');
            if (preview) {
                preview.src = tempBase64Photo;
                preview.classList.remove('hidden');
            }
            if (placeholder) placeholder.classList.add('hidden');
            setButtonEnabled('btn-photo-next', true);
        } catch (error) {
            console.error('Error al cargar foto de perfil:', error);
            alert('No se pudo cargar la foto. Intenta tomarla de nuevo o seleccionarla desde galería.');
            if (input) input.value = '';
        }
    }

    function savePassengerRequest() {
        const userId = String(Date.now());
        const userValue = document.getElementById('reg-user').value.toLowerCase().trim();
        const newRequest = {
            id: userId, 
            name: document.getElementById('dr-name').value, 
            usuario: userValue,
            pass: document.getElementById('reg-pass').value, 
            correo: document.getElementById('reg-email').value.toLowerCase().trim(),
            phone: document.getElementById('dr-phone').value, 
            foto: tempBase64Photo,
            passengerFoto: tempBase64Photo,
            status: 'activo', 
            role: 'pasajero',
            date: new Date().toLocaleDateString(),
            createdAt: new Date().toISOString()
        };
        upsertUser(newRequest);
        saveWalletData(userId, { saldo: 0.00, historial: [], trips: 0 });
        alert(`Cuenta creada correctamente.`); 
        location.reload();
    }

    // --- FUNCIÓN SOLICITADA: Registro y Acceso Automático a Panel Driver ---
    function buildUniqueDriverId(db) {
        let driverId = '';
        do {
            if (window.crypto && crypto.randomUUID) {
                driverId = `DRV_${crypto.randomUUID()}`;
            } else {
                driverId = `DRV_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
            }
        } while (db.some(user => String(user.id) === String(driverId)));
        return driverId;
    }

    function getCleanValue(id) {
        const el = document.getElementById(id);
        return el ? String(el.value || '').trim() : '';
    }


    // Corrección: manejo seguro de imágenes en Admin, Pasajero y Conductor.
    function isValidImageSource(src) {
        const value = String(src || '').trim();
        return !!value && /^(data:image\/|https?:\/\/|blob:|file:\/\/)/i.test(value);
    }

    function getInitialServiceImage(serviceId) {
        const img = document.getElementById(`service-image-${serviceId}`);
        if (img && isValidImageSource(img.getAttribute('src') || img.src)) return img.getAttribute('src') || img.src;
        const labels = {
            'taxi-expres': 'TX',
            'motocicleta': 'MT',
            'paqueteria': 'PK',
            'taxi-xl': 'XL'
        };
        const label = labels[serviceId] || 'DMX';
        return `data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20width%3D%22320%22%20height%3D%22220%22%20viewBox%3D%220%200%20320%20220%22%3E%3Crect%20width%3D%22320%22%20height%3D%22220%22%20rx%3D%2228%22%20fill%3D%22%23111827%22/%3E%3Ccircle%20cx%3D%22160%22%20cy%3D%2288%22%20r%3D%2248%22%20fill%3D%22%23ef4444%22/%3E%3Ctext%20x%3D%22160%22%20y%3D%22105%22%20text-anchor%3D%22middle%22%20font-size%3D%2242%22%20font-family%3D%22Arial%22%20font-weight%3D%22900%22%20fill%3D%22%23ffffff%22%3E${encodeURIComponent(label)}%3C/text%3E%3C/svg%3E`;
    }

    function getUserPhotoSource(user) {
        const candidates = [
            user?.driverFoto,
            user?.passengerFoto,
            user?.foto,
            user?.photo,
            user?.profilePhoto,
            user?.avatar
        ];
        return candidates.find(isValidImageSource) || '';
    }

    function renderUserAvatar(user, sizeClasses, fallbackBgClass = 'bg-gray-900') {
        const name = String(user?.name || user?.nombre || 'U').trim();
        const initial = (name.charAt(0) || 'U').toUpperCase();
        const photo = getUserPhotoSource(user);
        if (photo) {
            return `<img src="${photo}" onerror="this.outerHTML='<div class=&quot;${sizeClasses} ${fallbackBgClass} text-white rounded-2xl flex items-center justify-center font-black italic shadow-lg&quot;>${initial}</div>'" class="${sizeClasses} rounded-2xl object-cover shadow-lg">`;
        }
        return `<div class="${sizeClasses} ${fallbackBgClass} text-white rounded-2xl flex items-center justify-center font-black italic shadow-lg">${initial}</div>`;
    }

    function setImageOrFallback(img, fallback, src, initial = 'D') {
        if (!img || !fallback) return;
        if (isValidImageSource(src)) {
            img.onerror = function() {
                img.src = '';
                img.classList.add('hidden');
                fallback.classList.remove('hidden');
                fallback.innerText = initial;
            };
            img.src = src;
            img.classList.remove('hidden');
            fallback.classList.add('hidden');
        } else {
            img.src = '';
            img.classList.add('hidden');
            fallback.classList.remove('hidden');
            fallback.innerText = initial;
        }
    }

    function createDriverLoginValue(driverId) {
        const typedUser = getCleanValue('reg-user').toLowerCase();
        if (typedUser) return typedUser;
        return `driver_${String(driverId).replace(/^DRV_/, '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12).toLowerCase()}`;
    }

    function saveDriverRequest() {
        if (isSavingDriverRequest) return;
        isSavingDriverRequest = true;

        try {
            const db = getUsersDb();
            const driverId = buildUniqueDriverId(db);
            const driverName = getCleanValue('dr-name');
            const phoneValue = getCleanValue('dr-phone');
            const plateValue = getCleanValue('v-plate').toUpperCase();
            const userValue = createDriverLoginValue(driverId);
            const passValue = getCleanValue('reg-pass') || `DRV${String(driverId).slice(-6)}`;

            if (!driverName || !phoneValue || !plateValue) {
                alert('Completa nombre, teléfono y placa para finalizar el registro del conductor.');
                isSavingDriverRequest = false;
                return;
            }

            const newDriver = {
                id: driverId,
                name: driverName,
                usuario: userValue,
                pass: passValue,
                correo: getCleanValue('reg-email').toLowerCase(),
                phone: phoneValue,
                foto: tempBase64Photo || '',
                driverFoto: tempBase64Photo || '',
                ineFrontal: tempIneFrontPhoto || '',
                ineTrasera: tempIneBackPhoto || '',
                tarjetaCirculacion: tempCirculationPhoto || '',
                fotoVehiculo: tempVehiclePhoto || '',
                status: 'activo',
                role: 'conductor',
                date: new Date().toLocaleDateString(),
                createdAt: new Date().toISOString(),
                parentPassengerId: currentUser && currentUser.role === 'pasajero' ? currentUser.id : null,
                vehiculo: {
                    marca: getCleanValue('v-brand'),
                    modelo: getCleanValue('v-model'),
                    color: getCleanValue('v-color'),
                    year: getCleanValue('v-year'),
                    placa: plateValue
                }
            };

            // Guardado independiente: cada alta crea un nuevo conductor y no reemplaza registros anteriores.
            db.push(newDriver);
            saveUsersDb(db);

            // Cartera propia del conductor registrado.
            saveWalletData(driverId, { saldo: 0.00, historial: [], trips: 0 });

            // Sesión independiente y entrada automática al panel de conductor.
            currentUser = newDriver;
            persistPanelSession(newDriver);
            showDriverPanel();

            alert('¡Bienvenido Driver! Tu cuenta ha sido activada automáticamente.');
        } catch (error) {
            console.error('Error al guardar conductor:', error);
            alert('No se pudo finalizar el registro del conductor. Intenta nuevamente.');
        } finally {
            isSavingDriverRequest = false;
        }
    }

    // --- FUNCIONES DEL PANEL CONDUCTOR ---
    function toggleDriverAvailability() {

        isAvailable = !isAvailable;

        const statusBadge = document.getElementById('status-badge');
        const statusDot = document.getElementById('status-dot');
        const statusText = document.getElementById('status-text');

        const mainMsg = document.getElementById('driver-main-msg');
        

        const pulse = document.getElementById('search-pulse-driver');
        

        

        

        if (isAvailable) {

            statusBadge.classList.remove('bg-red-600/20','border-red-600/30');
            statusBadge.classList.add('bg-green-600/20','border-green-600/30');

            statusDot.classList.remove('bg-red-600');
            statusDot.classList.add('bg-green-500');

            statusText.classList.remove('text-red-600');
            statusText.classList.add('text-green-500');
            statusText.innerText = 'Disponible';

            mainMsg.innerText = 'Buscando viajes cercanos';

            pulse.classList.remove('hidden');

            



        } else {

            statusBadge.classList.remove('bg-green-600/20','border-green-600/30');
            statusBadge.classList.add('bg-red-600/20','border-red-600/30');

            statusDot.classList.remove('bg-green-500');
            statusDot.classList.add('bg-red-600');

            statusText.classList.remove('text-green-500');
            statusText.classList.add('text-red-600');
            statusText.innerText = 'No Disponible';

            pulse.classList.add('hidden');

            
        }

        renderDriverTripRequestCard();
        lucide.createIcons();
    }

    function openDriverSidebar() {
        updateDriverSidebarProfile();
        document.getElementById('driver-sidebar').classList.remove('-translate-x-full');
        document.getElementById('driver-sidebar-overlay').classList.remove('hidden');
    }

    function closeDriverSidebar() {
        document.getElementById('driver-sidebar').classList.add('-translate-x-full');
        document.getElementById('driver-sidebar-overlay').classList.add('hidden');
    }

    function getDriverProfileRating(driver) {
        const rawRating = driver?.calificacion || driver?.rating || driver?.driverRating || driver?.score || '5.0';
        const ratingNumber = Number(rawRating);
        return Number.isFinite(ratingNumber) ? ratingNumber.toFixed(1) : String(rawRating || '5.0');
    }

    function getDriverCompletedTrips(driver) {
        const walletTrips = driver?.id ? Number(getWalletData(driver.id).trips || 0) : 0;
        const driverTrips = Number(driver?.viajesRealizados || driver?.viajes || driver?.trips || 0);
        return Number.isFinite(driverTrips) && driverTrips > 0 ? driverTrips : walletTrips;
    }

    function updateDriverSidebarProfile() {
        if (!currentUser || currentUser.role !== 'conductor') return;

        const photo = document.getElementById('driver-menu-photo');
        const fallback = document.getElementById('driver-menu-photo-fallback');
        const name = document.getElementById('driver-menu-name');
        const rating = document.getElementById('driver-menu-rating');
        const trips = document.getElementById('driver-menu-trips');

        const driverPhoto = getUserPhotoSource(currentUser);
        if (photo && fallback) {
            setImageOrFallback(photo, fallback, driverPhoto, (currentUser.name || 'D').trim().charAt(0).toUpperCase() || 'D');
        }

        if (name) name.innerText = currentUser.name || 'Conductor';
        if (rating) rating.innerText = `★ ${getDriverProfileRating(currentUser)}`;
        if (trips) trips.innerText = getDriverCompletedTrips(currentUser);
    }

    function goToPassengerPanelFromDriver() {
        // Guardar sesión de conductor y restaurar la sesión/foto propia del pasajero.
        const existingDriver = currentUser && currentUser.role === 'conductor' ? currentUser : getExistingDriverForCurrentUser();
        if (existingDriver) persistPanelSession(existingDriver);

        const passengerUser = getPassengerForDriver(existingDriver) || getStoredPanelUser('pasajero');
        if (passengerUser) currentUser = passengerUser;
        showPassengerPanel();
    }

    function renderMockServices() {
        const list = document.getElementById('driver-services-list');
        list.innerHTML = `
            <div class="bg-white p-4 rounded-2xl border-2 border-red-600 shadow-lg animate-bounce-custom">
                <div class="flex justify-between items-start mb-3">
                    <div>
                        <p class="text-[8px] font-black text-gray-400 uppercase italic">Nuevo Servicio</p>
                        <h5 class="text-sm font-black italic uppercase">Usuario: Maria G.</h5>
                    </div>
                    <span class="bg-green-100 text-green-600 text-[10px] font-black px-2 py-1 rounded-lg">$85.00</span>
                </div>
                <div class="space-y-2 mb-4">
                    <div class="flex items-center gap-2">
                        <i data-lucide="map-pin" class="w-3 h-3 text-red-600"></i>
                        <span class="text-[9px] font-bold text-gray-600 uppercase">Centro Histórico</span>
                    </div>
                    <div class="flex items-center gap-2">
                        <i data-lucide="navigation" class="w-3 h-3 text-gray-400"></i>
                        <span class="text-[9px] font-bold text-gray-400 uppercase italic">A 1.2 km de ti</span>
                    </div>
                </div>
                <button type="button" onclick="alert('Viaje Aceptado')" class="w-full bg-green-600 text-white py-2 rounded-xl font-black text-[9px] uppercase italic">Aceptar Viaje</button>
            </div>
        `;
        lucide.createIcons();
    }

    function updateProfileUI() {
        if (!currentUser || currentUser.role !== 'pasajero') return;
        persistPanelSession(currentUser);
        const sideName = document.getElementById('side-user-name');
        const sideTrips = document.getElementById('side-user-trips');

        if (sideName) sideName.innerText = currentUser.name || 'Pasajero';
        setPassengerProfilePhoto(currentUser);

        const wallet = getWalletData(currentUser.id);
        if (sideTrips) sideTrips.innerText = wallet.trips || 0;
        updateWalletDisplay();
    }

    function handleAuth() {
        const userIn = document.getElementById('login-email').value.trim();
        const passIn = document.getElementById('login-pass').value.trim();
        
        if (userIn === 'admincentral' && passIn === '9271@') {
            currentUser = null;
            showAdminPanel();
        } else {
            const db = saveUsersDb(getUsersDb());
            const user = db.find(u => (u.usuario === userIn.toLowerCase() || u.correo === userIn.toLowerCase()) && u.pass === passIn);
            
            if (user) { 
                currentUser = user;
                persistPanelSession(user);
                if (user.role === 'conductor') {
                    showDriverPanel();
                } else {
                    showPassengerPanel();
                }
            } else { alert('Usuario o contraseña incorrectos'); }
        }
        lucide.createIcons();
    }


    let selectedUrbanServiceId = null;
    let urbanEditPhotoBase64 = null;

    function getServiciosUrbanosAdminData() {
        const defaults = {
            'taxi-expres': { nombre: 'Taxi Express', imagen: null, config: '', deleted: false },
            'motocicleta': { nombre: 'Motocicleta', imagen: null, config: '', deleted: false },
            'paqueteria': { nombre: 'Paquetería', imagen: null, config: '', deleted: false },
            'taxi-xl': { nombre: 'Taxi XL<br><span class="text-[8px] text-gray-400">10 personas</span>', imagen: null, config: '', deleted: false }
        };
        const saved = JSON.parse(localStorage.getItem('admin_servicios_viajes_urbanos') || '{}');
        const merged = { ...defaults };
        Object.keys(saved).forEach(id => {
            merged[id] = { ...(defaults[id] || { nombre: '', imagen: null, config: '', deleted: false }), ...saved[id] };
            if (!isValidImageSource(merged[id].imagen)) merged[id].imagen = null;
        });
        return merged;
    }

    function saveServiciosUrbanosAdminData(data) {
        localStorage.setItem('admin_servicios_viajes_urbanos', JSON.stringify(data));
    }

    function inicializarServiciosUrbanosAdmin() {
        const data = getServiciosUrbanosAdminData();
        Object.keys(data).forEach(id => {
            const card = document.getElementById(`service-card-${id}`);
            if (!card) return;
            const img = document.getElementById(`service-image-${id}`);
            const name = document.getElementById(`service-name-${id}`);

            card.dataset.urbanServiceId = id;
            card.setAttribute('onclick', `seleccionarServicioUrbano('${id}')`);
            card.classList.add('cursor-pointer');

            if (data[id].deleted) {
                card.classList.add('hidden');
                return;
            }

            card.classList.remove('hidden');
            card.dataset.config = data[id].config || '';
            if (img) {
                const fallbackImage = getInitialServiceImage(id);
                img.onerror = function() { this.onerror = null; this.src = fallbackImage; };
                img.src = isValidImageSource(data[id].imagen) ? data[id].imagen : fallbackImage;
            }
            if (name && data[id].nombre) name.innerHTML = data[id].nombre;
        });
        limpiarSeleccionServicioUrbano();
        cancelarEdicionServicioUrbano();
        renderPassengerUrbanServices();
    }

    function seleccionarServicioUrbano(id) {
        if (currentAdminView !== 'urban-trips') return;
        document.querySelectorAll('[data-urban-service-id]').forEach(card => {
            card.classList.remove('card-selected','ring-2','ring-red-500');
        });
        const card = document.getElementById(`service-card-${id}`);
        if (!card || card.classList.contains('hidden')) return;
        selectedUrbanServiceId = id;
        card.classList.add('card-selected','ring-2','ring-red-500');
    }

    function limpiarSeleccionServicioUrbano() {
        selectedUrbanServiceId = null;
        document.querySelectorAll('[data-urban-service-id]').forEach(card => {
            card.classList.remove('card-selected','ring-2','ring-red-500');
        });
    }

    function eliminarServicioUrbanoSeleccionado() {
        if (currentAdminView !== 'urban-trips' || !selectedUrbanServiceId) return;

        const data = getServiciosUrbanosAdminData();
        if (!data[selectedUrbanServiceId]) return;

        data[selectedUrbanServiceId].deleted = true;
        saveServiciosUrbanosAdminData(data);

        const card = document.getElementById(`service-card-${selectedUrbanServiceId}`);
        if (card) card.remove();

        selectedUrbanServiceId = null;
        cancelarEdicionServicioUrbano();
        lucide.createIcons();
    }

    function editarServicioSeleccionado() {
        if (currentAdminView !== 'urban-trips' || !selectedUrbanServiceId) return;

        const card = document.getElementById(`service-card-${selectedUrbanServiceId}`);
        if (!card) return;

        const name = document.getElementById(`service-name-${selectedUrbanServiceId}`);
        const img = document.getElementById(`service-image-${selectedUrbanServiceId}`);
        const panel = document.getElementById('urban-service-edit-panel');
        const inputName = document.getElementById('urban-edit-name');
        const inputConfig = document.getElementById('urban-edit-config');
        const preview = document.getElementById('urban-edit-preview');

        urbanEditPhotoBase64 = null;
        if (inputName && name) inputName.value = name.innerText.replace(/\s+/g, ' ').trim();
        if (inputConfig) inputConfig.value = card.dataset.config || '';
        if (preview && img) {
            preview.src = img.src;
            preview.classList.remove('hidden');
        }
        if (panel) panel.classList.remove('hidden');
        lucide.createIcons();
    }

    function previsualizarFotoServicioUrbano(input) {
        if (!input.files || !input.files[0]) return;
        const reader = new FileReader();
        reader.onload = function(e) {
            urbanEditPhotoBase64 = e.target.result;
            const preview = document.getElementById('urban-edit-preview');
            if (preview) {
                preview.src = urbanEditPhotoBase64;
                preview.classList.remove('hidden');
            }
        };
        reader.readAsDataURL(input.files[0]);
    }

    function guardarEdicionServicioUrbano() {
        if (currentAdminView !== 'urban-trips' || !selectedUrbanServiceId) return;

        const data = getServiciosUrbanosAdminData();
        const card = document.getElementById(`service-card-${selectedUrbanServiceId}`);
        const name = document.getElementById(`service-name-${selectedUrbanServiceId}`);
        const img = document.getElementById(`service-image-${selectedUrbanServiceId}`);
        const inputName = document.getElementById('urban-edit-name');
        const inputConfig = document.getElementById('urban-edit-config');

        if (!data[selectedUrbanServiceId]) data[selectedUrbanServiceId] = { nombre: '', imagen: null, config: '', deleted: false };

        if (inputName && inputName.value.trim()) {
            data[selectedUrbanServiceId].nombre = inputName.value.trim();
            if (name) name.innerHTML = inputName.value.trim();
        }

        if (urbanEditPhotoBase64) {
            data[selectedUrbanServiceId].imagen = urbanEditPhotoBase64;
            if (img) img.src = urbanEditPhotoBase64;
        }

        data[selectedUrbanServiceId].config = inputConfig ? inputConfig.value : '';
        if (card) card.dataset.config = data[selectedUrbanServiceId].config;

        saveServiciosUrbanosAdminData(data);
        renderPassengerUrbanServices();
        cancelarEdicionServicioUrbano();
        lucide.createIcons();
    }

    function cancelarEdicionServicioUrbano() {
        const panel = document.getElementById('urban-service-edit-panel');
        const photo = document.getElementById('urban-edit-photo');
        const preview = document.getElementById('urban-edit-preview');
        if (panel) panel.classList.add('hidden');
        if (photo) photo.value = '';
        if (preview) preview.classList.add('hidden');
        urbanEditPhotoBase64 = null;
    }

    function resetAdminTopDeleteButton() {
        const deleteBtnText = document.getElementById('admin-delete-btn-text');
        const editBtn = document.getElementById('admin-edit-btn');
        const taximeterScheduleBtn = document.getElementById('admin-taximeter-schedule-btn');
        const taximeterNewBtn = document.getElementById('admin-taximeter-new-btn');
        const taximeterConfigBtn = document.getElementById('admin-taximeter-config-btn');
        const taximeterSection = document.getElementById('urban-taximeter-section');

        if (deleteBtnText) deleteBtnText.innerText = 'Eliminar Selección';

        if (editBtn) {
            editBtn.classList.add('hidden');
            editBtn.classList.remove('inline-flex');
        }

        if (taximeterScheduleBtn) {
            taximeterScheduleBtn.classList.add('hidden');
            taximeterScheduleBtn.classList.remove('inline-flex');
        }

        if (taximeterNewBtn) {
            taximeterNewBtn.classList.add('hidden');
            taximeterNewBtn.classList.remove('inline-flex');
        }

        if (taximeterConfigBtn) {
            taximeterConfigBtn.classList.add('hidden');
            taximeterConfigBtn.classList.remove('inline-flex');
        }

        if (taximeterSection) taximeterSection.classList.add('hidden');

        taximeterSelectedUrbanServiceId = null;
        selectedTaximeterScheduleId = null;
        currentTaximeterConfigContext = null;
        limpiarSeleccionServicioUrbano();
        cancelarEdicionServicioUrbano();
    }

    function openUrbanTripsView() {
        closeAll();
        currentAdminView = 'urban-trips';
        selectedIds = [];

        const dashboard = document.getElementById('admin-dashboard');
        const wallet = document.getElementById('admin-wallet-section');
        const urbanTrips = document.getElementById('urban-trips-section');
        const taximeterSection = document.getElementById('urban-taximeter-section');
        const menuBtn = document.getElementById('admin-menu-btn');
        const backBtn = document.getElementById('admin-back-btn');
        const deleteBtnText = document.getElementById('admin-delete-btn-text');

        if (dashboard) dashboard.classList.add('hidden');
        if (wallet) wallet.classList.add('hidden');
        if (taximeterSection) taximeterSection.classList.add('hidden');
        if (urbanTrips) urbanTrips.classList.remove('hidden');
        if (menuBtn) menuBtn.classList.remove('hidden');
        if (backBtn) backBtn.classList.add('hidden');
        if (deleteBtnText) deleteBtnText.innerText = 'Borrar';
        const editBtn = document.getElementById('admin-edit-btn');
        if (editBtn) {
            editBtn.classList.remove('hidden');
            editBtn.classList.add('inline-flex');
        }
        const taximeterScheduleBtn = document.getElementById('admin-taximeter-schedule-btn');
        if (taximeterScheduleBtn) {
            taximeterScheduleBtn.classList.remove('hidden');
            taximeterScheduleBtn.classList.add('inline-flex');
        }
        const taximeterNewBtn = document.getElementById('admin-taximeter-new-btn');
        if (taximeterNewBtn) {
            taximeterNewBtn.classList.add('hidden');
            taximeterNewBtn.classList.remove('inline-flex');
        }
        const taximeterConfigBtn = document.getElementById('admin-taximeter-config-btn');
        if (taximeterConfigBtn) {
            taximeterConfigBtn.classList.add('hidden');
            taximeterConfigBtn.classList.remove('inline-flex');
        }
        selectedTaximeterScheduleId = null;
        currentTaximeterConfigContext = null;

        document.getElementById('admin-title').innerHTML = 'VIAJES <span class="text-red-600 text-lg">URBANOS</span>';
        inicializarServiciosUrbanosAdmin();
        lucide.createIcons();
    }


    function getTaximeterSchedulesUrbanTripsData() {
        return JSON.parse(localStorage.getItem('admin_horarios_taximetro_viajes_urbanos') || '{}');
    }

    function saveTaximeterSchedulesUrbanTripsData(data) {
        localStorage.setItem('admin_horarios_taximetro_viajes_urbanos', JSON.stringify(data));
    }

    function getTaximeterUrbanConfigData() {
        return JSON.parse(localStorage.getItem('admin_config_taximetro_viajes_urbanos') || '{}');
    }

    function saveTaximeterUrbanConfigData(data) {
        localStorage.setItem('admin_config_taximetro_viajes_urbanos', JSON.stringify(data));
    }

    function getTaximeterUrbanConfigKey(serviceId, scheduleId) {
        return `${serviceId}__${scheduleId}`;
    }

    function getTaximeterUrbanConfigForContext(serviceId, scheduleId) {
        const data = getTaximeterUrbanConfigData();
        return data[getTaximeterUrbanConfigKey(serviceId, scheduleId)] || null;
    }

    function setTaximeterUrbanConfigForContext(serviceId, scheduleId, config) {
        const data = getTaximeterUrbanConfigData();
        data[getTaximeterUrbanConfigKey(serviceId, scheduleId)] = config;
        saveTaximeterUrbanConfigData(data);
    }

    function getUrbanTaximeterSelectedSchedule() {
        if (!taximeterSelectedUrbanServiceId || !selectedTaximeterScheduleId) return null;
        const schedules = getTaximeterSchedulesUrbanTripsData()[taximeterSelectedUrbanServiceId] || [];
        return schedules.find(item => item.id === selectedTaximeterScheduleId) || null;
    }

    function prepararContextoTaximetroViajesUrbanos(schedule) {
        if (!schedule || !taximeterSelectedUrbanServiceId) return null;
        const context = {
            serviceId: taximeterSelectedUrbanServiceId,
            serviceName: getUrbanServiceDisplayName(taximeterSelectedUrbanServiceId),
            scheduleId: schedule.id,
            scheduleName: schedule.nombre,
            desde: schedule.desde,
            hasta: schedule.hasta,
            active: isNowInsideTaximeterSchedule(schedule),
            linkedAt: new Date().toISOString()
        };
        localStorage.setItem('admin_taximetro_contexto_viajes_urbanos', JSON.stringify(context));
        return context;
    }

    function getUrbanServiceDisplayName(serviceId) {
        const name = document.getElementById(`service-name-${serviceId}`);
        if (name) return name.innerText.replace(/\s+/g, ' ').trim();
        const data = getServiciosUrbanosAdminData();
        return (data[serviceId]?.nombre || serviceId).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    }


    const passengerUrbanServiceMeta = {
        'taxi-expres': { fixedName: 'Taxi Express', capacity: 'Hasta 4 personas', fallbackEta: '3 min' },
        'motocicleta': { fixedName: 'Motocicleta', capacity: '1 persona', fallbackEta: '2 min' },
        'paqueteria': { fixedName: 'Paquetería', capacity: 'Hasta 35 kg', fallbackEta: '4 min' },
        'taxi-xl': { fixedName: 'Taxi XL', capacity: 'Hasta 10 personas', fallbackEta: '6 min' }
    };

    function getPassengerUrbanServiceImage(serviceId) {
        const data = getServiciosUrbanosAdminData();
        if (isValidImageSource(data[serviceId]?.imagen)) return data[serviceId].imagen;
        const adminImage = document.getElementById(`service-image-${serviceId}`);
        const currentAdminSrc = adminImage ? (adminImage.getAttribute('src') || adminImage.src) : '';
        return isValidImageSource(currentAdminSrc) ? currentAdminSrc : getInitialServiceImage(serviceId);
    }

    function isKmInsideTaximeterRange(config, km) {
        if (!config || !config.kilometros) return false;
        const minKm = Number(config.kilometros.desde || 0);
        const maxKm = Number(config.kilometros.hasta || 0);
        if (!Number.isFinite(km) || km <= 0) return false;
        return km >= minKm && (maxKm <= 0 || km <= maxKm);
    }

    function getPassengerRouteMetricsForPricing() {
        return {
            km: Number(appState.routeDistanceKm || 0),
            minutes: Number(appState.routeDurationMinutes || 0)
        };
    }

    function getActiveTaximeterConfigForPassenger(serviceId, metrics = getPassengerRouteMetricsForPricing()) {
        const km = Number(metrics.km || 0);
        const schedules = getTaximeterSchedulesUrbanTripsData()[serviceId] || [];
        const activeSchedules = schedules.filter(schedule => isNowInsideTaximeterSchedule(schedule));
        const matchingConfigs = activeSchedules
            .map(schedule => {
                const config = getTaximeterUrbanConfigForContext(serviceId, schedule.id);
                return config ? { ...config, schedule } : null;
            })
            .filter(config => config && config.costos && isKmInsideTaximeterRange(config, km))
            .sort((a, b) => Number(b.kilometros?.desde || 0) - Number(a.kilometros?.desde || 0));

        return matchingConfigs[0] || null;
    }

    function calculatePassengerFinalPrice(serviceId) {
        if (!hasPassengerActiveRoute()) return 0;
        const metrics = getPassengerRouteMetricsForPricing();
        const estimatedKm = Number(metrics.km || 0);
        const estimatedMinutes = Number(metrics.minutes || 0);
        const config = getActiveTaximeterConfigForPassenger(serviceId, metrics);

        if (!config || !config.costos || estimatedKm <= 0) return 0;

        const initial = Number(config.costos.precioInicial || 0);
        const minute = Number(config.costos.precioPorMinuto || 0);
        const kmPrice = Number(config.costos.precioPorKilometro || 0);
        const total = initial + (minute * estimatedMinutes) + (kmPrice * estimatedKm);
        return total > 0 ? Number(total.toFixed(2)) : 0;
    }

    function getPassengerServiceEta(serviceId, index) {
        const drivers = getRegisteredDriversForPassengerOffers();
        if (drivers && drivers.length > 0) {
            const driver = drivers[index] || drivers[0];
            return driver.time || passengerUrbanServiceMeta[serviceId]?.fallbackEta || `${3 + (index * 2)} min`;
        }
        return passengerUrbanServiceMeta[serviceId]?.fallbackEta || `${3 + (index * 2)} min`;
    }

    function getPassengerServiceMeta(serviceId, index = 0) {
        const fixed = passengerUrbanServiceMeta[serviceId];
        const adminData = getServiciosUrbanosAdminData();
        if (fixed) return fixed;
        const adminName = adminData[serviceId]?.nombre || getUrbanServiceDisplayName(serviceId) || `Servicio ${index + 1}`;
        return { fixedName: adminName, capacity: adminData[serviceId]?.capacidad || 'Servicio disponible', fallbackEta: `${3 + (index * 2)} min` };
    }

    function getPassengerUrbanServiceIds() {
        const adminData = getServiciosUrbanosAdminData();
        const fixedIds = ['taxi-expres', 'motocicleta', 'paqueteria', 'taxi-xl'];
        const extraIds = Object.keys(adminData).filter(id => !fixedIds.includes(id));
        return [...fixedIds, ...extraIds].filter(id => !adminData[id]?.deleted);
    }

    function renderPassengerUrbanServices() {
        const container = document.getElementById('passenger-services-list');
        if (!container) return;
        removeDuplicatedPassengerServicesSections();

        const orderedIds = getPassengerUrbanServiceIds();
        container.innerHTML = orderedIds.map((serviceId, index) => {
            const meta = getPassengerServiceMeta(serviceId, index);
            const image = getPassengerUrbanServiceImage(serviceId);
            const eta = getPassengerServiceEta(serviceId, index);
            const price = calculatePassengerFinalPrice(serviceId);
            const selected = appState.selectedServiceId === serviceId;
            const priceText = price > 0 ? `$${price.toFixed(2)}` : '$0.00';
            return `
                <button type="button" id="passenger-service-${serviceId}" data-service-id="${serviceId}" onclick="selectPassengerUrbanService('${serviceId}')" class="passenger-service-option ${selected ? 'selected' : ''}">
                    <span class="passenger-service-photo-wrap">
                        <img src="${image}" alt="${meta.fixedName}" onerror="this.onerror=null;this.src=getInitialServiceImage('${serviceId}')" class="passenger-service-photo">
                    </span>
                    <span class="passenger-service-info">
                        <span class="passenger-service-title">${meta.fixedName}</span>
                        <span class="passenger-service-meta">
                            <span><i data-lucide="users" class="w-3 h-3"></i>${meta.capacity}</span>
                            <span id="passenger-service-eta-${serviceId}"><i data-lucide="clock" class="w-3 h-3"></i>${eta}</span>
                        </span>
                    </span>
                    <span class="passenger-service-price">
                        <strong id="passenger-service-price-${serviceId}">${priceText}</strong>
                        <small>${price > 0 ? 'MXN' : 'Sin ruta'}</small>
                    </span>
                </button>`;
        }).join('');

        if (!orderedIds.includes(appState.selectedServiceId)) {
            appState.selectedServiceId = orderedIds[0] || 'taxi-expres';
        }
        selectPassengerUrbanService(appState.selectedServiceId, true);
        lucide.createIcons();
    }

    function refreshPassengerServicePricesAndEta() {
        const orderedIds = getPassengerUrbanServiceIds();
        orderedIds.forEach((serviceId, index) => {
            const eta = getPassengerServiceEta(serviceId, index);
            const price = calculatePassengerFinalPrice(serviceId);
            const etaEl = document.getElementById(`passenger-service-eta-${serviceId}`);
            const priceEl = document.getElementById(`passenger-service-price-${serviceId}`);
            const cardEl = document.getElementById(`passenger-service-${serviceId}`);
            if (etaEl) etaEl.innerHTML = `<i data-lucide="clock" class="w-3 h-3"></i>${eta}`;
            if (priceEl) priceEl.innerText = price > 0 ? `$${price.toFixed(2)}` : '$0.00';
            const smallEl = cardEl ? cardEl.querySelector('.passenger-service-price small') : null;
            if (smallEl) smallEl.innerText = price > 0 ? 'MXN' : 'Sin ruta';
        });
        selectPassengerUrbanService(appState.selectedServiceId || orderedIds[0] || 'taxi-expres', true);
        lucide.createIcons();
    }

    function selectPassengerUrbanService(serviceId, silent = false) {
        appState.selectedServiceId = serviceId;
        appState.precioViaje = calculatePassengerFinalPrice(serviceId);

        document.querySelectorAll('.passenger-service-option').forEach(card => card.classList.remove('selected'));
        const selectedCard = document.getElementById(`passenger-service-${serviceId}`);
        if (selectedCard) selectedCard.classList.add('selected');

        const selectedPrice = document.getElementById('passenger-selected-price');
        if (selectedPrice) selectedPrice.innerText = appState.precioViaje > 0 ? `$${appState.precioViaje.toFixed(2)}` : '$0.00';
        const tripCost = document.getElementById('trip-cost');
        if (tripCost) tripCost.innerText = appState.precioViaje > 0 ? `$${appState.precioViaje.toFixed(2)} MXN` : '$0.00 MXN';

        if (!silent) lucide.createIcons();
    }


    function timeToMinutesTaximeter(value) {
        if (!value || !value.includes(':')) return 0;
        const parts = value.split(':').map(Number);
        return (parts[0] * 60) + parts[1];
    }

    function isNowInsideTaximeterSchedule(schedule, now = new Date()) {
        const current = (now.getHours() * 60) + now.getMinutes();
        const start = timeToMinutesTaximeter(schedule.desde);
        const end = timeToMinutesTaximeter(schedule.hasta);

        if (start === end) return true;
        if (start < end) return current >= start && current <= end;
        return current >= start || current <= end;
    }

    function getTaximeterServiceRealtimeStatus(serviceId) {
        const data = getTaximeterSchedulesUrbanTripsData();
        const schedules = data[serviceId] || [];
        const activeSchedules = schedules.filter(schedule => isNowInsideTaximeterSchedule(schedule));
        return {
            active: activeSchedules.length > 0,
            schedules,
            activeSchedules
        };
    }

    function formatTaximeterTime(value) {
        if (!value || !value.includes(':')) return '--:--';
        const [hourText, minuteText] = value.split(':');
        let hour = Number(hourText);
        const suffix = hour >= 12 ? 'PM' : 'AM';
        let displayHour = hour % 12;
        if (displayHour === 0) displayHour = 12;
        return `${String(displayHour).padStart(2, '0')}:${minuteText} ${suffix}`;
    }

    function renderHorariosTaximetroViajesUrbanos(showForm = false) {
        if (!taximeterSelectedUrbanServiceId) return;

        const taximeterSection = document.getElementById('urban-taximeter-section');
        if (!taximeterSection) return;

        const serviceId = taximeterSelectedUrbanServiceId;
        const serviceName = getUrbanServiceDisplayName(serviceId);
        const status = getTaximeterServiceRealtimeStatus(serviceId);
        const nowText = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const schedulesHtml = status.schedules.length === 0
            ? `<div class="bg-white rounded-2xl border border-dashed border-gray-300 p-6 text-center">
                    <i data-lucide="clock" class="w-7 h-7 text-gray-300 mx-auto mb-3"></i>
                    <p class="text-[10px] font-black text-gray-400 uppercase italic">Sin horarios creados para este servicio</p>
               </div>`
            : status.schedules.map(schedule => {
                const isActive = isNowInsideTaximeterSchedule(schedule);
                return `
                    <div id="taximeter-schedule-card-${schedule.id}" onclick="seleccionarHorarioTaximetroViajesUrbanos('${schedule.id}')" class="bg-white cursor-pointer rounded-2xl border ${selectedTaximeterScheduleId === schedule.id ? 'card-selected ring-2 ring-red-500' : (isActive ? 'border-green-200' : 'border-gray-200')} shadow-sm p-4 flex items-center justify-between gap-3 active:scale-[.99] transition-all">
                        <div class="min-w-0">
                            <p class="text-[8px] font-black text-gray-400 uppercase italic tracking-widest">${serviceName}</p>
                            <h4 class="text-sm font-black italic uppercase text-gray-900 truncate">${schedule.nombre}</h4>
                            <p class="text-[10px] font-black text-gray-500 uppercase italic mt-1">Desde ${formatTaximeterTime(schedule.desde)} hasta ${formatTaximeterTime(schedule.hasta)}</p>
                        </div>
                        <div class="flex flex-col items-end gap-2 shrink-0">
                            <span class="px-3 py-1 rounded-full text-[8px] font-black uppercase italic ${isActive ? 'bg-green-50 text-green-700 border border-green-100' : 'bg-red-50 text-red-600 border border-red-100'}">${isActive ? 'Activo' : 'Inactivo'}</span>
                            <button type="button" onclick="event.stopPropagation(); eliminarHorarioTaximetroViajesUrbanos('${schedule.id}')" class="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center active:scale-95 transition-all" title="Eliminar horario" aria-label="Eliminar horario">
                                <i data-lucide="trash-2" class="w-4 h-4 text-red-600"></i>
                            </button>
                        </div>
                    </div>`;
            }).join('');

        const formHtml = showForm ? `
            <div id="taximeter-schedule-form" class="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 mb-4">
                <div class="flex items-center justify-between mb-3">
                    <div>
                        <p class="text-[8px] font-black text-gray-400 uppercase italic tracking-widest">Nuevo horario</p>
                        <h3 class="text-sm font-black italic uppercase text-gray-900">Funcionamiento del taxímetro</h3>
                    </div>
                    <button type="button" onclick="renderHorariosTaximetroViajesUrbanos(false)" class="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center active:scale-95 transition-all" title="Cerrar" aria-label="Cerrar">
                        <i data-lucide="x" class="w-4 h-4"></i>
                    </button>
                </div>
                <div class="space-y-3">
                    <div>
                        <label class="reg-label">Nombre del horario</label>
                        <input type="text" id="taximeter-schedule-name" class="reg-input" placeholder="Ej: 24/7, Horario nocturno, Horario matutino">
                    </div>
                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <label class="reg-label">Desde</label>
                            <input type="time" id="taximeter-schedule-start" class="reg-input" value="00:00">
                        </div>
                        <div>
                            <label class="reg-label">Hasta</label>
                            <input type="time" id="taximeter-schedule-end" class="reg-input" value="23:00">
                        </div>
                    </div>
                    <div class="grid grid-cols-2 gap-3 pt-1">
                        <button type="button" onclick="renderHorariosTaximetroViajesUrbanos(false)" class="bg-gray-200 text-gray-700 py-3 rounded-xl font-black text-[10px] uppercase italic active:scale-95 transition-all">Cancelar</button>
                        <button type="button" onclick="guardarHorarioTaximetroViajesUrbanos()" class="bg-red-600 text-white py-3 rounded-xl font-black text-[10px] uppercase italic active:scale-95 transition-all">Guardar</button>
                    </div>
                </div>
            </div>` : '';

        taximeterSection.innerHTML = `
            <div class="mb-4 bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
                <p class="text-[8px] font-black text-gray-400 uppercase italic tracking-widest">Panel de Control / Servicios / Viajes urbanos</p>
                <h3 class="text-lg font-black italic uppercase text-gray-900 leading-none mt-1">Horarios del <span class="text-red-600">Taxímetro</span></h3>
                <p class="text-[9px] font-bold text-gray-400 uppercase italic mt-2">Servicio seleccionado: <span class="text-gray-900">${serviceName}</span></p>
            </div>

            <div class="bg-gray-900 text-white rounded-2xl p-4 mb-4 flex items-center justify-between gap-3">
                <div>
                    <p class="text-[8px] font-black text-gray-500 uppercase italic tracking-widest">Sincronizado con hora real</p>
                    <h4 id="taximeter-realtime-clock" class="text-sm font-black italic uppercase">${nowText}</h4>
                </div>
                <div class="text-right">
                    <p class="text-[8px] font-black text-gray-500 uppercase italic">Taxímetro</p>
                    <span id="taximeter-realtime-status" class="inline-flex mt-1 px-3 py-1 rounded-full text-[8px] font-black uppercase italic ${status.active ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-red-600/20 text-red-400 border border-red-600/30'}">${status.active ? 'Activado' : 'Desactivado'}</span>
                </div>
            </div>

            ${formHtml}

            <div class="space-y-3 pb-10">
                ${schedulesHtml}
            </div>`;

        lucide.createIcons();
    }

    function seleccionarHorarioTaximetroViajesUrbanos(scheduleId) {
        if (currentAdminView !== 'urban-taximeter' || !taximeterSelectedUrbanServiceId || !scheduleId) return;

        const schedules = getTaximeterSchedulesUrbanTripsData()[taximeterSelectedUrbanServiceId] || [];
        const schedule = schedules.find(item => item.id === scheduleId);
        if (!schedule) return;

        selectedTaximeterScheduleId = scheduleId;
        currentTaximeterConfigContext = prepararContextoTaximetroViajesUrbanos(schedule);

        document.querySelectorAll('[id^="taximeter-schedule-card-"]').forEach(card => {
            card.classList.remove('card-selected', 'ring-2', 'ring-red-500');
        });

        const card = document.getElementById(`taximeter-schedule-card-${scheduleId}`);
        if (card) card.classList.add('card-selected', 'ring-2', 'ring-red-500');
        lucide.createIcons();
    }

    function abrirPantallaTaximetroViajesUrbanos() {
        if (currentAdminView !== 'urban-taximeter' || !taximeterSelectedUrbanServiceId || !selectedTaximeterScheduleId) return;

        const data = getTaximeterSchedulesUrbanTripsData();
        const schedules = data[taximeterSelectedUrbanServiceId] || [];
        const schedule = schedules.find(item => item.id === selectedTaximeterScheduleId);
        if (!schedule) return;

        currentTaximeterConfigContext = prepararContextoTaximetroViajesUrbanos(schedule);
        currentAdminView = 'urban-taximeter-config';

        const dashboard = document.getElementById('admin-dashboard');
        const wallet = document.getElementById('admin-wallet-section');
        const urbanTrips = document.getElementById('urban-trips-section');
        const taximeterSection = document.getElementById('urban-taximeter-section');
        const editBtn = document.getElementById('admin-edit-btn');
        const taximeterScheduleBtn = document.getElementById('admin-taximeter-schedule-btn');
        const taximeterNewBtn = document.getElementById('admin-taximeter-new-btn');
        const taximeterConfigBtn = document.getElementById('admin-taximeter-config-btn');
        const deleteBtnText = document.getElementById('admin-delete-btn-text');

        if (dashboard) dashboard.classList.add('hidden');
        if (wallet) wallet.classList.add('hidden');
        if (urbanTrips) urbanTrips.classList.add('hidden');
        if (taximeterSection) {
            taximeterSection.classList.remove('hidden');
            taximeterSection.innerHTML = '';
        }
        if (deleteBtnText) deleteBtnText.innerText = 'Borrar';

        if (editBtn) {
            editBtn.classList.add('hidden');
            editBtn.classList.remove('inline-flex');
        }
        if (taximeterScheduleBtn) {
            taximeterScheduleBtn.classList.add('hidden');
            taximeterScheduleBtn.classList.remove('inline-flex');
        }
        if (taximeterNewBtn) {
            taximeterNewBtn.classList.remove('hidden');
            taximeterNewBtn.classList.add('inline-flex');
        }
        if (taximeterConfigBtn) {
            taximeterConfigBtn.classList.add('hidden');
            taximeterConfigBtn.classList.remove('inline-flex');
        }

        document.getElementById('admin-title').innerHTML = 'TAXÍMETRO <span class="text-red-600 text-lg">URBANO</span>';
        renderPantallaConfiguracionTaximetroUrbano(false);
        updateTaximeterRealtimeStatus();
        lucide.createIcons();
    }

    function guardarHorarioTaximetroViajesUrbanos() {
        if (currentAdminView !== 'urban-taximeter' || !taximeterSelectedUrbanServiceId) return;

        const nameInput = document.getElementById('taximeter-schedule-name');
        const startInput = document.getElementById('taximeter-schedule-start');
        const endInput = document.getElementById('taximeter-schedule-end');
        const nombre = nameInput ? nameInput.value.trim() : '';
        const desde = startInput ? startInput.value : '';
        const hasta = endInput ? endInput.value : '';

        if (!nombre || !desde || !hasta) {
            alert('Completa el nombre del horario, hora de inicio y hora final.');
            return;
        }

        const data = getTaximeterSchedulesUrbanTripsData();
        const serviceId = taximeterSelectedUrbanServiceId;
        if (!data[serviceId]) data[serviceId] = [];

        data[serviceId].push({
            id: `taximeter_${Date.now()}_${Math.random().toString(16).slice(2)}`,
            serviceId,
            nombre,
            desde,
            hasta,
            createdAt: new Date().toISOString()
        });

        saveTaximeterSchedulesUrbanTripsData(data);
        selectedTaximeterScheduleId = null;
        currentTaximeterConfigContext = null;
        renderHorariosTaximetroViajesUrbanos(false);
        updateTaximeterRealtimeStatus();
    }

    function eliminarHorarioTaximetroViajesUrbanos(scheduleId) {
        if (!taximeterSelectedUrbanServiceId || !scheduleId) return;

        const data = getTaximeterSchedulesUrbanTripsData();
        const serviceId = taximeterSelectedUrbanServiceId;
        data[serviceId] = (data[serviceId] || []).filter(schedule => schedule.id !== scheduleId);
        if (selectedTaximeterScheduleId === scheduleId) {
            selectedTaximeterScheduleId = null;
            currentTaximeterConfigContext = null;
            localStorage.removeItem('admin_taximetro_contexto_viajes_urbanos');
        }
        saveTaximeterSchedulesUrbanTripsData(data);
        renderHorariosTaximetroViajesUrbanos(false);
        updateTaximeterRealtimeStatus();
    }

    function updateTaximeterRealtimeStatus() {
        const allData = getTaximeterSchedulesUrbanTripsData();
        const realtimeState = {};

        Object.keys(allData).forEach(serviceId => {
            const schedules = allData[serviceId] || [];
            realtimeState[serviceId] = {
                active: schedules.some(schedule => isNowInsideTaximeterSchedule(schedule)),
                updatedAt: new Date().toISOString()
            };
        });

        localStorage.setItem('admin_estado_taximetro_viajes_urbanos', JSON.stringify(realtimeState));

        if (currentTaximeterConfigContext && currentTaximeterConfigContext.serviceId && currentTaximeterConfigContext.scheduleId) {
            const schedules = (allData[currentTaximeterConfigContext.serviceId] || []);
            const linkedSchedule = schedules.find(schedule => schedule.id === currentTaximeterConfigContext.scheduleId);
            if (linkedSchedule) {
                currentTaximeterConfigContext.active = isNowInsideTaximeterSchedule(linkedSchedule);
                currentTaximeterConfigContext.updatedAt = new Date().toISOString();
                localStorage.setItem('admin_taximetro_contexto_viajes_urbanos', JSON.stringify(currentTaximeterConfigContext));
            }
        }

        if ((currentAdminView === 'urban-taximeter' || currentAdminView === 'urban-taximeter-config') && taximeterSelectedUrbanServiceId) {
            const clock = document.getElementById('taximeter-realtime-clock');
            const statusBadge = document.getElementById('taximeter-realtime-status');
            const status = getTaximeterServiceRealtimeStatus(taximeterSelectedUrbanServiceId);

            if (clock) clock.innerText = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            if (statusBadge) {
                statusBadge.innerText = status.active ? 'Activado' : 'Desactivado';
                statusBadge.className = `inline-flex mt-1 px-3 py-1 rounded-full text-[8px] font-black uppercase italic ${status.active ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-red-600/20 text-red-400 border border-red-600/30'}`;
            }
        }
    }

    function abrirHorariosTaximetroViajesUrbanos() {
        if (currentAdminView !== 'urban-trips' || !selectedUrbanServiceId) return;

        taximeterSelectedUrbanServiceId = selectedUrbanServiceId;
        currentAdminView = 'urban-taximeter';

        const dashboard = document.getElementById('admin-dashboard');
        const wallet = document.getElementById('admin-wallet-section');
        const urbanTrips = document.getElementById('urban-trips-section');
        const taximeterSection = document.getElementById('urban-taximeter-section');
        const deleteBtnText = document.getElementById('admin-delete-btn-text');
        const editBtn = document.getElementById('admin-edit-btn');
        const taximeterScheduleBtn = document.getElementById('admin-taximeter-schedule-btn');
        const taximeterNewBtn = document.getElementById('admin-taximeter-new-btn');
        const taximeterConfigBtn = document.getElementById('admin-taximeter-config-btn');

        if (dashboard) dashboard.classList.add('hidden');
        if (wallet) wallet.classList.add('hidden');
        if (urbanTrips) urbanTrips.classList.add('hidden');
        if (taximeterSection) taximeterSection.classList.remove('hidden');

        if (deleteBtnText) deleteBtnText.innerText = 'Borrar';

        if (editBtn) {
            editBtn.classList.remove('hidden');
            editBtn.classList.add('inline-flex');
        }

        if (taximeterScheduleBtn) {
            taximeterScheduleBtn.classList.add('hidden');
            taximeterScheduleBtn.classList.remove('inline-flex');
        }

        if (taximeterNewBtn) {
            taximeterNewBtn.classList.remove('hidden');
            taximeterNewBtn.classList.add('inline-flex');
        }

        if (taximeterConfigBtn) {
            taximeterConfigBtn.classList.remove('hidden');
            taximeterConfigBtn.classList.add('inline-flex');
        }

        selectedTaximeterScheduleId = null;
        currentTaximeterConfigContext = null;

        document.getElementById('admin-title').innerHTML = 'HORARIOS <span class="text-red-600 text-lg">TAXÍMETRO</span>';
        cancelarEdicionServicioUrbano();
        renderHorariosTaximetroViajesUrbanos(false);
        updateTaximeterRealtimeStatus();
        lucide.createIcons();
    }

    function renderPantallaConfiguracionTaximetroUrbano(showForm = false) {
        if (!taximeterSelectedUrbanServiceId || !selectedTaximeterScheduleId) return;

        const taximeterSection = document.getElementById('urban-taximeter-section');
        if (!taximeterSection) return;

        const schedule = getUrbanTaximeterSelectedSchedule();
        if (!schedule) {
            taximeterSection.innerHTML = `
                <div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 text-center">
                    <i data-lucide="alert-circle" class="w-8 h-8 text-red-600 mx-auto mb-3"></i>
                    <p class="text-[10px] font-black text-gray-500 uppercase italic">El horario seleccionado ya no existe.</p>
                </div>`;
            lucide.createIcons();
            return;
        }

        currentTaximeterConfigContext = prepararContextoTaximetroViajesUrbanos(schedule);
        const serviceId = taximeterSelectedUrbanServiceId;
        const scheduleId = selectedTaximeterScheduleId;
        const serviceName = getUrbanServiceDisplayName(serviceId);
        const config = getTaximeterUrbanConfigForContext(serviceId, scheduleId);
        const status = getTaximeterServiceRealtimeStatus(serviceId);
        const nowText = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        const formHtml = showForm ? `
            <div id="taximeter-urban-config-form" class="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 mb-4">
                <div class="flex items-center justify-between mb-3">
                    <div>
                        <p class="text-[8px] font-black text-gray-400 uppercase italic tracking-widest">Nueva configuración</p>
                        <h3 class="text-sm font-black italic uppercase text-gray-900">Taxímetro urbano</h3>
                    </div>
                    <button type="button" onclick="renderPantallaConfiguracionTaximetroUrbano(false)" class="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center active:scale-95 transition-all" title="Cerrar" aria-label="Cerrar">
                        <i data-lucide="x" class="w-4 h-4"></i>
                    </button>
                </div>

                <div class="bg-gray-50 border border-gray-100 rounded-2xl p-3 mb-4">
                    <p class="text-[8px] font-black text-gray-400 uppercase italic">Enlazado a</p>
                    <h4 class="text-[11px] font-black uppercase italic text-gray-900 mt-1">${serviceName}</h4>
                    <p class="text-[9px] font-black text-red-600 uppercase italic mt-1">${schedule.nombre} · ${formatTaximeterTime(schedule.desde)} - ${formatTaximeterTime(schedule.hasta)}</p>
                </div>

                <div class="space-y-4">
                    <div>
                        <h4 class="text-[10px] font-black text-gray-900 uppercase italic mb-3">Kilómetros</h4>
                        <div class="grid grid-cols-2 gap-3">
                            <div>
                                <label class="reg-label">Desde</label>
                                <input type="number" id="taximeter-km-from" class="reg-input" min="0" step="0.01" placeholder="Kilómetro inicial" value="${config?.kilometros?.desde ?? 0}">
                            </div>
                            <div>
                                <label class="reg-label">Hasta</label>
                                <input type="number" id="taximeter-km-to" class="reg-input" min="0" step="0.01" placeholder="Límite máximo" value="${config?.kilometros?.hasta ?? ''}">
                            </div>
                        </div>
                    </div>

                    <div>
                        <h4 class="text-[10px] font-black text-gray-900 uppercase italic mb-3">Costos</h4>
                        <div class="space-y-3">
                            <div>
                                <label class="reg-label">Precio inicial</label>
                                <input type="number" id="taximeter-price-initial" class="reg-input" min="0" step="0.01" placeholder="Banderazo del taxímetro" value="${config?.costos?.precioInicial ?? ''}">
                            </div>
                            <div>
                                <label class="reg-label">Precio por minuto</label>
                                <input type="number" id="taximeter-price-minute" class="reg-input" min="0" step="0.01" placeholder="Costo por tráfico o tiempo transcurrido" value="${config?.costos?.precioPorMinuto ?? ''}">
                            </div>
                            <div>
                                <label class="reg-label">Precio por kilómetro</label>
                                <input type="number" id="taximeter-price-km" class="reg-input" min="0" step="0.01" placeholder="Costo según distancia recorrida" value="${config?.costos?.precioPorKilometro ?? ''}">
                            </div>
                        </div>
                    </div>

                    <div class="grid grid-cols-2 gap-3 pt-1">
                        <button type="button" onclick="renderPantallaConfiguracionTaximetroUrbano(false)" class="bg-gray-200 text-gray-700 py-3 rounded-xl font-black text-[10px] uppercase italic active:scale-95 transition-all">Cancelar</button>
                        <button type="button" onclick="guardarConfiguracionTaximetroUrbano()" class="bg-red-600 text-white py-3 rounded-xl font-black text-[10px] uppercase italic active:scale-95 transition-all">Guardar</button>
                    </div>
                </div>
            </div>` : '';

        const savedConfigHtml = config ? `
            <div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
                <div class="flex items-center justify-between mb-3">
                    <div>
                        <p class="text-[8px] font-black text-gray-400 uppercase italic tracking-widest">Configuración guardada</p>
                        <h3 class="text-sm font-black italic uppercase text-gray-900">${serviceName}</h3>
                    </div>
                    <span class="px-3 py-1 rounded-full text-[8px] font-black uppercase italic bg-green-50 text-green-700 border border-green-100">Activa</span>
                </div>
                <div class="grid grid-cols-2 gap-3 mb-3">
                    <div class="bg-gray-50 rounded-2xl p-3 border border-gray-100">
                        <p class="text-[8px] font-black text-gray-400 uppercase italic">Desde</p>
                        <h4 class="text-[12px] font-black uppercase italic text-gray-900">Km ${config.kilometros.desde}</h4>
                    </div>
                    <div class="bg-gray-50 rounded-2xl p-3 border border-gray-100 text-right">
                        <p class="text-[8px] font-black text-gray-400 uppercase italic">Hasta</p>
                        <h4 class="text-[12px] font-black uppercase italic text-gray-900">Km ${config.kilometros.hasta}</h4>
                    </div>
                </div>
                <div class="grid grid-cols-3 gap-2">
                    <div class="bg-gray-900 text-white rounded-2xl p-3">
                        <p class="text-[8px] font-black text-gray-500 uppercase italic">Inicial</p>
                        <h4 class="text-[11px] font-black uppercase italic">$${Number(config.costos.precioInicial).toFixed(2)}</h4>
                    </div>
                    <div class="bg-gray-900 text-white rounded-2xl p-3">
                        <p class="text-[8px] font-black text-gray-500 uppercase italic">Minuto</p>
                        <h4 class="text-[11px] font-black uppercase italic">$${Number(config.costos.precioPorMinuto).toFixed(2)}</h4>
                    </div>
                    <div class="bg-gray-900 text-white rounded-2xl p-3">
                        <p class="text-[8px] font-black text-gray-500 uppercase italic">Kilómetro</p>
                        <h4 class="text-[11px] font-black uppercase italic">$${Number(config.costos.precioPorKilometro).toFixed(2)}</h4>
                    </div>
                </div>
            </div>` : `
            <div class="bg-white rounded-2xl border border-dashed border-gray-300 p-6 text-center">
                <i data-lucide="plus-circle" class="w-7 h-7 text-gray-300 mx-auto mb-3"></i>
                <p class="text-[10px] font-black text-gray-400 uppercase italic">Sin configuración de costos para este horario</p>
                <p class="text-[9px] font-bold text-gray-400 uppercase italic mt-2">Pulsa el botón Nuevo de la barra superior.</p>
            </div>`;

        taximeterSection.innerHTML = `
            <div class="mb-4 bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
                <p class="text-[8px] font-black text-gray-400 uppercase italic tracking-widest">Panel de Control / Servicios / Viajes urbanos</p>
                <h3 class="text-lg font-black italic uppercase text-gray-900 leading-none mt-1">Taxímetro <span class="text-red-600">Urbano</span></h3>
                <p class="text-[9px] font-bold text-gray-400 uppercase italic mt-2">Servicio: <span class="text-gray-900">${serviceName}</span></p>
                <p class="text-[9px] font-bold text-gray-400 uppercase italic mt-1">Horario: <span class="text-gray-900">${schedule.nombre}</span> · ${formatTaximeterTime(schedule.desde)} - ${formatTaximeterTime(schedule.hasta)}</p>
            </div>

            <div class="bg-gray-900 text-white rounded-2xl p-4 mb-4 flex items-center justify-between gap-3">
                <div>
                    <p class="text-[8px] font-black text-gray-500 uppercase italic tracking-widest">Sincronizado con hora real</p>
                    <h4 id="taximeter-realtime-clock" class="text-sm font-black italic uppercase">${nowText}</h4>
                </div>
                <div class="text-right">
                    <p class="text-[8px] font-black text-gray-500 uppercase italic">Taxímetro</p>
                    <span id="taximeter-realtime-status" class="inline-flex mt-1 px-3 py-1 rounded-full text-[8px] font-black uppercase italic ${status.active ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-red-600/20 text-red-400 border border-red-600/30'}">${status.active ? 'Activado' : 'Desactivado'}</span>
                </div>
            </div>

            ${formHtml}

            <div class="space-y-3 pb-10">
                ${savedConfigHtml}
            </div>`;

        lucide.createIcons();
    }

    function guardarConfiguracionTaximetroUrbano() {
        if (currentAdminView !== 'urban-taximeter-config' || !taximeterSelectedUrbanServiceId || !selectedTaximeterScheduleId) return;

        const schedule = getUrbanTaximeterSelectedSchedule();
        if (!schedule) {
            alert('Selecciona un horario válido antes de guardar la configuración.');
            return;
        }

        const kmFrom = Number(document.getElementById('taximeter-km-from')?.value || 0);
        const kmTo = Number(document.getElementById('taximeter-km-to')?.value || 0);
        const priceInitial = Number(document.getElementById('taximeter-price-initial')?.value || 0);
        const priceMinute = Number(document.getElementById('taximeter-price-minute')?.value || 0);
        const priceKm = Number(document.getElementById('taximeter-price-km')?.value || 0);

        if (kmTo <= kmFrom) {
            alert('El límite máximo de kilómetros debe ser mayor al kilómetro inicial.');
            return;
        }

        if (priceInitial <= 0 || priceMinute < 0 || priceKm <= 0) {
            alert('Completa correctamente los costos del taxímetro.');
            return;
        }

        const config = {
            serviceId: taximeterSelectedUrbanServiceId,
            serviceName: getUrbanServiceDisplayName(taximeterSelectedUrbanServiceId),
            scheduleId: selectedTaximeterScheduleId,
            scheduleName: schedule.nombre,
            horario: {
                desde: schedule.desde,
                hasta: schedule.hasta
            },
            kilometros: {
                desde: kmFrom,
                hasta: kmTo
            },
            costos: {
                precioInicial: priceInitial,
                precioPorMinuto: priceMinute,
                precioPorKilometro: priceKm
            },
            updatedAt: new Date().toISOString()
        };

        setTaximeterUrbanConfigForContext(taximeterSelectedUrbanServiceId, selectedTaximeterScheduleId, config);
        currentTaximeterConfigContext = prepararContextoTaximetroViajesUrbanos(schedule);
        renderPantallaConfiguracionTaximetroUrbano(false);
        updateTaximeterRealtimeStatus();
    }

    function nuevoHorarioTaximetroViajesUrbanos() {
        if (!taximeterSelectedUrbanServiceId) return;
        if (currentAdminView === 'urban-taximeter') {
            renderHorariosTaximetroViajesUrbanos(true);
            return;
        }
        if (currentAdminView === 'urban-taximeter-config') {
            renderPantallaConfiguracionTaximetroUrbano(true);
        }
    }

    if (!window.taximeterUrbanTripsRealtimeInterval) {
        window.taximeterUrbanTripsRealtimeInterval = setInterval(updateTaximeterRealtimeStatus, 1000);
    }

    function renderAdminPassengers() {
        currentAdminView = 'passengers';
        selectedIds = [];
        resetAdminTopDeleteButton();
        const urbanTrips = document.getElementById('urban-trips-section');
        const taximeterSection = document.getElementById('urban-taximeter-section');
        if (urbanTrips) urbanTrips.classList.add('hidden');
        if (taximeterSection) taximeterSection.classList.add('hidden');
        document.getElementById('admin-dashboard').classList.remove('hidden');
        document.getElementById('admin-wallet-section').classList.add('hidden');
        document.getElementById('admin-menu-btn').classList.remove('hidden');
        document.getElementById('admin-back-btn').classList.add('hidden');
        document.getElementById('admin-title').innerHTML = 'PANEL <span class="text-red-600 text-lg">ADMIN</span>';

        const container = document.getElementById('admin-requests-container');

        const reqs = saveUsersDb(getUsersDb()).filter(user => user.role === 'pasajero');

        document.getElementById('admin-list-title').innerText = "Pasajeros Registrados";

        container.innerHTML = reqs.length === 0
            ? '<p class="text-center text-[9px] uppercase py-10">Sin pasajeros</p>'
            : '';

        reqs.forEach(req => {
            container.innerHTML += `
                <div id="card-${req.id}" onclick="toggleCardSelection('${req.id}')" class="bg-white p-5 rounded-[2rem] shadow-sm border border-gray-100 flex flex-col gap-4 cursor-pointer relative transition-all">
                    <div class="flex items-center justify-between">
                        <div class="flex items-center gap-3">
                            ${renderUserAvatar(req, 'w-12 h-12', 'bg-gray-900')}
                            <div>
                                <h4 class="text-[12px] font-black uppercase italic text-gray-900 leading-none">${req.name}</h4>
                                <p class="text-[8px] font-bold text-gray-400 mt-1">ID: ${req.id} | TEL: ${req.phone || 'N/A'}</p>
                            </div>
                        </div>
                        <span class="text-[8px] font-black px-3 py-1 bg-green-100 text-green-600 rounded-full uppercase italic border border-green-200">Activo</span>
                    </div>
                </div>`;
        });

        lucide.createIcons();
    }

    function renderAdminRequests() {
        currentAdminView = 'requests';
        selectedIds = [];
        resetAdminTopDeleteButton();
        const urbanTrips = document.getElementById('urban-trips-section');
        const taximeterSection = document.getElementById('urban-taximeter-section');
        if (urbanTrips) urbanTrips.classList.add('hidden');
        if (taximeterSection) taximeterSection.classList.add('hidden');
        document.getElementById('admin-dashboard').classList.remove('hidden');
        document.getElementById('admin-wallet-section').classList.add('hidden');
        document.getElementById('admin-menu-btn').classList.remove('hidden');
        document.getElementById('admin-back-btn').classList.add('hidden');
        document.getElementById('admin-title').innerHTML = 'PANEL <span class="text-red-600 text-lg">ADMIN</span>';

        const container = document.getElementById('admin-requests-container');

        const reqs = saveUsersDb(getUsersDb()).filter(user => user.role === 'conductor');

        document.getElementById('admin-list-title').innerText = "Conductores Registrados";

        container.innerHTML = reqs.length === 0
            ? '<p class="text-center text-[9px] uppercase py-10">Sin conductores</p>'
            : '';

        reqs.forEach(req => {
            container.innerHTML += `
                <div id="card-${req.id}" onclick="toggleCardSelection('${req.id}')" class="bg-white p-5 rounded-[2rem] shadow-sm border border-gray-100 flex flex-col gap-4 cursor-pointer relative transition-all">
                    <div class="flex items-center justify-between">
                        <div class="flex items-center gap-3">
                            ${renderUserAvatar(req, 'w-12 h-12', 'bg-red-600')}
                            <div>
                                <h4 class="text-[12px] font-black uppercase italic text-gray-900 leading-none">${req.name}</h4>
                                <p class="text-[8px] font-bold text-gray-400 mt-1">TEL: ${req.phone || 'NO REGISTRADO'}</p>
                                <p class="text-[8px] font-black text-red-600 uppercase mt-0.5">${req.vehiculo?.marca || 'Conductor'} - ${req.date}</p>
                            </div>
                        </div>
                        <span class="text-[8px] font-black px-3 py-1 bg-red-100 text-red-600 rounded-full uppercase italic">Conductor</span>
                    </div>
                </div>`;
        });

        lucide.createIcons();
    }

    function toggleCardSelection(id) {
        const card = document.getElementById(`card-${id}`);
        const idx = selectedIds.indexOf(String(id));
        if (idx > -1) { selectedIds.splice(idx, 1); card.classList.remove('card-selected'); }
        else { selectedIds.push(String(id)); card.classList.add('card-selected'); }
    }

    function eliminarSeleccionados() {
        if (currentAdminView === 'urban-trips') {
            eliminarServicioUrbanoSeleccionado();
            return;
        }
        if (currentAdminView === 'urban-taximeter') return;
        if (selectedIds.length === 0) { alert("Selecciona registros para eliminar"); return; }

        const idsToDelete = selectedIds.map(String);
        let db = getUsersDb();
        const roleToDelete = currentAdminView === 'passengers' ? 'pasajero' : 'conductor';

        const deletedUsers = db.filter(user => user.role === roleToDelete && idsToDelete.includes(String(user.id)));
        db = db.filter(user => !(user.role === roleToDelete && idsToDelete.includes(String(user.id))));
        saveUsersDb(db);

        deletedUsers.forEach(user => localStorage.removeItem(`wallet_${user.id}`));
        localStorage.removeItem('driver_requests');

        selectedIds = [];
        if (currentAdminView === 'passengers') renderAdminPassengers();
        else renderAdminRequests();
        alert("Registros eliminados.");
    }

    let userTargetAdmin = null;
    function openAdminWallet() { 
        closeAll();
        currentAdminView = 'wallet';
        selectedIds = [];
        resetAdminTopDeleteButton();
        const urbanTrips = document.getElementById('urban-trips-section');
        const taximeterSection = document.getElementById('urban-taximeter-section');
        if (urbanTrips) urbanTrips.classList.add('hidden');
        if (taximeterSection) taximeterSection.classList.add('hidden');
        document.getElementById('admin-dashboard').classList.add('hidden'); 
        document.getElementById('admin-wallet-section').classList.remove('hidden');
        document.getElementById('admin-menu-btn').classList.add('hidden');
        document.getElementById('admin-back-btn').classList.remove('hidden');
        document.getElementById('admin-title').innerHTML = 'CARTERA <span class="text-red-600 text-lg">ADMIN</span>';
    }
    function closeAdminWallet() { 
        resetAdminTopDeleteButton();
        const urbanTrips = document.getElementById('urban-trips-section');
        const taximeterSection = document.getElementById('urban-taximeter-section');
        if (urbanTrips) urbanTrips.classList.add('hidden');
        if (taximeterSection) taximeterSection.classList.add('hidden');
        document.getElementById('admin-dashboard').classList.remove('hidden');
        document.getElementById('admin-wallet-section').classList.add('hidden');
        document.getElementById('admin-menu-btn').classList.remove('hidden');
        document.getElementById('admin-back-btn').classList.add('hidden');
        document.getElementById('admin-title').innerHTML = 'PANEL <span class="text-red-600 text-lg">ADMIN</span>';
    }
    function searchPassengerInWallet() {
        const input = document.getElementById('admin-search-user');
        const term = (input?.value || '').toLowerCase().trim();
        const pasajeros = saveUsersDb(getUsersDb()).filter(u => u.role === 'pasajero');
        userTargetAdmin = pasajeros.find(u =>
            (u.name || '').toLowerCase().includes(term) ||
            (u.correo || '').toLowerCase().includes(term) ||
            (u.usuario || '').toLowerCase() === term ||
            String(u.phone || u.telefono || '').replace(/\D/g, '').includes(term.replace(/\D/g, ''))
        );

        const disp = document.getElementById('admin-view-saldo');
        const status = document.getElementById('admin-search-status');
        const list = document.getElementById('admin-movimientos-list');

        if (userTargetAdmin) {
            const wallet = getWalletData(userTargetAdmin.id);
            if (disp) disp.innerText = formatWalletBalance(wallet.saldo);
            if (status) status.innerText = `Pasajero: ${userTargetAdmin.name}`;
            renderHistorial(wallet.historial, list);
        } else {
            if (disp) disp.innerText = term ? 'No encontrado' : '$0.00 MXN';
            if (status) status.innerText = 'Saldo Actual del Pasajero';
            if (list) list.innerHTML = '';
        }
    }

    function renderHistorial(hist, container) {
        if (!container) return;
        const movimientos = Array.isArray(hist) ? hist : [];
        container.innerHTML = movimientos.length === 0 ? '<p class="text-[8px] text-center uppercase py-4">Sin movimientos</p>' : '';
        movimientos.forEach(m => {
            const amount = Number(m.monto || 0);
            const color = m.tipo === 'sumar' ? 'text-green-600' : 'text-red-600';
            const sign = m.tipo === 'sumar' ? '+' : '-';
            const saldoFinal = typeof m.saldoFinal === 'number' ? `<p class="text-[8px] font-black text-gray-400 uppercase italic">Saldo: ${formatWalletBalance(m.saldoFinal)}</p>` : '';
            container.innerHTML += `<div class="bg-white p-3 rounded-xl border flex justify-between items-center"><div><p class="text-[9px] uppercase italic font-black">${m.desc || 'Movimiento'}</p>${saldoFinal}</div><p class="text-[10px] font-black ${color}">${sign}$${amount.toFixed(2)}</p></div>`;
        });
    }

    function adminModificarSaldo(tipo) {
        if (!userTargetAdmin) { alert('Selecciona un pasajero válido.'); return; }
        const input = document.getElementById('admin-monto-input');
        const monto = parseFloat(input?.value || '0');
        if (isNaN(monto) || monto <= 0) { alert('Ingresa un monto válido.'); return; }

        addMovement(
            userTargetAdmin.id,
            tipo,
            monto,
            tipo === 'sumar' ? 'Recarga Admin' : 'Descuento Admin',
            { origen: 'panel_admin' }
        );

        if (input) input.value = '';
        refreshWalletViews(userTargetAdmin.id);
    }

    function updateWalletDisplay() {
        if (!currentUser) return;
        const wallet = getWalletData(currentUser.id);
        const display = document.getElementById('display-saldo');
        if (display) {
            display.innerText = formatWalletBalance(wallet.saldo);
            display.classList.toggle('text-red-400', Number(wallet.saldo) < 0);
            display.classList.toggle('text-green-400', Number(wallet.saldo) > 0);
        }
    }

    function getCurrentTripFinalCost() {
        refreshPassengerServicePricesAndEta();
        selectPassengerUrbanService(appState.selectedServiceId || 'taxi-expres', true);
        return Number(appState.precioViaje || calculatePassengerFinalPrice(appState.selectedServiceId || 'taxi-expres') || 0);
    }

    function canPassengerUseWalletForTrip(cost) {
        const wallet = getWalletData(currentUser.id);
        if (wallet.saldo < 0) {
            alert('Saldo negativo. Recarga para continuar.');
            return false;
        }
        if (appState.selectedPayment === 'cartera' && wallet.saldo < cost) {
            alert('Saldo insuficiente.');
            return false;
        }
        return true;
    }

    async function handleRequest() {
        const finalCost = getCurrentTripFinalCost();
        if (!hasPassengerActiveRoute()) { alert('Selecciona un destino real para calcular la ruta y las tarifas.'); return; }
        if (!finalCost || finalCost <= 0) { alert('Este servicio no tiene un horario/tarifa activa configurada para este momento.'); return; }
        if (!canPassengerUseWalletForTrip(finalCost)) return;

        appState.precioViaje = finalCost;
        appState.pendingTrip = {
            passengerId: currentUser.id,
            passengerName: currentUser.name || currentUser.nombre || 'Pasajero',
            passengerPhoto: getUserPhotoSource(currentUser),
            passengerRating: currentUser.rating || currentUser.calificacion || '5.0',
            passengerTrips: getWalletData(currentUser.id).trips || 0,
            passengerLocation: appState.passengerLocation || null,
            pickupAddress: appState.passengerAddress || 'Ubicación actual del pasajero',
            destinationAddress: appState.destinationAddress || 'Destino del pasajero',
            destinationLocation: appState.destinationLocation || null,
            serviceId: appState.selectedServiceId,
            paymentMethod: appState.selectedPayment,
            finalCost,
            distanceKm: Number(appState.routeDistanceKm || 0),
            durationMinutes: Number(appState.routeDurationMinutes || 0),
            routeSummary: appState.routeSummary || '',
            createdAt: new Date().toISOString(),
            charged: false
        };
        refreshWalletViews(currentUser.id);
        startRadar();

        const created = await publishPassengerTripRequest(appState.pendingTrip);
        if (!created) return;
    }

    function normalizeFirestoreTrip(trip = {}) {
        const driver = trip.driver || null;
        return {
            ...trip,
            id: String(trip.id || trip.viajeId || ''),
            status: trip.status || (trip.estado === 'aceptado' ? 'accepted' : 'pending'),
            passengerId: trip.passengerId || trip.pasajeroId || '',
            passengerName: trip.passengerName || trip.pasajeroNombre || 'Pasajero',
            passengerPhoto: trip.passengerPhoto || trip.pasajeroFoto || '',
            passengerRating: trip.passengerRating || trip.pasajeroCalificacion || '5.0',
            passengerTrips: Number(trip.passengerTrips || trip.pasajeroViajes || 0),
            pickupAddress: trip.pickupAddress || trip.origen || 'Ubicación actual del pasajero',
            destinationAddress: trip.destinationAddress || trip.destino || 'Destino del pasajero',
            paymentMethod: trip.paymentMethod || trip.metodoPago || 'efectivo',
            distanceKm: Number(trip.distanceKm || trip.distanciaKm || 0),
            finalCost: Number(trip.finalCost || trip.costo || 0),
            driver: driver || (trip.conductorId ? {
                id: trip.conductorId,
                name: trip.conductorNombre || 'Conductor',
                photo: trip.conductorFoto || '',
                rating: trip.conductorCalificacion || '5.0',
                brand: trip.conductorMarca || '',
                model: trip.conductorModelo || '',
                plate: trip.conductorPlaca || '',
                color: trip.conductorColor || '',
                phone: trip.conductorTelefono || '',
                time: trip.tiempoLlegada || '3 min',
                ubicacion: trip.conductorUbicacion || null
            } : null)
        };
    }

    function publishPassengerTripRequest(trip) {
        if (!currentUser || currentUser.role !== 'pasajero' || !trip) return null;
        const firebaseApi = window.DriveMXFirebase;
        if (!firebaseApi?.createTripRequest) {
            alert('Firebase todavía no está listo. Intenta nuevamente.');
            return null;
        }
        return firebaseApi.createTripRequest({
            ...trip,
            estado: 'pendiente',
            status: 'pending',
            pasajeroId: currentUser.id,
            pasajeroNombre: trip.passengerName || currentUser.name || currentUser.nombre || 'Pasajero',
            pasajeroFoto: trip.passengerPhoto || getUserPhotoSource(currentUser),
            pasajeroCalificacion: trip.passengerRating || currentUser.rating || currentUser.calificacion || '5.0',
            pasajeroViajes: Number(trip.passengerTrips || getWalletData(currentUser.id).trips || 0),
            origen: trip.pickupAddress || appState.passengerAddress || 'Ubicación actual del pasajero',
            destino: trip.destinationAddress || appState.destinationAddress || 'Destino del pasajero',
            metodoPago: trip.paymentMethod || appState.selectedPayment,
            distanciaKm: Number(trip.distanceKm || appState.routeDistanceKm || 0),
            costo: Number(trip.finalCost || appState.precioViaje || 0)
        }).then(createdTrip => {
            const tripId = createdTrip.id || createdTrip.viajeId;
            appState.pendingTrip = { ...appState.pendingTrip, requestId: tripId, viajeId: tripId, id: tripId };
            startPassengerPendingRequestWatcher();
            return createdTrip;
        }).catch(error => {
            console.error('Crear viaje Firestore:', error);
            alert(error.message || 'No se pudo crear el viaje en Firebase.');
            stopPassengerPendingRequestWatcher();
            const radar = document.getElementById('radar');
            const searchMsg = document.getElementById('search-msg');
            if (radar) radar.classList.add('hidden');
            if (searchMsg) searchMsg.classList.add('hidden');
            return null;
        });
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    }

    function formatDriverPickupDistance(request) {
        const driverLocation = currentUser?.ubicacion || null;
        const passengerLocation = request?.passengerLocation || null;
        if (driverLocation && passengerLocation && driverLocation.lat && driverLocation.lng && passengerLocation.lat && passengerLocation.lng) {
            const km = getDistanceKm(driverLocation.lat, driverLocation.lng, passengerLocation.lat, passengerLocation.lng);
            return `A ${km.toFixed(km < 10 ? 1 : 0)} km`;
        }
        const routeKm = Number(request?.distanceKm || 0);
        return routeKm > 0 ? `${routeKm.toFixed(routeKm < 10 ? 1 : 0)} km aprox.` : 'Distancia no disponible';
    }

    function startDriverPendingTripsRealtime() {
        if (!currentUser || currentUser.role !== 'conductor') return;
        if (driverPendingTripsUnsubscribe) driverPendingTripsUnsubscribe();
        const firebaseApi = window.DriveMXFirebase;
        if (!firebaseApi?.listenPendingTrips) {
            renderDriverTripRequestCard();
            return;
        }
        driverPendingTripsUnsubscribe = firebaseApi.listenPendingTrips(trips => {
            const conductorId = String(currentUser?.id || '');
            driverRealtimeTripRequests = (trips || [])
                .map(normalizeFirestoreTrip)
                .filter(trip => trip && trip.id && String(trip.passengerId) !== conductorId)
                .filter(trip => !(trip.rechazadoPor || []).map(String).includes(conductorId))
                .filter(trip => !rejectedTripIdsForCurrentDriver.has(String(trip.id)));
            renderDriverTripRequestCard();
        }, error => {
            const mainMsg = document.getElementById('driver-main-msg');
            if (mainMsg) mainMsg.innerText = error.message || 'No se pudieron escuchar viajes';
        });
    }

    function getLatestPendingTripRequestForCurrentDriver() {
        if (!currentUser || currentUser.role !== 'conductor') return null;
        return driverRealtimeTripRequests.find(req => req && req.status === 'pending') || null;
    }

    function renderDriverTripRequestCard() {
        const container = document.getElementById('driver-trip-request-list');
        const mainMsg = document.getElementById('driver-main-msg');
        if (!container) return;

        const request = getLatestPendingTripRequestForCurrentDriver();
        if (!request || !isAvailable) {
            container.classList.add('hidden');
            container.innerHTML = '';
            if (mainMsg && activePanel === 'driver') mainMsg.innerText = isAvailable ? 'Buscando viajes cercanos' : 'Actívate para recibir viajes';
            return;
        }

        const initial = escapeHtml((request.passengerName || 'P').charAt(0).toUpperCase());
        const photo = isValidImageSource(request.passengerPhoto)
            ? `<img src="${escapeHtml(request.passengerPhoto)}" onerror="this.outerHTML='<div class=&quot;driver-request-avatar-fallback bg-gray-900 text-white flex items-center justify-center font-black italic shadow-lg&quot;>${initial}</div>'" class="driver-request-avatar shadow-lg border-2 border-white" alt="Foto del pasajero">`
            : `<div class="driver-request-avatar-fallback bg-gray-900 text-white flex items-center justify-center font-black italic shadow-lg">${initial}</div>`;
        const encodedId = encodeURIComponent(request.id);
        const cost = Number(request.finalCost || 0);
        container.innerHTML = `
            <div class="driver-trip-request-card">
                <div class="flex items-start gap-3">
                    ${photo}
                    <div class="min-w-0 flex-1">
                        <div class="flex items-start justify-between gap-2">
                            <div class="min-w-0">
                                <p class="text-[8px] font-black text-red-600 uppercase italic tracking-widest">Nueva solicitud</p>
                                <h4 class="text-sm leading-none font-black italic uppercase text-gray-900 truncate">${escapeHtml(request.passengerName || 'Pasajero')}</h4>
                            </div>
                            <div class="text-right shrink-0">
                                <p class="text-base leading-none font-black italic text-gray-900">$${cost.toFixed(0)}</p>
                                <p class="text-[8px] font-black uppercase italic text-gray-400">MXN</p>
                            </div>
                        </div>
                        <div class="flex flex-wrap gap-1.5 mt-2">
                            <span class="driver-request-pill text-yellow-600">★ ${escapeHtml(request.passengerRating || '5.0')}</span>
                            <span class="driver-request-pill">${escapeHtml(getPaymentLabel(request.paymentMethod))}</span>
                            <span class="driver-request-pill">${escapeHtml(formatDriverPickupDistance(request))}</span>
                        </div>
                    </div>
                </div>

                <div class="mt-3 bg-gray-50 rounded-2xl border border-gray-100 p-3 space-y-2">
                    <div class="driver-request-route-row">
                        <span class="driver-request-route-dot bg-green-500"></span>
                        <p class="driver-request-route-text">${escapeHtml(request.pickupAddress || 'Ubicación actual del pasajero')}</p>
                    </div>
                    <div class="driver-request-route-row">
                        <span class="driver-request-route-dot bg-red-600"></span>
                        <p class="driver-request-route-text">${escapeHtml(request.destinationAddress || 'Destino del pasajero')}</p>
                    </div>
                </div>

                <div class="grid grid-cols-2 gap-2 mt-3">
                    <button type="button" onclick="acceptDriverTripRequest('${encodedId}')" class="driver-request-action bg-green-600 text-white shadow-lg shadow-green-600/20">Aceptar</button>
                    <button type="button" onclick="rejectDriverTripRequest('${encodedId}')" class="driver-request-action bg-gray-200 text-gray-700">Rechazar</button>
                </div>
            </div>`;
        container.classList.remove('hidden');
        if (mainMsg) mainMsg.innerText = 'Solicitud de viaje cercana';
        lucide.createIcons();
    }

    function calculateDriverEtaForTrip(request, driver) {
        const driverLocation = driver?.ubicacion || currentUser?.ubicacion || null;
        const passengerLocation = request?.passengerLocation || null;
        if (driverLocation && passengerLocation && driverLocation.lat && driverLocation.lng && passengerLocation.lat && passengerLocation.lng) {
            const km = getDistanceKm(driverLocation.lat, driverLocation.lng, passengerLocation.lat, passengerLocation.lng);
            return `${Math.max(2, Math.ceil((km / 28) * 60))} min`;
        }
        const routeKm = Number(request?.distanceKm || 0);
        return routeKm > 0 ? `${Math.max(3, Math.ceil((routeKm / 28) * 60))} min` : 'Calculando';
    }

    function getCurrentDriverOfferData() {
        if (!currentUser || currentUser.role !== 'conductor') return null;
        const vehicle = currentUser.vehiculo || {};
        const brand = vehicle.marca || currentUser.brand || 'Vehículo';
        const model = vehicle.modelo || currentUser.model || 'Modelo';
        const color = vehicle.color || currentUser.color || 'Color';
        const plate = vehicle.placa || currentUser.plate || 'N/A';
        return {
            id: currentUser.id,
            name: currentUser.name || currentUser.nombre || 'Conductor',
            rating: currentUser.rating || currentUser.calificacion || '5.0',
            color,
            brand,
            model,
            vehicle: `${brand} ${model}`.trim(),
            plate,
            phone: currentUser.phone || currentUser.telefono || '',
            photo: getUserPhotoSource(currentUser),
            ubicacion: currentUser.ubicacion || null,
            tiempoLlegada: 'Calculando'
        };
    }

    async function acceptDriverTripRequest(encodedRequestId) {
        const requestId = decodeURIComponent(encodedRequestId || '');
        const driverOffer = getCurrentDriverOfferData();
        const request = driverRealtimeTripRequests.find(req => String(req.id) === String(requestId));
        if (driverOffer) driverOffer.tiempoLlegada = calculateDriverEtaForTrip(request, driverOffer);
        const firebaseApi = window.DriveMXFirebase;
        if (!requestId || !driverOffer || !firebaseApi?.acceptTripRequest) return;
        try {
            await firebaseApi.acceptTripRequest(requestId, driverOffer);
            driverRealtimeTripRequests = driverRealtimeTripRequests.filter(req => String(req.id) !== String(requestId));
            renderDriverTripRequestCard();
            const mainMsg = document.getElementById('driver-main-msg');
            if (mainMsg) mainMsg.innerText = 'Viaje aceptado';
        } catch (error) {
            alert(error.message || 'No se pudo aceptar el viaje.');
            renderDriverTripRequestCard();
        }
    }

    async function rejectDriverTripRequest(encodedRequestId) {
        const requestId = decodeURIComponent(encodedRequestId || '');
        if (!requestId) return;
        rejectedTripIdsForCurrentDriver.add(String(requestId));
        driverRealtimeTripRequests = driverRealtimeTripRequests.filter(req => String(req.id) !== String(requestId));
        renderDriverTripRequestCard();
        try { await window.DriveMXFirebase?.rejectTripForDriver?.(requestId, currentUser?.id); } catch (error) { console.warn('Rechazo Firestore:', error.message || error); }
    }

    function stopPassengerPendingRequestWatcher() {
        if (passengerTripUnsubscribe) {
            passengerTripUnsubscribe();
            passengerTripUnsubscribe = null;
        }
    }

    function getAcceptedDriverForPassengerRequest() {
        const trip = appState.pendingTrip || {};
        return trip.driver || null;
    }

    function startPassengerPendingRequestWatcher() {
        const requestId = appState.pendingTrip?.requestId || appState.pendingTrip?.viajeId || appState.pendingTrip?.id;
        if (!requestId) return;
        stopPassengerPendingRequestWatcher();
        const firebaseApi = window.DriveMXFirebase;
        if (!firebaseApi?.listenTripById) return;
        passengerTripUnsubscribe = firebaseApi.listenTripById(requestId, tripDoc => {
            const trip = normalizeFirestoreTrip(tripDoc || {});
            if (!trip || !trip.id) return;
            appState.pendingTrip = { ...appState.pendingTrip, ...trip, requestId: trip.id, viajeId: trip.id };
            if (trip.status === 'accepted' && trip.driver) {
                stopPassengerPendingRequestWatcher();
                acceptDriverOffer(trip.driver);
            }
        }, error => console.warn('Escucha pasajero:', error.message || error));
    }

    function applyAutomaticTripWalletDiscount(tripData = null) {
        const trip = tripData || appState.pendingTrip || {};
        const passengerId = trip.passengerId || (currentUser && currentUser.id);
        const finalCost = Number(trip.finalCost || appState.precioViaje || 0);
        const paymentMethod = trip.paymentMethod || appState.selectedPayment;

        if (!passengerId || !finalCost || finalCost <= 0) return getWalletData(passengerId);

        let wallet = getWalletData(passengerId);
        if (paymentMethod === 'cartera') {
            wallet = addMovement(passengerId, 'restar', finalCost, 'Pago automático de viaje', {
                origen: 'viaje_finalizado',
                serviceId: trip.serviceId || appState.selectedServiceId,
                distanciaKm: Number(trip.distanceKm || appState.routeDistanceKm || 0),
                tiempoMinutos: Number(trip.durationMinutes || appState.routeDurationMinutes || 0),
                ruta: trip.routeSummary || appState.routeSummary || ''
            });
        }

        wallet.trips = Number(wallet.trips || 0) + 1;
        wallet = saveWalletData(passengerId, wallet);
        refreshWalletViews(passengerId);
        return wallet;
    }

    function finalizePassengerTrip() {
        if (!currentUser || currentUser.role !== 'pasajero') return;
        if (appState.pendingTrip && appState.pendingTrip.charged) return;

        applyAutomaticTripWalletDiscount(appState.pendingTrip);
        if (appState.pendingTrip) appState.pendingTrip.charged = true;

        clearActiveTripDriverTracking();
        clearActiveTripDriverTracking();
        activeTripData = null;
        closePassengerMessageModal();
        const activeTrip = document.getElementById('active-trip-passenger');
        const fixedCancel = document.getElementById('fixed-cancel-trip-btn');
        if (activeTrip) activeTrip.classList.add('hidden');
        if (fixedCancel) fixedCancel.classList.add('hidden');
        showPassengerPanel();
    }

    function completePassengerTrip() {
        finalizePassengerTrip();
    }

    function startRadar() {
        closeAll();
        document.getElementById('radar').classList.remove('hidden');
        document.getElementById('search-msg').classList.remove('hidden');
        document.getElementById('p-banners').classList.add('hidden-view');
        document.getElementById('p-wallet').classList.add('hidden-view');
        document.getElementById('p-header').classList.add('hidden-view');
        startPassengerPendingRequestWatcher();
    }

    function showDriverSelection() {
        document.getElementById('radar').classList.add('hidden');
        document.getElementById('search-msg').classList.add('hidden');
        document.getElementById('passenger-view').classList.add('hidden');
        document.getElementById('driver-selection-view').classList.remove('hidden');
        renderAvailableDrivers();
    }

    function getRegisteredDriversForPassengerOffers() {
        const dbDrivers = saveUsersDb(getUsersDb()).filter(user => user.role === 'conductor' && user.status === 'activo');
        return dbDrivers.map((driver, index) => {
            const vehicle = driver.vehiculo || {};
            const brand = vehicle.marca || driver.brand || 'Vehículo';
            const model = vehicle.modelo || driver.model || 'Modelo';
            const color = vehicle.color || driver.color || 'Color';
            const plate = vehicle.placa || driver.plate || 'N/A';
            return {
                id: driver.id,
                name: driver.name || 'Conductor',
                rating: driver.rating || driver.calificacion || '5.0',
                color,
                brand,
                model,
                vehicle: `${brand} ${model}`.trim(),
                plate,
                time: calculateDriverEta(driver, index),
                phone: driver.phone || driver.telefono || '',
                photo: getUserPhotoSource(driver),
                ubicacion: driver.ubicacion || null
            };
        });
    }

    function calculateDriverEta(driver, index = 0) {
        const passengerLocation = JSON.parse(localStorage.getItem('drive_mx_passenger_location') || 'null');
        const driverLocation = driver.ubicacion || null;
        if (passengerLocation && driverLocation && passengerLocation.lat && passengerLocation.lng && driverLocation.lat && driverLocation.lng) {
            const km = getDistanceKm(passengerLocation.lat, passengerLocation.lng, driverLocation.lat, driverLocation.lng);
            const minutes = Math.max(2, Math.ceil((km / 28) * 60));
            return `${minutes} min`;
        }
        return `${3 + (index * 2)} min`;
    }

    function getDistanceKm(lat1, lng1, lat2, lng2) {
        const R = 6371;
        const toRad = value => value * Math.PI / 180;
        const dLat = toRad(lat2 - lat1);
        const dLng = toRad(lng2 - lng1);
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function updatePassengerLocationForEta(callback) {
        if (!navigator.geolocation) { callback && callback(); return; }
        navigator.geolocation.getCurrentPosition(pos => {
            localStorage.setItem('drive_mx_passenger_location', JSON.stringify({
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                accuracy: pos.coords.accuracy,
                updatedAt: new Date().toISOString()
            }));
            callback && callback();
        }, () => { callback && callback(); }, { enableHighAccuracy: true, maximumAge: 60000, timeout: 5000 });
    }

    function renderAvailableDrivers() {
        activePanel = 'passenger-offers';
        const container = document.getElementById('driver-cards-container');
        container.innerHTML = '';
        updatePassengerLocationForEta(() => {
            const drivers = getRegisteredDriversForPassengerOffers();
            if (drivers.length === 0) {
                container.innerHTML = '<div class="bg-white p-6 rounded-[2rem] shadow-lg border text-center"><p class="text-[10px] font-black text-gray-500 uppercase italic">No hay conductores registrados disponibles.</p></div>';
                lucide.createIcons();
                return;
            }
            container.innerHTML = '';
            drivers.forEach(dr => {
                const encodedDriver = encodeURIComponent(JSON.stringify(dr));
                const driverInitial = (dr.name || 'D').charAt(0).toUpperCase();
                const avatar = isValidImageSource(dr.photo)
                    ? `<img src="${dr.photo}" onerror="this.outerHTML='<div class=&quot;w-14 h-14 bg-red-600 rounded-full flex items-center justify-center text-white font-black italic border-2 border-white shadow-lg&quot;>${driverInitial}</div>'" class="w-14 h-14 bg-red-600 rounded-full object-cover border-2 border-white shadow-lg">`
                    : `<div class="w-14 h-14 bg-red-600 rounded-full flex items-center justify-center text-white font-black italic border-2 border-white shadow-lg">${driverInitial}</div>`;
                container.innerHTML += `
                    <div class="bg-white p-5 rounded-[2rem] shadow-lg border flex flex-col space-y-4">
                        <div class="flex items-center gap-4">
                            ${avatar}
                            <div class="flex-1 min-w-0">
                                <h4 class="font-black italic uppercase text-xs truncate">${dr.name}</h4>
                                <p class="text-[9px] font-bold text-gray-400 uppercase truncate">${dr.vehicle} • ${dr.plate}</p>
                            </div>
                            <div class="text-right">
                                 <p class="text-[10px] font-black text-yellow-500">★ ${dr.rating}</p>
                                 <p class="text-[8px] font-bold text-gray-400 uppercase">${dr.time}</p>
                            </div>
                        </div>
                        <div class="grid grid-cols-2 gap-3">
                            <button type="button" onclick="acceptDriverOfferFromEncoded('${encodedDriver}')" class="bg-green-600 text-white py-3 rounded-2xl text-[10px] font-black uppercase italic active:scale-95 transition-all">Aceptar</button>
                            <button type="button" onclick="this.closest('.bg-white').remove()" class="bg-gray-200 text-gray-600 py-3 rounded-2xl text-[10px] font-black uppercase italic active:scale-95 transition-all">Rechazar</button>
                        </div>
                    </div>`;
            });
            lucide.createIcons();
        });
    }

    function acceptDriverOfferFromEncoded(encodedDriver) {
        try {
            acceptDriverOffer(JSON.parse(decodeURIComponent(encodedDriver)));
        } catch (error) {
            alert('No se pudo abrir la oferta del conductor.');
        }
    }

    function removeDuplicatedPassengerServicesSections() {
        const originalSheet = document.getElementById('cost-sheet');
        const originalList = document.getElementById('passenger-services-list');
        document.querySelectorAll('.passenger-services-list').forEach(list => {
            if (list !== originalList) {
                const duplicatedSheet = list.closest('#cost-sheet, .passenger-services-list, div');
                if (duplicatedSheet && duplicatedSheet !== originalSheet && duplicatedSheet.parentNode) duplicatedSheet.remove();
            }
        });
        document.querySelectorAll('[id="cost-sheet"]').forEach((sheet, index) => {
            if (index > 0) sheet.remove();
        });
    }

    let activeTripData = null;

    function getPaymentLabel(method) {
        const labels = { efectivo: 'Efectivo', spei: 'SPEI', cartera: 'Cartera' };
        return labels[method] || 'Efectivo';
    }

    function acceptDriverOffer(driver) {
        activePanel = 'passenger-trip';
        activeTripData = driver;
        if (appState.pendingTrip) {
            appState.pendingTrip.driverId = driver.id || '';
            appState.pendingTrip.driverName = driver.name || 'Conductor';
            appState.pendingTrip.acceptedAt = new Date().toISOString();
        }
        removeDuplicatedPassengerServicesSections();
        const costSheet = document.getElementById('cost-sheet');
        if (costSheet) costSheet.classList.remove('active', 'minimized');
        document.getElementById('driver-selection-view').classList.add('hidden');
        document.getElementById('passenger-view').classList.remove('hidden');
        closeAll();
        closeDriverSidebar();

        document.getElementById('radar').classList.add('hidden');
        document.getElementById('search-msg').classList.add('hidden');
        document.getElementById('p-header').classList.add('hidden-view');
        document.getElementById('p-banners').classList.add('hidden-view');
        document.getElementById('p-wallet').classList.add('hidden-view');

        const activeTrip = document.getElementById('active-trip-passenger');
        activeTrip.classList.remove('hidden');
        hideDriverArrivedPassengerBox();
        populateActiveTripSheet(driver);
        initActiveTripSheetDrag();
        document.getElementById('fixed-cancel-trip-btn').classList.remove('hidden');
        startActiveTripDriverTracking();

        lucide.createIcons();
    }

    function populateActiveTripSheet(driver) {
        const brand = driver.brand || (driver.vehicle || '').split(' ')[0] || 'Vehículo';
        const model = driver.model || (driver.vehicle || '').replace(brand, '').trim() || driver.vehicle || 'Modelo';
        document.getElementById('trip-driver-rating').innerText = `★ ${driver.rating || '5.0'}`;
        document.getElementById('trip-driver-name').innerText = driver.name || 'Conductor';
        document.getElementById('trip-driver-vehicle').innerText = `${driver.color || 'Color'} • ${brand} ${model}`;
        document.getElementById('trip-driver-plate').innerText = `Placa: ${driver.plate || 'N/A'}`;
        document.getElementById('trip-payment-method').innerText = getPaymentLabel(appState.selectedPayment);
        document.getElementById('trip-cost').innerText = `$${appState.precioViaje.toFixed(2)} MXN`;
        document.getElementById('trip-pickup').innerText = appState.passengerAddress || 'Ubicación actual del pasajero';
        document.getElementById('trip-destination').innerText = appState.destinationAddress || 'Destino del pasajero';

        const photo = document.getElementById('trip-driver-photo');
        const fallback = document.getElementById('trip-driver-fallback');
        setImageOrFallback(photo, fallback, driver.photo, (driver.name || 'D').charAt(0).toUpperCase());
    }

    function initActiveTripSheetDrag() {
        const sheet = document.getElementById('active-trip-sheet');
        if (!sheet || sheet.dataset.ready === 'true') return;
        sheet.dataset.ready = 'true';

        let startY = 0;
        let currentY = 0;
        let isDragging = false;

        const start = (e) => {
            isDragging = true;
            startY = e.touches ? e.touches[0].clientY : e.clientY;
            currentY = startY;
            sheet.classList.add('dragging');
        };
        const move = (e) => {
            if (!isDragging) return;
            currentY = e.touches ? e.touches[0].clientY : e.clientY;
            const delta = currentY - startY;
            const isMinimized = sheet.classList.contains('minimized');
            const base = isMinimized ? sheet.offsetHeight - 122 : 0;
            const next = Math.max(0, Math.min(sheet.offsetHeight - 122, base + delta));
            sheet.style.transform = `translateY(${next}px)`;
        };
        const end = () => {
            if (!isDragging) return;
            isDragging = false;
            sheet.classList.remove('dragging');
            sheet.style.transform = '';
            const delta = currentY - startY;
            if (delta > 45) sheet.classList.add('minimized');
            if (delta < -45) sheet.classList.remove('minimized');
        };

        sheet.addEventListener('touchstart', start, { passive: true });
        sheet.addEventListener('touchmove', move, { passive: true });
        sheet.addEventListener('touchend', end);
        sheet.addEventListener('mousedown', start);
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', end);
        sheet.addEventListener('click', (e) => {
            if (e.target.closest('button')) return;
            if (sheet.classList.contains('minimized')) sheet.classList.remove('minimized');
        });
    }


    function getActiveDriverPhone() {
        const driver = activeTripData || {};
        const rawPhone = String(driver.phone || driver.telefono || driver.celular || '').trim();
        return rawPhone.replace(/[^0-9+]/g, '');
    }

    function callActiveDriver() {
        if (activePanel !== 'passenger-trip') return;
        const phone = getActiveDriverPhone();
        if (!phone) {
            alert('Este conductor no tiene número registrado.');
            return;
        }
        window.location.href = `tel:${phone}`;
    }

    function openPassengerMessageModal() {
        if (activePanel !== 'passenger-trip') return;
        const modal = document.getElementById('passenger-message-modal');
        const input = document.getElementById('passenger-driver-message');
        const status = document.getElementById('passenger-message-status');
        if (!modal) return;
        if (status) { status.classList.add('hidden'); status.innerText = ''; }
        modal.classList.remove('hidden');
        setTimeout(() => input && input.focus(), 60);
        lucide.createIcons();
    }

    function closePassengerMessageModal() {
        const modal = document.getElementById('passenger-message-modal');
        if (modal) modal.classList.add('hidden');
    }

    function sendPassengerMessageToDriver() {
        if (activePanel !== 'passenger-trip') return;
        const input = document.getElementById('passenger-driver-message');
        const status = document.getElementById('passenger-message-status');
        const text = (input?.value || '').trim();
        if (!text) {
            alert('Escribe un mensaje para el conductor.');
            return;
        }
        const driver = activeTripData || {};
        const messages = JSON.parse(localStorage.getItem('drive_mx_trip_messages') || '[]');
        messages.unshift({
            id: 'MSG_' + Date.now(),
            tripDriverId: driver.id || '',
            driverName: driver.name || 'Conductor',
            passengerId: currentUser?.id || '',
            passengerName: currentUser?.name || 'Pasajero',
            message: text,
            createdAt: new Date().toLocaleString(),
            panel: 'passenger'
        });
        localStorage.setItem('drive_mx_trip_messages', JSON.stringify(messages));
        if (status) {
            status.innerText = 'Mensaje enviado al conductor dentro de la app.';
            status.classList.remove('hidden');
        }
        if (input) input.value = '';
    }


    function getStoredDriverLiveLocation(driver = activeTripData || {}) {
        if (!driver) return null;
        const driverId = driver.id || '';
        const direct = driverId ? JSON.parse(localStorage.getItem('drive_mx_driver_location_' + driverId) || 'null') : null;
        if (direct && direct.lat && direct.lng) return direct;
        const dbDriver = saveUsersDb(getUsersDb()).find(u => String(u.id) === String(driverId));
        if (dbDriver && dbDriver.ubicacion && dbDriver.ubicacion.lat && dbDriver.ubicacion.lng) return dbDriver.ubicacion;
        if (driver.ubicacion && driver.ubicacion.lat && driver.ubicacion.lng) return driver.ubicacion;
        return null;
    }

    function createSimulatedDriverStart(passengerPosition) {
        if (!passengerPosition) return null;
        return {
            lat: passengerPosition.lat - 0.012,
            lng: passengerPosition.lng - 0.010,
            simulated: true,
            updatedAt: new Date().toISOString()
        };
    }

    function moveDriverPositionTowardPickup(currentPosition, pickupPosition) {
        if (!currentPosition || !pickupPosition) return currentPosition;
        const distance = getDistanceKm(currentPosition.lat, currentPosition.lng, pickupPosition.lat, pickupPosition.lng);
        if (distance <= 0.035) return { ...pickupPosition, arrived: true, updatedAt: new Date().toISOString() };
        const stepRatio = Math.min(0.22, Math.max(0.05, 0.045 / Math.max(distance, 0.001)));
        return {
            lat: currentPosition.lat + ((pickupPosition.lat - currentPosition.lat) * stepRatio),
            lng: currentPosition.lng + ((pickupPosition.lng - currentPosition.lng) * stepRatio),
            simulated: currentPosition.simulated || false,
            updatedAt: new Date().toISOString()
        };
    }

    function ensureActiveTripMapObjects() {
        if (!passengerMap || typeof google === 'undefined' || !google.maps) return false;
        if (!activeTripDriverMarker) {
            activeTripDriverMarker = new google.maps.Marker({
                map: passengerMap,
                title: 'Conductor en camino',
                icon: {
                    path: google.maps.SymbolPath.CIRCLE,
                    scale: 9,
                    fillColor: '#ef4444',
                    fillOpacity: 1,
                    strokeColor: '#ffffff',
                    strokeWeight: 4
                }
            });
        }
        if (!activeTripDirectionsRenderer) {
            activeTripDirectionsRenderer = new google.maps.DirectionsRenderer({
                map: passengerMap,
                suppressMarkers: true,
                preserveViewport: false,
                polylineOptions: { strokeColor: '#ef4444', strokeWeight: 6, strokeOpacity: 0.95 }
            });
        }
        const activeTrip = document.getElementById('active-trip-passenger');
        if (activeTrip) activeTrip.classList.add('google-active');
        return true;
    }

    function clearActiveTripDriverTracking() {
        if (activeTripTrackingTimer) {
            clearInterval(activeTripTrackingTimer);
            activeTripTrackingTimer = null;
        }
        if (activeTripDriverMarker) {
            activeTripDriverMarker.setMap(null);
            activeTripDriverMarker = null;
        }
        if (activeTripDirectionsRenderer) {
            activeTripDirectionsRenderer.setMap(null);
            activeTripDirectionsRenderer = null;
        }
        activeTripDriverPosition = null;
        activeTripArrived = false;
        const activeTrip = document.getElementById('active-trip-passenger');
        if (activeTrip) activeTrip.classList.remove('google-active');
    }

    function updateActiveTripDriverTracking() {
        if (activePanel !== 'passenger-trip' || !activeTripData) return;
        if (!appState.passengerLocation) {
            const storedPassenger = JSON.parse(localStorage.getItem('drive_mx_passenger_location') || 'null');
            if (storedPassenger && storedPassenger.lat && storedPassenger.lng) appState.passengerLocation = { lat: storedPassenger.lat, lng: storedPassenger.lng };
        }
        const pickupPosition = appState.passengerLocation;
        if (!pickupPosition) return;

        let liveDriverPosition = getStoredDriverLiveLocation(activeTripData);
        if (!activeTripDriverPosition) activeTripDriverPosition = liveDriverPosition || createSimulatedDriverStart(pickupPosition);
        else if (liveDriverPosition && !liveDriverPosition.simulated) activeTripDriverPosition = liveDriverPosition;
        else activeTripDriverPosition = moveDriverPositionTowardPickup(activeTripDriverPosition, pickupPosition);

        if (!activeTripDriverPosition) return;
        if (ensureActiveTripMapObjects()) {
            const driverLatLng = new google.maps.LatLng(activeTripDriverPosition.lat, activeTripDriverPosition.lng);
            const pickupLatLng = new google.maps.LatLng(pickupPosition.lat, pickupPosition.lng);
            activeTripDriverMarker.setPosition(driverLatLng);
            if (passengerMapMarker) passengerMapMarker.setPosition(pickupLatLng);
            if (passengerDirectionsService && activeTripDirectionsRenderer) {
                passengerDirectionsService.route({
                    origin: driverLatLng,
                    destination: pickupLatLng,
                    travelMode: google.maps.TravelMode.DRIVING,
                    drivingOptions: { departureTime: new Date(), trafficModel: google.maps.TrafficModel.BEST_GUESS }
                }, (result, status) => {
                    if (activePanel !== 'passenger-trip' || !activeTripDirectionsRenderer) return;
                    if (status === 'OK') activeTripDirectionsRenderer.setDirections(result);
                });
            }
        }

        const distanceToPickup = getDistanceKm(activeTripDriverPosition.lat, activeTripDriverPosition.lng, pickupPosition.lat, pickupPosition.lng);
        if (!activeTripArrived && distanceToPickup <= 0.05) {
            activeTripArrived = true;
            showDriverArrivedPassengerBox();
            const messages = JSON.parse(localStorage.getItem('drive_mx_trip_messages') || '[]');
            messages.unshift({
                id: 'MSG_' + Date.now(),
                tripDriverId: activeTripData.id || '',
                driverName: activeTripData.name || 'Conductor',
                passengerId: currentUser?.id || '',
                passengerName: currentUser?.name || 'Pasajero',
                message: 'El conductor ha llegado',
                createdAt: new Date().toLocaleString(),
                panel: 'system',
                type: 'driver_arrived_pickup'
            });
            localStorage.setItem('drive_mx_trip_messages', JSON.stringify(messages));
        }
    }

    function startActiveTripDriverTracking() {
        hideDriverArrivedPassengerBox();
        clearActiveTripDriverTracking();
        activeTripArrived = false;
        if (googleMapsReady) initPassengerMap();
        updateActiveTripDriverTracking();
        activeTripTrackingTimer = setInterval(updateActiveTripDriverTracking, 3000);
    }

    function showDriverArrivedPassengerBox() {
        const box = document.getElementById('driver-arrived-passenger-box');
        if (box) box.classList.remove('hidden');
        lucide.createIcons();
    }

    let driverArrivedPassengerTimer = null;

    function hideDriverArrivedPassengerBox() {
        if (driverArrivedPassengerTimer) {
            clearTimeout(driverArrivedPassengerTimer);
            driverArrivedPassengerTimer = null;
        }
        const box = document.getElementById('driver-arrived-passenger-box');
        const status = document.getElementById('passenger-leaving-status');
        if (box) box.classList.add('hidden');
        if (status) {
            status.classList.add('hidden');
            status.innerText = 'El pasajero está saliendo';
        }
    }

    function scheduleDriverArrivedPassengerMessage() {
        // Compatibilidad: ya no se muestra por tiempo; se activa únicamente al llegar al punto de recogida.
        startActiveTripDriverTracking();
    }

    function notifyPassengerIsLeaving() {
        if (activePanel !== 'passenger-trip' || !activeTripData) return;
        const driver = activeTripData || {};
        const messages = JSON.parse(localStorage.getItem('drive_mx_trip_messages') || '[]');
        messages.unshift({
            id: 'MSG_' + Date.now(),
            tripDriverId: driver.id || '',
            driverName: driver.name || 'Conductor',
            passengerId: currentUser?.id || '',
            passengerName: currentUser?.name || 'Pasajero',
            message: 'El pasajero está saliendo',
            createdAt: new Date().toLocaleString(),
            panel: 'passenger',
            type: 'passenger_leaving'
        });
        localStorage.setItem('drive_mx_trip_messages', JSON.stringify(messages));

        const status = document.getElementById('passenger-leaving-status');
        if (status) {
            status.innerText = 'Notificación enviada al conductor: El pasajero está saliendo';
            status.classList.remove('hidden');
        }

        if (typeof refreshDriverPassengerNotifications === 'function') {
            refreshDriverPassengerNotifications();
        }
    }

    function refreshDriverPassengerNotifications() {
        const mainMsg = document.getElementById('driver-main-msg');
        if (!mainMsg || !currentUser || currentUser.role !== 'conductor') return;

        const messages = JSON.parse(localStorage.getItem('drive_mx_trip_messages') || '[]');
        const latestLeavingMessage = messages.find(msg =>
            msg &&
            msg.type === 'passenger_leaving' &&
            (!msg.tripDriverId || msg.tripDriverId === currentUser.id)
        );

        if (latestLeavingMessage) {
            mainMsg.innerText = latestLeavingMessage.message || 'El pasajero está saliendo';
        }
    }

    function shareTripWhatsApp() {
        const driver = activeTripData || {};
        const msg = `Estoy en un viaje de Drive MX. Conductor: ${driver.name || 'Conductor'}, vehículo: ${driver.color || ''} ${driver.vehicle || ''}, placa: ${driver.plate || 'N/A'}. Recogida: ${appState.passengerAddress || 'Ubicación actual del pasajero'}. Destino: ${appState.destinationAddress || 'Destino del pasajero'}.`;
        window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
    }

    function cancelPassengerTrip() {
        if (!confirm('¿Cancelar este viaje?')) return;
        activeTripData = null;
        closePassengerMessageModal();
        document.getElementById('active-trip-passenger').classList.add('hidden');
        document.getElementById('fixed-cancel-trip-btn').classList.add('hidden');
        showPassengerPanel();
    }

    function openMenu() {

        if(activePanel === 'driver') {
            openDriverSidebar();
            return;
        }

        document.getElementById('sidebar').classList.add('open');
        document.getElementById('overlay').classList.add('opacity-100', 'pointer-events-auto');
    }
    function closeAll() {
        document.getElementById('sidebar').classList.remove('open');
        const costSheet = document.getElementById('cost-sheet');
        if (costSheet && costSheet.classList.contains('active')) {
            minimizePassengerCostSheet();
        }
        document.getElementById('overlay').classList.remove('opacity-100', 'pointer-events-auto');
    }
    function toggleAccordion(id) { document.getElementById(id).classList.toggle('expanded'); }
    function openCosts() {
        if (!appState.destinationLocation) {
            hidePassengerCostsDuringDestinationSearch();
            return;
        }
        restorePassengerDestinationSearchState(false);
        renderPassengerUrbanServices();
        calculatePassengerRouteAndRefreshFares();
        const costSheet = document.getElementById('cost-sheet');
        if (costSheet) costSheet.classList.remove('minimized');
        if (costSheet) costSheet.style.transform = '';
        if (costSheet) costSheet.classList.add('active');
        document.getElementById('overlay').classList.add('opacity-100', 'pointer-events-auto');
    }
    function minimizePassengerCostSheet() {
        const costSheet = document.getElementById('cost-sheet');
        if (!costSheet) return;
        costSheet.classList.add('active', 'minimized');
        costSheet.style.transform = '';
        document.getElementById('overlay').classList.remove('opacity-100', 'pointer-events-auto');
    }
    function expandPassengerCostSheet() {
        const costSheet = document.getElementById('cost-sheet');
        if (!costSheet) return;
        renderPassengerUrbanServices();
        calculatePassengerRouteAndRefreshFares();
        costSheet.classList.remove('minimized');
        costSheet.style.transform = '';
        costSheet.classList.add('active');
        document.getElementById('overlay').classList.add('opacity-100', 'pointer-events-auto');
    }
    function initPassengerCostSheetDrag() {
        const sheet = document.getElementById('cost-sheet');
        if (!sheet || sheet.dataset.dragReady === 'true') return;
        sheet.dataset.dragReady = 'true';
        let startY = 0;
        let currentY = 0;
        let dragging = false;

        function getBaseTranslatePrefix() {
            return window.matchMedia('(min-width: 768px)').matches ? 'translateX(-50%) ' : '';
        }

        sheet.addEventListener('pointerdown', (event) => {
            if (event.target && event.target.closest && event.target.closest('button, input, textarea, select, .passenger-service-option, .payment-opt')) return;
            dragging = true;
            startY = event.clientY;
            currentY = event.clientY;
            sheet.classList.add('sheet-dragging');
            sheet.setPointerCapture(event.pointerId);
        });

        sheet.addEventListener('pointermove', (event) => {
            if (!dragging) return;
            currentY = event.clientY;
            const deltaY = currentY - startY;
            if (!sheet.classList.contains('minimized') && deltaY > 0) {
                sheet.style.transform = `${getBaseTranslatePrefix()}translateY(${Math.min(deltaY, 220)}px)`;
            } else if (sheet.classList.contains('minimized') && deltaY < 0) {
                sheet.style.transform = `${getBaseTranslatePrefix()}translateY(${Math.max(deltaY, -120)}px)`;
            }
        });

        function finishDrag(event) {
            if (!dragging) return;
            dragging = false;
            sheet.classList.remove('sheet-dragging');
            const deltaY = currentY - startY;
            sheet.style.transform = '';
            if (sheet.classList.contains('minimized')) {
                if (deltaY < -35) expandPassengerCostSheet();
            } else if (deltaY > 55) {
                minimizePassengerCostSheet();
            }
        }

        sheet.addEventListener('pointerup', finishDrag);
        sheet.addEventListener('pointercancel', finishDrag);
        sheet.addEventListener('click', (event) => {
            if (sheet.classList.contains('minimized') && !(event.target && event.target.closest && event.target.closest('#btn-confirmar'))) {
                expandPassengerCostSheet();
            }
        });
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initPassengerCostSheetDrag);
    } else {
        initPassengerCostSheetDrag();
    }
    function setPay(btn, method) { document.querySelectorAll('.payment-opt').forEach(b => b.classList.remove('selected')); btn.classList.add('selected'); appState.selectedPayment = method; }

    window.addEventListener('storage', (event) => {
        if (['admin_horarios_taximetro_viajes_urbanos', 'admin_config_taximetro_viajes_urbanos', 'admin_servicios_viajes_urbanos', 'db_usuarios_permanente'].includes(event.key)) {
            if (activePanel === 'passenger') {
                renderPassengerUrbanServices();
                calculatePassengerRouteAndRefreshFares();
            }
        }
        if (event.key && event.key.startsWith('wallet_')) {
            const userId = event.key.replace('wallet_', '');
            refreshWalletViews(userId);
        }
    });

    window.addEventListener('drive_mx_wallet_updated', (event) => {
        refreshWalletViews(event.detail?.userId || null);
        if (activePanel === 'driver') updateDriverSidebarProfile();
    });
    
    function goToStep(n) {
        const steps = ['step-photo', 'step-name', 'step-ine-front', 'step-ine-back', 'step-vehicle', 'step-circ', 'step-v-photo', 'step-phone', 'step-finish-driver', 'step-finish-passenger'];
        steps.forEach(s => { const el = document.getElementById(s); if(el) el.classList.add('hidden'); });
        const normalSteps = ['step-photo', 'step-name', 'step-ine-front', 'step-ine-back', 'step-vehicle', 'step-circ', 'step-v-photo', 'step-phone'];
        if (normalSteps[n - 1]) document.getElementById(normalSteps[n - 1]).classList.remove('hidden');
        currentStep = n;
        lucide.createIcons();
    }

    async function processFile(input, previewId, buttonId) {
        const file = getFileFromInput(input);
        if (!file) return;
        try {
            const base64 = await compressImageFile(file, 1280, 0.78);
            saveTempDocument(input.id, base64);
            const preview = document.getElementById(previewId);
            if (preview) {
                preview.src = base64;
                preview.classList.remove('hidden');
            }
            setButtonEnabled(buttonId, true);
        } catch (error) {
            console.error('Error al cargar archivo:', error);
            alert('No se pudo cargar la imagen. Intenta tomarla de nuevo o seleccionarla desde galería.');
            if (input) input.value = '';
        }
    }

    function checkName(i) {
        const nameOk = !!(i && String(i.value || '').trim().length > 3);
        setButtonEnabled('btn-name-next', nameOk);
    }
    function checkVehicle() {
        const plateOk = getCleanValue('v-plate').length > 0;
        setButtonEnabled('btn-v-next', plateOk);
    }
    function checkPhone(i) {
        const digits = String(i?.value || '').replace(/\D/g, '');
        setButtonEnabled('btn-phone-next', digits.length >= 10);
    }
    
    function getExistingDriverForCurrentUser() {
        const db = getUsersDb();
        if (!currentUser) return null;

        // Si la sesión activa ya es de conductor, regresar ese mismo registro guardado.
        if (currentUser.role === 'conductor') {
            return db.find(user =>
                user.role === 'conductor' && String(user.id) === String(currentUser.id)
            ) || currentUser;
        }

        // Si la sesión activa es pasajero, buscar el conductor creado desde esa cuenta.
        const currentId = String(currentUser.id || '');
        const currentUsuario = String(currentUser.usuario || '').toLowerCase().trim();
        const currentCorreo = String(currentUser.correo || '').toLowerCase().trim();
        const currentPhone = String(currentUser.phone || currentUser.telefono || '').replace(/\D/g, '');

        return db.find(user => {
            if (!user || user.role !== 'conductor') return false;
            const driverParentId = String(user.parentPassengerId || '');
            const driverUsuario = String(user.usuario || '').toLowerCase().trim();
            const driverCorreo = String(user.correo || '').toLowerCase().trim();
            const driverPhone = String(user.phone || user.telefono || '').replace(/\D/g, '');

            return (currentId && driverParentId === currentId) ||
                   (currentCorreo && driverCorreo && driverCorreo === currentCorreo) ||
                   (currentUsuario && driverUsuario && driverUsuario === currentUsuario) ||
                   (currentPhone && driverPhone && driverPhone === currentPhone);
        }) || null;
    }

    function applyToBeDriver() {
        const existingDriver = getExistingDriverForCurrentUser();

        // Si el conductor ya fue creado, NO abrir registro otra vez.
        // Entrar directo al panel existente y conservar datos guardados.
        if (existingDriver) {
            currentUser = existingDriver;
            persistPanelSession(existingDriver);
            closeAll();
            showDriverPanel();
            return;
        }

        activePanel = 'registration';
        registrationMode = 'driver';
        tempBase64Photo = '';
        tempIneFrontPhoto = '';
        tempIneBackPhoto = '';
        tempCirculationPhoto = '';
        tempVehiclePhoto = '';
        window.tempBase64Photo = '';
        window.tempIneFrontPhoto = '';
        window.tempIneBackPhoto = '';
        window.tempCirculationPhoto = '';
        window.tempVehiclePhoto = '';
        closeAll();
        document.getElementById('passenger-view').classList.add('hidden');
        document.getElementById('driver-registration-view').classList.remove('hidden');
        document.getElementById('reg-main-title').innerHTML = 'REGISTRO <span class="text-red-600 uppercase">DRIVER</span>';
        document.getElementById('fields-account').classList.add('hidden');
        goToStep(1);
    }

    function handleStepNameNext() { 
        if (registrationMode === 'passenger') goToStep(8); 
        else goToStep(3); 
    }

    function handleStepPhoneNext() {
        const steps = ['step-photo', 'step-name', 'step-ine-front', 'step-ine-back', 'step-vehicle', 'step-circ', 'step-v-photo', 'step-phone'];
        steps.forEach(s => { const el = document.getElementById(s); if(el) el.classList.add('hidden'); });
        if (registrationMode === 'passenger') document.getElementById('step-finish-passenger').classList.remove('hidden');
        else document.getElementById('step-finish-driver').classList.remove('hidden');
        lucide.createIcons();
    }

    function handleDriverBack() { activePanel = null; document.getElementById('driver-registration-view').classList.add('hidden'); document.getElementById('login-screen').classList.remove('hidden'); }
    window.addEventListener('drive_mx_trip_requests_updated', renderDriverTripRequestCard);



