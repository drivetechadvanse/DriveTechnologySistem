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

    function isKmInsideTaximeterRange(config, km) {
        if (!config || !config.kilometros) return false;
        const minKm = Number(config.kilometros.desde || 0);
        const maxKm = Number(config.kilometros.hasta || 0);
        if (!Number.isFinite(km) || km <= 0) return false;
        return km >= minKm && (maxKm <= 0 || km <= maxKm);
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
