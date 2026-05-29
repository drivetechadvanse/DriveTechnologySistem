# Drive MX separado por carpetas

Esta versión separa el `index.html` original sin eliminar funciones visibles.

## Orden de pegado / creación

1. Crea la carpeta raíz del proyecto.
2. Pega `index.html` en la raíz.
3. Crea la carpeta `src/`.
4. Dentro de `src/`, crea estas carpetas:
   - `portada/`
   - `inicio/`
   - `pasajeros/pantallas/`, `pasajeros/componentes/`, `pasajeros/servicios/`, `pasajeros/hooks/`
   - `conductores/pantallas/`, `conductores/componentes/`, `conductores/servicios/`, `conductores/hooks/`
   - `administrador/pantallas/`, `administrador/componentes/`, `administrador/servicios/`, `administrador/hooks/`
   - `firebase/`
   - `mapas/`
   - `storage/`
   - `firestore/`
   - `estilos/`
   - `common/`

## Archivos principales

- `src/estilos/styles.css` → estilos originales.
- `src/portada/splash.html` → portada/splash.
- `src/common/overlay.html` → overlay global.
- `src/common/sidebar.html` → menú lateral global.
- `src/inicio/login.html` → login/inicio.
- `src/inicio/registro-unificado.html` → registro pasajero/conductor.
- `src/pasajeros/pantallas/pasajero.html` → panel pasajero.
- `src/conductores/pantallas/conductor-activo.html` → panel conductor.
- `src/conductores/pantallas/seleccion-conductor.html` → selección de conductor.
- `src/administrador/pantallas/admin-panel.html` → panel de control administrador.
- `src/common/app.js` → lógica principal original.
- `src/firebase/firebase-bridge.js` → Firebase Auth, Firestore y Storage bridge.
- `src/firestore/global-sync.js` → sincronización global Firestore/Storage.
- `src/mapas/google-maps-loader.js` → carga Google Maps.

## Importante

La lógica JavaScript principal queda en `src/common/app.js` para no romper funciones globales `onclick`, Firebase, tarifas, taxímetro ni Google Maps. Después podemos hacer una segunda separación interna de lógica por pasajero/conductor/admin con más cuidado.

Para probarlo, súbelo a GitHub y despliega en Vercel. Si lo abres localmente con doble clic, `fetch()` puede fallar por seguridad del navegador; usa Vercel o un servidor local.