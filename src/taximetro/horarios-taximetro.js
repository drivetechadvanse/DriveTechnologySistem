    function getTaximeterSchedulesUrbanTripsData() {
        return JSON.parse(localStorage.getItem('admin_horarios_taximetro_viajes_urbanos') || '{}');
    }

    function saveTaximeterSchedulesUrbanTripsData(data) {
        localStorage.setItem('admin_horarios_taximetro_viajes_urbanos', JSON.stringify(data));
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
        if (!window.taximeterSelectedUrbanServiceId) return;

        const taximeterSection = document.getElementById('urban-taximeter-section');
        if (!taximeterSection) return;

        const serviceId = window.taximeterSelectedUrbanServiceId;
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
                    <div id="taximeter-schedule-card-${schedule.id}" onclick="seleccionarHorarioTaximetroViajesUrbanos('${schedule.id}')" class="bg-white cursor-pointer rounded-2xl border ${window.selectedTaximeterScheduleId === schedule.id ? 'card-selected ring-2 ring-red-500' : (isActive ? 'border-green-200' : 'border-gray-200')} shadow-sm p-4 flex items-center justify-between gap-3 active:scale-[.99] transition-all">
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
        if (window.currentAdminView !== 'urban-taximeter' || !window.taximeterSelectedUrbanServiceId || !scheduleId) return;

        const schedules = getTaximeterSchedulesUrbanTripsData()[window.taximeterSelectedUrbanServiceId] || [];
        const schedule = schedules.find(item => item.id === scheduleId);
        if (!schedule) return;

        window.selectedTaximeterScheduleId = scheduleId;
        window.currentTaximeterConfigContext = prepararContextoTaximetroViajesUrbanos(schedule);

        document.querySelectorAll('[id^="taximeter-schedule-card-"]').forEach(card => {
            card.classList.remove('card-selected', 'ring-2', 'ring-red-500');
        });

        const card = document.getElementById(`taximeter-schedule-card-${scheduleId}`);
        if (card) card.classList.add('card-selected', 'ring-2', 'ring-red-500');
        lucide.createIcons();
    }

    function abrirPantallaTaximetroViajesUrbanos() {
        if (window.currentAdminView !== 'urban-taximeter' || !window.taximeterSelectedUrbanServiceId || !window.selectedTaximeterScheduleId) return;

        const data = getTaximeterSchedulesUrbanTripsData();
        const schedules = data[window.taximeterSelectedUrbanServiceId] || [];
        const schedule = schedules.find(item => item.id === window.selectedTaximeterScheduleId);
        if (!schedule) return;

        window.currentTaximeterConfigContext = prepararContextoTaximetroViajesUrbanos(schedule);
        window.currentAdminView = 'urban-taximeter-config';

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
        if (window.currentAdminView !== 'urban-taximeter' || !window.taximeterSelectedUrbanServiceId) return;

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
        const serviceId = window.taximeterSelectedUrbanServiceId;
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
        window.selectedTaximeterScheduleId = null;
        window.currentTaximeterConfigContext = null;
        renderHorariosTaximetroViajesUrbanos(false);
        updateTaximeterRealtimeStatus();
    }

    function eliminarHorarioTaximetroViajesUrbanos(scheduleId) {
        if (!window.taximeterSelectedUrbanServiceId || !scheduleId) return;

        const data = getTaximeterSchedulesUrbanTripsData();
        const serviceId = window.taximeterSelectedUrbanServiceId;
        data[serviceId] = (data[serviceId] || []).filter(schedule => schedule.id !== scheduleId);
        if (window.selectedTaximeterScheduleId === scheduleId) {
            window.selectedTaximeterScheduleId = null;
            window.currentTaximeterConfigContext = null;
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

        if (window.currentTaximeterConfigContext && window.currentTaximeterConfigContext.serviceId && window.currentTaximeterConfigContext.scheduleId) {
            const schedules = (allData[window.currentTaximeterConfigContext.serviceId] || []);
            const linkedSchedule = schedules.find(schedule => schedule.id === window.currentTaximeterConfigContext.scheduleId);
            if (linkedSchedule) {
                window.currentTaximeterConfigContext.active = isNowInsideTaximeterSchedule(linkedSchedule);
                window.currentTaximeterConfigContext.updatedAt = new Date().toISOString();
                localStorage.setItem('admin_taximetro_contexto_viajes_urbanos', JSON.stringify(window.currentTaximeterConfigContext));
            }
        }

        if ((window.currentAdminView === 'urban-taximeter' || window.currentAdminView === 'urban-taximeter-config') && window.taximeterSelectedUrbanServiceId) {
            const clock = document.getElementById('taximeter-realtime-clock');
            const statusBadge = document.getElementById('taximeter-realtime-status');
            const status = getTaximeterServiceRealtimeStatus(window.taximeterSelectedUrbanServiceId);

            if (clock) clock.innerText = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            if (statusBadge) {
                statusBadge.innerText = status.active ? 'Activado' : 'Desactivado';
                statusBadge.className = `inline-flex mt-1 px-3 py-1 rounded-full text-[8px] font-black uppercase italic ${status.active ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-red-600/20 text-red-400 border border-red-600/30'}`;
            }
        }
    }

    function abrirHorariosTaximetroViajesUrbanos() {
        if (window.currentAdminView !== 'urban-trips' || !window.selectedUrbanServiceId) return;

        window.taximeterSelectedUrbanServiceId = window.selectedUrbanServiceId;
        window.currentAdminView = 'urban-taximeter';

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

        window.selectedTaximeterScheduleId = null;
        window.currentTaximeterConfigContext = null;

        document.getElementById('admin-title').innerHTML = 'HORARIOS <span class="text-red-600 text-lg">TAXÍMETRO</span>';
        cancelarEdicionServicioUrbano();
        renderHorariosTaximetroViajesUrbanos(false);
        updateTaximeterRealtimeStatus();
        lucide.createIcons();
    }


    function nuevoHorarioTaximetroViajesUrbanos() {
        if (!window.taximeterSelectedUrbanServiceId) return;
        if (window.currentAdminView === 'urban-taximeter') {
            renderHorariosTaximetroViajesUrbanos(true);
            return;
        }
        if (window.currentAdminView === 'urban-taximeter-config') {
            renderPantallaConfiguracionTaximetroUrbano(true);
        }
    }

    if (!window.taximeterUrbanTripsRealtimeInterval) {
        window.taximeterUrbanTripsRealtimeInterval = setInterval(updateTaximeterRealtimeStatus, 1000);
    }
