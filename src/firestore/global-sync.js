 import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js";
  import {
    getFirestore,
    doc,
    setDoc,
    getDoc,
    collection,
    onSnapshot,
    serverTimestamp,
    runTransaction
  } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";
  import {
    getStorage,
    ref,
    uploadString,
    getDownloadURL
  } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-storage.js";

  const firebaseConfigGlobalSync = {
    apiKey: "AIzaSyCnKO3sGvEvmbcwOr7vWVpvZj_1f1TbVH8",
    authDomain: "drivemx-app.firebaseapp.com",
    projectId: "drivemx-app",
    storageBucket: "drivemx-app.firebasestorage.app",
    messagingSenderId: "488734017418",
    appId: "1:488734017418:web:a175638b14637bfa78ea73",
    measurementId: "G-FKFZ5TTV52"
  };

  const appGlobalSync = getApps().length ? getApp() : initializeApp(firebaseConfigGlobalSync);
  const dbGlobalSync = getFirestore(appGlobalSync);
  const storageGlobalSync = getStorage(appGlobalSync);

  const GLOBAL_SYNC = {
    ready: false,
    defaults: {
      servicios: {
        'taxi-expres': { nombre: 'Taxi Express', imagen: null, config: '', deleted: false },
        'motocicleta': { nombre: 'Motocicleta', imagen: null, config: '', deleted: false },
        'paqueteria': { nombre: 'Paquetería', imagen: null, config: '', deleted: false },
        'taxi-xl': { nombre: 'Taxi XL<br><span class="text-[8px] text-gray-400">10 personas</span>', imagen: null, config: '', deleted: false }
      }
    },
    wallets: new Map(),
    servicios: {},
    taximeterSchedules: {},
    taximeterConfig: {},
    unsub: []
  };

  const cloneSync = value => JSON.parse(JSON.stringify(value || {}));
  const normalizeWalletSync = data => ({
    ...(data || {}),
    saldo: Number(data?.saldo || 0),
    historial: Array.isArray(data?.historial) ? data.historial : [],
    trips: Number(data?.trips || 0)
  });
  const walletRefSync = userId => doc(dbGlobalSync, 'carteras', String(userId));
  const nowTextSync = () => new Date().toLocaleString('es-MX');
  const isDataImageSync = src => typeof src === 'string' && src.startsWith('data:image/');
  const isValidImageSourceSync = src => typeof src === 'string' && (src.startsWith('http') || src.startsWith('data:image/') || src.startsWith('blob:'));
  const safeSegmentSync = value => String(value || 'archivo').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'archivo';

  function getAppVarSync(name, fallback = undefined) {
    try {
      const value = Function(`try { return typeof ${name} !== \"undefined\" ? ${name} : undefined; } catch (_) { return undefined; }`)();
      return value === undefined ? fallback : value;
    } catch (_) {
      return fallback;
    }
  }

  const DEFAULT_TAXIMETER_SCHEDULES_SYNC = {
    'taxi-expres': [{ id: 'default_24_7', serviceId: 'taxi-expres', nombre: '24/7', desde: '00:00', hasta: '23:59', globalDefault: true }],
    'motocicleta': [{ id: 'default_24_7', serviceId: 'motocicleta', nombre: '24/7', desde: '00:00', hasta: '23:59', globalDefault: true }],
    'paqueteria': [{ id: 'default_24_7', serviceId: 'paqueteria', nombre: '24/7', desde: '00:00', hasta: '23:59', globalDefault: true }],
    'taxi-xl': [{ id: 'default_24_7', serviceId: 'taxi-xl', nombre: '24/7', desde: '00:00', hasta: '23:59', globalDefault: true }]
  };

  const DEFAULT_TAXIMETER_CONFIG_SYNC = {
    'taxi-expres__default_24_7': { serviceId: 'taxi-expres', scheduleId: 'default_24_7', kilometros: { desde: 0, hasta: 999 }, costos: { precioInicial: 25, precioPorMinuto: 2.5, precioPorKilometro: 9 }, globalDefault: true },
    'motocicleta__default_24_7': { serviceId: 'motocicleta', scheduleId: 'default_24_7', kilometros: { desde: 0, hasta: 999 }, costos: { precioInicial: 15, precioPorMinuto: 1.5, precioPorKilometro: 5 }, globalDefault: true },
    'paqueteria__default_24_7': { serviceId: 'paqueteria', scheduleId: 'default_24_7', kilometros: { desde: 0, hasta: 999 }, costos: { precioInicial: 20, precioPorMinuto: 2, precioPorKilometro: 7 }, globalDefault: true },
    'taxi-xl__default_24_7': { serviceId: 'taxi-xl', scheduleId: 'default_24_7', kilometros: { desde: 0, hasta: 999 }, costos: { precioInicial: 40, precioPorMinuto: 3.5, precioPorKilometro: 13 }, globalDefault: true }
  };

  const hasItemsSync = obj => obj && typeof obj === 'object' && Object.keys(obj).length > 0;

  function mergeTaximeterSchedulesSync(remote = {}) {
    return hasItemsSync(remote) ? cloneSync(remote) : cloneSync(DEFAULT_TAXIMETER_SCHEDULES_SYNC);
  }

  function mergeTaximeterConfigSync(remote = {}) {
    return hasItemsSync(remote) ? cloneSync(remote) : cloneSync(DEFAULT_TAXIMETER_CONFIG_SYNC);
  }

  function seedGlobalTaximeterIfEmptySync(docName, defaults) {
    setDoc(doc(dbGlobalSync, 'panelControl', docName), {
      items: cloneSync(defaults),
      seededBy: 'drive_mx_global_sync_repair',
      updatedAt: new Date().toISOString(),
      updatedAtServer: serverTimestamp()
    }, { merge: true }).catch(error => console.warn('Seed taxímetro global:', docName, error.code || error.message || error));
  }

  function mergeServiciosSync(remote = {}) {
    const merged = cloneSync(GLOBAL_SYNC.defaults.servicios);
    Object.keys(remote || {}).forEach(id => {
      merged[id] = { ...(merged[id] || { nombre: '', imagen: null, config: '', deleted: false }), ...(remote[id] || {}) };
      if (!isValidImageSourceSync(merged[id].imagen)) merged[id].imagen = null;
    });
    return merged;
  }

  async function uploadServiceImageIfNeededSync(serviceId, service) {
    const copy = { ...(service || {}) };
    if (!isDataImageSync(copy.imagen)) return copy;
    const path = `admins/panel-control/servicios-urbanos/${safeSegmentSync(serviceId)}/imagenes/${Date.now()}.jpg`;
    const storageReference = ref(storageGlobalSync, path);
    await uploadString(storageReference, copy.imagen, 'data_url', {
      contentType: 'image/jpeg',
      customMetadata: { app: 'drive_mx', source: 'admin_service_photo', uploadedAt: new Date().toISOString() }
    });
    copy.imagen = await getDownloadURL(storageReference);
    copy.storagePath = path;
    copy.storageStatus = 'guardada';
    return copy;
  }

  function repaintServiciosSync() {
    if (typeof window.inicializarServiciosUrbanosAdmin === 'function') window.inicializarServiciosUrbanosAdmin();
    if (typeof window.renderPassengerUrbanServices === 'function') window.renderPassengerUrbanServices();
    if (typeof window.refreshPassengerServicePricesAndEta === 'function') window.refreshPassengerServicePricesAndEta();
  }

  function repaintTaximeterSync() {
    if (typeof window.updateTaximeterRealtimeStatus === 'function') window.updateTaximeterRealtimeStatus();
    if (getAppVarSync('currentAdminView') === 'urban-taximeter' && typeof window.renderHorariosTaximetroViajesUrbanos === 'function') window.renderHorariosTaximetroViajesUrbanos(false);
    if (getAppVarSync('currentAdminView') === 'urban-taximeter-config' && typeof window.renderPantallaConfiguracionTaximetroUrbano === 'function') window.renderPantallaConfiguracionTaximetroUrbano(false);
    if (typeof window.refreshPassengerServicePricesAndEta === 'function') window.refreshPassengerServicePricesAndEta();
  }

  function installGlobalListenersSync() {
    if (GLOBAL_SYNC.ready) return;
    GLOBAL_SYNC.ready = true;

    GLOBAL_SYNC.unsub.push(onSnapshot(collection(dbGlobalSync, 'carteras'), snap => {
      snap.docChanges().forEach(change => {
        const wallet = normalizeWalletSync(change.doc.data());
        GLOBAL_SYNC.wallets.set(change.doc.id, wallet);
        window.dispatchEvent(new CustomEvent('drive_mx_wallet_updated', { detail: { userId: change.doc.id, wallet } }));
        if (typeof window.refreshWalletViews === 'function') window.refreshWalletViews(change.doc.id);
      });
    }));

    GLOBAL_SYNC.unsub.push(onSnapshot(doc(dbGlobalSync, 'panelControl', 'serviciosUrbanos'), snap => {
      GLOBAL_SYNC.servicios = mergeServiciosSync(snap.exists() ? (snap.data().items || {}) : {});
      repaintServiciosSync();
    }));

    GLOBAL_SYNC.unsub.push(onSnapshot(doc(dbGlobalSync, 'panelControl', 'horariosTaximetroViajesUrbanos'), snap => {
      const items = snap.exists() ? (snap.data().items || {}) : {};
      if (!hasItemsSync(items)) seedGlobalTaximeterIfEmptySync('horariosTaximetroViajesUrbanos', DEFAULT_TAXIMETER_SCHEDULES_SYNC);
      GLOBAL_SYNC.taximeterSchedules = mergeTaximeterSchedulesSync(items);
      repaintTaximeterSync();
    }));

    GLOBAL_SYNC.unsub.push(onSnapshot(doc(dbGlobalSync, 'panelControl', 'configTaximetroViajesUrbanos'), snap => {
      const items = snap.exists() ? (snap.data().items || {}) : {};
      if (!hasItemsSync(items)) seedGlobalTaximeterIfEmptySync('configTaximetroViajesUrbanos', DEFAULT_TAXIMETER_CONFIG_SYNC);
      GLOBAL_SYNC.taximeterConfig = mergeTaximeterConfigSync(items);
      repaintTaximeterSync();
    }));
  }

  async function saveWalletFirestoreSync(userId, data) {
    if (!userId) return normalizeWalletSync(data);
    const wallet = normalizeWalletSync(data);
    GLOBAL_SYNC.wallets.set(String(userId), wallet);
    await setDoc(walletRefSync(userId), { ...wallet, userId: String(userId), updatedAtServer: serverTimestamp() }, { merge: true });
    window.dispatchEvent(new CustomEvent('drive_mx_wallet_updated', { detail: { userId: String(userId), wallet } }));
    return wallet;
  }

  window.getWalletData = function(userId) {
    if (!userId) return { saldo: 0.00, historial: [], trips: 0 };
    return normalizeWalletSync(GLOBAL_SYNC.wallets.get(String(userId)) || {});
  };

  window.saveWalletData = function(userId, data) {
    const wallet = normalizeWalletSync(data);
    if (!userId) return wallet;
    GLOBAL_SYNC.wallets.set(String(userId), wallet);
    saveWalletFirestoreSync(userId, wallet).catch(error => {
      console.error('No se pudo guardar cartera global en Firestore:', error);
      alert('No se pudo sincronizar la cartera global: ' + (error.code || error.message || error));
    });
    return wallet;
  };

  window.addMovement = function(userId, tipo, monto, descripcion, extra = {}) {
    const amount = Number(monto || 0);
    if (!userId || !Number.isFinite(amount) || amount <= 0) return window.getWalletData(userId);
    const current = window.getWalletData(userId);
    const updated = normalizeWalletSync({
      ...current,
      saldo: tipo === 'sumar' ? Number((current.saldo + amount).toFixed(2)) : Number((current.saldo - amount).toFixed(2)),
      historial: [{
        id: `MOV_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        fecha: nowTextSync(),
        tipo,
        monto: amount,
        desc: descripcion,
        saldoFinal: tipo === 'sumar' ? Number((current.saldo + amount).toFixed(2)) : Number((current.saldo - amount).toFixed(2)),
        ...extra
      }, ...(current.historial || [])]
    });
    GLOBAL_SYNC.wallets.set(String(userId), updated);
    runTransaction(dbGlobalSync, async tx => {
      const refWallet = walletRefSync(userId);
      const snap = await tx.get(refWallet);
      const serverWallet = normalizeWalletSync(snap.exists() ? snap.data() : {});
      const serverSaldo = tipo === 'sumar' ? Number((serverWallet.saldo + amount).toFixed(2)) : Number((serverWallet.saldo - amount).toFixed(2));
      const movement = { ...updated.historial[0], saldoFinal: serverSaldo };
      tx.set(refWallet, {
        ...serverWallet,
        userId: String(userId),
        saldo: serverSaldo,
        trips: Number(serverWallet.trips || 0),
        historial: [movement, ...(serverWallet.historial || [])].slice(0, 250),
        updatedAtServer: serverTimestamp()
      }, { merge: true });
    }).catch(error => {
      console.error('Movimiento global Firestore:', error);
      alert('No se pudo guardar el movimiento global: ' + (error.code || error.message || error));
    });
    if (typeof window.refreshWalletViews === 'function') window.refreshWalletViews(userId);
    return updated;
  };

  window.incrementWalletTrips = function(userId) {
    const wallet = window.getWalletData(userId);
    wallet.trips = Number(wallet.trips || 0) + 1;
    return window.saveWalletData(userId, wallet);
  };

  const originalSearchPassengerInWalletSync = window.searchPassengerInWallet;
  window.searchPassengerInWallet = function() {
    originalSearchPassengerInWalletSync?.apply(this, arguments);
    if (window.userTargetAdmin?.id) getDoc(walletRefSync(window.userTargetAdmin.id)).then(snap => {
      if (snap.exists()) GLOBAL_SYNC.wallets.set(String(window.userTargetAdmin.id), normalizeWalletSync(snap.data()));
      if (typeof window.refreshWalletViews === 'function') window.refreshWalletViews(window.userTargetAdmin.id);
    }).catch(console.warn);
  };

  window.getServiciosUrbanosAdminData = function() { return mergeServiciosSync(GLOBAL_SYNC.servicios); };

  window.saveServiciosUrbanosAdminData = async function(data) {
    const normalized = mergeServiciosSync(data || {});
    const uploaded = {};
    for (const [id, service] of Object.entries(normalized)) uploaded[id] = await uploadServiceImageIfNeededSync(id, service);
    GLOBAL_SYNC.servicios = mergeServiciosSync(uploaded);
    await setDoc(doc(dbGlobalSync, 'panelControl', 'serviciosUrbanos'), {
      items: GLOBAL_SYNC.servicios,
      updatedAt: new Date().toISOString(),
      updatedAtServer: serverTimestamp()
    }, { merge: true });
    repaintServiciosSync();
  };

  window.getTaximeterSchedulesUrbanTripsData = function() { return cloneSync(GLOBAL_SYNC.taximeterSchedules); };
  window.saveTaximeterSchedulesUrbanTripsData = function(data) {
    GLOBAL_SYNC.taximeterSchedules = mergeTaximeterSchedulesSync(data || {});
    setDoc(doc(dbGlobalSync, 'panelControl', 'horariosTaximetroViajesUrbanos'), {
      items: GLOBAL_SYNC.taximeterSchedules,
      updatedAt: new Date().toISOString(),
      updatedAtServer: serverTimestamp()
    }, { merge: true }).catch(error => alert('No se pudieron sincronizar horarios del taxímetro: ' + (error.code || error.message || error)));
  };

  window.getTaximeterUrbanConfigData = function() { return cloneSync(GLOBAL_SYNC.taximeterConfig); };
  window.saveTaximeterUrbanConfigData = function(data) {
    GLOBAL_SYNC.taximeterConfig = mergeTaximeterConfigSync(data || {});
    setDoc(doc(dbGlobalSync, 'panelControl', 'configTaximetroViajesUrbanos'), {
      items: GLOBAL_SYNC.taximeterConfig,
      updatedAt: new Date().toISOString(),
      updatedAtServer: serverTimestamp()
    }, { merge: true }).catch(error => alert('No se pudo sincronizar configuración del taxímetro: ' + (error.code || error.message || error)));
  };

  const originalGetActiveTaximeterConfigForPassengerSync = window.getActiveTaximeterConfigForPassenger;
  window.getActiveTaximeterConfigForPassenger = function(serviceId) {
    const schedules = window.getTaximeterSchedulesUrbanTripsData?.()[serviceId] || [];
    const activeSchedule = schedules.find(schedule => typeof window.isNowInsideTaximeterSchedule === 'function' ? window.isNowInsideTaximeterSchedule(schedule) : true);
    if (!activeSchedule) return null;
    const key = typeof window.getTaximeterUrbanConfigKey === 'function' ? window.getTaximeterUrbanConfigKey(serviceId, activeSchedule.id) : `${serviceId}__${activeSchedule.id}`;
    return (window.getTaximeterUrbanConfigData?.() || {})[key] || originalGetActiveTaximeterConfigForPassengerSync?.(serviceId) || null;
  };

  const originalPrepararContextoSync = window.prepararContextoTaximetroViajesUrbanos;
  window.prepararContextoTaximetroViajesUrbanos = function(schedule) {
    const context = originalPrepararContextoSync?.apply(this, arguments) || null;
    if (context) setDoc(doc(dbGlobalSync, 'panelControl', 'estadoTaximetroViajesUrbanos'), {
      contexto: context,
      updatedAt: new Date().toISOString(),
      updatedAtServer: serverTimestamp()
    }, { merge: true }).catch(console.warn);
    return context;
  };

  const originalUpdateTaximeterStatusSync = window.updateTaximeterRealtimeStatus;
  window.updateTaximeterRealtimeStatus = function() {
    originalUpdateTaximeterStatusSync?.apply(this, arguments);
    const allData = window.getTaximeterSchedulesUrbanTripsData?.() || {};
    const state = {};
    Object.keys(allData).forEach(serviceId => {
      const schedules = allData[serviceId] || [];
      state[serviceId] = {
        active: schedules.some(schedule => typeof window.isNowInsideTaximeterSchedule === 'function' ? window.isNowInsideTaximeterSchedule(schedule) : false),
        updatedAt: new Date().toISOString()
      };
    });
    setDoc(doc(dbGlobalSync, 'panelControl', 'estadoTaximetroViajesUrbanos'), {
      items: state,
      updatedAt: new Date().toISOString(),
      updatedAtServer: serverTimestamp()
    }, { merge: true }).catch(console.warn);
  };

  const originalShowPassengerSync = window.showPassengerPanel;
  window.showPassengerPanel = function() {
    installGlobalListenersSync();
    originalShowPassengerSync?.apply(this, arguments);
    const activeUser = getAppVarSync('currentUser', window.currentUser || null);
    const uid = activeUser?.uid || activeUser?.id;
    if (uid) getDoc(walletRefSync(uid)).then(snap => {
      if (snap.exists()) GLOBAL_SYNC.wallets.set(String(uid), normalizeWalletSync(snap.data()));
      if (typeof window.updateWalletDisplay === 'function') window.updateWalletDisplay();
    }).catch(console.warn);
  };

  const originalShowAdminSync = window.showAdminPanel;
  window.showAdminPanel = function() {
    installGlobalListenersSync();
    originalShowAdminSync?.apply(this, arguments);
  };

  const originalOpenUrbanTripsSync = window.openUrbanTripsView;
  window.openUrbanTripsView = function() {
    installGlobalListenersSync();
    originalOpenUrbanTripsSync?.apply(this, arguments);
    repaintServiciosSync();
  };

  const originalAdminModificarSaldoSync = window.adminModificarSaldo;
  window.adminModificarSaldo = function(tipo) {
    installGlobalListenersSync();
    return originalAdminModificarSaldoSync?.apply(this, arguments);
  };

  installGlobalListenersSync();
  window.DriveMXGlobalSync = { db: dbGlobalSync, storage: storageGlobalSync, state: GLOBAL_SYNC, installGlobalListenersSync };
