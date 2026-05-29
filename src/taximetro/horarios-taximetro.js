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

    
