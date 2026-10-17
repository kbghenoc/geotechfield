
"use strict";

/**
 * GEOTECHFIELD V1
 * Base locale IndexedDB — version 2
 *
 * Magasins :
 *   - projects
 *   - observations
 *   - photos
 *
 * Les photos sont stockées séparément des observations.
 * Aucune connexion à un serveur n'est nécessaire.
 */

(() => {
    const DB_NAME = "geotechfield_database";
    const DB_VERSION = 2;

    const STORES = Object.freeze({
        projects: "projects",
        observations: "observations",
        photos: "photos"
    });

    let databasePromise = null;

    /* -----------------------------------------------------
       Initialisation de la base
    ----------------------------------------------------- */

    function openDatabase() {
        if (databasePromise) {
            return databasePromise;
        }

        databasePromise = new Promise((resolve, reject) => {
            if (!("indexedDB" in window)) {
                databasePromise = null;
                reject(
                    new Error(
                        "IndexedDB n'est pas disponible dans ce navigateur."
                    )
                );
                return;
            }

            let request;

            try {
                request = indexedDB.open(DB_NAME, DB_VERSION);
            } catch (error) {
                databasePromise = null;
                reject(error);
                return;
            }

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                const transaction = event.target.transaction;

                // Magasin des projets : conservé lors de la migration.
                if (!db.objectStoreNames.contains(STORES.projects)) {
                    const store = db.createObjectStore(
                        STORES.projects,
                        { keyPath: "id" }
                    );

                    store.createIndex("name", "name", { unique: false });
                    store.createIndex(
                        "createdAt",
                        "createdAt",
                        { unique: false }
                    );
                }

                // Magasin des observations : conservé lors de la migration.
                if (!db.objectStoreNames.contains(STORES.observations)) {
                    const store = db.createObjectStore(
                        STORES.observations,
                        { keyPath: "id" }
                    );

                    store.createIndex(
                        "stationId",
                        "stationId",
                        { unique: false }
                    );

                    store.createIndex(
                        "projectId",
                        "projectId",
                        { unique: false }
                    );

                    store.createIndex("date", "date", { unique: false });
                    store.createIndex("status", "status", { unique: false });

                    store.createIndex(
                        "createdAt",
                        "createdAt",
                        { unique: false }
                    );
                }

                // Nouveau magasin des photos.
                // Une photo est liée à une observation via observationId.
                if (!db.objectStoreNames.contains(STORES.photos)) {
                    const store = db.createObjectStore(
                        STORES.photos,
                        { keyPath: "id" }
                    );

                    store.createIndex(
                        "observationId",
                        "observationId",
                        { unique: false }
                    );

                    store.createIndex(
                        "createdAt",
                        "createdAt",
                        { unique: false }
                    );
                }

                // Évite les avertissements liés à certains navigateurs.
                void transaction;
            };

            request.onsuccess = () => {
                const db = request.result;

                db.onversionchange = () => {
                    db.close();
                    databasePromise = null;
                };

                db.onclose = () => {
                    databasePromise = null;
                };

                resolve(db);
            };

            request.onerror = () => {
                databasePromise = null;

                reject(
                    request.error ||
                    new Error("Impossible d'ouvrir la base de données.")
                );
            };

            request.onblocked = () => {
                console.warn(
                    "La mise à jour de GEOTECHFIELD est bloquée. " +
                    "Ferme les autres onglets de l'application, puis réessaie."
                );
            };
        });

        return databasePromise;
    }

    /* -----------------------------------------------------
       Transactions génériques
    ----------------------------------------------------- */

    async function executeTransaction(
        storeNames,
        mode,
        operation
    ) {
        const db = await openDatabase();
        const names = Array.isArray(storeNames)
            ? storeNames
            : [storeNames];

        return new Promise((resolve, reject) => {
            let transaction;
            let result;
            let operationError = null;

            try {
                transaction = db.transaction(names, mode);

                result = operation(transaction);

                transaction.oncomplete = () => {
                    if (operationError) {
                        reject(operationError);
                    } else {
                        resolve(result);
                    }
                };

                transaction.onerror = () => {
                    reject(
                        transaction.error ||
                        operationError ||
                        new Error("La transaction a échoué.")
                    );
                };

                transaction.onabort = () => {
                    reject(
                        transaction.error ||
                        operationError ||
                        new Error("La transaction a été annulée.")
                    );
                };
            } catch (error) {
                operationError = error;

                if (transaction) {
                    try {
                        transaction.abort();
                    } catch {
                        reject(error);
                    }
                } else {
                    reject(error);
                }
            }
        });
    }

    async function getAll(storeName) {
        const db = await openDatabase();

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(storeName, "readonly");
            const request = transaction.objectStore(storeName).getAll();

            request.onsuccess = () => {
                resolve(request.result || []);
            };

            request.onerror = () => {
                reject(
                    request.error ||
                    new Error("Impossible de lire les données.")
                );
            };
        });
    }

    async function getById(storeName, id) {
        const db = await openDatabase();

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(storeName, "readonly");
            const request = transaction.objectStore(storeName).get(id);

            request.onsuccess = () => {
                resolve(request.result ?? null);
            };

            request.onerror = () => {
                reject(
                    request.error ||
                    new Error("Impossible de retrouver cet élément.")
                );
            };
        });
    }

    async function getByIndex(storeName, indexName, value) {
        const db = await openDatabase();

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(storeName, "readonly");
            const store = transaction.objectStore(storeName);

            if (!store.indexNames.contains(indexName)) {
                reject(new Error(`Index introuvable : ${indexName}`));
                return;
            }

            const request = store.index(indexName).getAll(value);

            request.onsuccess = () => {
                resolve(request.result || []);
            };

            request.onerror = () => {
                reject(
                    request.error ||
                    new Error("Impossible de lire les données.")
                );
            };
        });
    }

    async function saveRecord(storeName, record) {
        if (!record || !record.id) {
            throw new Error(
                "L'enregistrement doit posséder un identifiant."
            );
        }

        return executeTransaction(
            storeName,
            "readwrite",
            (transaction) => {
                transaction.objectStore(storeName).put(record);
                return record;
            }
        );
    }

    async function deleteRecord(storeName, id) {
        if (!id) {
            throw new Error("Identifiant manquant.");
        }

        return executeTransaction(
            storeName,
            "readwrite",
            (transaction) => {
                transaction.objectStore(storeName).delete(id);
                return true;
            }
        );
    }

    /* -----------------------------------------------------
       Identifiants
    ----------------------------------------------------- */

    function createId(prefix = "record") {
        if (
            typeof crypto !== "undefined" &&
            typeof crypto.randomUUID === "function"
        ) {
            return `${prefix}_${crypto.randomUUID()}`;
        }

        return (
            prefix +
            "_" +
            Date.now().toString(36) +
            "_" +
            Math.random().toString(36).slice(2, 12)
        );
    }

    /* -----------------------------------------------------
       Projets
    ----------------------------------------------------- */

    async function getProjects() {
        const projects = await getAll(STORES.projects);

        return projects.sort((a, b) => {
            const dateA = a.updatedAt || a.createdAt || "";
            const dateB = b.updatedAt || b.createdAt || "";

            return String(dateB).localeCompare(String(dateA));
        });
    }

    async function getProject(id) {
        return getById(STORES.projects, id);
    }

    async function saveProject(project) {
        if (!project || typeof project !== "object") {
            throw new Error("Les informations du projet sont invalides.");
        }

        const now = new Date().toISOString();
        const existing = project.id
            ? await getProject(project.id)
            : null;

        const record = {
            ...project,
            id: project.id || createId("project"),
            name: String(project.name || "").trim(),
            location: String(project.location || "").trim(),
            description: String(project.description || "").trim(),
            createdAt: existing?.createdAt || project.createdAt || now,
            updatedAt: now
        };

        if (!record.name) {
            throw new Error("Le nom du projet est obligatoire.");
        }

        await saveRecord(STORES.projects, record);

        return record;
    }

    async function deleteProject(id) {
        const observations = await getObservationsByProject(id);

        if (observations.length > 0) {
            throw new Error(
                "Ce projet contient des observations. " +
                "Supprime-les ou réaffecte-les avant de supprimer le projet."
            );
        }

        return deleteRecord(STORES.projects, id);
    }

    /* -----------------------------------------------------
       Observations
    ----------------------------------------------------- */

    async function getObservations() {
        const observations = await getAll(STORES.observations);

        return observations.sort((a, b) => {
            const dateA = a.updatedAt || a.createdAt || "";
            const dateB = b.updatedAt || b.createdAt || "";

            return String(dateB).localeCompare(String(dateA));
        });
    }

    async function getObservation(id) {
        return getById(STORES.observations, id);
    }

    async function getObservationsByProject(projectId) {
        return getByIndex(
            STORES.observations,
            "projectId",
            projectId
        );
    }

    async function saveObservation(observation) {
        if (!observation || typeof observation !== "object") {
            throw new Error(
                "Les informations de l'observation sont invalides."
            );
        }

        const now = new Date().toISOString();

        const existing = observation.id
            ? await getObservation(observation.id)
            : null;

        const record = {
            ...observation,
            id: observation.id || createId("observation"),
            stationId: String(observation.stationId || "").trim(),
            projectId: String(observation.projectId || "").trim(),
            date: String(observation.date || "").trim(),
            lithology: String(observation.lithology || "").trim(),
            description: String(observation.description || "").trim(),
            latitude: normalizeCoordinate(observation.latitude),
            longitude: normalizeCoordinate(observation.longitude),
            comments: String(observation.comments || "").trim(),
            status: observation.status === "validated"
                ? "validated"
                : "draft",
            createdAt: existing?.createdAt || observation.createdAt || now,
            updatedAt: now
        };

        validateObservation(record);

        const project = await getProject(record.projectId);

        if (!project) {
            throw new Error(
                "Le projet associé à cette observation n'existe pas."
            );
        }

        await saveRecord(STORES.observations, record);

        return record;
    }

    async function deleteObservation(id) {
        if (!id) {
            throw new Error("Identifiant d'observation manquant.");
        }

        // Suppression de l'observation et de ses photos dans une transaction.
        const photos = await getPhotosByObservation(id);
        const db = await openDatabase();

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(
                [STORES.observations, STORES.photos],
                "readwrite"
            );

            transaction.objectStore(STORES.observations).delete(id);

            const photoStore = transaction.objectStore(STORES.photos);

            for (const photo of photos) {
                photoStore.delete(photo.id);
            }

            transaction.oncomplete = () => resolve(true);

            transaction.onerror = () => {
                reject(
                    transaction.error ||
                    new Error(
                        "Impossible de supprimer l'observation et ses photos."
                    )
                );
            };

            transaction.onabort = () => {
                reject(
                    transaction.error ||
                    new Error("La suppression a été annulée.")
                );
            };
        });
    }

    /* -----------------------------------------------------
       Photos associées aux observations
    ----------------------------------------------------- */

    /**
     * Une photo est un objet :
     * {
     *   id: string,
     *   observationId: string,
     *   name: string,
     *   type: string,
     *   size: number,
     *   blob: Blob,
     *   createdAt: string
     * }
     *
     * La compression et la création des aperçus seront gérées
     * par app.js. Cette couche conserve les fichiers reçus.
     */

    async function getPhotosByObservation(observationId) {
        if (!observationId) {
            return [];
        }

        const photos = await getByIndex(
            STORES.photos,
            "observationId",
            observationId
        );

        return photos.sort((a, b) => {
            return String(a.createdAt || "").localeCompare(
                String(b.createdAt || "")
            );
        });
    }

    async function getPhoto(id) {
        return getById(STORES.photos, id);
    }

    async function savePhoto(photo) {
        if (!photo || typeof photo !== "object") {
            throw new Error("Les informations de la photo sont invalides.");
        }

        const observationId = String(photo.observationId || "").trim();

        if (!observationId) {
            throw new Error(
                "La photo doit être associée à une observation."
            );
        }

        const observation = await getObservation(observationId);

        if (!observation) {
            throw new Error(
                "Impossible d'ajouter une photo : observation introuvable."
            );
        }

        const blob = photo.blob instanceof Blob
            ? photo.blob
            : photo.file instanceof Blob
                ? photo.file
                : null;

        if (!blob || blob.size === 0) {
            throw new Error("Le fichier photo est vide ou invalide.");
        }

        if (blob.type && !blob.type.startsWith("image/")) {
            throw new Error("Le fichier sélectionné n'est pas une image.");
        }

        const now = new Date().toISOString();

        const record = {
            id: photo.id || createId("photo"),
            observationId,
            name: String(photo.name || photo.file?.name || "photo"),
            type: String(photo.type || blob.type || "image/jpeg"),
            size: blob.size,
            blob,
            createdAt: photo.createdAt || now
        };

        await saveRecord(STORES.photos, record);

        return record;
    }

    async function deletePhoto(id) {
        return deleteRecord(STORES.photos, id);
    }

    async function deletePhotosByObservation(observationId) {
        if (!observationId) {
            return 0;
        }

        const photos = await getPhotosByObservation(observationId);

        if (photos.length === 0) {
            return 0;
        }

        const db = await openDatabase();

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORES.photos, "readwrite");
            const store = transaction.objectStore(STORES.photos);

            for (const photo of photos) {
                store.delete(photo.id);
            }

            transaction.oncomplete = () => resolve(photos.length);

            transaction.onerror = () => {
                reject(
                    transaction.error ||
                    new Error("Impossible de supprimer les photos.")
                );
            };

            transaction.onabort = () => {
                reject(
                    transaction.error ||
                    new Error("La suppression des photos a été annulée.")
                );
            };
        });
    }

    async function getPhotoStatistics() {
        const photos = await getAll(STORES.photos);

        return {
            count: photos.length,
            totalBytes: photos.reduce(
                (total, photo) => total + (Number(photo.size) || 0),
                0
            )
        };
    }

    /* -----------------------------------------------------
       Validation des observations
    ----------------------------------------------------- */

    function validateObservation(observation) {
        if (!observation.stationId) {
            throw new Error("L'identifiant de station est obligatoire.");
        }

        if (!observation.projectId) {
            throw new Error("Veuillez sélectionner un projet.");
        }

        if (!observation.date) {
            throw new Error("La date de l'observation est obligatoire.");
        }

        if (!observation.lithology) {
            throw new Error("La lithologie est obligatoire.");
        }

        if (!observation.description) {
            throw new Error(
                "La description géologique est obligatoire."
            );
        }

        const hasLatitude = observation.latitude !== null;
        const hasLongitude = observation.longitude !== null;

        if (hasLatitude !== hasLongitude) {
            throw new Error(
                "La latitude et la longitude doivent être renseignées ensemble."
            );
        }

        if (hasLatitude) {
            if (
                observation.latitude < -90 ||
                observation.latitude > 90
            ) {
                throw new Error(
                    "La latitude doit être comprise entre -90 et 90."
                );
            }

            if (
                observation.longitude < -180 ||
                observation.longitude > 180
            ) {
                throw new Error(
                    "La longitude doit être comprise entre -180 et 180."
                );
            }
        }
    }

    function normalizeCoordinate(value) {
        if (
            value === null ||
            value === undefined ||
            String(value).trim() === ""
        ) {
            return null;
        }

        const number = Number(value);

        if (!Number.isFinite(number)) {
            throw new Error(
                "Une coordonnée GPS n'est pas un nombre valide."
            );
        }

        return number;
    }

    /* -----------------------------------------------------
       Identifiants de station
    ----------------------------------------------------- */

    async function generateStationId() {
        const observations = await getObservations();

        let maxNumber = 0;

        for (const observation of observations) {
            const match = String(observation.stationId || "")
                .match(/^GTF-(\d+)$/i);

            if (match) {
                maxNumber = Math.max(maxNumber, Number(match[1]));
            }
        }

        return `GTF-${String(maxNumber + 1).padStart(4, "0")}`;
    }

    /* -----------------------------------------------------
       Statistiques du tableau de bord
    ----------------------------------------------------- */

    async function getStatistics() {
        const [projects, observations] = await Promise.all([
            getProjects(),
            getObservations()
        ]);

        const drafts = observations.filter(
            (item) => item.status === "draft"
        ).length;

        const withGPS = observations.filter(
            (item) =>
                Number.isFinite(item.latitude) &&
                Number.isFinite(item.longitude)
        ).length;

        return {
            projects: projects.length,
            observations: observations.length,
            drafts,
            validated: observations.length - drafts,
            withGPS
        };
    }

    /* -----------------------------------------------------
       Export JSON
    ----------------------------------------------------- */

    /**
     * Les Blob ne sont pas directement exportables comme des
     * images dans un JSON standard. On les convertit en Base64.
     *
     * Le formatVersion reste 1 pour conserver la compatibilité
     * avec l'importateur existant, qui sera adapté ensuite.
     */

    function blobToDataURL(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = () => resolve(reader.result);

            reader.onerror = () => {
                reject(
                    reader.error ||
                    new Error("Impossible de lire une photo.")
                );
            };

            reader.readAsDataURL(blob);
        });
    }

    function dataURLToBlob(dataURL) {
        if (typeof dataURL !== "string") {
            throw new Error("Données de photo invalides.");
        }

        const match = dataURL.match(
            /^data:([^;,]+)?(;base64)?,(.*)$/s
        );

        if (!match) {
            throw new Error("Format de photo Base64 invalide.");
        }

        const mimeType = match[1] || "application/octet-stream";
        const isBase64 = Boolean(match[2]);
        const payload = match[3];

        if (isBase64) {
            const binary = atob(payload);
            const bytes = new Uint8Array(binary.length);

            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
            }

            return new Blob([bytes], { type: mimeType });
        }

        return new Blob(
            [decodeURIComponent(payload)],
            { type: mimeType }
        );
    }

    async function exportData() {
        const [projects, observations, photos] = await Promise.all([
            getProjects(),
            getObservations(),
            getAll(STORES.photos)
        ]);

        const exportedPhotos = await Promise.all(
            photos.map(async (photo) => ({
                id: photo.id,
                observationId: photo.observationId,
                name: photo.name,
                type: photo.type,
                size: photo.size,
                createdAt: photo.createdAt,
                dataURL: await blobToDataURL(photo.blob)
            }))
        );

        return {
            application: "GEOTECHFIELD",
            formatVersion: 1,
            photoSupport: 1,
            exportedAt: new Date().toISOString(),
            data: {
                projects,
                observations,
                photos: exportedPhotos
            }
        };
    }

    /* -----------------------------------------------------
       Import JSON
    ----------------------------------------------------- */

    async function importData(backup) {
        if (!backup || typeof backup !== "object") {
            throw new Error("Le fichier de sauvegarde est invalide.");
        }

        if (backup.application !== "GEOTECHFIELD") {
            throw new Error(
                "Ce fichier ne provient pas d'une sauvegarde GEOTECHFIELD."
            );
        }

        if (
            !backup.data ||
            !Array.isArray(backup.data.projects) ||
            !Array.isArray(backup.data.observations)
        ) {
            throw new Error(
                "La structure de la sauvegarde est invalide."
            );
        }

        if (backup.formatVersion !== 1) {
            throw new Error(
                "Cette version de sauvegarde n'est pas prise en charge."
            );
        }

        const projects = backup.data.projects;
        const observations = backup.data.observations;
        const photos = Array.isArray(backup.data.photos)
            ? backup.data.photos
            : [];

        const projectIds = new Set();

        for (const project of projects) {
            if (
                !project ||
                typeof project.id !== "string" ||
                !project.id.trim() ||
                typeof project.name !== "string" ||
                !project.name.trim()
            ) {
                throw new Error(
                    "Un projet du fichier de sauvegarde est invalide."
                );
            }

            if (projectIds.has(project.id)) {
                throw new Error(
                    "La sauvegarde contient des identifiants de projet en double."
                );
            }

            projectIds.add(project.id);
        }

        const observationIds = new Set();

        for (const observation of observations) {
            if (
                !observation ||
                typeof observation.id !== "string" ||
                !observation.id.trim()
            ) {
                throw new Error(
                    "Une observation du fichier de sauvegarde est invalide."
                );
            }

            if (observationIds.has(observation.id)) {
                throw new Error(
                    "La sauvegarde contient des identifiants d'observation en double."
                );
            }

            observationIds.add(observation.id);

            validateObservation({
                ...observation,
                latitude: normalizeCoordinate(observation.latitude),
                longitude: normalizeCoordinate(observation.longitude)
            });

            if (!projectIds.has(observation.projectId)) {
                throw new Error(
                    `Le projet associé à la station ${observation.stationId} ` +
                    "est absent de la sauvegarde."
                );
            }
        }

        const photoIds = new Set();

        for (const photo of photos) {
            if (
                !photo ||
                typeof photo.id !== "string" ||
                !photo.id.trim() ||
                !observationIds.has(photo.observationId) ||
                typeof photo.dataURL !== "string"
            ) {
                throw new Error(
                    "Une photo de la sauvegarde est invalide ou " +
                    "associée à une observation absente."
                );
            }

            if (photoIds.has(photo.id)) {
                throw new Error(
                    "La sauvegarde contient des identifiants de photo en double."
                );
            }

            photoIds.add(photo.id);

            // Vérifie le format et le contenu avant d'effacer la base.
            dataURLToBlob(photo.dataURL);
        }

        // Préparer les photos avant de commencer la transaction.
        const preparedPhotos = photos.map((photo) => {
            const blob = dataURLToBlob(photo.dataURL);

            return {
                id: photo.id,
                observationId: photo.observationId,
                name: String(photo.name || "photo"),
                type: String(photo.type || blob.type || "image/jpeg"),
                size: blob.size,
                blob,
                createdAt: photo.createdAt || new Date().toISOString()
            };
        });

        const db = await openDatabase();

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(
                [
                    STORES.projects,
                    STORES.observations,
                    STORES.photos
                ],
                "readwrite"
            );

            const projectStore = transaction.objectStore(STORES.projects);
            const observationStore = transaction.objectStore(
                STORES.observations
            );
            const photoStore = transaction.objectStore(STORES.photos);

            projectStore.clear();
            observationStore.clear();
            photoStore.clear();

            for (const project of projects) {
                projectStore.put(project);
            }

            for (const observation of observations) {
                observationStore.put({
                    ...observation,
                    latitude: normalizeCoordinate(observation.latitude),
                    longitude: normalizeCoordinate(observation.longitude)
                });
            }

            for (const photo of preparedPhotos) {
                photoStore.put(photo);
            }

            transaction.oncomplete = () => {
                resolve({
                    projects: projects.length,
                    observations: observations.length,
                    photos: preparedPhotos.length
                });
            };

            transaction.onerror = () => {
                reject(
                    transaction.error ||
                    new Error("La restauration a échoué.")
                );
            };

            transaction.onabort = () => {
                reject(
                    transaction.error ||
                    new Error("La restauration a été annulée.")
                );
            };
        });
    }

    /* -----------------------------------------------------
       Suppression de toutes les données
    ----------------------------------------------------- */

    async function clearAllData() {
        const db = await openDatabase();

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(
                [
                    STORES.projects,
                    STORES.observations,
                    STORES.photos
                ],
                "readwrite"
            );

            transaction.objectStore(STORES.projects).clear();
            transaction.objectStore(STORES.observations).clear();
            transaction.objectStore(STORES.photos).clear();

            transaction.oncomplete = () => resolve(true);

            transaction.onerror = () => {
                reject(
                    transaction.error ||
                    new Error("Impossible d'effacer les données.")
                );
            };

            transaction.onabort = () => {
                reject(
                    transaction.error ||
                    new Error("L'effacement a été annulé.")
                );
            };
        });
    }

    /* -----------------------------------------------------
       API publique
    ----------------------------------------------------- */

    window.GEOTECHFIELD_DB = Object.freeze({
        openDatabase,

        // Projets
        getProjects,
        getProject,
        saveProject,
        deleteProject,

        // Observations
        getObservations,
        getObservation,
        getObservationsByProject,
        saveObservation,
        deleteObservation,

        // Photos
        getPhotosByObservation,
        getPhoto,
        savePhoto,
        deletePhoto,
        deletePhotosByObservation,
        getPhotoStatistics,

        // Outils
        generateStationId,
        getStatistics,

        // Sauvegardes
        exportData,
        importData,
        clearAllData
    });
})();
