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
