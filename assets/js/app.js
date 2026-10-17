
"use strict";

/* ==========================================================
   GEOTECHFIELD V1
   Projets • Observations • Photos géologiques
   Recherche • GPS manuel • Sauvegardes JSON • IndexedDB
   Dépendance : assets/js/database.js
   ========================================================== */

(() => {
    const DB = window.GEOTECHFIELD_DB;

    const $ = (selector, root = document) =>
        root.querySelector(selector);

    const $$ = (selector, root = document) =>
        Array.from(root.querySelectorAll(selector));

    const state = {
        view: "dashboard",
        projects: [],
        observations: [],
        editingProjectId: null,
        editingObservationId: null,
        previousFocus: null,
        projectFilterId: null,
        initialized: false,

        // Gestion des photos dans le formulaire
        existingPhotos: [],
        removedPhotoIds: [],
        selectedPhotoFiles: [],
        photoObjectURLs: []
    };

    const VIEW_LABELS = {
    dashboard: "Vue d'ensemble",
    projects: "Projets géologiques",
    observations: "Observations de terrain",
    reports: "Rapports de projet",
    settings: "Paramètres et données"
};
    /* ======================================================
       UTILITAIRES
       ====================================================== */

    function escapeHTML(value) {
        return String(value ?? "").replace(/[&<>"']/g, char => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        })[char]);
    }

    function localDate() {
        const now = new Date();
        const offset = now.getTimezoneOffset() * 60000;

        return new Date(now.getTime() - offset)
            .toISOString()
            .slice(0, 10);
    }

    function formatDate(value) {
        if (!value) return "—";

        const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);

        if (Number.isNaN(date.getTime())) {
            return escapeHTML(value);
        }

        return new Intl.DateTimeFormat("fr-FR", {
            day: "2-digit",
            month: "short",
            year: "numeric"
        }).format(date);
    }

    function formatNumber(value) {
        return new Intl.NumberFormat("fr-FR")
            .format(Number(value) || 0);
    }

    function findProject(id) {
        return state.projects.find(
            project => String(project.id) === String(id)
        );
    }

    function projectName(id) {
        return findProject(id)?.name || "Projet inconnu";
    }

    function hasGPS(observation) {
        if (
            observation?.latitude === null ||
            observation?.latitude === undefined ||
            observation?.latitude === "" ||
            observation?.longitude === null ||
            observation?.longitude === undefined ||
            observation?.longitude === ""
        ) {
            return false;
        }

        const lat = Number(observation.latitude);
        const lon = Number(observation.longitude);

        return Number.isFinite(lat) &&
            Number.isFinite(lon) &&
            lat >= -90 && lat <= 90 &&
            lon >= -180 && lon <= 180;
    }

    function setText(id, value) {
        const element = document.getElementById(id);

        if (element) {
            element.textContent = String(value ?? "");
        }
    }

    function toast(message, type = "success") {
        const region = $("#toastRegion");

        if (!region) {
            console.log(`[GEOTECHFIELD] ${message}`);
            return;
        }

        const item = document.createElement("div");

        item.className = `toast toast-${type}`;
        item.setAttribute(
            "role",
            type === "error" ? "alert" : "status"
        );
        item.textContent = message;

        region.appendChild(item);

        requestAnimationFrame(() => item.classList.add("show"));

        window.setTimeout(() => {
            item.classList.remove("show");
            window.setTimeout(() => item.remove(), 250);
        }, 3800);
    }

    function showError(error, fallback = "Une erreur est survenue.") {
        console.error("[GEOTECHFIELD]", error);
        toast(error?.message || fallback, "error");
    }

    function requireDatabase() {
        if (!DB) {
            throw new Error(
                "Base de données indisponible. Vérifie database.js."
            );
        }
    }

    function dispatchDataUpdated() {
        document.dispatchEvent(
            new CustomEvent("geotechfield:data-updated")
        );
    }

    /* ======================================================
       PHOTOS — GESTION DES APERÇUS
       ====================================================== */

    function resetPhotoState() {
        state.photoObjectURLs.forEach(url => URL.revokeObjectURL(url));

        state.photoObjectURLs = [];
        state.existingPhotos = [];
        state.removedPhotoIds = [];
        state.selectedPhotoFiles = [];
    }

    function createPhotoURL(blob) {
        const url = URL.createObjectURL(blob);
        state.photoObjectURLs.push(url);
        return url;
    }

    function renderPhotoPreviews() {
        const container = $("#photoPreviewGrid");

        if (!container) return;

        state.photoObjectURLs.forEach(url => URL.revokeObjectURL(url));
        state.photoObjectURLs = [];

        const existing = state.existingPhotos
            .filter(photo => !state.removedPhotoIds.includes(photo.id))
            .map(photo => ({
                id: photo.id,
                name: photo.name || "Photo existante",
                url: createPhotoURL(photo.blob),
                existing: true
            }));

        const pending = state.selectedPhotoFiles.map((file, index) => ({
            index,
            name: file.name,
            url: createPhotoURL(file),
            existing: false
        }));

        const photos = [...existing, ...pending];

        if (photos.length === 0) {
            container.innerHTML = `
                <div class="photo-empty">
                    <span aria-hidden="true">▧</span>
                    <p>Aucune photo ajoutée.</p>
                    <small>
                        Ajoute des images des roches, affleurements
                        ou formations géologiques.
                    </small>
                </div>`;
            updatePhotoCount();
            return;
        }

        container.innerHTML = photos.map(photo => `
            <article class="photo-card">
                <img
                    src="${escapeHTML(photo.url)}"
                    alt="${escapeHTML(photo.name)}"
                    loading="lazy">

                <div class="photo-card-info">
                    <span title="${escapeHTML(photo.name)}">
                        ${escapeHTML(photo.name)}
                    </span>

                    <button
                        type="button"
                        class="btn btn-small btn-danger"
                        data-action="${
                            photo.existing
                                ? "remove-existing-photo"
                                : "remove-new-photo"
                        }"
                        ${
                            photo.existing
                                ? `data-id="${escapeHTML(photo.id)}"`
                                : `data-index="${photo.index}"`
                        }
                        aria-label="Retirer ${escapeHTML(photo.name)}">
                        Retirer
                    </button>
                </div>
            </article>
        `).join("");

        updatePhotoCount();
    }

    function updatePhotoCount() {
        const count = state.existingPhotos.filter(
            photo => !state.removedPhotoIds.includes(photo.id)
        ).length + state.selectedPhotoFiles.length;

        setText(
            "photoCount",
            `${count} photo${count !== 1 ? "s" : ""}`
        );
    }

    function initializePhotoSelection() {
        $("#modalBody")?.addEventListener("change", event => {
            if (event.target.id !== "observationPhotos") return;

            const files = Array.from(event.target.files || []);
            const maxPhotos = 20;
            const maxSize = 12 * 1024 * 1024;

            const validFiles = [];

            for (const file of files) {
                if (!file.type.startsWith("image/")) {
                    toast(`${file.name} n'est pas une image.`, "error");
                    continue;
                }

                if (file.size > maxSize) {
                    toast(
                        `${file.name} dépasse la limite de 12 Mo.`,
                        "error"
                    );
                    continue;
                }

                validFiles.push(file);
            }

            const currentCount = state.existingPhotos.filter(
                photo => !state.removedPhotoIds.includes(photo.id)
            ).length;

            const available = Math.max(
                0,
                maxPhotos - currentCount - state.selectedPhotoFiles.length
            );

            if (validFiles.length > available) {
                toast(
                    `Tu peux ajouter au maximum ${maxPhotos} photos par observation.`,
                    "error"
                );
            }

            state.selectedPhotoFiles.push(...validFiles.slice(0, available));

            // Permet de sélectionner à nouveau le même fichier.
            event.target.value = "";

            renderPhotoPreviews();
        });
    }

    async function loadObservationPhotos(observationId) {
        if (!observationId) {
            state.existingPhotos = [];
            return;
        }

        if (typeof DB.getPhotosByObservation !== "function") {
            throw new Error(
                "La gestion des photos manque dans database.js."
            );
        }

        state.existingPhotos =
            await DB.getPhotosByObservation(observationId);
    }

    async function saveObservationPhotos(observationId) {
        for (const photoId of state.removedPhotoIds) {
            await DB.deletePhoto(photoId);
        }

        for (const file of state.selectedPhotoFiles) {
            await DB.savePhoto({
                observationId,
                name: file.name,
                type: file.type,
                blob: file
            });
        }
    }

    /* ======================================================
       NAVIGATION
       ====================================================== */

    function navigate(view) {
        if (!VIEW_LABELS[view]) return;

        const panel = $(`[data-view-panel="${view}"]`);

        if (!panel && view !== "dashboard") {
            toast(`La vue « ${VIEW_LABELS[view]} » est introuvable.`, "error");
            return;
        }

        state.view = view;

        $$("[data-view-panel]").forEach(item => {
            item.hidden = item.dataset.viewPanel !== view;
        });

        $$("[data-view]").forEach(button => {
            const active = button.dataset.view === view;

            if (
                button.classList.contains("nav-item") ||
                button.getAttribute("role") === "tab"
            ) {
                button.classList.toggle("active", active);

                if (active) {
                    button.setAttribute("aria-current", "page");
                } else {
                    button.removeAttribute("aria-current");
                }
            }
        });

        setText("breadcrumbCurrent", VIEW_LABELS[view]);

        if (view === "dashboard") renderDashboard();
        if (view === "projects") renderProjects();
        if (view === "observations") renderObservations();

        if (view === "reports") {
    window.GEOTECHFIELD_REPORTS?.render();
}
        closeMobileSidebar();
    }

    function closeMobileSidebar() {
        const sidebar =
            $("#appSidebar") || $(".app-sidebar") || $(".sidebar");

        if (window.matchMedia("(max-width: 900px)").matches) {
            sidebar?.classList.remove("open");
            document.body.classList.remove("mobile-sidebar-open");
            $("#mobileMenu")?.setAttribute("aria-expanded", "false");
        }
    }

    function initializeNavigation() {
        document.addEventListener("click", event => {
            const button = event.target.closest("[data-view]");

            if (!button) return;

            event.preventDefault();
            navigate(button.dataset.view);
        });

        $("#mobileMenu")?.addEventListener("click", () => {
            const sidebar =
                $("#appSidebar") || $(".app-sidebar") || $(".sidebar");

            if (!sidebar) return;

            const open = sidebar.classList.toggle("open");

            document.body.classList.toggle("mobile-sidebar-open", open);
            $("#mobileMenu")?.setAttribute("aria-expanded", String(open));
        });
    }

    /* ======================================================
       MODALES
       ====================================================== */

    function openModal(title, content, eyebrow = "GEOTECHFIELD") {
        const backdrop = $("#modalBackdrop");
        const modalTitle = $("#modalTitle");
        const modalBody = $("#modalBody");

        if (!backdrop || !modalBody || !modalTitle) {
            toast("La fenêtre de dialogue est introuvable.", "error");
            return;
        }

        state.previousFocus = document.activeElement;

        modalTitle.textContent = title;

        const label = $("#modalEyebrow");
        if (label) label.textContent = eyebrow;

        modalBody.innerHTML = content;
        backdrop.hidden = false;
        backdrop.setAttribute("aria-hidden", "false");

        document.body.classList.add("modal-open");

        requestAnimationFrame(() => {
            modalBody.querySelector(
                "input:not([type=hidden]), select, textarea, button"
            )?.focus();
        });
    }

    function closeModal() {
        const backdrop = $("#modalBackdrop");

        if (!backdrop || backdrop.hidden) return;

        resetPhotoState();

        backdrop.hidden = true;
        backdrop.setAttribute("aria-hidden", "true");
        document.body.classList.remove("modal-open");

        const body = $("#modalBody");
        if (body) body.innerHTML = "";

        state.editingProjectId = null;
        state.editingObservationId = null;

        if (state.previousFocus?.isConnected) {
            state.previousFocus.focus();
        }

        state.previousFocus = null;
    }

    function initializeModals() {
        $("#closeModal")?.addEventListener("click", closeModal);

        $("#modalBackdrop")?.addEventListener("click", event => {
            if (event.target === $("#modalBackdrop")) closeModal();
        });

        document.addEventListener("keydown", event => {
            if (event.key === "Escape") closeModal();
        });
    }

    /* ======================================================
       CHARGEMENT DES DONNÉES
       ====================================================== */

    async function loadData() {
        requireDatabase();

        const [projects, observations] = await Promise.all([
            DB.getProjects(),
            DB.getObservations()
        ]);

        state.projects = Array.isArray(projects) ? projects : [];
        state.observations = Array.isArray(observations) ? observations : [];

        renderDashboard();

        if (state.view === "projects") renderProjects();
        if (state.view === "observations") renderObservations();

        dispatchDataUpdated();
    }

    /* ======================================================
       TABLEAU DE BORD
       ====================================================== */

    function renderDashboard() {
        setText("statProjects", formatNumber(state.projects.length));
        setText("statObservations", formatNumber(state.observations.length));

        setText(
            "statDrafts",
            formatNumber(state.observations.filter(
                item => item.status === "draft"
            ).length)
        );

        setText(
            "statGPS",
            formatNumber(state.observations.filter(hasGPS).length)
        );

        const container = $("#recentObservations");
        if (!container) return;

        const recent = [...state.observations]
            .sort((a, b) =>
                String(b.date || "").localeCompare(String(a.date || ""))
            )
            .slice(0, 5);

        if (!recent.length) {
            container.innerHTML = `
                <div class="empty-state compact-empty">
                    <div class="empty-state-icon">⌖</div>
                    <h3>Aucune observation pour le moment</h3>
                    <p>Crée un projet puis enregistre ta première station.</p>
                    <button type="button" class="btn btn-primary"
                        data-action="new-observation">
                        + Nouvelle observation
                    </button>
                </div>`;
            return;
        }

        container.innerHTML = recent.map(item => `
            <article class="recent-observation">
                <div class="recent-observation-marker">⌖</div>
                <div class="recent-observation-content">
                    <strong>${escapeHTML(item.stationId || "Station")}</strong>
                    <p>${escapeHTML(item.description || "Sans description")}</p>
                    <span>
                        ${escapeHTML(item.lithology || "Lithologie non précisée")}
                        · ${escapeHTML(formatDate(item.date))}
                    </span>
                    <div class="table-subtext">
                        ${escapeHTML(projectName(item.projectId))}
                    </div>
                </div>
                <div class="recent-observation-status">
                    <span class="status-badge ${
                        item.status === "validated"
                            ? "status-validated" : "status-draft"
                    }">
                        ${item.status === "validated" ? "Validée" : "Brouillon"}
                    </span>
                    <button type="button" class="btn btn-small btn-secondary"
                        data-action="edit-observation"
                        data-id="${escapeHTML(item.id)}">
                        Ouvrir
                    </button>
                </div>
            </article>
        `).join("");
    }

    /* ======================================================
       PROJETS
       ====================================================== */

    function renderProjects() {
        const grid = $("#projectsGrid");
        if (!grid) return;

        const query = ($("#projectSearch")?.value || "")
            .trim().toLocaleLowerCase("fr");

        const filtered = state.projects.filter(project =>
            [
                project.name,
                project.location,
                project.description
            ].join(" ").toLocaleLowerCase("fr").includes(query)
        );

        setText("projectResultCount", `${filtered.length} projet(s)`);

        if (!filtered.length) {
            grid.innerHTML = `
                <div class="empty-state">
                    <h3>${query ? "Aucun résultat" : "Aucun projet créé"}</h3>
                    <p>${
                        query
                            ? "Essaie un autre terme."
                            : "Crée un projet pour organiser tes observations."
                    }</p>
                    <button type="button" class="btn btn-primary"
                        data-action="new-project">
                        + Créer un projet
                    </button>
                </div>`;
            return;
        }

        grid.innerHTML = filtered.map(project => {
            const count = state.observations.filter(
                item => String(item.projectId) === String(project.id)
            ).length;

            return `
                <article class="project-card">
                    <div class="project-card-header">
                        <div class="project-icon">⌖</div>
                        <div class="project-card-actions">
                            <button type="button" class="btn btn-small btn-secondary"
                                data-action="edit-project"
                                data-id="${escapeHTML(project.id)}">Modifier</button>
                            <button type="button" class="btn btn-small btn-danger"
                                data-action="delete-project"
                                data-id="${escapeHTML(project.id)}">Supprimer</button>
                        </div>
                    </div>
                    <h3>${escapeHTML(project.name)}</h3>
                    <div class="project-location">
                        ${escapeHTML(project.location || "Localisation non précisée")}
                    </div>
                    <div class="project-card-description">
                        ${escapeHTML(project.description || "Aucune description.")}
                    </div>
                    <div class="project-card-footer">
                        <span>${formatNumber(count)} observation(s)</span>
                        <button type="button" class="btn btn-small btn-secondary"
                            data-action="view-project-observations"
                            data-id="${escapeHTML(project.id)}">
                            Voir les observations →
                        </button>
                    </div>
                </article>`;
        }).join("");
    }

    function projectForm(project = null) {
        const editing = Boolean(project);
        state.editingProjectId = project?.id ?? null;

        openModal(
            editing ? "Modifier le projet" : "Nouveau projet",
            `
            <form id="projectForm" class="form-grid">
                <div class="form-field">
                    <label class="form-label" for="projectName">Nom du projet *</label>
                    <input class="form-input" id="projectName" name="name"
                        maxlength="140" required
                        value="${escapeHTML(project?.name || "")}"
                        placeholder="Ex. Cartographie du secteur nord">
                </div>
                <div class="form-field">
                    <label class="form-label" for="projectLocation">Localisation</label>
                    <input class="form-input" id="projectLocation" name="location"
                        maxlength="180"
                        value="${escapeHTML(project?.location || "")}">
                </div>
                <div class="form-field">
                    <label class="form-label" for="projectDescription">Description</label>
                    <textarea class="form-textarea" id="projectDescription"
                        name="description" maxlength="3000">${escapeHTML(
                            project?.description || ""
                        )}</textarea>
                </div>
                <div class="form-actions">
                    <button type="button" class="btn btn-secondary"
                        data-action="close-modal">Annuler</button>
                    <button type="submit" class="btn btn-primary">
                        ${editing ? "Enregistrer les modifications" : "Créer le projet"}
                    </button>
                </div>
            </form>`,
            editing ? "MODIFICATION DU PROJET" : "NOUVEAU PROJET"
        );
    }

    async function saveProjectForm(form) {
        const data = new FormData(form);
        const isEditing = state.editingProjectId !== null;

        const project = {
            name: String(data.get("name") || "").trim(),
            location: String(data.get("location") || "").trim(),
            description: String(data.get("description") || "").trim()
        };

        if (!project.name) {
            toast("Le nom du projet est obligatoire.", "error");
            return;
        }

        if (isEditing) project.id = state.editingProjectId;

        const button = form.querySelector('[type="submit"]');
        if (button) button.disabled = true;

        try {
            await DB.saveProject(project);
            closeModal();
            toast(isEditing ? "Projet modifié." : "Projet créé.");
            await loadData();
            navigate("projects");
        } catch (error) {
            showError(error, "Impossible d'enregistrer le projet.");
            if (button) button.disabled = false;
        }
    }

    async function deleteProject(id) {
        const project = findProject(id);
        if (!project) return;

        if (!window.confirm(
            `Supprimer le projet « ${project.name} » ?\n` +
            "La suppression est refusée si des observations existent."
        )) return;

        try {
            await DB.deleteProject(id);
            toast("Projet supprimé.");
            await loadData();
            navigate("projects");
        } catch (error) {
            showError(error, "Impossible de supprimer ce projet.");
        }
    }

    /* ======================================================
       OBSERVATIONS — LISTE
       ====================================================== */

    function renderObservations() {
        const tbody = $("#observationsTable");
        const empty = $("#observationsEmpty");
        const tableContainer = $("#observationsTableContainer");

        if (!tbody) return;

        const query = ($("#observationSearch")?.value || "")
            .trim().toLocaleLowerCase("fr");

        const status = $("#observationStatusFilter")?.value || "all";

        const filtered = state.observations.filter(item => {
            const text = [
                item.stationId,
                item.lithology,
                item.description,
                item.comments,
                projectName(item.projectId)
            ].join(" ").toLocaleLowerCase("fr");

            return text.includes(query) &&
                (status === "all" || item.status === status) &&
                (!state.projectFilterId ||
                    String(item.projectId) === String(state.projectFilterId));
        }).sort((a, b) =>
            String(b.date || "").localeCompare(String(a.date || ""))
        );

        setText("observationResultCount", `${filtered.length} observation(s)`);

        const notice = $("#projectFilterNotice");

        if (notice) {
            notice.hidden = !state.projectFilterId;
            notice.textContent = state.projectFilterId
                ? `Filtre projet : ${projectName(state.projectFilterId)}`
                : "";
        }

        if (!filtered.length) {
            tbody.innerHTML = "";

            if (empty) {
                empty.hidden = false;
                empty.innerHTML = `
                    <h3>Aucune observation trouvée</h3>
                    <p>Modifie les filtres ou crée une nouvelle observation.</p>
                    ${state.projectFilterId ? `
                        <button type="button" class="btn btn-secondary"
                            data-action="clear-project-filter">
                            Effacer le filtre projet
                        </button>` : ""}
                    <button type="button" class="btn btn-primary"
                        data-action="new-observation">
                        + Nouvelle observation
                    </button>`;
            }

            if (tableContainer) tableContainer.hidden = true;
            return;
        }

        if (empty) empty.hidden = true;
        if (tableContainer) tableContainer.hidden = false;

        tbody.innerHTML = filtered.map(item => `
            <tr>
                <td>
                    <strong>${escapeHTML(item.stationId || "Station")}</strong>
                    <div class="table-subtext">${escapeHTML(formatDate(item.date))}</div>
                </td>
                <td>${escapeHTML(projectName(item.projectId))}</td>
                <td>${escapeHTML(item.lithology || "—")}</td>
                <td class="observation-description-cell">
                    ${escapeHTML(item.description || "—")}
                </td>
                <td>
                    <span class="status-badge ${
                        item.status === "validated"
                            ? "status-validated" : "status-draft"
                    }">
                        ${item.status === "validated" ? "Validée" : "Brouillon"}
                    </span>
                </td>
                <td>
                    <div class="table-actions">
                        <button type="button" class="btn btn-small btn-secondary"
                            data-action="edit-observation"
                            data-id="${escapeHTML(item.id)}">Modifier</button>
                        ${item.status !== "validated" ? `
                            <button type="button" class="btn btn-small btn-secondary"
                                data-action="validate-observation"
                                data-id="${escapeHTML(item.id)}">Valider</button>` : ""}
                        <button type="button" class="btn btn-small btn-danger"
                            data-action="delete-observation"
                            data-id="${escapeHTML(item.id)}">Supprimer</button>
                    </div>
                </td>
            </tr>
        `).join("");
    }

    /* ======================================================
       FORMULAIRE D'OBSERVATION ET PHOTOS
       ====================================================== */

    async function observationForm(observation = null, presetProjectId = null) {
        if (!state.projects.length) {
            openModal(
                "Créer un projet d'abord",
                `<div class="empty-state">
                    <h3>Aucun projet disponible</h3>
                    <p>Chaque observation doit être associée à un projet.</p>
                    <button type="button" class="btn btn-primary"
                        data-action="new-project">+ Créer un projet</button>
                </div>`,
                "PRÉPARATION DU CARNET"
            );
            return;
        }

        resetPhotoState();

        const editingId = observation?.id ?? null;
        state.editingObservationId = editingId;

        let stationId = observation?.stationId || "";

        if (!stationId) {
            stationId = await DB.generateStationId();
        }

        if (state.editingObservationId !== editingId) return;

        if (editingId) {
            try {
                await loadObservationPhotos(editingId);
            } catch (error) {
                showError(error, "Impossible de charger les photos.");
                return;
            }
        }

        if (state.editingObservationId !== editingId) return;

        const projectOptions = state.projects.map(project => `
            <option value="${escapeHTML(project.id)}"
                ${
                    String(observation?.projectId ?? presetProjectId ?? "") ===
                    String(project.id) ? "selected" : ""
                }>
                ${escapeHTML(project.name)}
            </option>
        `).join("");

        openModal(
            observation ? "Modifier l'observation" : "Nouvelle observation",
            `
            <form id="observationForm" class="form-grid">
                <div class="form-grid form-grid-two">
                    <div class="form-field">
                        <label class="form-label" for="observationStation">
                            Identifiant de station *
                        </label>
                        <input class="form-input" id="observationStation"
                            name="stationId" maxlength="60" required
                            value="${escapeHTML(stationId)}">
                    </div>
                    <div class="form-field">
                        <label class="form-label" for="observationDate">Date *</label>
                        <input class="form-input" id="observationDate"
                            name="date" type="date" required
                            value="${escapeHTML(observation?.date || localDate())}">
                    </div>
                </div>

                <div class="form-field">
                    <label class="form-label" for="observationProject">Projet *</label>
                    <select class="form-select" id="observationProject"
                        name="projectId" required>
                        <option value="">Sélectionner un projet</option>
                        ${projectOptions}
                    </select>
                </div>

                <div class="form-field">
                    <label class="form-label" for="observationLithology">
                        Lithologie *
                    </label>
                    <input class="form-input" id="observationLithology"
                        name="lithology" maxlength="160" required
                        placeholder="Ex. Grès fin, argilite, calcaire..."
                        value="${escapeHTML(observation?.lithology || "")}">
                </div>

                <div class="form-field">
                    <label class="form-label" for="observationDescription">
                        Description géologique *
                    </label>
                    <textarea class="form-textarea"
                        id="observationDescription" name="description"
                        maxlength="6000" required
                        placeholder="Couleur, granulométrie, structures, contacts...">${escapeHTML(
                            observation?.description || ""
                        )}</textarea>
                </div>

                <div class="form-grid form-grid-two">
                    <div class="form-field">
                        <label class="form-label" for="observationLatitude">
                            Latitude
                        </label>
                        <input class="form-input" id="observationLatitude"
                            name="latitude" type="number" step="any"
                            min="-90" max="90"
                            value="${escapeHTML(observation?.latitude ?? "")}">
                    </div>
                    <div class="form-field">
                        <label class="form-label" for="observationLongitude">
                            Longitude
                        </label>
                        <input class="form-input" id="observationLongitude"
                            name="longitude" type="number" step="any"
                            min="-180" max="180"
                            value="${escapeHTML(observation?.longitude ?? "")}">
                    </div>
                </div>

                <p class="form-help">
                    Renseigne les deux coordonnées GPS, ou laisse les deux champs vides.
                </p>

                <!-- PHOTOS GÉOLOGIQUES -->
                <section class="photo-section">
                    <div class="photo-section-heading">
                        <div>
                            <h3>Photos de terrain</h3>
                            <p>
                                Photographie les roches, affleurements,
                                échantillons et structures géologiques.
                            </p>
                        </div>
                        <span id="photoCount" class="status-badge">0 photo</span>
                    </div>

                    <label class="photo-upload-zone" for="observationPhotos">
                        <span class="photo-upload-icon" aria-hidden="true">＋</span>
                        <strong>Ajouter des photos</strong>
                        <span>
                            Clique pour choisir des images sur ton appareil.
                        </span>
                        <small>Images uniquement · 12 Mo maximum par photo</small>
                    </label>

                    <input
                        id="observationPhotos"
                        type="file"
                        accept="image/*"
                        multiple
                        capture="environment"
                        class="photo-file-input">

                    <div id="photoPreviewGrid" class="photo-preview-grid">
                        <div class="photo-empty">
                            <p>Aucune photo ajoutée.</p>
                        </div>
                    </div>
                </section>

                <div class="form-field">
                    <label class="form-label" for="observationComments">
                        Notes complémentaires
                    </label>
                    <textarea class="form-textarea"
                        id="observationComments" name="comments"
                        maxlength="4000"
                        placeholder="Échantillons, contexte, remarques...">${escapeHTML(
                            observation?.comments || ""
                        )}</textarea>
                </div>

                <div class="form-field">
                    <label class="form-label" for="observationStatus">Statut</label>
                    <select class="form-select" id="observationStatus" name="status">
                        <option value="draft" ${
                            observation?.status !== "validated" ? "selected" : ""
                        }>Brouillon</option>
                        <option value="validated" ${
                            observation?.status === "validated" ? "selected" : ""
                        }>Validée</option>
                    </select>
                </div>

                <div class="form-actions">
                    <button type="button" class="btn btn-secondary"
                        data-action="close-modal">Annuler</button>
                    <button type="submit" class="btn btn-primary">
                        ${observation ? "Enregistrer les modifications" : "Enregistrer l'observation"}
                    </button>
                </div>
            </form>`,
            observation ? "MODIFICATION DE STATION" : "NOUVELLE STATION"
        );

        renderPhotoPreviews();
    }

    async function saveObservationForm(form) {
        const data = new FormData(form);
        const editingId = state.editingObservationId;
        const isEditing = editingId !== null;

        const stationId = String(data.get("stationId") || "").trim();
        const projectId = String(data.get("projectId") || "").trim();
        const date = String(data.get("date") || "").trim();
        const lithology = String(data.get("lithology") || "").trim();
        const description = String(data.get("description") || "").trim();
        const latRaw = String(data.get("latitude") ?? "").trim();
        const lonRaw = String(data.get("longitude") ?? "").trim();

        if (!stationId || !projectId || !date || !lithology || !description) {
            toast("Remplis tous les champs obligatoires.", "error");
            return;
        }

        if (!findProject(projectId)) {
            toast("Sélectionne un projet valide.", "error");
            return;
        }

        if (Boolean(latRaw) !== Boolean(lonRaw)) {
            toast("Renseigne les deux coordonnées GPS, ou laisse-les vides.", "error");
            return;
        }

        let latitude = null;
        let longitude = null;

        if (latRaw && lonRaw) {
            latitude = Number(latRaw);
            longitude = Number(lonRaw);

            if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
                toast("La latitude doit être comprise entre -90 et 90.", "error");
                return;
            }

            if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
                toast("La longitude doit être comprise entre -180 et 180.", "error");
                return;
            }
        }

        const observation = {
            stationId,
            projectId,
            date,
            lithology,
            description,
            latitude,
            longitude,
            comments: String(data.get("comments") || "").trim(),
            status: data.get("status") === "validated" ? "validated" : "draft"
        };

        if (isEditing) observation.id = editingId;

        const button = form.querySelector('[type="submit"]');
        if (button) {
            button.disabled = true;
            button.textContent = "Enregistrement...";
        }

        try {
            // 1. Enregistrer d'abord l'observation.
            const saved = await DB.saveObservation(observation);

            // 2. Enregistrer ou supprimer les photos associées.
            await saveObservationPhotos(saved.id);

            closeModal();

            const photoCount = (
                await DB.getPhotosByObservation(saved.id)
            ).length;

            toast(
                `${isEditing ? "Observation modifiée" : "Observation enregistrée"} — ${photoCount} photo(s).`
            );

            await loadData();
            navigate("observations");
        } catch (error) {
            showError(
                error,
                "Impossible d'enregistrer l'observation et ses photos."
            );

            if (button) {
                button.disabled = false;
                button.textContent = isEditing
                    ? "Enregistrer les modifications"
                    : "Enregistrer l'observation";
            }
        }
    }

    async function validateObservation(id) {
        const observation = state.observations.find(
            item => String(item.id) === String(id)
        );

        if (!observation) return;

        try {
            await DB.saveObservation({ ...observation, status: "validated" });
            toast("Observation validée.");
            await loadData();
        } catch (error) {
            showError(error, "Impossible de valider l'observation.");
        }
    }

    async function deleteObservation(id) {
        const observation = state.observations.find(
            item => String(item.id) === String(id)
        );

        if (!observation) return;

        if (!window.confirm(
            `Supprimer l'observation ${observation.stationId || ""} et ses photos ?\nCette action est définitive.`
        )) return;

        try {
            // database.js supprime également les photos associées.
            await DB.deleteObservation(id);
            toast("Observation et photos supprimées.");
            await loadData();
        } catch (error) {
            showError(error, "Impossible de supprimer cette observation.");
        }
    }

    /* ======================================================
       EXPORT JSON
       ====================================================== */

    async function exportJSON() {
        try {
            const backup = await DB.exportData();

            const blob = new Blob(
                [JSON.stringify(backup, null, 2)],
                { type: "application/json;charset=utf-8" }
            );

            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");

            link.href = url;
            link.download = `geotechfield-backup-${localDate()}.json`;

            document.body.appendChild(link);
            link.click();
            link.remove();

            setTimeout(() => URL.revokeObjectURL(url), 1000);

            toast("Sauvegarde JSON préparée, photos incluses.");
        } catch (error) {
            showError(error, "Impossible d'exporter les données.");
        }
    }

    /* ======================================================
       IMPORT JSON
       ====================================================== */

    function importJSON() {
        const input = document.createElement("input");

        input.type = "file";
        input.accept = ".json,application/json";
        input.hidden = true;

        document.body.appendChild(input);

        input.addEventListener("change", async () => {
            const file = input.files?.[0];

            if (!file) {
                input.remove();
                return;
            }

            try {
                const backup = JSON.parse(await file.text());

                if (!window.confirm(
                    "Restaurer cette sauvegarde ?\n\nLes données actuelles de cet appareil seront remplacées."
                )) return;

                const result = await DB.importData(backup);

                state.projectFilterId = null;

                await loadData();
                navigate("dashboard");

                toast(
                    `Sauvegarde restaurée : ${result.projects} projet(s), ` +
                    `${result.observations} observation(s), ${result.photos || 0} photo(s).`
                );
            } catch (error) {
                showError(error, "Fichier JSON invalide ou incompatible.");
            } finally {
                input.remove();
            }
        });

        input.click();
    }

    /* ======================================================
       SUPPRESSION DE TOUTES LES DONNÉES
       ====================================================== */

    async function clearData() {
        if (!window.confirm(
            "Supprimer tous les projets, observations et photos de cet appareil ?"
        )) return;

        if (!window.confirm(
            "Dernière confirmation : cette opération est définitive sans sauvegarde."
        )) return;

        try {
            await DB.clearAllData();
            state.projectFilterId = null;
            await loadData();
            navigate("dashboard");
            toast("Toutes les données locales ont été supprimées.");
        } catch (error) {
            showError(error, "Impossible de supprimer les données.");
        }
    }

    /* ======================================================
       À PROPOS
       ====================================================== */

    function showAbout() {
        openModal(
            "À propos de GEOTECHFIELD",
            `
            <div class="about-content">
                <div class="about-brand-mark">G</div>
                <h3>GEOTECHFIELD</h3>
                <p><strong>Geological Field Notebook</strong></p>
                <p>
                    Un carnet numérique pour organiser les projets,
                    les observations et les photos géologiques de terrain.
                </p>
                <p>
                    <strong>Version :</strong> V1<br>
                    <strong>Stockage :</strong> IndexedDB local<br>
                    <strong>Photos :</strong> stockage local par observation<br>
                    <strong>Sauvegarde :</strong> JSON avec les photos
                </p>
                <p>
                    Les données ne sont pas automatiquement synchronisées
                    entre appareils. Conserve des sauvegardes régulières.
                </p>
                <div class="form-actions">
                    <button type="button" class="btn btn-primary"
                        data-action="close-modal">Fermer</button>
                </div>
            </div>`,
            "GEOLOGICAL DATA WORKSPACE"
        );
    }

    /* ======================================================
       ACTIONS
       ====================================================== */

    function initializeActions() {
        $("#heroNewObservation")?.addEventListener("click", () => observationForm());
        $("#emptyNewObservation")?.addEventListener("click", () => observationForm());
        $("#newObservationButton")?.addEventListener("click", () => observationForm());
        $("#quickObservation")?.addEventListener("click", () => observationForm());

        $("#heroNewProject")?.addEventListener("click", () => projectForm());
        $("#newProjectButton")?.addEventListener("click", () => projectForm());
        $("#quickProject")?.addEventListener("click", () => projectForm());

        $("#quickExport")?.addEventListener("click", exportJSON);
        $("#exportJSON")?.addEventListener("click", exportJSON);
        $("#importJSON")?.addEventListener("click", importJSON);
        $("#clearData")?.addEventListener("click", clearData);
        $("#aboutButton")?.addEventListener("click", showAbout);

        $("#projectSearch")?.addEventListener("input", renderProjects);
        $("#observationSearch")?.addEventListener("input", renderObservations);
        $("#observationStatusFilter")?.addEventListener("change", renderObservations);

        initializePhotoSelection();

        $("#modalBody")?.addEventListener("submit", async event => {
            event.preventDefault();

            if (event.target.id === "projectForm") {
                await saveProjectForm(event.target);
            }

            if (event.target.id === "observationForm") {
                await saveObservationForm(event.target);
            }
        });

        document.addEventListener("click", async event => {
            const button = event.target.closest("[data-action]");
            if (!button) return;

            const action = button.dataset.action;
            const id = button.dataset.id;

            try {
                switch (action) {
                    case "new-project":
                        projectForm();
                        break;

                    case "new-observation":
                        await observationForm();
                        break;

                    case "edit-project": {
                        const project = findProject(id);
                        if (project) projectForm(project);
                        break;
                    }

                    case "delete-project":
                        await deleteProject(id);
                        break;

                    case "edit-observation": {
                        const observation = state.observations.find(
                            item => String(item.id) === String(id)
                        );
                        if (observation) await observationForm(observation);
                        break;
                    }

                    case "delete-observation":
                        await deleteObservation(id);
                        break;

                    case "validate-observation":
                        await validateObservation(id);
                        break;

                    case "view-project-observations": {
                        const project = findProject(id);
                        if (!project) {
                            toast("Projet introuvable.", "error");
                            break;
                        }

                        state.projectFilterId = project.id;

                        if ($("#observationSearch")) {
                            $("#observationSearch").value = "";
                        }

                        if ($("#observationStatusFilter")) {
                            $("#observationStatusFilter").value = "all";
                        }

                        navigate("observations");
                        break;
                    }

                    case "clear-project-filter":
                        state.projectFilterId = null;
                        renderObservations();
                        break;

                    case "close-modal":
                        closeModal();
                        break;

                    case "remove-existing-photo":
                        state.removedPhotoIds.push(id);
                        renderPhotoPreviews();
                        break;

                    case "remove-new-photo": {
                        const index = Number(button.dataset.index);

                        if (Number.isInteger(index) && index >= 0) {
                            state.selectedPhotoFiles.splice(index, 1);
                            renderPhotoPreviews();
                        }
                        break;
                    }
                }
            } catch (error) {
                showError(error);
            }
        });
    }

    /* ======================================================
       INITIALISATION
       ====================================================== */

    async function initialize() {
        if (state.initialized) return;
        state.initialized = true;

        initializeNavigation();
        initializeModals();
        initializeActions();

        try {
            requireDatabase();

            if (typeof DB.openDatabase === "function") {
                await DB.openDatabase();
            }

            await loadData();
            navigate("dashboard");
        } catch (error) {
            showError(error, "Impossible de charger GEOTECHFIELD.");

            const recent = $("#recentObservations");

            if (recent) {
                recent.innerHTML = `
                    <div class="empty-state compact-empty">
                        <h3>Base de données indisponible</h3>
                        <p>
                            Recharge la page. Si le problème persiste,
                            vérifie la console du navigateur.
                        </p>
                    </div>`;
            }
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initialize, { once: true });
    } else {
        initialize();
    }
})();
