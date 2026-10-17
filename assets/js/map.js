
/*
 * GEOTECHFIELD — Cartographie de terrain V1
 * Fichier : assets/js/map.js
 *
 * Dépendances :
 *   - Leaflet 1.9.x, chargé dans index.html
 *   - assets/js/database.js
 *
 * Aucun framework supplémentaire nécessaire.
 */

(function () {
    "use strict";

    const DB = window.GEOTECHFIELD_DB;

    const DEFAULT_CENTER = [-5.93, 12.35]; // Centre initial indicatif : région de Muanda
    const DEFAULT_ZOOM = 9;
    const DETAIL_ZOOM = 16;

    const COLORS = {
        gres: "#D6A56D",
        argilite: "#8D99A6",
        shale: "#8D99A6",
        calcaire: "#67B7A1",
        autres: "#C084FC",
        location: "#2DD4BF"
    };

    let map = null;
    let stationLayer = null;
    let locationLayer = null;
    let resizeObserver = null;
    let initialized = false;
    let stations = [];
    let projectMap = new Map();

    const $ = (id) => document.getElementById(id);

    function escapeHTML(value) {
        return String(value ?? "").replace(/[&<>"']/g, (character) => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        })[character]);
    }

    function setStatus(message, type = "info") {
        const element = $("mapStatus");
        if (!element) return;

        element.textContent = message;
        element.dataset.type = type;
    }

    function isValidCoordinate(latitude, longitude) {
        if (latitude === null || latitude === undefined ||
            longitude === null || longitude === undefined ||
            latitude === "" || longitude === "") {
            return false;
        }

        const lat = Number(latitude);
        const lng = Number(longitude);

        return Number.isFinite(lat) &&
            Number.isFinite(lng) &&
            lat >= -90 && lat <= 90 &&
            lng >= -180 && lng <= 180;
    }

    function getLithologyColor(lithology) {
        const value = String(lithology || "").toLowerCase();

        if (value.includes("grès") || value.includes("gres") ||
            value.includes("sandstone")) {
            return COLORS.gres;
        }

        if (value.includes("argilite") || value.includes("shale") ||
            value.includes("argile") || value.includes("mudstone")) {
            return COLORS.argilite;
        }

        if (value.includes("calcaire") || value.includes("limestone") ||
            value.includes("carbonate")) {
            return COLORS.calcaire;
        }

        return COLORS.autres;
    }

    function formatCoordinates(latitude, longitude) {
        return `${Number(latitude).toFixed(6)}, ${Number(longitude).toFixed(6)}`;
    }

    function formatDate(value) {
        if (!value) return "Date non renseignée";

        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);

        return new Intl.DateTimeFormat("fr-FR", {
            day: "2-digit",
            month: "short",
            year: "numeric"
        }).format(date);
    }

    function getProjectName(projectId) {
        const project = projectMap.get(projectId);
        return project ? project.name : "Projet inconnu";
    }

    function popupHTML(observation) {
        const stationId = escapeHTML(observation.stationId || "Station");
        const lithology = escapeHTML(observation.lithology || "Non renseignée");
        const description = escapeHTML(observation.description || "Aucune description.");
        const project = escapeHTML(getProjectName(observation.projectId));
        const date = escapeHTML(formatDate(observation.date));
        const coordinates = escapeHTML(
            formatCoordinates(observation.latitude, observation.longitude)
        );

        return `
            <div style="min-width:210px;max-width:290px;font-family:Arial,sans-serif">
                <div style="font-size:11px;color:#64748b;margin-bottom:5px">
                    ${stationId}
                </div>
                <strong style="font-size:15px">${lithology}</strong>
                <div style="font-size:12px;color:#64748b;margin:7px 0">
                    ${project}<br>${date}
                </div>
                <p style="font-size:12px;line-height:1.5;margin:8px 0">
                    ${description}
                </p>
                <div style="font-size:11px;color:#64748b">
                    GPS : ${coordinates}
                </div>
                <button
                    type="button"
                    data-map-station="${escapeHTML(observation.id)}"
                    style="margin-top:10px;padding:7px 10px;border:0;border-radius:6px;background:#0f766e;color:white;cursor:pointer"
                >
                    Voir la fiche
                </button>
            </div>
        `;
    }

    function createMap() {
        if (map) return true;

        if (!window.L) {
            setStatus(
                "Leaflet n'a pas été chargé. Vérifie ta connexion Internet et le chargement du script Leaflet dans index.html.",
                "error"
            );
            return false;
        }

        const container = $("geologyMap");
        if (!container) return false;

        map = L.map(container, {
            zoomControl: true,
            preferCanvas: true
        }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            maxZoom: 19
        }).addTo(map);

        stationLayer = L.layerGroup().addTo(map);
        locationLayer = L.layerGroup().addTo(map);

        map.on("popupopen", (event) => {
            const popupElement = event.popup.getElement();
            if (!popupElement) return;

            const button = popupElement.querySelector("[data-map-station]");
            if (!button) return;

            button.addEventListener("click", () => {
                const id = button.getAttribute("data-map-station");
                openObservation(id);
            });
        });

        if ("ResizeObserver" in window) {
            resizeObserver = new ResizeObserver(() => {
                if (map) map.invalidateSize({ pan: false });
            });
            resizeObserver.observe(container);
        }

        // Leaflet doit recalculer ses dimensions après l'ouverture de l'onglet.
        window.setTimeout(() => {
            if (map) map.invalidateSize();
        }, 250);

        return true;
    }

    async function openObservation(id) {
        if (!DB || typeof DB.getObservation !== "function") {
            setStatus("La base de données n'est pas disponible.", "error");
            return;
        }

        try {
            const observation = await DB.getObservation(id);

            if (!observation) {
                setStatus("Cette observation n'existe plus.", "error");
                return;
            }

            // Réutilise la modale de l'application si elle est disponible.
            if (typeof window.GEOTECHFIELD_OPEN_OBSERVATION === "function") {
                window.GEOTECHFIELD_OPEN_OBSERVATION(observation);
                return;
            }

            const message = [
                `Station : ${observation.stationId || "Non renseignée"}`,
                `Lithologie : ${observation.lithology || "Non renseignée"}`,
                `Date : ${formatDate(observation.date)}`,
                `Projet : ${getProjectName(observation.projectId)}`,
                `Description : ${observation.description || "Aucune"}`,
                `Commentaires : ${observation.comments || "Aucun"}`
            ].join("\n\n");

            window.alert(message);
        } catch (error) {
            console.error("GEOTECHFIELD : impossible d'ouvrir l'observation.", error);
            setStatus("Impossible de charger cette observation.", "error");
        }
    }

    function renderStationList(allStations, locatedStations) {
        const container = $("mapStationList");
        if (!container) return;

        const withoutGPS = allStations.filter((item) =>
            !isValidCoordinate(item.latitude, item.longitude)
        );

        const locatedHTML = locatedStations.map((item) => `
            <button
                class="map-station-item"
                type="button"
                data-focus-station="${escapeHTML(item.id)}"
                style="width:100%;text-align:left;background:transparent;color:inherit"
            >
                <div class="map-station-name">
                    ${escapeHTML(item.stationId || "Station sans identifiant")}
                </div>
                <div class="map-station-details">
                    ${escapeHTML(item.lithology || "Lithologie non renseignée")}
                    · ${escapeHTML(getProjectName(item.projectId))}
                </div>
            </button>
        `).join("");

        const missingHTML = withoutGPS.length ? `
            <div style="margin-top:16px;font-size:12px;font-weight:700;color:var(--muted,#8D99A6)">
                SANS COORDONNÉES GPS (${withoutGPS.length})
            </div>
            ${withoutGPS.map((item) => `
                <div class="map-station-item" style="cursor:default">
                    <div class="map-station-name">
                        ${escapeHTML(item.stationId || "Station sans identifiant")}
                    </div>
                    <div class="map-station-details">
                        ${escapeHTML(item.lithology || "Lithologie non renseignée")}
                    </div>
                </div>
            `).join("")}
        ` : "";

        container.innerHTML = (locatedHTML || `
            <div class="map-empty">
                Aucune station avec des coordonnées GPS valides.
            </div>
        `) + missingHTML;
    }

    function updateCounters(allStations, locatedStations) {
        const values = {
            mapTotalStations: allStations.length,
            mapGpsStations: locatedStations.length,
            mapMissingGps: allStations.length - locatedStations.length
        };

        Object.entries(values).forEach(([id, value]) => {
            const element = $(id);
            if (element) element.textContent = String(value);
        });
    }

    function renderStations(allStations) {
        if (!createMap()) return;

        stationLayer.clearLayers();

        const locatedStations = allStations.filter((item) =>
            isValidCoordinate(item.latitude, item.longitude)
        );

        locatedStations.forEach((observation) => {
            const latitude = Number(observation.latitude);
            const longitude = Number(observation.longitude);
            const color = getLithologyColor(observation.lithology);

            const marker = L.circleMarker([latitude, longitude], {
                radius: 8,
                color: "#0B0F14",
                weight: 2,
                fillColor: color,
                fillOpacity: 0.95
            });

            marker.bindPopup(popupHTML(observation));
            marker.bindTooltip(
                `${observation.stationId || "Station"} — ${observation.lithology || "Lithologie inconnue"}`
            );

            marker.addTo(stationLayer);
        });

        updateCounters(allStations, locatedStations);
        renderStationList(allStations, locatedStations);

        if (locatedStations.length === 1) {
            map.setView([
                Number(locatedStations[0].latitude),
                Number(locatedStations[0].longitude)
            ], DETAIL_ZOOM);
        } else if (locatedStations.length > 1) {
            const bounds = L.latLngBounds(
                locatedStations.map((item) => [
                    Number(item.latitude),
                    Number(item.longitude)
                ])
            );

            map.fitBounds(bounds, { padding: [35, 35], maxZoom: DETAIL_ZOOM });
        }

        setStatus(
            locatedStations.length
                ? `${locatedStations.length} station(s) géolocalisée(s) affichée(s).`
                : "Carte prête. Ajoute des coordonnées GPS aux observations pour afficher les stations.",
            "success"
        );
    }

    async function refreshMap(options = {}) {
        if (!DB || typeof DB.getObservations !== "function") {
            setStatus(
                "Base de données indisponible. Vérifie assets/js/database.js.",
                "error"
            );
            return;
        }

        try {
            setStatus("Chargement des stations...");

            const results = await Promise.all([
                DB.getObservations(),
                typeof DB.getProjects === "function"
                    ? DB.getProjects()
                    : Promise.resolve([])
            ]);

            stations = Array.isArray(results[0]) ? results[0] : [];
            const projects = Array.isArray(results[1]) ? results[1] : [];

            projectMap = new Map(projects.map((project) => [
                project.id,
                project
            ]));

            if (!createMap()) return;

            const locatedStations = stations.filter((item) =>
                isValidCoordinate(item.latitude, item.longitude)
            );

            // Ne recentre pas la carte automatiquement lors d'un simple rafraîchissement.
            // Le recentrage initial reste utile à la première ouverture.
            const shouldFit = options.fit === true || !initialized;

            if (shouldFit) {
                renderStations(stations);
            } else {
                stationLayer.clearLayers();

                locatedStations.forEach((observation) => {
                    L.circleMarker(
                        [Number(observation.latitude), Number(observation.longitude)],
                        {
                            radius: 8,
                            color: "#0B0F14",
                            weight: 2,
                            fillColor: getLithologyColor(observation.lithology),
                            fillOpacity: 0.95
                        }
                    )
                    .bindPopup(popupHTML(observation))
                    .bindTooltip(
                        `${observation.stationId || "Station"} — ${observation.lithology || "Lithologie inconnue"}`
                    )
                    .addTo(stationLayer);
                });

                updateCounters(stations, locatedStations);
                renderStationList(stations, locatedStations);

                setStatus(
                    `${locatedStations.length} station(s) géolocalisée(s) affichée(s).`,
                    "success"
                );
            }

            initialized = true;
            map.invalidateSize();
        } catch (error) {
            console.error("GEOTECHFIELD : erreur de chargement de la carte.", error);
            setStatus(
                "Impossible de charger les observations. Vérifie la base de données.",
                "error"
            );
        }
    }

    function locateMe() {
        if (!navigator.geolocation) {
            setStatus(
                "La géolocalisation n'est pas prise en charge par ce navigateur.",
                "error"
            );
            return;
        }

        setStatus("Recherche de ta position GPS...");

        navigator.geolocation.getCurrentPosition(
            (position) => {
                const latitude = position.coords.latitude;
                const longitude = position.coords.longitude;
                const accuracy = Math.round(position.coords.accuracy);

                if (!map && !createMap()) return;

                locationLayer.clearLayers();

                L.circleMarker([latitude, longitude], {
                    radius: 9,
                    color: "#0B0F14",
                    weight: 2,
                    fillColor: COLORS.location,
                    fillOpacity: 1
                })
                .bindPopup(`
                    <strong>Ta position actuelle</strong><br>
                    ${formatCoordinates(latitude, longitude)}<br>
                    Précision estimée : ${accuracy} m
                `)
                .addTo(locationLayer)
                .openPopup();

                L.circle([latitude, longitude], {
                    radius: accuracy,
                    color: COLORS.location,
                    weight: 1,
                    fillOpacity: 0.08
                }).addTo(locationLayer);

                map.setView([latitude, longitude], DETAIL_ZOOM);

                setStatus(
                    `Position obtenue. Précision estimée : ${accuracy} m. Cette position n'a pas été enregistrée dans une observation.`,
                    "success"
                );
            },
            (error) => {
                const messages = {
                    1: "Autorisation GPS refusée. Autorise la localisation dans ton navigateur.",
                    2: "Position GPS indisponible. Vérifie les paramètres de localisation du téléphone.",
                    3: "La demande GPS a expiré. Réessaie dans quelques instants."
                };

                setStatus(
                    messages[error.code] || "Impossible de déterminer ta position.",
                    "error"
                );
            },
            {
                enableHighAccuracy: true,
                timeout: 15000,
                maximumAge: 10000
            }
        );
    }

    function focusStation(id) {
        const observation = stations.find((item) => String(item.id) === String(id));

        if (!observation ||
            !isValidCoordinate(observation.latitude, observation.longitude)) {
            setStatus("Cette station n'a pas de coordonnées GPS valides.", "error");
            return;
        }

        if (!map && !createMap()) return;

        const position = [
            Number(observation.latitude),
            Number(observation.longitude)
        ];

        map.setView(position, DETAIL_ZOOM);

        stationLayer.eachLayer((layer) => {
            const layerPosition = layer.getLatLng();

            if (layerPosition.lat === position[0] &&
                layerPosition.lng === position[1]) {
                layer.openPopup();
            }
        });
    }

    function bindEvents() {
        $("mapLocateMe")?.addEventListener("click", locateMe);

        $("mapRefresh")?.addEventListener("click", () => {
            refreshMap({ fit: false });
        });

        $("mapStationList")?.addEventListener("click", (event) => {
            const button = event.target.closest("[data-focus-station]");
            if (!button) return;

            focusStation(button.getAttribute("data-focus-station"));
        });

        // La carte est initialisée lorsqu'on ouvre sa rubrique.
        document.querySelectorAll('[data-view="mapping"]').forEach((button) => {
            button.addEventListener("click", () => {
                window.setTimeout(() => {
                    if (!createMap()) return;

                    map.invalidateSize();

                    if (!initialized) {
                        refreshMap({ fit: true });
                    }
                }, 150);
            });
        });

        // Permet à d'autres modules de rafraîchir la carte après une modification.
        window.addEventListener("geotechfield:observations-updated", () => {
            refreshMap({ fit: false });
        });

        // Surveille l'affichage : Leaflet doit connaître la taille réelle du conteneur.
        document.addEventListener("visibilitychange", () => {
            if (!document.hidden && map) {
                window.setTimeout(() => map.invalidateSize(), 100);
            }
        });
    }

    async function start() {
        bindEvents();

        // Ne crée pas la carte tant que son panneau est caché.
        const mapPanel = $("mappingView");

        if (mapPanel && !mapPanel.hidden) {
            await refreshMap({ fit: true });
        } else {
            setStatus("Ouvre Cartographie pour charger la carte.");
        }
    }

    // API publique utilisée pour actualiser la carte depuis app.js.
    window.GEOTECHFIELD_MAP = {
        refresh: () => refreshMap({ fit: false }),
        locateMe,
        focusStation,
        openObservation
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
        start();
    }
})();
