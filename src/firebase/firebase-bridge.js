import { initializeApp } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js";
  import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-analytics.js";
  import {
    getAuth,
    setPersistence,
    browserLocalPersistence,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    onAuthStateChanged,
    signOut,
    signInAnonymously
  } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js";
  import {
    getFirestore,
    doc,
    setDoc,
    getDoc,
    getDocs,
    deleteDoc,
    collection,
    addDoc,
    onSnapshot,
    serverTimestamp,
    updateDoc,
    query,
    where,
    orderBy,
    limit,
    arrayUnion,
    runTransaction
  } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";
  import {
    getStorage,
    ref,
    uploadString,
    getDownloadURL
  } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-storage.js";

  const firebaseConfig = {
    apiKey: "AIzaSyCnKO3sGvEvmbcwOr7vWVpvZj_1f1TbVH8",
    authDomain: "drivemx-app.firebaseapp.com",
    projectId: "drivemx-app",
    storageBucket: "drivemx-app.firebasestorage.app",
    messagingSenderId: "488734017418",
    appId: "1:488734017418:web:a175638b14637bfa78ea73",
    measurementId: "G-FKFZ5TTV52"
  };

  const app = initializeApp(firebaseConfig);
  try { getAnalytics(app); } catch (_) {}
  const auth = getAuth(app);
  const db = getFirestore(app);
  const storage = getStorage(app);
  await setPersistence(auth, browserLocalPersistence);

  // DRIVE MX: sesión Firebase persistente corregida
  onAuthStateChanged(auth, async (firebaseUser) => {
    try {
      if (!firebaseUser || firebaseUser.isAnonymous) return;
      localStorage.setItem('drive_mx_auth_uid', firebaseUser.uid);
      const profile = await findUserByUid(firebaseUser.uid);
      if (profile) {
        setCurrentAppUser(profile);
        mergeLocalUser(profile);
        window.persistPanelSession?.(profile);
      }
    } catch (error) {
      console.warn('Restaurar sesión Firebase:', error.message || error);
    }
  });

  const COLLECTION_BY_ROLE = { pasajero: 'pasajeros', conductor: 'conductores', admin: 'admins' };
  const ROLE_STORAGE_ROOT = { pasajero: 'pasajeros', conductor: 'conductores', admin: 'admins' };
  const ROLE_WALLET_COLLECTION = { pasajero: 'carterasPasajeros', conductor: 'carterasConductores', admin: 'carterasAdmins' };
  const ROLE_TRIPS_COLLECTION = { pasajero: 'viajesPasajeros', conductor: 'viajesConductores', admin: 'viajesAdmins' };

  function normalizeRole(role) {
    if (role === 'driver') return 'conductor';
    if (role === 'passenger') return 'pasajero';
    if (role === 'administrador') return 'admin';
    return ['pasajero', 'conductor', 'admin'].includes(role) ? role : 'pasajero';
  }

  function isDataImage(value) { return typeof value === 'string' && value.startsWith('data:image/'); }
  function imageContentType(dataUrl) {
    const match = String(dataUrl || '').match(/^data:(image\/[^;]+);base64,/i);
    return match ? match[1] : 'image/jpeg';
  }
  function safeStorageSegment(value) { return String(value || Date.now()).replace(/[^a-zA-Z0-9_-]/g, '_'); }
  function normalizeEmail(email) { return String(email || '').trim().toLowerCase(); }
  function normalizeLogin(login) { return String(login || '').trim().toLowerCase(); }

  function getAppVar(name, fallback = undefined) {
    try {
      const value = Function(`try { return typeof ${name} !== "undefined" ? ${name} : undefined; } catch (_) { return undefined; }`)();
      return value === undefined ? fallback : value;
    } catch (_) { return fallback; }
  }

  function setAppVar(name, value) {
    try { Function('value', `${name} = value;`)(value); } catch (_) {}
    try { window[name] = value; } catch (_) {}
    return value;
  }

  function getCurrentAppUser() {
    const firebaseUser = auth.currentUser;
    const userFromApp = getAppVar('currentUser', undefined) || window.currentUser || null;

    if (firebaseUser && userFromApp) {
      return normalizeUserForLocal({
        ...userFromApp,
        uid: firebaseUser.uid,
        id: firebaseUser.uid,
        correo: normalizeEmail(userFromApp.correo || firebaseUser.email || '')
      });
    }

    return userFromApp || null;
  }

  function setCurrentAppUser(user) {
    return setAppVar('currentUser', user);
  }

  function getSelectedAdminIds() {
    const fromGlobal = getAppVar('selectedIds', window.selectedIds || []);
    if (Array.isArray(fromGlobal) && fromGlobal.length) return [...fromGlobal].map(String);
    return [...document.querySelectorAll('#admin-requests-container .card-selected')]
      .map(card => String(card.id || '').replace(/^card-/, ''))
      .filter(Boolean);
  }

  function setSelectedAdminIds(ids) {
    setAppVar('selectedIds', ids || []);
    window.selectedIds = ids || [];
  }

  function getCurrentAdminViewSafe() {
    const value = getAppVar('currentAdminView', window.currentAdminView || '');
    if (value) return value;
    const title = (document.getElementById('admin-list-title')?.innerText || '').toLowerCase();
    if (title.includes('pasaj')) return 'passengers';
    if (title.includes('conductor') || title.includes('solicitudes')) return 'requests';
    return '';
  }

  function getLocalUsersSafe() {
    try { return Array.isArray(window.getUsersDb?.()) ? window.getUsersDb() : []; }
    catch (_) { return []; }
  }

  function saveLocalUsersSafe(users) {
    if (typeof window.saveUsersDb === 'function') return window.saveUsersDb(users || []);
    localStorage.setItem('db_usuarios_permanente', JSON.stringify(users || []));
    return users || [];
  }

  function normalizeUserForLocal(user) {
    const role = normalizeRole(user?.role);
    const id = String(user?.uid || user?.id || '').trim();
    return { ...(user || {}), uid: id, id, role };
  }

  function localUserMatches(a, b) {
    if (!a || !b) return false;
    const aRole = normalizeRole(a.role), bRole = normalizeRole(b.role);
    const aUid = String(a.uid || a.id || ''), bUid = String(b.uid || b.id || '');
    if (aUid && bUid && aUid === bUid && aRole === bRole) return true;
    const aEmail = normalizeEmail(a.correo), bEmail = normalizeEmail(b.correo);
    if (aEmail && bEmail && aEmail === bEmail && aRole === bRole) return true;
    const aUser = normalizeLogin(a.usuario), bUser = normalizeLogin(b.usuario);
    if (aUser && bUser && aUser === bUser && aRole === bRole) return true;
    return false;
  }

  function mergeLocalUser(user) {
    const clean = normalizeUserForLocal(user);
    if (!clean.id || !clean.role) return clean;
    const users = getLocalUsersSafe();
    const idx = users.findIndex(u => localUserMatches(u, clean));
    if (idx >= 0) users[idx] = { ...users[idx], ...clean, id: clean.id, uid: clean.id, role: clean.role };
    else users.push(clean);
    saveLocalUsersSafe(users);
    return clean;
  }

  function removeLocalUser(role, uid) {
    const cleanRole = normalizeRole(role);
    const cleanUid = String(uid || '');
    const users = getLocalUsersSafe().filter(u => !(normalizeRole(u.role) === cleanRole && String(u.uid || u.id || '') === cleanUid));
    saveLocalUsersSafe(users);
    localStorage.removeItem(`wallet_${cleanUid}`);
  }

  function removeUndefinedAndLargeImages(obj) {
    const clean = Array.isArray(obj) ? [] : {};
    Object.entries(obj || {}).forEach(([key, value]) => {
      if (value === undefined) return;
      if (typeof value === 'string' && value.startsWith('data:image/')) return;
      if (value && typeof value === 'object' && !(value instanceof Date)) clean[key] = removeUndefinedAndLargeImages(value);
      else clean[key] = value;
    });
    return clean;
  }

  async function ensureFirebaseSessionForSystemWrite() {
    if (auth.currentUser) return auth.currentUser;
    try { return (await signInAnonymously(auth)).user; }
    catch (error) { console.warn('Auth anónimo no disponible:', error.code || error.message); return null; }
  }

  async function uploadDataImage(path, dataUrl) {
    if (!isDataImage(dataUrl)) return dataUrl || '';
    await ensureFirebaseSessionForSystemWrite();
    const cleanPath = String(path || '').replace(/^\/+/, '');
    const storageRef = ref(storage, cleanPath);
    await uploadString(storageRef, dataUrl, 'data_url', {
      contentType: imageContentType(dataUrl),
      customMetadata: { app: 'drive_mx', storagePath: cleanPath, uploadedAt: new Date().toISOString() }
    });
    return await getDownloadURL(storageRef);
  }

  async function uploadRoleImage(role, userId, imageKey, dataUrl) {
    if (!isDataImage(dataUrl)) return { url: dataUrl || '', path: '', error: '' };
    const safeRole = normalizeRole(role);
    const safeId = safeStorageSegment(userId);
    const safeKey = safeStorageSegment(imageKey);
    const extension = imageContentType(dataUrl).includes('png') ? 'png' : 'jpg';
    const path = `${ROLE_STORAGE_ROOT[safeRole]}/${safeId}/imagenes/${safeKey}.${extension}`;
    try { return { url: await uploadDataImage(path, dataUrl), path, error: '' }; }
    catch (error) { return { url: '', path, error: error.code || error.message || String(error) }; }
  }



  function getFirebaseAuthUserRequired() {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser || firebaseUser.isAnonymous) throw new Error('Debes iniciar sesión en Firebase para usar viajes reales.');
    return firebaseUser;
  }

  function cleanTripPayload(trip = {}) {
    return removeUndefinedAndLargeImages({
      ...trip,
      estado: 'pendiente',
      status: 'pending',
      rechazadoPor: Array.isArray(trip.rechazadoPor) ? trip.rechazadoPor : [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }

  async function createTripRequest(trip) {
    const firebaseUser = getFirebaseAuthUserRequired();
    const passengerId = String(trip?.passengerId || firebaseUser.uid || '');
    if (!passengerId) throw new Error('No se pudo validar el pasajero.');
    const payload = cleanTripPayload({
      ...trip,
      passengerId,
      pasajeroId: passengerId
    });
    const refDoc = await addDoc(collection(db, 'viajes'), payload);
    await updateDoc(refDoc, { id: refDoc.id, viajeId: refDoc.id, updatedAt: serverTimestamp() });
    return { id: refDoc.id, ...payload };
  }

  function listenPendingTrips(onChange, onError) {
    getFirebaseAuthUserRequired();
    const q = query(collection(db, 'viajes'), where('estado', '==', 'pendiente'), limit(20));
    return onSnapshot(q, snapshot => {
      const trips = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
      if (typeof onChange === 'function') onChange(trips);
    }, error => {
      console.error('Escucha de viajes pendientes:', error.code || error.message || error);
      if (typeof onError === 'function') onError(error);
    });
  }

  function listenTripById(tripId, onChange, onError) {
    getFirebaseAuthUserRequired();
    if (!tripId) throw new Error('Falta el id del viaje.');
    return onSnapshot(doc(db, 'viajes', String(tripId)), snapshot => {
      if (typeof onChange === 'function') onChange(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null);
    }, error => {
      console.error('Escucha de viaje:', error.code || error.message || error);
      if (typeof onError === 'function') onError(error);
    });
  }

  async function acceptTripRequest(viajeId, driverData = {}) {
    const firebaseUser = getFirebaseAuthUserRequired();
    const cleanDriver = removeUndefinedAndLargeImages(driverData || {});
    const conductorId = String(cleanDriver.id || cleanDriver.conductorId || firebaseUser.uid || '');
    if (!viajeId) throw new Error('Falta el id del viaje.');
    if (!conductorId) throw new Error('No se pudo validar el conductor.');

    const tripRef = doc(db, 'viajes', String(viajeId));
    return await runTransaction(db, async transaction => {
      const snap = await transaction.get(tripRef);
      if (!snap.exists()) throw new Error('El viaje ya no existe.');
      const current = snap.data() || {};
      if (current.estado !== 'pendiente') throw new Error('Este viaje ya fue aceptado por otro conductor.');

      const acceptedPayload = {
        estado: 'aceptado',
        status: 'accepted',
        conductorId,
        conductorNombre: cleanDriver.name || cleanDriver.conductorNombre || 'Conductor',
        conductorFoto: cleanDriver.photo || cleanDriver.conductorFoto || '',
        conductorCalificacion: cleanDriver.rating || cleanDriver.conductorCalificacion || '5.0',
        conductorMarca: cleanDriver.brand || cleanDriver.conductorMarca || '',
        conductorModelo: cleanDriver.model || cleanDriver.conductorModelo || '',
        conductorPlaca: cleanDriver.plate || cleanDriver.conductorPlaca || '',
        conductorColor: cleanDriver.color || cleanDriver.conductorColor || '',
        conductorTelefono: cleanDriver.phone || cleanDriver.conductorTelefono || '',
        conductorUbicacion: cleanDriver.ubicacion || null,
        tiempoLlegada: cleanDriver.tiempoLlegada || cleanDriver.time || '3 min',
        driver: cleanDriver,
        driverId: conductorId,
        driverName: cleanDriver.name || 'Conductor',
        acceptedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      transaction.update(tripRef, removeUndefinedAndLargeImages(acceptedPayload));
      return { id: String(viajeId), ...current, ...acceptedPayload };
    });
  }

  async function rejectTripForDriver(viajeId, conductorId) {
    getFirebaseAuthUserRequired();
    if (!viajeId || !conductorId) return;
    await updateDoc(doc(db, 'viajes', String(viajeId)), {
      rechazadoPor: arrayUnion(String(conductorId)),
      updatedAt: serverTimestamp()
    });
  }


  function getTempImageValue(key, previewId = '') {
    const direct = window[key];
    if (isDataImage(direct)) return direct;
    const previewValue = previewId ? (document.getElementById(previewId)?.src || '') : '';
    if (isDataImage(previewValue)) return previewValue;
    try {
      const globalValue = Function(`try { return typeof ${key} !== "undefined" ? ${key} : ""; } catch (_) { return ""; }`)();
      return isDataImage(globalValue) ? globalValue : '';
    } catch (_) { return ''; }
  }

  function normalizeFirebaseAuthError(error) {
    const code = error?.code || '';
    if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
      return new Error('Correo o contraseña incorrectos. Verifica que Email/Password esté activado en Firebase Authentication y que las credenciales sean válidas.');
    }
    if (code === 'auth/operation-not-allowed') {
      return new Error('Email/Password no está activado en Firebase Authentication. Actívalo en Firebase Console > Authentication > Sign-in method.');
    }
    if (code === 'auth/email-already-in-use') {
      return new Error('Este correo ya existe. Inicia sesión con la contraseña correcta para evitar duplicar usuarios.');
    }
    return error instanceof Error ? error : new Error(String(error || 'Error de Firebase Authentication.'));
  }

  async function registerPassengerFirebase(email, pass) {
    const cleanEmail = normalizeEmail(email);
    const cleanPass = String(pass || '').trim();

    if (!cleanEmail || !cleanEmail.includes('@')) {
      throw new Error('Ingresa un correo válido para crear la cuenta del pasajero.');
    }
    if (cleanPass.length < 6) {
      throw new Error('La contraseña debe tener mínimo 6 caracteres.');
    }

    try {
      return (await createUserWithEmailAndPassword(auth, cleanEmail, cleanPass)).user;
    } catch (error) {
      throw normalizeFirebaseAuthError(error);
    }
  }

  async function loginFirebase(email, pass) {
    const cleanEmail = normalizeEmail(email);
    const cleanPass = String(pass || '').trim();

    if (!cleanEmail || !cleanEmail.includes('@')) {
      throw new Error('Ingresa un correo válido para iniciar sesión.');
    }
    if (!cleanPass) {
      throw new Error('Ingresa tu contraseña.');
    }

    try {
      return (await signInWithEmailAndPassword(auth, cleanEmail, cleanPass)).user;
    } catch (error) {
      throw normalizeFirebaseAuthError(error);
    }
  }

  // Compatibilidad para conductor/admin: crea cuenta nueva, sin iniciar sesión como fallback.
  // Evita mezclar registro con login y elimina el origen típico de auth/invalid-credential.
  async function getOrCreateEmailUser(email, pass) {
    const cleanEmail = normalizeEmail(email);
    const cleanPass = String(pass || '').trim();
    if (auth.currentUser && !auth.currentUser.isAnonymous) return auth.currentUser;
    return registerPassengerFirebase(cleanEmail, cleanPass);
  }

  async function signInFirebaseIfPossible(login, pass) {
    const email = normalizeEmail(login);
    if (!email.includes('@') || !pass) return null;
    return loginFirebase(email, pass);
  }

  async function findUserByUid(uid, preferredRole = '') {
    const cleanUid = String(uid || '');
    const roles = preferredRole ? [normalizeRole(preferredRole)] : ['pasajero', 'conductor', 'admin'];
    for (const role of roles) {
      const collectionName = COLLECTION_BY_ROLE[role];
      const snap = await getDoc(doc(db, collectionName, cleanUid));
      if (snap.exists()) return normalizeUserForLocal({ id: snap.id, uid: snap.id, ...snap.data(), role });
    }
    return null;
  }

  async function findUserByLoginInFirestore(login, pass) {
    const needle = normalizeLogin(login);
    if (!needle) return null;
    for (const role of ['pasajero', 'conductor', 'admin']) {
      const collectionName = COLLECTION_BY_ROLE[role];
      const snap = await getDocs(collection(db, collectionName));
      let found = null;
      snap.forEach(d => {
        const data = { id: d.id, uid: d.id, ...d.data(), role };
        if ((normalizeLogin(data.usuario) === needle || normalizeEmail(data.correo) === needle) && String(data.pass || '') === String(pass || '')) found = normalizeUserForLocal(data);
      });
      if (found) return found;
    }
    return null;
  }

  async function prepareUserForFirebase(user) {
    const copy = normalizeUserForLocal({ ...(user || {}) });
    copy.uid = String(copy.uid || copy.id || auth.currentUser?.uid || '');
    copy.id = copy.uid;
    copy.role = normalizeRole(copy.role);
    copy.storagePaths = { ...(copy.storagePaths || {}) };
    copy.storageStatus = { ...(copy.storageStatus || {}) };

    const imageMapByRole = {
      pasajero: [['foto', copy.foto || copy.passengerFoto || ''], ['passengerFoto', copy.passengerFoto || copy.foto || '']],
      conductor: [['foto', copy.foto || copy.driverFoto || ''], ['driverFoto', copy.driverFoto || copy.foto || ''], ['ineFrontal', copy.ineFrontal || ''], ['ineTrasera', copy.ineTrasera || ''], ['tarjetaCirculacion', copy.tarjetaCirculacion || ''], ['fotoVehiculo', copy.fotoVehiculo || '']],
      admin: [['foto', copy.foto || copy.adminFoto || ''], ['adminFoto', copy.adminFoto || copy.foto || '']]
    };

    for (const [key, value] of imageMapByRole[copy.role] || []) {
      if (!isDataImage(value)) continue;
      const uploaded = await uploadRoleImage(copy.role, copy.id, key, value);
      if (uploaded.url) {
        copy[key] = uploaded.url;
        if (key === 'foto') {
          if (copy.role === 'pasajero') copy.passengerFoto = uploaded.url;
          if (copy.role === 'conductor') copy.driverFoto = uploaded.url;
          if (copy.role === 'admin') copy.adminFoto = uploaded.url;
        }
        copy.storagePaths[key] = uploaded.path;
        copy.storageStatus[key] = 'guardada';
      } else if (uploaded.error) copy.storageStatus[key] = `error:${uploaded.error}`;
    }

    copy.updatedAt = new Date().toISOString();
    return copy;
  }

  async function saveUserGlobal(user) {
    if (!user || !user.role) return user;
    const prepared = await prepareUserForFirebase(user);
    if (!prepared.id) throw new Error('No hay UID autenticado para guardar el usuario.');
    const collectionName = COLLECTION_BY_ROLE[prepared.role];
    const firestoreUser = removeUndefinedAndLargeImages(prepared);

    await setDoc(doc(db, collectionName, prepared.id), {
      ...firestoreUser,
      uid: prepared.id,
      id: prepared.id,
      updatedAtServer: serverTimestamp()
    }, { merge: true });

    await setDoc(doc(db, 'usuariosIndice', `${prepared.role}_${prepared.id}`), {
      id: prepared.id,
      uid: prepared.id,
      role: prepared.role,
      name: prepared.name || '',
      usuario: prepared.usuario || '',
      correo: prepared.correo || '',
      phone: prepared.phone || '',
      status: prepared.status || 'activo',
      collectionName,
      updatedAtServer: serverTimestamp()
    }, { merge: true });

    mergeLocalUser(prepared);
    return prepared;
  }

  async function ensureWallet(role, uid) {
    const collectionName = ROLE_WALLET_COLLECTION[normalizeRole(role)];
    if (!collectionName || !uid) return;
    await setDoc(doc(db, collectionName, String(uid)), {
      userId: String(uid), uid: String(uid), role: normalizeRole(role), saldo: 0, historial: [], trips: 0, updatedAtServer: serverTimestamp()
    }, { merge: true });
  }

  async function loadUsersGlobal() {
    const merged = [];
    for (const role of ['pasajero', 'conductor', 'admin']) {
      const collectionName = COLLECTION_BY_ROLE[role];
      const snap = await getDocs(collection(db, collectionName));
      snap.forEach(d => merged.push(normalizeUserForLocal({ id: d.id, uid: d.id, ...d.data(), role })));
    }
    saveLocalUsersSafe(merged);
    return merged;
  }

  function installRealtimeUsers() {
    if (window.driveMxFirebaseUsersInstalled) return;
    window.driveMxFirebaseUsersInstalled = true;
    window.driveMxFirebaseUnsubscribers = window.driveMxFirebaseUnsubscribers || {};
    ['pasajero', 'conductor', 'admin'].forEach(role => {
      const collectionName = COLLECTION_BY_ROLE[role];
      if (window.driveMxFirebaseUnsubscribers[collectionName]) return;
      window.driveMxFirebaseUnsubscribers[collectionName] = onSnapshot(collection(db, collectionName), snap => {
        snap.docChanges().forEach(change => {
          const uid = change.doc.id;
          if (change.type === 'removed') removeLocalUser(role, uid);
          else mergeLocalUser({ id: uid, uid, ...change.doc.data(), role });
        });
        if (getAppVar('activePanel', window.activePanel) === 'admin') {
          const adminView = getCurrentAdminViewSafe();
          if (adminView === 'passengers') window.renderAdminPassengers?.();
          else if (adminView === 'requests') window.renderAdminRequests?.();
        }
      }, error => console.warn(`Realtime ${collectionName}:`, error.message));
    });
  }

  function installRealtimeSolicitudes() {
    if (window.driveMxFirebaseSolicitudesInstalled) return;
    window.driveMxFirebaseSolicitudesInstalled = true;
    window.driveMxFirebaseUnsubscribers = window.driveMxFirebaseUnsubscribers || {};
    if (window.driveMxFirebaseUnsubscribers.solicitudesViaje) return;
    const q = query(collection(db, 'solicitudesViaje'), where('status', 'in', ['pending', 'accepted']), orderBy('createdAt', 'desc'), limit(30));
    window.driveMxFirebaseUnsubscribers.solicitudesViaje = onSnapshot(q, snap => {
      const currentUserForRequest = getCurrentAppUser?.() || null;
      const currentDriverId = String(currentUserForRequest?.uid || currentUserForRequest?.id || '');
      const requests = [];
      snap.forEach(d => requests.push({ id: d.id, ...d.data() }));
      const visibleRequests = requests.filter(req => {
        if (!currentDriverId || currentUserForRequest?.role !== 'conductor') return true;
        const rejected = Array.isArray(req.rejectedDriverIds) ? req.rejectedDriverIds.map(String) : [];
        return !rejected.includes(currentDriverId) && String(req.rejectedBy || '') !== currentDriverId;
      });
      if (typeof window.saveStoredTripRequests === 'function') window.saveStoredTripRequests(visibleRequests);
      else localStorage.setItem('drive_mx_pending_trip_requests', JSON.stringify(visibleRequests));
      window.renderDriverTripRequestCard?.();
    }, error => console.warn('Solicitudes realtime:', error.message));
  }

  async function deleteUserEverywhere(role, uid) {
    const cleanRole = normalizeRole(role);
    const cleanUid = String(uid || '');
    if (!cleanUid) return;
    await deleteDoc(doc(db, COLLECTION_BY_ROLE[cleanRole], cleanUid));
    await deleteDoc(doc(db, 'usuariosIndice', `${cleanRole}_${cleanUid}`)).catch(() => {});
    if (ROLE_WALLET_COLLECTION[cleanRole]) await deleteDoc(doc(db, ROLE_WALLET_COLLECTION[cleanRole], cleanUid)).catch(() => {});
    removeLocalUser(cleanRole, cleanUid);
  }

  async function saveDriverAvailability(disponible) {
    const user = getCurrentAppUser();
    if (!user || user.role !== 'conductor') return;
    user.disponible = Boolean(disponible);
    user.estadoConductor = disponible ? 'disponible' : 'no_disponible';
    mergeLocalUser(user);
    await setDoc(doc(db, 'conductores', String(user.uid || user.id)), {
      uid: String(user.uid || user.id), disponible: Boolean(disponible), estadoConductor: user.estadoConductor,
      activoEnServicios: Boolean(disponible), updatedAtServer: serverTimestamp()
    }, { merge: true });
  }

  async function saveDriverLocation() {
    const user = getCurrentAppUser();
    if (!user || user.role !== 'conductor' || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(async pos => {
      const uid = String(user.uid || user.id);
      const ubicacion = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, driverId: uid, uid, disponible: Boolean(window.isAvailable), updatedAt: new Date().toISOString() };
      user.ubicacion = ubicacion;
      localStorage.setItem('drive_mx_driver_location_' + uid, JSON.stringify(ubicacion));
      localStorage.setItem('drive_mx_last_driver_location', JSON.stringify(ubicacion));
      mergeLocalUser(user);
      await setDoc(doc(db, 'ubicacionesConductores', uid), { ...ubicacion, updatedAtServer: serverTimestamp() }, { merge: true });
      await setDoc(doc(db, 'conductores', uid), { ubicacion, updatedAtServer: serverTimestamp() }, { merge: true });
    }, () => {}, { enableHighAccuracy: true, maximumAge: 20000, timeout: 8000 });
  }

  async function saveServiceToFirebase(id, service) {
    await ensureFirebaseSessionForSystemWrite();
    const copy = { ...(service || {}), id, updatedAt: new Date().toISOString(), updatedAtServer: serverTimestamp(), ownerRole: 'admin', panel: 'panel-control' };
    if (isDataImage(copy.imagen)) {
      copy.imagen = await uploadDataImage(`admins/panel-control/servicios-urbanos/${safeStorageSegment(id)}/imagenes/servicio_${Date.now()}.jpg`, copy.imagen);
      copy.storagePath = `admins/panel-control/servicios-urbanos/${safeStorageSegment(id)}/imagenes/`;
      copy.storageStatus = 'guardada';
    }
    await setDoc(doc(db, 'admins', 'panelControl', 'serviciosUrbanos', id), copy, { merge: true });
    await setDoc(doc(db, 'serviciosUrbanos', id), copy, { merge: true });
    return copy;
  }

  function installOverrides() {
    if (window.driveMxFirebaseOverridesInstalled) return;
    window.driveMxFirebaseOverridesInstalled = true;

    const originalHandleAuth = window.handleAuth;
    window.handleAuth = async function() {
      const login = normalizeLogin(document.getElementById('login-email')?.value || '');
      const pass = String(document.getElementById('login-pass')?.value || '').trim();

      if (login === 'admincentral' && pass === '9271@') {
        await ensureFirebaseSessionForSystemWrite();
        return originalHandleAuth?.apply(this, arguments);
      }

      if (!login || !pass) {
        alert('Ingresa usuario/correo y contraseña.');
        return;
      }

      try {
        let authUser = null;
        let firestoreUser = null;

        if (login.includes('@')) {
          authUser = await loginFirebase(login, pass);
          firestoreUser = await findUserByUid(authUser.uid);
        } else {
          // Soporta login con usuario sin mezclarlo con registro.
          // Primero encuentra el perfil por usuario+pass en Firestore y luego autentica con su correo real.
          const indexedUser = await findUserByLoginInFirestore(login, pass);
          if (!indexedUser?.correo) throw new Error('Usuario no encontrado en Firebase.');
          authUser = await loginFirebase(indexedUser.correo, pass);
          firestoreUser = await findUserByUid(authUser.uid, indexedUser.role) || indexedUser;
        }

        if (!firestoreUser) {
          throw new Error('La autenticación fue correcta, pero no se encontró el perfil en Firestore.');
        }

        const normalizedUser = normalizeUserForLocal({ ...firestoreUser, uid: authUser.uid, id: authUser.uid });
        setCurrentAppUser(normalizedUser);
        mergeLocalUser(normalizedUser);
        window.persistPanelSession?.(normalizedUser);

        if (normalizedUser.role === 'conductor') window.showDriverPanel?.();
        else if (normalizedUser.role === 'admin') window.showAdminPanel?.();
        else window.showPassengerPanel?.();

        lucide.createIcons();
      } catch (error) {
        console.error('Login Firebase:', error);
        alert(error.message || 'No se pudo iniciar sesión con Firebase.');
      }
    };

    const originalSavePassenger = window.savePassengerRequest;
    window.savePassengerRequest = async function() {
      const email = normalizeEmail(document.getElementById('reg-email')?.value || '');
      const pass = document.getElementById('reg-pass')?.value || '';
      try {
        const name = String(document.getElementById('dr-name')?.value || '').trim();
        const usuario = normalizeLogin(document.getElementById('reg-user')?.value || '');
        const phone = String(document.getElementById('dr-phone')?.value || '').trim();

        if (!name || !usuario || !phone || !email || !pass) {
          alert('Completa nombre, usuario, teléfono, correo y contraseña.');
          return;
        }
        if (!email.includes('@')) {
          alert('Ingresa un correo válido.');
          return;
        }
        if (String(pass).trim().length < 6) {
          alert('La contraseña debe tener mínimo 6 caracteres.');
          return;
        }

        const authUser = await registerPassengerFirebase(email, pass);
        const uid = authUser.uid;
        const newPassenger = {
          uid, id: uid, role: 'pasajero',
          name,
          usuario,
          pass,
          correo: email,
          phone,
          foto: getTempImageValue('tempBase64Photo', 'driver-photo-preview'),
          passengerFoto: getTempImageValue('tempBase64Photo', 'driver-photo-preview'),
          status: 'activo',
          date: new Date().toLocaleDateString(),
          createdAt: new Date().toISOString()
        };
        const synced = await saveUserGlobal(newPassenger);
        await ensureWallet('pasajero', uid);
        window.saveWalletData?.(uid, { saldo: 0.00, historial: [], trips: 0 });
        setCurrentAppUser(synced);
        window.persistPanelSession?.(synced);
        window.showPassengerPanel?.();
        alert('Cuenta de pasajero creada y guardada en Firebase.');
      } catch (error) {
        console.error('Registro pasajero Firebase:', error);
        alert('No se pudo registrar con Firebase: ' + (error.message || error.code || error));
        // No se ejecuta el guardado local de respaldo para evitar duplicados y estados desincronizados.
        return;
      }
    };

    const originalSaveDriver = window.saveDriverRequest;
    window.saveDriverRequest = async function() {
      if (window.isSavingDriverRequest) return;
      window.isSavingDriverRequest = true;
      try {
        const get = id => (document.getElementById(id)?.value || '').trim();
        const email = normalizeEmail(get('reg-email') || getCurrentAppUser()?.correo || '');
        const pass = get('reg-pass') || getCurrentAppUser()?.pass || `DRV${Date.now().toString().slice(-6)}`;
        const authUser = auth.currentUser && !auth.currentUser.isAnonymous ? auth.currentUser : await getOrCreateEmailUser(email, pass);
        const uid = authUser.uid;
        const existing = await findUserByUid(uid, 'conductor');
        if (existing) {
          setCurrentAppUser(existing);
          window.persistPanelSession?.(existing);
          mergeLocalUser(existing);
          window.showDriverPanel?.();
          alert('Ya tienes registro de conductor. Se cargaron tus datos desde Firebase.');
          return;
        }
        const driverName = get('dr-name');
        const phoneValue = get('dr-phone');
        const plateValue = get('v-plate').toUpperCase();
        if (!driverName || !phoneValue || !plateValue) {
          alert('Completa nombre, teléfono y placa para finalizar el registro del conductor.');
          return;
        }
        const newDriver = {
          uid, id: uid, role: 'conductor',
          parentPassengerId: getCurrentAppUser()?.role === 'pasajero' ? String(getCurrentAppUser()?.uid || getCurrentAppUser()?.id || '') : '',
          name: driverName,
          usuario: window.createDriverLoginValue ? window.createDriverLoginValue(uid) : `driver_${String(uid).slice(-8)}`,
          pass,
          correo: email,
          phone: phoneValue,
          foto: getTempImageValue('tempBase64Photo', 'driver-photo-preview'),
          driverFoto: getTempImageValue('tempBase64Photo', 'driver-photo-preview'),
          ineFrontal: getTempImageValue('tempIneFrontPhoto', 'ine-f-preview'),
          ineTrasera: getTempImageValue('tempIneBackPhoto', 'ine-b-preview'),
          tarjetaCirculacion: getTempImageValue('tempCirculationPhoto', 'circ-preview'),
          fotoVehiculo: getTempImageValue('tempVehiclePhoto', 'v-photo-preview'),
          status: 'activo', disponible: false, estadoConductor: 'no_disponible', activoEnServicios: false,
          date: new Date().toLocaleDateString(), createdAt: new Date().toISOString(),
          vehiculo: { marca: get('v-brand'), modelo: get('v-model'), color: get('v-color'), year: get('v-year'), placa: plateValue }
        };
        const synced = await saveUserGlobal(newDriver);
        await ensureWallet('conductor', uid);
        window.saveWalletData?.(uid, { saldo: 0.00, historial: [], trips: 0 });
        setCurrentAppUser(synced);
        window.persistPanelSession?.(synced);
        window.showDriverPanel?.();
        alert('Conductor creado, guardado en Firebase y activado en panel Driver.');
      } catch (error) {
        console.error('Registro conductor Firebase:', error);
        alert('No se pudo guardar el conductor en Firebase: ' + (error.message || error.code || error));
        // No se ejecuta el guardado local de respaldo para evitar duplicados y estados desincronizados.
        return;
      } finally { window.isSavingDriverRequest = false; }
    };

    const originalApplyToBeDriver = window.applyToBeDriver;
    window.applyToBeDriver = async function() {
      try {
        const uid = auth.currentUser?.uid || getCurrentAppUser()?.uid || getCurrentAppUser()?.id;
        if (uid) {
          const existing = await findUserByUid(uid, 'conductor');
          if (existing) {
            setCurrentAppUser(existing);
            window.persistPanelSession?.(existing);
            mergeLocalUser(existing);
            window.closeAll?.();
            window.showDriverPanel?.();
            return;
          }
        }
        await loadUsersGlobal();
      } catch (e) { console.warn('Buscar conductor existente:', e.message); }
      return originalApplyToBeDriver?.apply(this, arguments);
    };

    const originalShowAdmin = window.showAdminPanel;
    window.showAdminPanel = function() {
      installRealtimeUsers();
      loadUsersGlobal().catch(e => console.warn('Admin Firebase:', e.message)).finally(() => originalShowAdmin?.apply(this, arguments));
    };

    const originalShowDriver = window.showDriverPanel;
    window.showDriverPanel = function() {
      installRealtimeSolicitudes();
      originalShowDriver?.apply(this, arguments);
      if (getCurrentAppUser()?.role === 'conductor') saveUserGlobal(getCurrentAppUser()).catch(() => {});
    };

    const originalToggleAvailability = window.toggleDriverAvailability;
    window.toggleDriverAvailability = function() {
      originalToggleAvailability?.apply(this, arguments);
      const currentAvailability = Boolean(getAppVar('isAvailable', window.isAvailable || false));
      saveDriverAvailability(currentAvailability).catch(e => console.warn('Disponibilidad Firebase:', e.message));
      if (currentAvailability) saveDriverLocation();
    };

    const originalUpdateLocation = window.updateCurrentDriverLocation;
    window.updateCurrentDriverLocation = function() {
      originalUpdateLocation?.apply(this, arguments);
      if (Boolean(getAppVar('isAvailable', window.isAvailable || false))) saveDriverLocation();
    };

    window.eliminarSeleccionados = async function() {
      const adminView = getCurrentAdminViewSafe();
      const selected = getSelectedAdminIds();
      if (adminView === 'urban-trips') return window.eliminarServicioUrbanoSeleccionado?.();
      if (adminView === 'urban-taximeter') return;
      if (!selected.length) { alert('Selecciona registros para eliminar'); return; }
      const roleToDelete = adminView === 'passengers' ? 'pasajero' : 'conductor';
      const idsToDelete = selected.map(String);
      try {
        await Promise.all(idsToDelete.map(id => deleteUserEverywhere(roleToDelete, id)));
        setSelectedAdminIds([]);
        if (adminView === 'passengers') window.renderAdminPassengers?.();
        else window.renderAdminRequests?.();
        alert('Registros eliminados en Firestore.');
      } catch (error) {
        console.error('Eliminar Firestore:', error);
        alert('No se pudo eliminar en Firestore: ' + (error.code || error.message || error));
      }
    };

    const originalPublishRequest = window.publishPassengerTripRequest;
    window.publishPassengerTripRequest = async function(trip) {
      originalPublishRequest?.apply(this, arguments);
      const liveAppState = getAppVar('appState', window.appState || {});
      const requestId = liveAppState?.pendingTrip?.requestId || `REQ_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      if (liveAppState?.pendingTrip) liveAppState.pendingTrip.requestId = requestId;
      const request = {
        ...(trip || {}), id: requestId, status: 'pending',
        passengerId: getCurrentAppUser()?.uid || getCurrentAppUser()?.id || trip?.passengerId || '',
        passengerName: trip?.passengerName || getCurrentAppUser()?.name || 'Pasajero',
        passengerPhoto: trip?.passengerPhoto || window.getUserPhotoSource?.(getCurrentAppUser()) || '',
        createdAt: new Date().toISOString(), createdAtServer: serverTimestamp()
      };
      try {
        await setDoc(doc(db, 'solicitudesViaje', requestId), request, { merge: true });
        if (request.passengerId) await setDoc(doc(db, ROLE_TRIPS_COLLECTION.pasajero, `${request.passengerId}_${requestId}`), { ...request, solicitudId: requestId, ownerRole: 'pasajero', ownerId: String(request.passengerId), updatedAtServer: serverTimestamp() }, { merge: true });
      } catch (e) { console.warn('Solicitud Firebase:', e.message); }
    };

    const originalAcceptRequest = window.acceptDriverTripRequest;
    window.acceptDriverTripRequest = async function(encodedRequestId) {
      originalAcceptRequest?.apply(this, arguments);
      const requestId = decodeURIComponent(encodedRequestId || '');
      const driverOffer = window.getCurrentDriverOfferData?.();
      if (!requestId || !driverOffer) return;
      try {
        await updateDoc(doc(db, 'solicitudesViaje', requestId), { status: 'accepted', acceptedAt: new Date().toISOString(), acceptedAtServer: serverTimestamp(), driver: driverOffer, driverId: driverOffer.id, driverName: driverOffer.name });
        await setDoc(doc(db, ROLE_TRIPS_COLLECTION.conductor, `${driverOffer.id}_${requestId}`), { solicitudId: requestId, status: 'accepted', ownerRole: 'conductor', ownerId: String(driverOffer.id), driver: driverOffer, driverId: driverOffer.id, createdAtServer: serverTimestamp() }, { merge: true });
      } catch (e) { console.warn('Aceptar solicitud Firebase:', e.message); }
    };

    const originalRejectRequest = window.rejectDriverTripRequest;
    window.rejectDriverTripRequest = async function(encodedRequestId) {
      const requestId = decodeURIComponent(encodedRequestId || '');
      const driverId = String(getCurrentAppUser()?.uid || getCurrentAppUser()?.id || '');

      // Mantiene la función existente para la UI local del conductor,
      // pero NO marca la solicitud global como rechazada para el pasajero.
      originalRejectRequest?.apply(this, arguments);

      if (!requestId) return;
      try {
        await updateDoc(doc(db, 'solicitudesViaje', requestId), {
          status: 'pending',
          rejectedDriverIds: driverId ? arrayUnion(driverId) : arrayUnion('sin_conductor'),
          rejectedBy: driverId,
          rejectedAt: new Date().toISOString(),
          updatedAtServer: serverTimestamp()
        });
      }
      catch (e) { console.warn('Rechazar solicitud Firebase:', e.message); }
    };

    const originalSendMessage = window.sendPassengerMessageToDriver;
    window.sendPassengerMessageToDriver = async function() {
      const input = document.getElementById('passenger-driver-message');
      const text = (input?.value || '').trim();
      const liveAppState = getAppVar('appState', window.appState || {});
      const tripId = liveAppState?.pendingTrip?.requestId || 'general';
      const driver = window.activeTripData || {};
      if (text) {
        try {
          await setDoc(doc(db, 'chatsPasajeros', `${getCurrentAppUser()?.uid || getCurrentAppUser()?.id || 'pasajero'}_${tripId}_${Date.now()}`), {
            tripId, driverId: driver.id || '', passengerId: getCurrentAppUser()?.uid || getCurrentAppUser()?.id || '', passengerName: getCurrentAppUser()?.name || 'Pasajero', message: text, panel: 'passenger', createdAt: new Date().toISOString(), createdAtServer: serverTimestamp()
          });
        } catch (e) { console.warn('Chat Firebase:', e.message); }
      }
      return originalSendMessage?.apply(this, arguments);
    };

    const originalSaveServices = window.saveServiciosUrbanosAdminData;
    window.saveServiciosUrbanosAdminData = function(data) {
      originalSaveServices?.apply(this, arguments);
      Object.entries(data || {}).forEach(async ([id, service]) => {
        try {
          const saved = await saveServiceToFirebase(id, service);
          if (saved?.imagen && !isDataImage(saved.imagen)) {
            const current = JSON.parse(localStorage.getItem('admin_servicios_viajes_urbanos') || '{}');
            current[id] = { ...(current[id] || {}), ...(service || {}), imagen: saved.imagen, storageStatus: 'guardada' };
            localStorage.setItem('admin_servicios_viajes_urbanos', JSON.stringify(current));
            const img = document.getElementById(`service-image-${id}`);
            if (img) img.src = saved.imagen;
          }
        } catch (e) {
          console.error('Servicio Firebase/Storage:', id, e.code || e.message || e);
          alert('Firebase no guardó la foto del servicio: ' + (e.code || e.message || e));
        }
      });
    };

    document.querySelectorAll('button[onclick="location.reload()"]').forEach(btn => {
      btn.onclick = async () => {
        try { await signOut(auth); } catch (_) {}
        localStorage.removeItem('drive_mx_active_session');
        localStorage.removeItem('drive_mx_passenger_session');
        localStorage.removeItem('drive_mx_driver_session');
        location.reload();
      };
    });
  }

  window.DriveMXFirebase = { app, auth, db, storage, saveUserGlobal, loadUsersGlobal, saveDriverAvailability, saveDriverLocation, uploadDataImage, saveServiceToFirebase, deleteUserEverywhere, createTripRequest, listenPendingTrips, listenTripById, acceptTripRequest, rejectTripForDriver };

  installOverrides();
  installRealtimeUsers();
  installRealtimeSolicitudes();

  let authBootstrapped = false;
  onAuthStateChanged(auth, async firebaseUser => {
    if (authBootstrapped) return;
    authBootstrapped = true;
    try {
      await loadUsersGlobal();
      if (firebaseUser && !firebaseUser.isAnonymous) {
        const user = await findUserByUid(firebaseUser.uid);
        if (user) {
          setCurrentAppUser(user);
          window.persistPanelSession?.(user);
          if (user.role === 'conductor') window.showDriverPanel?.();
          else if (user.role === 'pasajero') window.showPassengerPanel?.();
          else window.showAdminPanel?.();
        }
      }
    } catch (error) { console.warn('Arranque Firebase:', error.message); }
  });
