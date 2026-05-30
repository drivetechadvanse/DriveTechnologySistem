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
        if (!window.taximeterSelectedUrbanServiceId || !window.selectedTaximeterScheduleId) return null;
        const schedules = getTaximeterSchedulesUrbanTripsData()[window.taximeterSelectedUrbanServiceId] || [];
        return schedules.find(item => item.id === window.selectedTaximeterScheduleId) || null;
    }

    function prepararContextoTaximetroViajesUrbanos(schedule) {
        if (!schedule || !window.taximeterSelectedUrbanServiceId) return null;
        const context = {
            serviceId: window.taximeterSelectedUrbanServiceId,
            serviceName: getUrbanServiceDisplayName(window.taximeterSelectedUrbanServiceId),
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


    function isKmInsideTaximeterRange(config, km) {
        if (!config || !config.kilometros) return false;
        const minKm = Number(config.kilometros.desde || 0);
        const maxKm = Number(config.kilometros.hasta || 0);
        if (!Number.isFinite(km) || km <= 0) return false;
        return km >= minKm && (maxKm <= 0 || km <= maxKm);
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

