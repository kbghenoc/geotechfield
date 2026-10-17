
"use strict";

const CACHE_NAME = "geotechfield-shell-v1";

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./assets/js/database.js",
  "./assets/js/app.js",
  "./assets/js/reports.js",
  "./assets/icons/icon.svg"
  // Ajoute ici le chemin exact de ta feuille CSS.
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.all(
        APP_SHELL.map(async (url) => {
          try {
            await cache.add(url);
          } catch (error) {
            // Un fichier manquant ne doit pas bloquer
            // l'installation complète du Service Worker.
            console.warn("Fichier non mis en cache :", url);
          }
        })
      );

      await self.skipWaiting();
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key.startsWith("geotechfield-shell-") &&
                key !== CACHE_NAME
            )
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Ne pas intercepter les ressources d'autres sites.
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    // En ligne : récupérer la page actualisée.
    // Hors ligne : afficher la page déjà mise en cache.
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();

            caches.open(CACHE_NAME).then((cache) => {
              cache.put("./index.html", copy);
            });
          }

          return response;
        })
        .catch(async () => {
          const cachedPage = await caches.match("./index.html");

          if (cachedPage) return cachedPage;

          return new Response(
            "GEOTECHFIELD est hors ligne. Ouvre l'application depuis sa page déjà chargée.",
            {
              status: 503,
              headers: { "Content-Type": "text/plain; charset=utf-8" }
            }
          );
        })
    );

    return;
  }

  // Ressources statiques : cache d'abord, réseau ensuite.
  event.respondWith(
    caches.match(request).then(async (cached) => {
      if (cached) return cached;

      try {
        const response = await fetch(request);

        if (response.ok) {
          const copy = response.clone();

          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, copy);
          });
        }

        return response;
      } catch {
        return new Response("", { status: 503 });
      }
    })
  );
});
