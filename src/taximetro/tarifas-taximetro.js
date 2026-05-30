    function calculatePassengerRouteAndRefreshFares(fitRoute = false) {
        if (!window.appState.passengerLocation || !window.appState.destinationLocation || !window.passengerDirectionsService) {
            resetPassengerRoutePricing('Selecciona destino para calcular tarifas');
            return;
        }

        window.passengerDirectionsService.route({
            origin: window.appState.passengerLocation,
            destination: window.appState.destinationLocation,
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
                window.appState.routeDistanceKm = km;
                window.appState.routeDurationMinutes = Math.max(1, Math.ceil(seconds / 60));
                window.appState.routeSummary = `${km.toFixed(1)} km • ${window.appState.routeDurationMinutes} min`;

                const routeSummaryEl = document.getElementById('passenger-route-summary');
                if (routeSummaryEl) routeSummaryEl.innerText = window.appState.routeSummary;

                if (window.passengerDirectionsRenderer) window.passengerDirectionsRenderer.set('directions', null);
                animatePassengerRouteLine(result.routes[0]);
                refreshPassengerServicePricesAndEta();
            } else {
                resetPassengerRoutePricing('No se pudo calcular la ruta');
            }
        });
    }

    function startPassengerFareRealtimeSync() {
        if (window.passengerRealtimeFareTimer) clearInterval(window.passengerRealtimeFareTimer);
        window.passengerRealtimeFareTimer = setInterval(() => {
            if (window.activePanel === 'passenger') calculatePassengerRouteAndRefreshFares();
        }, 15000);
    }


    function getPassengerRouteMetricsForPricing() {
        return {
            km: Number(window.appState.routeDistanceKm || 0),
            minutes: Number(window.appState.routeDurationMinutes || 0)
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


    function renderPantallaConfiguracionTaximetroUrbano(showForm = false) {
        if (!window.taximeterSelectedUrbanServiceId || !window.selectedTaximeterScheduleId) return;

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

        window.currentTaximeterConfigContext = prepararContextoTaximetroViajesUrbanos(schedule);
        const serviceId = window.taximeterSelectedUrbanServiceId;
        const scheduleId = window.selectedTaximeterScheduleId;
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
        if (window.currentAdminView !== 'urban-taximeter-config' || !window.taximeterSelectedUrbanServiceId || !window.selectedTaximeterScheduleId) return;

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
            serviceId: window.taximeterSelectedUrbanServiceId,
            serviceName: getUrbanServiceDisplayName(window.taximeterSelectedUrbanServiceId),
            scheduleId: window.selectedTaximeterScheduleId,
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

        setTaximeterUrbanConfigForContext(window.taximeterSelectedUrbanServiceId, window.selectedTaximeterScheduleId, config);
        window.currentTaximeterConfigContext = prepararContextoTaximetroViajesUrbanos(schedule);
        renderPantallaConfiguracionTaximetroUrbano(false);
        updateTaximeterRealtimeStatus();
    }


