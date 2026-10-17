
"use strict";

/**
 * GEOTECHFIELD — Rapports de projet
 * Lecture des projets, stations et photos depuis IndexedDB.
 * Impression des rapports de station et de projet en PDF.
 */

(() => {
    const DB = window.GEOTECHFIELD_DB;
    const $ = (selector, root = document) => root.querySelector(selector);

    let projects = [];
    let observations = [];
    let selectedProjectId = "";
    let renderVersion = 0;
    let objectURLs = [];

    function escapeHTML(value) {
        return String(value ?? "").replace(/[&<>"']/g, char => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        })[char]);
    }

    function formatDate(value) {
        if (!value) return "—";

        const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);

        if (Number.isNaN(date.getTime())) return "—";

        return new Intl.DateTimeFormat("fr-FR", {
            day: "2-digit",
            month: "long",
            year: "numeric"
        }).format(date);
    }

    function formatBytes(bytes) {
        const size = Number(bytes) || 0;

        if (size < 1024) return `${size} octets`;
        if (size < 1024 * 1024) {
            return `${(size / 1024).toFixed(1)} Ko`;
        }

        return `${(size / (1024 * 1024)).toFixed(2)} Mo`;
    }

    function getProject(id) {
        return projects.find(
            project => String(project.id) === String(id)
        );
    }

    function getProjectObservations(projectId) {
        return observations
            .filter(item => String(item.projectId) === String(projectId))
            .sort((a, b) =>
                String(a.date || "").localeCompare(String(b.date || ""))
            );
    }

    function releaseObjectURLs() {
        objectURLs.forEach(url => URL.revokeObjectURL(url));
        objectURLs = [];
    }

    function createImageURL(blob) {
        if (!(blob instanceof Blob)) return "";

        const url = URL.createObjectURL(blob);
        objectURLs.push(url);

        return url;
    }

    function notify(message, isError = false) {
        const region = $("#toastRegion");

        if (!region) {
            console[isError ? "error" : "log"](message);
            return;
        }

        const item = document.createElement("div");
        item.className = `toast toast-${isError ? "error" : "success"}`;
        item.setAttribute("role", isError ? "alert" : "status");
        item.textContent = message;

        region.appendChild(item);
        requestAnimationFrame(() => item.classList.add("show"));

        window.setTimeout(() => {
            item.classList.remove("show");
            window.setTimeout(() => item.remove(), 250);
        }, 3500);
    }

    async function loadData() {
        if (!DB) {
            throw new Error("La base GEOTECHFIELD est indisponible.");
        }

        const [loadedProjects, loadedObservations] = await Promise.all([
            DB.getProjects(),
            DB.getObservations()
        ]);

        projects = Array.isArray(loadedProjects) ? loadedProjects : [];
        observations = Array.isArray(loadedObservations)
            ? loadedObservations
            : [];

        if (
            selectedProjectId &&
            !getProject(selectedProjectId)
        ) {
            selectedProjectId = "";
        }

        if (!selectedProjectId && projects.length) {
            selectedProjectId = String(projects[0].id);
        }
    }

    function renderShell() {
        const workspace = $("#projectReportsWorkspace");
        if (!workspace) return;

        if (!projects.length) {
            workspace.innerHTML = `
                <div class="panel">
                    <div class="empty-state">
                        <h3>Aucun projet disponible</h3>
                        <p>
                            Crée d'abord un projet, puis ajoute des
                            observations et des photos de terrain.
                        </p>
                        <button type="button"
                            class="btn btn-primary"
                            data-report-action="create-project">
                            + Créer un projet
                        </button>
                    </div>
                </div>`;
            return;
        }

        const project = getProject(selectedProjectId) || projects[0];
        selectedProjectId = String(project.id);

        const stations = getProjectObservations(project.id);
        const validated = stations.filter(
            item => item.status === "validated"
        ).length;
        const drafts = stations.length - validated;
        const gpsCount = stations.filter(item =>
            item.latitude !== null &&
            item.latitude !== undefined &&
            item.longitude !== null &&
            item.longitude !== undefined &&
            item.latitude !== "" &&
            item.longitude !== ""
        ).length;

        workspace.innerHTML = `
            <div class="panel" style="margin-bottom:20px">
                <div class="toolbar" style="flex-wrap:wrap">
                    <div style="flex:1;min-width:230px">
                        <label class="form-label" for="reportProjectSelect">
                            Projet à examiner
                        </label>
                        <select class="form-select" id="reportProjectSelect">
                            ${projects.map(item => `
                                <option value="${escapeHTML(item.id)}"
                                    ${String(item.id) === String(project.id)
                                        ? "selected" : ""}>
                                    ${escapeHTML(item.name)}
                                </option>
                            `).join("")}
                        </select>
                    </div>

                    <button type="button"
                        class="btn btn-primary"
                        data-report-action="print-project">
                        Imprimer le rapport du projet
                    </button>
                </div>

                <div style="margin-top:18px">
                    <h2>${escapeHTML(project.name)}</h2>
                    <p>${escapeHTML(project.location || "Localisation non précisée")}</p>
                    <p>${escapeHTML(project.description || "Aucune description du projet.")}</p>
                </div>
            </div>

            <div class="grid grid-stats"
                style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-bottom:20px">

                <div class="panel">
                    <p>Stations</p>
                    <h2>${stations.length}</h2>
                </div>

                <div class="panel">
                    <p>Stations validées</p>
                    <h2>${validated}</h2>
                </div>

                <div class="panel">
                    <p>Brouillons</p>
                    <h2>${drafts}</h2>
                </div>

                <div class="panel">
                    <p>Stations avec GPS</p>
                    <h2>${gpsCount}</h2>
                </div>
            </div>

            <div class="panel">
                <div class="page-heading" style="margin-bottom:18px">
                    <div>
                        <h2>Registre des stations</h2>
                        <p>
                            ${stations.length} station(s) enregistrée(s)
                            pour ce projet.
                        </p>
                    </div>
                </div>

                <div class="table-container">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Station / date</th>
                                <th>Lithologie</th>
                                <th>Description</th>
                                <th>Photos</th>
                                <th>Statut</th>
                                <th>Rapport</th>
                            </tr>
                        </thead>
                        <tbody id="projectReportStations">
                            <tr>
                                <td colspan="6">Chargement des stations…</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div id="reportStationsEmpty" class="empty-state" hidden>
                    <h3>Aucune station dans ce projet</h3>
                    <p>Ajoute une observation pour commencer le rapport.</p>
                    <button type="button" class="btn btn-primary"
                        data-report-action="create-observation">
                        + Ajouter une station
                    </button>
                </div>
            </div>`;
    }

    async function renderStations(version) {
        const tbody = $("#projectReportStations");
        if (!tbody) return;

        const stations = getProjectObservations(selectedProjectId);
        const empty = $("#reportStationsEmpty");

        if (!stations.length) {
            tbody.innerHTML = "";
            if (empty) empty.hidden = false;
            return;
        }

        if (empty) empty.hidden = true;

        const results = await Promise.all(stations.map(async station => {
            try {
                const photos = await DB.getPhotosByObservation(station.id);
                return { station, photos };
            } catch (error) {
                console.error("Erreur de lecture des photos :", error);
                return { station, photos: [] };
            }
        }));

        if (version !== renderVersion) return;

        tbody.innerHTML = results.map(({ station, photos }) => {
            const status = station.status === "validated"
                ? "Validée"
                : "Brouillon";

            const previews = photos.slice(0, 3).map(photo => {
                const url = createImageURL(photo.blob);

                return url
                    ? `<img src="${escapeHTML(url)}"
                        alt="${escapeHTML(photo.name || "Photo de terrain")}"
                        title="${escapeHTML(photo.name || "Photo")}"
                        style="width:42px;height:42px;object-fit:cover;border-radius:6px;margin:2px">`
                    : "";
            }).join("");

            const extra = photos.length > 3
                ? `<span>+${photos.length - 3}</span>`
                : "";

            return `
                <tr>
                    <td>
                        <strong>${escapeHTML(station.stationId || "Station")}</strong>
                        <div class="table-subtext">
                            ${escapeHTML(formatDate(station.date))}
                        </div>
                    </td>

                    <td>${escapeHTML(station.lithology || "—")}</td>

                    <td class="observation-description-cell">
                        ${escapeHTML(station.description || "—")}
                    </td>

                    <td>
                        <div style="display:flex;align-items:center;flex-wrap:wrap">
                            ${previews}
                            ${extra}
                        </div>
                        <small>${photos.length} photo(s)</small>
                    </td>

                    <td>
                        <span class="status-badge ${
                            station.status === "validated"
                                ? "status-validated"
                                : "status-draft"
                        }">${status}</span>
                    </td>

                    <td>
                        <button type="button"
                            class="btn btn-small btn-secondary"
                            data-report-action="print-station"
                            data-id="${escapeHTML(station.id)}">
                            Fiche PDF
                        </button>
                    </td>
                </tr>`;
        }).join("");
    }

    async function render() {
        const version = ++renderVersion;
        releaseObjectURLs();

        try {
            await loadData();

            if (version !== renderVersion) return;

            renderShell();

            if (projects.length) {
                await renderStations(version);
            }
        } catch (error) {
            console.error("[GEOTECHFIELD Reports]", error);
            notify(error.message || "Impossible de charger les rapports.", true);
        }
    }

    function photoHTML(photo) {
        const url = createImageURL(photo.blob);

        if (!url) {
            return `<p>Image indisponible : ${escapeHTML(photo.name)}</p>`;
        }

        return `
            <figure class="report-photo">
                <img src="${escapeHTML(url)}"
                    alt="${escapeHTML(photo.name || "Photo géologique")}">
                <figcaption>
                    ${escapeHTML(photo.name || "Photo de terrain")}
                </figcaption>
            </figure>`;
    }

    function reportStyles() {
        return `
            <style>
                * { box-sizing: border-box; }
                body {
                    margin: 0;
                    padding: 28px;
                    color: #202a35;
                    background: white;
                    font: 14px/1.55 Arial, sans-serif;
                }
                h1 { font-size: 26px; margin: 0 0 8px; }
                h2 { font-size: 19px; margin-top: 26px; }
                h3 { font-size: 15px; margin-bottom: 5px; }
                .report-header {
                    padding-bottom: 18px;
                    border-bottom: 2px solid #263746;
                    margin-bottom: 22px;
                }
                .report-subtitle { color: #5e6b78; }
                .report-meta {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 10px;
                    margin: 18px 0;
                }
                .report-field {
                    padding: 10px;
                    border: 1px solid #d7dfe6;
                    border-radius: 5px;
                    overflow-wrap: anywhere;
                }
                .report-label {
                    display: block;
                    color: #667481;
                    font-size: 11px;
                    text-transform: uppercase;
                    margin-bottom: 3px;
                }
                .report-section {
                    border-top: 1px solid #d7dfe6;
                    padding-top: 12px;
                    margin-top: 22px;
                }
                .report-photo-grid {
                    display: grid;
                    grid-template-columns: repeat(2, minmax(0, 1fr));
                    gap: 14px;
                }
                .report-photo { margin: 0; page-break-inside: avoid; }
                .report-photo img {
                    width: 100%;
                    max-height: 320px;
                    object-fit: contain;
                    border: 1px solid #d7dfe6;
                }
                figcaption {
                    font-size: 11px;
                    color: #5e6b78;
                    overflow-wrap: anywhere;
                    margin-top: 4px;
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 11px;
                }
                th, td {
                    border: 1px solid #d7dfe6;
                    padding: 7px;
                    text-align: left;
                    vertical-align: top;
                    overflow-wrap: anywhere;
                }
                th { background: #edf2f5; }
                .report-footer {
                    margin-top: 32px;
                    padding-top: 10px;
                    border-top: 1px solid #d7dfe6;
                    font-size: 10px;
                    color: #667481;
                }
                .no-photos {
                    padding: 14px;
                    border: 1px dashed #aab6c1;
                    color: #667481;
                }
                @page { size: A4; margin: 15mm; }
                @media print {
                    body { padding: 0; }
                    .report-section { break-inside: auto; }
                    tr, .report-field { break-inside: avoid; }
                }
            </style>`;
    }

    function buildReportHTML(title, content) {
        return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHTML(title)}</title>
${reportStyles()}
</head>
<body>
${content}
<footer class="report-footer">
    GEOTECHFIELD — Carnet numérique de terrain géologique<br>
    Rapport généré le ${escapeHTML(formatDate(new Date().toISOString()))}
</footer>
</body>
</html>`;
    }

    function openPrintWindow() {
        const printWindow = window.open("", "_blank");

        if (!printWindow) {
            notify(
                "La fenêtre du rapport a été bloquée. Autorise les fenêtres contextuelles pour ce site.",
                true
            );
        }

        return printWindow;
    }

    async function printStation(stationId) {
        const station = observations.find(
            item => String(item.id) === String(stationId)
        );

        if (!station) {
            notify("Station introuvable.", true);
            return;
        }

        // Ouvrir immédiatement pour limiter le blocage des fenêtres.
        const printWindow = openPrintWindow();
        if (!printWindow) return;

        try {
            const project = getProject(station.projectId);
            const photos = await DB.getPhotosByObservation(station.id);

            const gps = station.latitude !== null &&
                station.latitude !== undefined &&
                station.longitude !== null &&
                station.longitude !== undefined
                ? `${station.latitude}, ${station.longitude}`
                : "Non renseignées";

            const photoContent = photos.length
                ? `<div class="report-photo-grid">${photos.map(photoHTML).join("")}</div>`
                : `<div class="no-photos">Aucune photo n'est associée à cette station.</div>`;

            const html = buildReportHTML(
                `Fiche ${station.stationId || "station"}`,
                `
                <header class="report-header">
                    <h1>Fiche de station géologique</h1>
                    <div class="report-subtitle">
                        ${escapeHTML(project?.name || "Projet inconnu")}
                    </div>
                </header>

                <div class="report-meta">
                    <div class="report-field">
                        <span class="report-label">Identifiant de station</span>
                        <strong>${escapeHTML(station.stationId || "—")}</strong>
                    </div>
                    <div class="report-field">
                        <span class="report-label">Date d'observation</span>
                        ${escapeHTML(formatDate(station.date))}
                    </div>
                    <div class="report-field">
                        <span class="report-label">Projet</span>
                        ${escapeHTML(project?.name || "Projet inconnu")}
                    </div>
                    <div class="report-field">
                        <span class="report-label">Localisation du projet</span>
                        ${escapeHTML(project?.location || "Non précisée")}
                    </div>
                    <div class="report-field">
                        <span class="report-label">Lithologie</span>
                        ${escapeHTML(station.lithology || "Non précisée")}
                    </div>
                    <div class="report-field">
                        <span class="report-label">Statut</span>
                        ${station.status === "validated" ? "Validée" : "Brouillon"}
                    </div>
                    <div class="report-field">
                        <span class="report-label">Coordonnées GPS</span>
                        ${escapeHTML(gps)}
                    </div>
                </div>

                <section class="report-section">
                    <h2>Description géologique</h2>
                    <p>${escapeHTML(station.description || "Aucune description.")}</p>
                </section>

                <section class="report-section">
                    <h2>Notes complémentaires</h2>
                    <p>${escapeHTML(station.comments || "Aucune note complémentaire.")}</p>
                </section>

                <section class="report-section">
                    <h2>Photographies de terrain (${photos.length})</h2>
                    ${photoContent}
                </section>`
            );

            printWindow.document.open();
            printWindow.document.write(html);
            printWindow.document.close();

            printWindow.addEventListener("load", () => {
                printWindow.focus();
                printWindow.print();
            }, { once: true });
        } catch (error) {
            printWindow.close();
            console.error(error);
            notify("Impossible de préparer la fiche de station.", true);
        }
    }

    async function printProject() {
        const project = getProject(selectedProjectId);

        if (!project) {
            notify("Sélectionne un projet.", true);
            return;
        }

        const printWindow = openPrintWindow();
        if (!printWindow) return;

        try {
            const stations = getProjectObservations(project.id);

            const photoSets = await Promise.all(
                stations.map(async station => ({
                    station,
                    photos: await DB.getPhotosByObservation(station.id)
                }))
            );

            let totalPhotos = 0;
            photoSets.forEach(item => totalPhotos += item.photos.length);

            const stationRows = photoSets.map(({ station, photos }) => `
                <tr>
                    <td>${escapeHTML(station.stationId || "—")}</td>
                    <td>${escapeHTML(formatDate(station.date))}</td>
                    <td>${escapeHTML(station.lithology || "—")}</td>
                    <td>${escapeHTML(station.description || "—")}</td>
                    <td>${photos.length}</td>
                    <td>${station.status === "validated" ? "Validée" : "Brouillon"}</td>
                </tr>
            `).join("");

            const stationPhotoSections = photoSets.map(({ station, photos }) => `
                <section class="report-section">
                    <h2>
                        ${escapeHTML(station.stationId || "Station")}
                        — ${escapeHTML(station.lithology || "Lithologie non précisée")}
                    </h2>
                    <p><strong>Date :</strong> ${escapeHTML(formatDate(station.date))}</p>
                    <p><strong>Description :</strong> ${escapeHTML(station.description || "—")}</p>
                    <p><strong>Notes :</strong> ${escapeHTML(station.comments || "—")}</p>
                    <p><strong>GPS :</strong> ${
                        station.latitude !== null &&
                        station.latitude !== undefined &&
                        station.longitude !== null &&
                        station.longitude !== undefined
                            ? `${escapeHTML(station.latitude)}, ${escapeHTML(station.longitude)}`
                            : "Non renseigné"
                    }</p>
                    ${
                        photos.length
                            ? `<div class="report-photo-grid">${photos.map(photoHTML).join("")}</div>`
                            : `<div class="no-photos">Aucune photo pour cette station.</div>`
                    }
                </section>
            `).join("");

            const html = buildReportHTML(
                `Rapport — ${project.name}`,
                `
                <header class="report-header">
                    <h1>Rapport géologique de projet</h1>
                    <div class="report-subtitle">${escapeHTML(project.name)}</div>
                </header>

                <div class="report-meta">
                    <div class="report-field">
                        <span class="report-label">Localisation</span>
                        ${escapeHTML(project.location || "Non précisée")}
                    </div>
                    <div class="report-field">
                        <span class="report-label">Nombre de stations</span>
                        ${stations.length}
                    </div>
                    <div class="report-field">
                        <span class="report-label">Nombre total de photos</span>
                        ${totalPhotos}
                    </div>
                    <div class="report-field">
                        <span class="report-label">Description du projet</span>
                        ${escapeHTML(project.description || "Non renseignée")}
                    </div>
                </div>

                <section class="report-section">
                    <h2>Synthèse des stations</h2>
                    ${
                        stations.length
                            ? `<table>
                                <thead>
                                    <tr>
                                        <th>Station</th>
                                        <th>Date</th>
                                        <th>Lithologie</th>
                                        <th>Description</th>
                                        <th>Photos</th>
                                        <th>Statut</th>
                                    </tr>
                                </thead>
                                <tbody>${stationRows}</tbody>
                            </table>`
                            : `<div class="no-photos">Ce projet ne contient aucune station.</div>`
                    }
                </section>

                <h1 style="margin-top:32px">Fiches détaillées des stations</h1>
                ${stationPhotoSections}`
            );

            printWindow.document.open();
            printWindow.document.write(html);
            printWindow.document.close();

            printWindow.addEventListener("load", () => {
                printWindow.focus();
                printWindow.print();
            }, { once: true });
        } catch (error) {
            printWindow.close();
            console.error(error);
            notify("Impossible de préparer le rapport du projet.", true);
        }
    }

    function initializeEvents() {
        document.addEventListener("change", event => {
            if (event.target.id !== "reportProjectSelect") return;

            selectedProjectId = event.target.value;
            render();
        });

        document.addEventListener("click", event => {
            const button = event.target.closest("[data-report-action]");
            if (!button) return;

            const action = button.dataset.reportAction;

            if (action === "print-project") {
                printProject();
            }

            if (action === "print-station") {
                printStation(button.dataset.id);
            }

            if (action === "create-project") {
                document.querySelector(
                    '[data-action="new-project"], #newProjectButton'
                )?.click();
            }

            if (action === "create-observation") {
                document.querySelector(
                    '[data-action="new-observation"], #newObservationButton'
                )?.click();
            }
        });

        document.addEventListener("geotechfield:data-updated", () => {
            if (
                document.querySelector(
                    '[data-view-panel="reports"]:not([hidden])'
                )
            ) {
                render();
            }
        });

        window.addEventListener("beforeunload", releaseObjectURLs);
    }

    window.GEOTECHFIELD_REPORTS = Object.freeze({ render });

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initializeEvents, {
            once: true
        });
    } else {
        initializeEvents();
    }
})();
